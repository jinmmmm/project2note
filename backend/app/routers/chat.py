import uuid

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.db.database import get_db, ChatMessage, Note, Task, Transcript, ProviderConfig, ShareLink, User
from app.exceptions.biz_exception import BizException
from app.services.chat_service import (
    chat_with_rag,
    chat_with_tasks,
    global_session_task_id,
)
from app.utils.response import success
from app.utils.crypto import decrypt_secret

router = APIRouter(prefix="/chat", tags=["chat"])


def _load_note_fallbacks(db: Session, task_ids: list[str], user_id: str | None = None) -> list[dict]:
    fallbacks: list[dict] = []
    for tid in task_ids:
        note = db.query(Note).filter(Note.task_id == tid, *(([Note.user_id == user_id]) if user_id else [])).first()
        markdown = ""
        if note:
            markdown = (note.markdown_edited or note.markdown_raw or "").strip()
        if not markdown:
            transcript = db.query(Transcript).filter(Transcript.task_id == tid, *(([Transcript.user_id == user_id]) if user_id else [])).first()
            if transcript and transcript.full_text:
                markdown = transcript.full_text.strip()
        if not markdown:
            continue
        task = db.query(Task).filter(Task.id == tid, *(([Task.user_id == user_id]) if user_id else [])).first()
        fallbacks.append({
            "task_id": tid,
            "title": (task.title if task else "") or "未命名笔记",
            "markdown": markdown,
        })
    return fallbacks


def _share_storage_id(token: str, session_id: str) -> str:
    return f"share:{token}:{session_id}"


def _resolve_share_task_id(db: Session, token: str) -> str:
    link = db.query(ShareLink).filter(ShareLink.token == token).first()
    if not link:
        raise BizException(1007, "分享链接无效或已过期")
    task = db.query(Task).filter(Task.id == link.task_id).first()
    if not task or task.status != "COMPLETED":
        raise BizException(1007, "分享内容不存在")
    return task.id


class UserLLMFields(BaseModel):
    user_note_api_key: str | None = None
    user_note_base_url: str | None = None
    user_note_model_name: str | None = None


def _runtime_provider(db: Session, provider_id: str, req: UserLLMFields, user_id: str | None = None):
    api_key = (req.user_note_api_key or "").strip()
    if api_key:
        return type("RuntimeProvider", (), {
            "api_key": api_key,
            "base_url": (req.user_note_base_url or "").strip(),
        })()
    return db.query(ProviderConfig).filter(ProviderConfig.id == provider_id, ProviderConfig.user_id.in_(([user_id] if user_id else []) + ["legacy"])).first()


def _runtime_model_name(req: UserLLMFields, fallback: str) -> str:
    return (req.user_note_model_name or "").strip() or fallback


class AskRequest(UserLLMFields):
    question: str
    provider_id: str
    model_name: str
    enable_web_search: bool = False


class GlobalAskRequest(UserLLMFields):
    question: str
    provider_id: str
    model_name: str
    session_id: str = Field(..., min_length=1)
    task_ids: list[str] = []


class ShareAskRequest(UserLLMFields):
    question: str
    provider_id: str
    model_name: str
    session_id: str = Field(..., min_length=1)
    enable_web_search: bool = False


@router.get("/global/messages")
def get_global_messages(
    session_id: str = Query(..., min_length=1),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    storage_id = global_session_task_id(session_id)
    messages = (
        db.query(ChatMessage)
        .filter(ChatMessage.task_id == storage_id, ChatMessage.user_id == current_user.id)
        .order_by(ChatMessage.created_at)
        .all()
    )
    return success([
        {
            "id": m.id,
            "role": m.role,
            "content": m.content,
            "sources": m.sources,
            "created_at": m.created_at.isoformat() if m.created_at else None,
        }
        for m in messages
    ])


@router.post("/global/ask")
async def global_ask(req: GlobalAskRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    provider = _runtime_provider(db, req.provider_id, req, current_user.id)
    if not provider:
        raise BizException(400, "LLM 供应商不存在")

    if req.task_ids:
        for tid in req.task_ids:
            task = db.query(Task).filter(Task.id == tid, Task.user_id == current_user.id).first()
            if not task:
                raise BizException(404, f"任务 {tid} 不存在")
            if task.status != "COMPLETED":
                raise BizException(400, f"任务「{task.title or tid}」尚未完成，无法作为参考")

    storage_id = global_session_task_id(req.session_id)
    history_rows = (
        db.query(ChatMessage)
        .filter(ChatMessage.task_id == storage_id, ChatMessage.user_id == current_user.id)
        .order_by(ChatMessage.created_at)
        .all()
    )
    history = [{"role": m.role, "content": m.content} for m in history_rows]

    user_msg = ChatMessage(
        id=str(uuid.uuid4()),
        user_id=current_user.id,
        task_id=storage_id,
        role="user",
        content=req.question,
    )
    db.add(user_msg)

    note_fallbacks = _load_note_fallbacks(db, req.task_ids, current_user.id) if req.task_ids else []
    enable_web_search = len(req.task_ids) == 0

    result = await chat_with_tasks(
        task_ids=req.task_ids,
        question=req.question,
        history=history,
        api_key=decrypt_secret(provider.api_key),
        base_url=provider.base_url,
        model_name=_runtime_model_name(req, req.model_name),
        note_fallbacks=note_fallbacks,
        enable_web_search=enable_web_search,
    )

    assistant_msg = ChatMessage(
        id=str(uuid.uuid4()),
        user_id=current_user.id,
        task_id=storage_id,
        role="assistant",
        content=result["answer"],
        sources=result.get("sources"),
    )
    db.add(assistant_msg)
    db.commit()

    return success({
        "answer": result["answer"],
        "sources": result.get("sources", []),
    })


@router.delete("/global/messages")
def clear_global_messages(
    session_id: str = Query(..., min_length=1),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    storage_id = global_session_task_id(session_id)
    db.query(ChatMessage).filter(ChatMessage.task_id == storage_id, ChatMessage.user_id == current_user.id).delete()
    db.commit()
    return success(None)


@router.get("/share/{token}/messages")
def get_share_messages(
    token: str,
    session_id: str = Query(..., min_length=1),
    db: Session = Depends(get_db),
):
    _resolve_share_task_id(db, token)
    storage_id = _share_storage_id(token, session_id)
    messages = (
        db.query(ChatMessage)
        .filter(ChatMessage.task_id == storage_id)
        .order_by(ChatMessage.created_at)
        .all()
    )
    return success([
        {
            "id": m.id,
            "role": m.role,
            "content": m.content,
            "sources": m.sources,
            "created_at": m.created_at.isoformat() if m.created_at else None,
        }
        for m in messages
    ])


@router.post("/share/{token}/ask")
async def ask_share(token: str, req: ShareAskRequest, db: Session = Depends(get_db)):
    task_id = _resolve_share_task_id(db, token)

    provider = _runtime_provider(db, req.provider_id, req)
    if not provider:
        raise BizException(400, "LLM 供应商不存在")

    storage_id = _share_storage_id(token, req.session_id)
    history_rows = (
        db.query(ChatMessage)
        .filter(ChatMessage.task_id == storage_id)
        .order_by(ChatMessage.created_at)
        .all()
    )
    history = [{"role": m.role, "content": m.content} for m in history_rows]

    user_msg = ChatMessage(
        id=str(uuid.uuid4()),
        task_id=storage_id,
        role="user",
        content=req.question,
    )
    db.add(user_msg)

    note_fallbacks = _load_note_fallbacks(db, [task_id])
    result = await chat_with_rag(
        task_id=task_id,
        question=req.question,
        history=history,
        api_key=decrypt_secret(provider.api_key),
        base_url=provider.base_url,
        model_name=_runtime_model_name(req, req.model_name),
        note_fallbacks=note_fallbacks,
        enable_web_search=req.enable_web_search,
    )

    assistant_msg = ChatMessage(
        id=str(uuid.uuid4()),
        task_id=storage_id,
        role="assistant",
        content=result["answer"],
        sources=result.get("sources"),
    )
    db.add(assistant_msg)
    db.commit()

    return success({
        "answer": result["answer"],
        "sources": result.get("sources", []),
    })


@router.delete("/share/{token}/messages")
def clear_share_messages(
    token: str,
    session_id: str = Query(..., min_length=1),
    db: Session = Depends(get_db),
):
    _resolve_share_task_id(db, token)
    db.query(ChatMessage).filter(ChatMessage.task_id == _share_storage_id(token, session_id)).delete()
    db.commit()
    return success(None)


@router.get("/{task_id}/messages")
def get_messages(task_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    messages = (
        db.query(ChatMessage)
        .filter(ChatMessage.task_id == task_id, ChatMessage.user_id == current_user.id)
        .order_by(ChatMessage.created_at)
        .all()
    )
    return success([
        {
            "id": m.id,
            "role": m.role,
            "content": m.content,
            "sources": m.sources,
            "created_at": m.created_at.isoformat() if m.created_at else None,
        }
        for m in messages
    ])


@router.post("/{task_id}/ask")
async def ask(task_id: str, req: AskRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    task = db.query(Task).filter(Task.id == task_id, Task.user_id == current_user.id).first()
    if not task:
        raise BizException(404, "任务不存在")

    provider = _runtime_provider(db, req.provider_id, req)
    if not provider:
        raise BizException(400, "LLM 供应商不存在")

    history_rows = (
        db.query(ChatMessage)
        .filter(ChatMessage.task_id == task_id, ChatMessage.user_id == current_user.id)
        .order_by(ChatMessage.created_at)
        .all()
    )
    history = [{"role": m.role, "content": m.content} for m in history_rows]

    user_msg = ChatMessage(
        id=str(uuid.uuid4()),
        user_id=current_user.id,
        task_id=task_id,
        role="user",
        content=req.question,
    )
    db.add(user_msg)

    note_fallbacks = _load_note_fallbacks(db, [task_id])

    result = await chat_with_rag(
        task_id=task_id,
        question=req.question,
        history=history,
        api_key=decrypt_secret(provider.api_key),
        base_url=provider.base_url,
        model_name=_runtime_model_name(req, req.model_name),
        note_fallbacks=note_fallbacks,
        enable_web_search=req.enable_web_search,
    )

    assistant_msg = ChatMessage(
        id=str(uuid.uuid4()),
        user_id=current_user.id,
        task_id=task_id,
        role="assistant",
        content=result["answer"],
        sources=result.get("sources"),
    )
    db.add(assistant_msg)
    db.commit()

    return success({
        "answer": result["answer"],
        "sources": result.get("sources", []),
    })


@router.delete("/{task_id}/messages")
def clear_messages(task_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    db.query(ChatMessage).filter(ChatMessage.task_id == task_id, ChatMessage.user_id == current_user.id).delete()
    db.commit()
    return success(None)
