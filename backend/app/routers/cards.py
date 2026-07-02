"""Knowledge card CRUD and generation endpoints."""

import uuid
import logging
from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db.database import get_db, KnowledgeCard, ProviderConfig, Task, Note, User
from app.auth import get_current_user
from app.config import settings
from app.exceptions.biz_exception import BizException
from app.gpt.cards_llm import generate_cards_from_note_async
from app.gpt.note_llm import NoteLLM
from app.routers.tasks import UserLLMFields, _user_llm_config
from app.utils.crypto import decrypt_secret
from app.utils.response import success

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/tasks", tags=["cards"])


class CardResponse(BaseModel):
    id: str
    task_id: str
    style: str
    sort_order: int
    front_title: str
    front_subtitle: Optional[str] = None
    back_content: str
    back_pitfalls: Optional[str] = None
    personal_notes: Optional[str] = None
    review_status: str
    source_heading: Optional[str] = None
    source_term: Optional[str] = None


class CreateCardRequest(BaseModel):
    front_title: str
    front_subtitle: Optional[str] = None
    back_content: str = ""
    back_pitfalls: Optional[str] = None


class UpdateCardRequest(BaseModel):
    front_title: Optional[str] = None
    front_subtitle: Optional[str] = None
    back_content: Optional[str] = None
    back_pitfalls: Optional[str] = None
    personal_notes: Optional[str] = None
    review_status: Optional[str] = None
    sort_order: Optional[int] = None


class UpdateReviewRequest(BaseModel):
    review_status: str  # "none" | "mastered" | "needs_review"


class GenerateCardsRequest(UserLLMFields):
    style: Optional[str] = None
    force: bool = False


def _card_to_resp(card: KnowledgeCard) -> CardResponse:
    return CardResponse(
        id=card.id,
        task_id=card.task_id,
        style=card.style,
        sort_order=card.sort_order,
        front_title=card.front_title,
        front_subtitle=card.front_subtitle,
        back_content=card.back_content,
        back_pitfalls=card.back_pitfalls,
        personal_notes=card.personal_notes,
        review_status=card.review_status,
        source_heading=card.source_heading,
        source_term=card.source_term,
    )


def _resolve_llm(db: Session, user: User, user_llm_config: Optional[dict]) -> NoteLLM:
    if user_llm_config and user_llm_config.get("note_api_key"):
        return NoteLLM(
            api_key=user_llm_config["note_api_key"],
            base_url=user_llm_config.get("note_base_url", "https://api.openai.com/v1"),
            model_name=user_llm_config.get("note_model_name", "gpt-4o-mini"),
        )
    pc = db.query(ProviderConfig).filter(ProviderConfig.user_id == user.id, ProviderConfig.enabled == "true").first()
    if not pc:
        pc = db.query(ProviderConfig).filter(ProviderConfig.id == settings.llm_provider_id).first()
    if not pc:
        raise BizException(400, "未配置 LLM 供应商，请先在设置中添加 API Key")
    api_key = decrypt_secret(pc.api_key)
    model_name = getattr(pc, "model_name", None) or settings.llm_model_name or "gpt-4o-mini"
    return NoteLLM(api_key=api_key, base_url=pc.base_url, model_name=model_name)


@router.get("/{task_id}/cards")
def list_cards(task_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    task = db.query(Task).filter(Task.id == task_id, Task.user_id == current_user.id).first()
    if not task:
        raise BizException(404, "任务不存在")
    cards = (
        db.query(KnowledgeCard)
        .filter(KnowledgeCard.task_id == task_id, KnowledgeCard.style == task.style)
        .order_by(KnowledgeCard.sort_order)
        .all()
    )
    return success([_card_to_resp(c) for c in cards])


@router.post("/{task_id}/cards")
def create_card(task_id: str, req: CreateCardRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    task = db.query(Task).filter(Task.id == task_id, Task.user_id == current_user.id).first()
    if not task:
        raise BizException(404, "任务不存在")
    max_order = db.query(KnowledgeCard).filter(KnowledgeCard.task_id == task_id, KnowledgeCard.style == task.style).count()
    card = KnowledgeCard(
        id=str(uuid.uuid4()),
        task_id=task_id,
        user_id=current_user.id,
        style=task.style,
        sort_order=max_order,
        front_title=req.front_title,
        front_subtitle=req.front_subtitle,
        back_content=req.back_content,
        back_pitfalls=req.back_pitfalls,
    )
    db.add(card)
    db.commit()
    db.refresh(card)
    return success(_card_to_resp(card))


@router.put("/{task_id}/cards/{card_id}")
def update_card(task_id: str, card_id: str, req: UpdateCardRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    card = db.query(KnowledgeCard).filter(KnowledgeCard.id == card_id, KnowledgeCard.task_id == task_id, KnowledgeCard.user_id == current_user.id).first()
    if not card:
        raise BizException(404, "卡片不存在")
    for field, value in req.model_dump(exclude_unset=True).items():
        if value is not None:
            setattr(card, field, value)
    db.commit()
    db.refresh(card)
    return success(_card_to_resp(card))


@router.delete("/{task_id}/cards/{card_id}")
def delete_card(task_id: str, card_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    card = db.query(KnowledgeCard).filter(KnowledgeCard.id == card_id, KnowledgeCard.task_id == task_id, KnowledgeCard.user_id == current_user.id).first()
    if not card:
        raise BizException(404, "卡片不存在")
    db.delete(card)
    db.commit()
    return success(None)


@router.patch("/{task_id}/cards/{card_id}/review")
def update_review(task_id: str, card_id: str, req: UpdateReviewRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if req.review_status not in ("none", "mastered", "needs_review"):
        raise BizException(400, "review_status 仅支持 none / mastered / needs_review")
    card = db.query(KnowledgeCard).filter(KnowledgeCard.id == card_id, KnowledgeCard.task_id == task_id, KnowledgeCard.user_id == current_user.id).first()
    if not card:
        raise BizException(404, "卡片不存在")
    card.review_status = req.review_status
    db.commit()
    db.refresh(card)
    return success(_card_to_resp(card))


@router.post("/{task_id}/cards/generate")
async def generate_cards(task_id: str, req: GenerateCardsRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    task = db.query(Task).filter(Task.id == task_id, Task.user_id == current_user.id).first()
    if not task:
        raise BizException(404, "任务不存在")
    if task.status != "COMPLETED":
        raise BizException(400, "任务尚未完成，无法生成知识卡片")

    style = req.style or task.style
    user_llm = _user_llm_config(req)

    existing = db.query(KnowledgeCard).filter(KnowledgeCard.task_id == task_id, KnowledgeCard.style == style).first()
    if existing and not req.force:
        cards = db.query(KnowledgeCard).filter(KnowledgeCard.task_id == task_id, KnowledgeCard.style == style).order_by(KnowledgeCard.sort_order).all()
        return success([_card_to_resp(c) for c in cards])

    if existing and req.force:
        db.query(KnowledgeCard).filter(KnowledgeCard.task_id == task_id, KnowledgeCard.style == style).delete()
        db.commit()

    note = db.query(Note).filter(Note.task_id == task_id).first()
    if not note:
        raise BizException(404, "笔记不存在")
    markdown = note.markdown_edited or note.markdown_raw or ""
    if not markdown.strip():
        raise BizException(400, "笔记内容为空，无法生成知识卡片")

    llm = _resolve_llm(db, current_user, user_llm)
    card_dicts = await generate_cards_from_note_async(llm, markdown, style)

    if not card_dicts:
        raise BizException(500, "知识卡片生成失败，请重试")

    created = []
    for i, cd in enumerate(card_dicts):
        card = KnowledgeCard(
            id=str(uuid.uuid4()),
            task_id=task_id,
            user_id=current_user.id,
            style=style,
            sort_order=i,
            front_title=cd.get("title", ""),
            front_subtitle=cd.get("conclusion") or cd.get("hierarchy"),
            back_content=cd.get("explanation") or cd.get("knowledge", ""),
            back_pitfalls="\n".join(cd["pitfalls"]) if isinstance(cd.get("pitfalls"), list) else cd.get("pitfalls"),
            source_heading=cd.get("source_heading"),
        )
        db.add(card)
        created.append(card)

    db.commit()
    for c in created:
        db.refresh(c)
    return success([_card_to_resp(c) for c in created])
