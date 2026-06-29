import uuid
from pathlib import Path

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.config import settings
from app.db.database import get_db, Task, Note, Transcript, Recommendation, ShareLink, User
from app.exceptions.biz_exception import BizException
from app.utils.network import resolve_share_base_url
from app.utils.response import success

router = APIRouter(tags=["share"])


def _build_media_payload(task: Task) -> dict:
    source_url = task.source_url
    video_url = None
    media_kind = "none"
    open_url = source_url

    if task.video_path:
        fname = task.video_path.split("/")[-1]
        video_url = f"/static/uploads/{fname}"
        ext = Path(task.video_path).suffix.lower()
        if ext in (".m4a", ".mp3", ".wav", ".aac", ".flac", ".ogg"):
            media_kind = "audio"
        else:
            media_kind = "video"

    if task.platform == "bilibili" and source_url:
        media_kind = "bilibili_embed"
        open_url = source_url
    elif task.platform == "douyin" and source_url:
        media_kind = "external"
    elif media_kind == "none" and source_url:
        media_kind = "external"

    return {
        "video_url": video_url,
        "media_kind": media_kind,
        "open_url": open_url,
    }


@router.post("/tasks/{task_id}/share")
def create_share(task_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    task = db.query(Task).filter(Task.id == task_id, Task.user_id == current_user.id).first()
    if not task or task.status != "COMPLETED":
        raise BizException(400, "仅已完成任务可分享")

    existing = db.query(ShareLink).filter(ShareLink.task_id == task_id, ShareLink.user_id == current_user.id).first()
    if existing:
        token = existing.token
    else:
        token = str(uuid.uuid4())
        db.add(ShareLink(token=token, user_id=current_user.id, task_id=task_id))
        db.commit()

    base = resolve_share_base_url(settings.share_base_url)
    url = f"{base}/share/{token}"
    return success({"token": token, "url": url})


@router.get("/share/{token}")
def get_share(token: str, db: Session = Depends(get_db)):
    link = db.query(ShareLink).filter(ShareLink.token == token).first()
    if not link:
        raise BizException(1007, "分享链接无效或已过期")

    task = db.query(Task).filter(Task.id == link.task_id).first()
    if not task:
        raise BizException(1007, "分享内容不存在")

    note = db.query(Note).filter(Note.task_id == task.id).first()
    transcript = db.query(Transcript).filter(Transcript.task_id == task.id).first()
    rec = db.query(Recommendation).filter(Recommendation.task_id == task.id).first()

    media = _build_media_payload(task)

    return success({
        "title": task.title,
        "platform": task.platform,
        "source_url": task.source_url,
        "style": task.style,
        "provider_id": task.provider_id,
        "model_name": task.model_name,
        "created_at": task.created_at.isoformat() if task.created_at else None,
        "video_url": media["video_url"],
        "media_kind": media["media_kind"],
        "open_url": media["open_url"],
        "note": {
            "markdown": (note.markdown_edited or note.markdown_raw) if note else "",
        },
        "transcript": {
            "language": transcript.language if transcript else "zh",
            "segments": transcript.segments if transcript else [],
        },
        "recommendations": rec.items if rec else [],
    })
