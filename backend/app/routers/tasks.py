import asyncio
import os
import uuid
from datetime import datetime
from typing import Optional
from urllib.parse import quote

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pathlib import Path
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db.database import get_db, Task, Note, Transcript, Recommendation, ShareLink, ChatMessage, ProviderConfig, PlatformCookie, User
from app.auth import get_current_user
from app.config import settings
from app.exceptions.biz_exception import BizException
from app.services.pipeline import task_executor
from app.services.export_service import export_markdown, export_pdf
from app.utils.ffmpeg_helper import extract_frame
from app.utils.markdown_toc import ensure_body_toc_for_export, safe_export_filename
from app.services.recommendation_service import (
    DEFAULT_REC_VIDEO_LIMIT,
    is_extension_section_heading,
    refresh_recommendations,
    sync_recommendations_from_note,
)
from app.integrations.bilibili_search import extract_keywords_from_note
from app.services.note_index_service import reindex_task_note
from app.services.vector_store import vector_store
from app.gpt.note_llm import NoteLLM
from app.gpt.mindmap_llm import generate_mindmap
from app.gpt.prompts import extract_note_generated_at, patch_note_basic_info
from app.utils.markdown_sections import extract_section, replace_section
from app.utils.response import success
from app.utils.time_utils import now_local_str

router = APIRouter(prefix="/tasks", tags=["tasks"])

AUDIO_EXTENSIONS = {".m4a", ".mp3", ".wav", ".aac", ".flac", ".ogg"}


class UserLLMFields(BaseModel):
    user_note_api_key: Optional[str] = None
    user_note_base_url: Optional[str] = None
    user_note_model_name: Optional[str] = None
    user_vision_api_key: Optional[str] = None
    user_vision_base_url: Optional[str] = None
    user_vision_model_name: Optional[str] = None


def _user_llm_config(req: UserLLMFields) -> Optional[dict]:
    note_api_key = (req.user_note_api_key or "").strip()
    if not note_api_key:
        return None
    note_base_url = (req.user_note_base_url or "").strip()
    note_model_name = (req.user_note_model_name or "").strip()
    return {
        "note_api_key": note_api_key,
        "note_base_url": note_base_url,
        "note_model_name": note_model_name,
        "vision_api_key": (req.user_vision_api_key or "").strip() or note_api_key,
        "vision_base_url": (req.user_vision_base_url or "").strip() or note_base_url,
        "vision_model_name": (req.user_vision_model_name or "").strip(),
    }


def _resolve_screenshot_mode(req: BaseModel) -> str:
    """从请求中解析 screenshot_mode；兼容旧字段 enable_screenshots/enable_vision_screenshot_refine。
    新请求直接传 screenshot_mode，旧请求从两个 boolean 推算：
    - enable_screenshots=False → off
    - enable_screenshots=True + enable_vision_screenshot_refine=True → enhanced
    - enable_screenshots=True + enable_vision_screenshot_refine=False → basic
    """
    mode = getattr(req, 'screenshot_mode', None)
    if mode and mode in ('off', 'basic', 'enhanced'):
        return mode
    # 兼容旧字段
    if not getattr(req, 'enable_screenshots', True):
        return 'off'
    if getattr(req, 'enable_vision_screenshot_refine', True):
        return 'enhanced'
    return 'basic'


def _screenshot_mode_to_booleans(mode: str) -> tuple[bool, bool]:
    """将 screenshot_mode 转换回旧字段 boolean 值，用于写入 DB 和驱动 pipeline。"""
    if mode == 'off':
        return False, False
    elif mode == 'basic':
        return True, False
    else:  # enhanced
        return True, True


def _default_clone_title(source_title: str | None, style: str) -> str:
    base = (source_title or "未命名视频").strip()
    style_label = "小白" if style == "beginner" else "专业"
    return f"{base}（{style_label}）"


def _patch_task_title_in_notes(db: Session, task: Task):
    note = db.query(Note).filter(Note.task_id == task.id).first()
    if not note:
        return
    title = task.title or "未命名视频"
    for attr in ("markdown_raw", "markdown_edited"):
        content = getattr(note, attr)
        if not content:
            continue
        generated_at = extract_note_generated_at(content) or now_local_str()
        setattr(
            note,
            attr,
            patch_note_basic_info(
                content,
                title,
                task.platform,
                task.source_url,
                task.local_video_path,
                generated_at,
            ),
        )
    note.updated_at = datetime.utcnow()


class CreateTaskRequest(UserLLMFields):
    platform: str
    video_url: Optional[str] = None
    local_path: Optional[str] = None
    title: Optional[str] = None
    style: str = "beginner"
    detail_mode: str = "detailed"
    extras: Optional[str] = None
    # 截图模式: off=不截图, basic=纯算法评分选帧, enhanced=AI辅助选时间戳+算法评分
    screenshot_mode: str = "enhanced"
    # 旧字段保留兼容，新代码优先用 screenshot_mode
    enable_screenshots: bool = True
    enable_vision_screenshot_refine: bool = True
    screenshot_min_score: Optional[float] = None
    provider_id: str
    model_name: str


class UpdateNoteRequest(BaseModel):
    markdown_edited: str


class SaveMindmapRequest(BaseModel):
    # 新 schema
    active_mode: Optional[str] = None  # origin | ai_refactor
    modes: Optional[dict] = None
    sync_enabled: bool = False
    # 兼容旧 schema
    mode: Optional[str] = None
    tree: Optional[dict] = None
    edited: bool = False


class GenerateMindmapRequest(UserLLMFields):
    video_type: Optional[str] = None  # 课程 | 访谈 | 教程 | 影视
    force: bool = False  # 已编辑时是否强制覆盖
    instruction: Optional[str] = None  # 用户对本次重生成的额外要求


class ExportRequest(BaseModel):
    format: str = "md"
    title: str = ""


class RefreshRecommendationsRequest(UserLLMFields):
    keywords: list[dict]
    prompt: Optional[str] = None


class RegenerateTaskRequest(UserLLMFields):
    style: str = "beginner"
    detail_mode: str = "detailed"
    extras: Optional[str] = None
    # 截图模式: off=不截图, basic=纯算法评分选帧, enhanced=AI辅助选时间戳+算法评分
    screenshot_mode: str = "enhanced"
    # 旧字段保留兼容，新代码优先用 screenshot_mode
    enable_screenshots: bool = True
    enable_vision_screenshot_refine: bool = True
    screenshot_min_score: Optional[float] = None
    provider_id: str
    model_name: str
    save_mode: str = "overwrite"  # overwrite | save_as_new
    title: Optional[str] = None


class UpdateTaskRequest(BaseModel):
    title: Optional[str] = None
    collection_id: Optional[str] = None


class PolishNoteRequest(UserLLMFields):
    scope: str  # full | section
    heading_title: Optional[str] = None
    heading_depth: Optional[int] = None
    instruction: Optional[str] = None


class ScreenshotRequest(BaseModel):
    seconds: int | float


def _build_media_payload(task: Task) -> dict:
    source_url = task.source_url
    video_url = None
    media_kind = "none"
    open_url = source_url

    if task.video_path:
        fname = task.video_path.split("/")[-1]
        video_url = f"/static/uploads/{fname}"
        ext = Path(task.video_path).suffix.lower()
        if ext in AUDIO_EXTENSIONS:
            media_kind = "audio"
        else:
            media_kind = "video"

    if task.platform == "bilibili" and source_url:
        media_kind = "bilibili_embed"
        open_url = source_url
    elif task.platform == "douyin" and source_url and media_kind == "none":
        media_kind = "external"
    elif media_kind == "none" and source_url:
        media_kind = "external"

    return {
        "video_url": video_url,
        "media_kind": media_kind,
        "open_url": open_url,
    }


def _task_to_dict(task: Task, include_detail: bool = False) -> dict:
    d = {
        "id": task.id,
        "status": task.status,
        "progress": task.progress,
        "platform": task.platform,
        "source_url": task.source_url,
        "local_video_path": task.local_video_path,
        "title": task.title,
        "style": task.style,
        "detail_mode": task.detail_mode,
        "extras": task.extras,
        "enable_screenshots": task.enable_screenshots != "false",
        "enable_vision_screenshot_refine": task.enable_vision_screenshot_refine != "false",
        # 截图模式：优先读 screenshot_mode，否则从旧字段推算
        "screenshot_mode": task.screenshot_mode or (
            "off" if task.enable_screenshots == "false"
            else ("enhanced" if task.enable_vision_screenshot_refine != "false" else "basic")
        ),
        "screenshot_min_score": float(task.screenshot_min_score) if task.screenshot_min_score else None,
        "provider_id": task.provider_id,
        "model_name": task.model_name,
        "error_message": task.error_message,
        "video_path": task.video_path,
        "author": task.author,
        "published_at": task.published_at,
        "parent_task_id": task.parent_task_id,
        "page_index": task.page_index,
        "collection_id": task.collection_id,
        "created_at": task.created_at.isoformat() if task.created_at else None,
        "updated_at": task.updated_at.isoformat() if task.updated_at else None,
    }
    return d


@router.post("")
async def create_task(req: CreateTaskRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if req.platform not in ("bilibili", "douyin", "local"):
        raise BizException(1001, "仅支持 bilibili、douyin、local 平台")
    if req.platform == "local" and not req.local_path:
        raise BizException(400, "本地视频需要提供 local_path")
    if req.platform != "local" and not req.video_url:
        raise BizException(400, "在线视频需要提供 video_url")

    custom_title = (req.title or "").strip() or None

    screenshot_mode = _resolve_screenshot_mode(req)
    enable_screenshots, enable_vision = _screenshot_mode_to_booleans(screenshot_mode)

    task_id = str(uuid.uuid4())
    task = Task(
        id=task_id,
        user_id=current_user.id,
        platform=req.platform,
        source_url=req.video_url,
        local_video_path=req.local_path,
        title=custom_title,
        style=req.style,
        detail_mode=req.detail_mode,
        extras=req.extras,
        screenshot_mode=screenshot_mode,
        enable_screenshots="true" if enable_screenshots else "false",
        enable_vision_screenshot_refine="true" if enable_vision else "false",
        screenshot_min_score=str(req.screenshot_min_score) if req.screenshot_min_score is not None else None,
        provider_id=req.provider_id or settings.llm_provider_id,
        model_name=req.model_name or settings.llm_model_name,
        status="PENDING",
        progress="queued",
    )
    db.add(task)
    db.commit()

    task_executor.enqueue(task_id, user_llm_config=_user_llm_config(req))
    return success({"task_id": task_id, "status": "PENDING"})


class BatchCreateTaskRequest(UserLLMFields):
    platform: str
    collection_name: str                         # 合集名称，如 "Vue3教程"
    video_urls: list[str]                        # 各P的完整URL列表
    page_titles: Optional[list[str]] = None      # 各P的 part 标题
    style: str = "beginner"
    detail_mode: str = "detailed"
    extras: Optional[str] = None
    screenshot_mode: str = "enhanced"
    enable_screenshots: bool = True
    enable_vision_screenshot_refine: bool = True
    screenshot_min_score: Optional[float] = None
    provider_id: str
    model_name: str
    target_collection_id: Optional[str] = None   # 笔记分类合集ID


@router.post("/batch")
async def batch_create_tasks(req: BatchCreateTaskRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if req.platform not in ("bilibili", "douyin", "local"):
        raise BizException(1001, "仅支持 bilibili、douyin、local 平台")
    if not req.video_urls:
        raise BizException(400, "video_urls 不能为空")

    screenshot_mode = _resolve_screenshot_mode(req)
    enable_screenshots, enable_vision = _screenshot_mode_to_booleans(screenshot_mode)

    parent_task_id = None
    task_ids = []
    user_llm_config = _user_llm_config(req)

    for i, video_url in enumerate(req.video_urls):
        part_title = ""
        if req.page_titles and i < len(req.page_titles):
            part_title = req.page_titles[i].strip()
        page_num = i + 1
        # 父任务标题 = 用户输入的笔记标题；子任务标题 = 笔记标题 - 第N集·原生标题
        if i == 0:
            title = req.collection_name
        elif part_title and part_title.lower() != f"p{page_num}" and part_title != f"P{page_num}":
            title = f"{req.collection_name} - 第{page_num}集·{part_title}"
        else:
            title = f"{req.collection_name} - 第{page_num}集"

        task_id = str(uuid.uuid4())
        task = Task(
            id=task_id,
            user_id=current_user.id,
            platform=req.platform,
            source_url=video_url,
            title=title,
            style=req.style,
            detail_mode=req.detail_mode,
            extras=req.extras,
            screenshot_mode=screenshot_mode,
            enable_screenshots="true" if enable_screenshots else "false",
            enable_vision_screenshot_refine="true" if enable_vision else "false",
            screenshot_min_score=str(req.screenshot_min_score) if req.screenshot_min_score is not None else None,
            provider_id=req.provider_id or settings.llm_provider_id,
            model_name=req.model_name or settings.llm_model_name,
            parent_task_id=parent_task_id,
            page_index=page_num,
            collection_id=req.target_collection_id,
            status="PENDING",
            progress="queued",
        )
        db.add(task)
        db.commit()

        if parent_task_id is None:
            parent_task_id = task_id  # 第一个 Task 作为父

        task_ids.append(task_id)
        task_executor.enqueue(task_id, user_llm_config=user_llm_config)

    return success({
        "task_ids": task_ids,
        "parent_task_id": parent_task_id,
        "collection_name": req.collection_name,
    })


@router.get("")
def list_tasks(status: Optional[str] = None, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    q = db.query(Task).filter(Task.user_id == current_user.id).order_by(Task.created_at.desc())
    if status:
        q = q.filter(Task.status == status)
    tasks = q.all()
    return success([_task_to_dict(t) for t in tasks])


@router.get("/{task_id}")
def get_task(task_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    task = db.query(Task).filter(Task.id == task_id, Task.user_id == current_user.id).first()
    if not task:
        raise BizException(404, "任务不存在")

    note = db.query(Note).filter(Note.task_id == task_id, Note.user_id == current_user.id).first()
    transcript = db.query(Transcript).filter(Transcript.task_id == task_id, Transcript.user_id == current_user.id).first()
    rec = db.query(Recommendation).filter(Recommendation.task_id == task_id, Recommendation.user_id == current_user.id).first()
    share = db.query(ShareLink).filter(ShareLink.task_id == task_id, ShareLink.user_id == current_user.id).first()

    data = _task_to_dict(task)
    data["note"] = {
        "markdown_raw": note.markdown_raw if note else None,
        "markdown_edited": note.markdown_edited if note else None,
        "mindmap_data": note.mindmap_data if note else None,
    } if note else None
    data["transcript"] = {
        "language": transcript.language if transcript else "zh",
        "segments": transcript.segments if transcript else [],
        "full_text": transcript.full_text if transcript else "",
    } if transcript else None
    data["recommendations"] = rec.items if rec else []
    data["share_token"] = share.token if share else None

    media = _build_media_payload(task)
    data["video_url"] = media["video_url"]
    data["media_kind"] = media["media_kind"]
    data["open_url"] = media["open_url"]

    return success(data)


@router.get("/{task_id}/status")
def get_task_status(task_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    task = db.query(Task).filter(Task.id == task_id, Task.user_id == current_user.id).first()
    if not task:
        raise BizException(404, "任务不存在")
    return success({
        "status": task.status,
        "progress": task.progress,
        "error_message": task.error_message,
    })


@router.post("/{task_id}/screenshot")
def create_task_screenshot(task_id: str, req: ScreenshotRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    task = db.query(Task).filter(Task.id == task_id, Task.user_id == current_user.id).first()
    if not task:
        raise BizException(404, "任务不存在")
    if req.seconds < 0:
        raise BizException(400, "seconds 不能小于 0")
    if not task.video_path:
        raise BizException(400, "当前任务没有可截图视频文件")
    if not os.path.exists(task.video_path):
        raise BizException(404, "任务视频文件不存在")

    ext = Path(task.video_path).suffix.lower()
    if ext in AUDIO_EXTENSIONS:
        raise BizException(400, "当前任务是音频文件，无法截图")

    seconds_label = str(req.seconds).replace(".", "_")
    filename = f"screenshot_{task.id}_{seconds_label}"
    image_path = extract_frame(task.video_path, req.seconds, str(settings.uploads_path), filename)

    return success({
        "seconds": req.seconds,
        "filename": Path(image_path).name,
        "image_url": f"/static/uploads/{Path(image_path).name}",
    })


@router.post("/{task_id}/retry")
def retry_task(task_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    task = db.query(Task).filter(Task.id == task_id, Task.user_id == current_user.id).first()
    if not task:
        raise BizException(404, "任务不存在")
    task.status = "PENDING"
    task.progress = "queued"
    task.error_message = None
    db.commit()

    # 断点续跑: 已有 transcript 走 regenerate 跳过下载/转写; 否则 full 重跑
    transcript = db.query(Transcript).filter(Transcript.task_id == task_id, Transcript.user_id == current_user.id).first()
    mode = "regenerate" if transcript and transcript.segments else "full"
    task_executor.enqueue(task_id, mode)
    return success({"task_id": task_id, "status": "PENDING", "resume_mode": mode})


@router.post("/{task_id}/cancel")
def cancel_task(task_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    task = db.query(Task).filter(Task.id == task_id, Task.user_id == current_user.id).first()
    if not task:
        raise BizException(404, "任务不存在")
    if task.status not in ("PENDING", "PROCESSING"):
        raise BizException(400, "仅排队中或处理中的任务可停止")
    task.status = "CANCELED"
    task.progress = "canceled"
    task.error_message = None
    db.commit()
    task_executor.cancel(task_id)
    return success({"task_id": task_id, "status": "CANCELED"})


@router.post("/{task_id}/regenerate")
def regenerate_task(task_id: str, req: RegenerateTaskRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if req.save_mode not in ("overwrite", "save_as_new"):
        raise BizException(400, "save_mode 仅支持 overwrite 或 save_as_new")

    task = db.query(Task).filter(Task.id == task_id, Task.user_id == current_user.id).first()
    if not task:
        raise BizException(404, "任务不存在")
    if task.status not in ("COMPLETED", "FAILED", "CANCELED"):
        raise BizException(400, "任务处理中，请稍后再试")
    transcript = db.query(Transcript).filter(Transcript.task_id == task_id, Transcript.user_id == current_user.id).first()
    if not transcript or not transcript.segments:
        raise BizException(400, "无逐字稿，无法重新生成")

    target_id = task_id
    screenshot_mode = _resolve_screenshot_mode(req)
    enable_screenshots, enable_vision = _screenshot_mode_to_booleans(screenshot_mode)

    if req.save_mode == "save_as_new":
        target_id = str(uuid.uuid4())
        new_title = (req.title or "").strip() or _default_clone_title(
            task.title, req.style
        )
        new_task = Task(
            id=target_id,
            user_id=current_user.id,
            platform=task.platform,
            source_url=task.source_url,
            local_video_path=task.local_video_path,
            video_path=task.video_path,
            title=new_title,
            style=req.style,
            detail_mode=req.detail_mode,
            extras=req.extras,
            screenshot_mode=screenshot_mode,
            enable_screenshots="true" if enable_screenshots else "false",
            enable_vision_screenshot_refine="true" if enable_vision else "false",
            screenshot_min_score=str(req.screenshot_min_score) if req.screenshot_min_score is not None else None,
            provider_id=req.provider_id,
            model_name=req.model_name,
            status="PROCESSING",
            progress="generating_note",
        )
        db.add(new_task)
        db.add(
            Transcript(
                task_id=target_id,
                user_id=current_user.id,
                language=transcript.language,
                segments=transcript.segments,
                full_text=transcript.full_text,
            )
        )
        db.commit()
    else:
        task.style = req.style
        task.detail_mode = req.detail_mode
        task.extras = req.extras
        task.screenshot_mode = screenshot_mode
        task.enable_screenshots = "true" if enable_screenshots else "false"
        task.enable_vision_screenshot_refine = "true" if enable_vision else "false"
        task.screenshot_min_score = str(req.screenshot_min_score) if req.screenshot_min_score is not None else None
        task.provider_id = req.provider_id
        task.model_name = req.model_name
        task.status = "PROCESSING"
        task.progress = "generating_note"
        task.error_message = None
        db.commit()

    task_executor.enqueue(target_id, "regenerate", user_llm_config=_user_llm_config(req))
    return success({"task_id": target_id, "status": "PROCESSING", "save_mode": req.save_mode})


@router.patch("/{task_id}")
def update_task(task_id: str, req: UpdateTaskRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    task = db.query(Task).filter(Task.id == task_id, Task.user_id == current_user.id).first()
    if not task:
        raise BizException(404, "任务不存在")
    if req.title is not None:
        title = req.title.strip()
        if not title:
            raise BizException(400, "标题不能为空")
        task.title = title
        _patch_task_title_in_notes(db, task)
    if req.collection_id is not None:
        task.collection_id = req.collection_id
        # 同步更新所有子任务的 collection_id
        children = db.query(Task).filter(Task.parent_task_id == task_id, Task.user_id == current_user.id).all()
        for child in children:
            child.collection_id = req.collection_id
    task.updated_at = datetime.utcnow()
    db.commit()
    return success(_task_to_dict(task))


@router.delete("/{task_id}")
def delete_task(task_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    task = db.query(Task).filter(Task.id == task_id, Task.user_id == current_user.id).first()
    if not task:
        raise BizException(404, "任务不存在")
    # 级联删除子任务（合集任务组）
    children = db.query(Task).filter(Task.parent_task_id == task_id, Task.user_id == current_user.id).all()
    for child in children:
        db.query(Note).filter(Note.task_id == child.id, Note.user_id == current_user.id).delete()
        db.query(Transcript).filter(Transcript.task_id == child.id, Transcript.user_id == current_user.id).delete()
        db.query(Recommendation).filter(Recommendation.task_id == child.id, Recommendation.user_id == current_user.id).delete()
        db.query(ChatMessage).filter(ChatMessage.task_id == child.id, ChatMessage.user_id == current_user.id).delete()
        db.query(ShareLink).filter(ShareLink.task_id == child.id, ShareLink.user_id == current_user.id).delete()
        db.delete(child)
        vector_store.delete(child.id)
    db.query(Note).filter(Note.task_id == task_id, Note.user_id == current_user.id).delete()
    db.query(Transcript).filter(Transcript.task_id == task_id, Transcript.user_id == current_user.id).delete()
    db.query(Recommendation).filter(Recommendation.task_id == task_id, Recommendation.user_id == current_user.id).delete()
    db.query(ChatMessage).filter(ChatMessage.task_id == task_id, ChatMessage.user_id == current_user.id).delete()
    db.query(ShareLink).filter(ShareLink.task_id == task_id, ShareLink.user_id == current_user.id).delete()
    db.delete(task)
    db.commit()
    vector_store.delete(task_id)
    return success(None)


@router.post("/{task_id}/polish")
async def polish_note(task_id: str, req: PolishNoteRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if req.scope not in ("full", "section"):
        raise BizException(400, "scope 仅支持 full 或 section")
    if req.scope == "section":
        if not req.heading_title or not req.heading_depth:
            raise BizException(400, "按节润色需要提供 heading_title 和 heading_depth")
        if req.heading_depth not in (2, 3):
            raise BizException(400, "heading_depth 仅支持 2（大节）或 3（小节）")

    task = db.query(Task).filter(Task.id == task_id, Task.user_id == current_user.id).first()
    if not task:
        raise BizException(404, "任务不存在")
    note = db.query(Note).filter(Note.task_id == task_id, Note.user_id == current_user.id).first()
    if not note:
        raise BizException(404, "笔记不存在")

    user_llm_config = _user_llm_config(req)
    provider = _get_provider(db, task.provider_id, user_llm_config, current_user.id) if task.provider_id or user_llm_config else None
    if not provider:
        raise BizException(400, "未配置 LLM 供应商，请先在设置中添加")

    markdown = note.markdown_edited or note.markdown_raw or ""
    if not markdown.strip():
        raise BizException(400, "笔记内容为空")

    if req.scope == "full":
        target = markdown
        section_range = None
    else:
        extracted = extract_section(markdown, req.heading_title, req.heading_depth)
        if not extracted:
            raise BizException(404, f"未找到标题为「{req.heading_title}」的章节")
        target, start, end = extracted
        section_range = (start, end)

    try:
        llm = NoteLLM(provider.api_key, provider.base_url, _runtime_model_name(task, user_llm_config))
        polished = await asyncio.to_thread(
            llm.polish_markdown, target, req.instruction or "", task.style
        )
    except Exception as e:
        raise BizException(500, f"润色失败：{e}")

    if section_range:
        start, end = section_range
        updated = replace_section(markdown, start, end, polished)
    else:
        updated = polished

    note.markdown_edited = updated
    note.updated_at = datetime.utcnow()
    db.commit()
    reindex_task_note(db, task_id)

    recommendations_refreshed = False
    recommendations: list = []
    if (
        req.scope == "section"
        and req.heading_title
        and is_extension_section_heading(req.heading_title)
    ):
        cookie_row = db.query(PlatformCookie).filter(PlatformCookie.platform == f"{current_user.id}:bilibili", PlatformCookie.user_id == current_user.id).first()
        cookie = cookie_row.cookie if cookie_row else None
        recommendations = await sync_recommendations_from_note(db, task_id, updated, cookie)
        recommendations_refreshed = True

    return success({
        "task_id": task_id,
        "markdown_edited": updated,
        "scope": req.scope,
        "recommendations_refreshed": recommendations_refreshed,
        "recommendations": recommendations,
    })


def _get_provider(db: Session, provider_id: str, user_llm_config: Optional[dict] = None, user_id: str | None = None):
    if user_llm_config and user_llm_config.get("note_api_key"):
        return type("RuntimeProvider", (), {
            "api_key": user_llm_config.get("note_api_key"),
            "base_url": user_llm_config.get("note_base_url"),
        })()
    q = db.query(ProviderConfig).filter(ProviderConfig.id == provider_id)
    if user_id:
        provider = q.filter(ProviderConfig.user_id == user_id).first()
        if provider:
            return provider
    return q.filter((ProviderConfig.user_id == user_id) | (ProviderConfig.user_id == "legacy")).first()


def _runtime_model_name(task: Task, user_llm_config: Optional[dict] = None) -> str:
    if user_llm_config and user_llm_config.get("note_model_name"):
        return user_llm_config["note_model_name"]
    return task.model_name


def _normalize_mindmap_data(raw: Optional[dict]) -> dict:
    if raw and raw.get("modes"):
        modes = raw.get("modes") or {}
        if raw.get("schema_version") != 2:
            modes = {"origin": modes.get("origin")} if modes.get("origin") else {}
        return {
            "schema_version": 2,
            "active_mode": raw.get("active_mode") or "ai_refactor",
            "sync_enabled": bool(raw.get("sync_enabled")),
            "modes": modes,
        }
    if raw and raw.get("tree"):
        mode = raw.get("mode") or "origin"
        if mode == "ai_refactor":
            return {
                "schema_version": 2,
                "active_mode": "ai_refactor",
                "sync_enabled": bool(raw.get("sync_enabled")),
                "modes": {},
            }
        return {
            "schema_version": 2,
            "active_mode": mode,
            "sync_enabled": bool(raw.get("sync_enabled")),
            "modes": {
                mode: {
                    "tree": raw.get("tree"),
                    "edited": bool(raw.get("edited")),
                    "updated_at": raw.get("updated_at"),
                }
            },
        }
    return {"schema_version": 2, "active_mode": "ai_refactor", "sync_enabled": False, "modes": {}}


def _with_mode_entry(raw: Optional[dict], mode: str, tree: dict, edited: bool, sync_enabled: bool = False) -> dict:
    data = _normalize_mindmap_data(raw)
    modes = data.setdefault("modes", {})
    modes[mode] = {"tree": tree, "edited": bool(edited), "updated_at": now_local_str()}
    data["schema_version"] = 2
    data["active_mode"] = mode
    data["sync_enabled"] = bool(sync_enabled)
    return data


@router.put("/{task_id}/note")
def update_note(task_id: str, req: UpdateNoteRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    note = db.query(Note).filter(Note.task_id == task_id, Note.user_id == current_user.id).first()
    if not note:
        raise BizException(404, "笔记不存在")
    note.markdown_edited = req.markdown_edited
    note.updated_at = datetime.utcnow()
    db.commit()
    reindex_task_note(db, task_id)
    return success({"task_id": task_id})


@router.put("/{task_id}/mindmap")
def save_mindmap(task_id: str, req: SaveMindmapRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """持久化导图编辑结果（含 origin 初稿、AI 初稿、用户编辑）。"""
    note = db.query(Note).filter(Note.task_id == task_id, Note.user_id == current_user.id).first()
    if not note:
        raise BizException(404, "笔记不存在")
    if req.modes is not None:
        note.mindmap_data = {
            "schema_version": 2,
            "active_mode": req.active_mode or "ai_refactor",
            "sync_enabled": bool(req.sync_enabled),
            "modes": req.modes,
        }
    elif req.mode and req.tree:
        note.mindmap_data = _with_mode_entry(
            note.mindmap_data,
            req.mode,
            req.tree,
            req.edited,
            req.sync_enabled,
        )
    else:
        raise BizException(400, "导图数据为空")
    note.updated_at = datetime.utcnow()
    db.commit()
    return success({"task_id": task_id})


@router.post("/{task_id}/mindmap")
async def generate_mindmap_route(task_id: str, req: GenerateMindmapRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """AI 通识重构引擎：调用 LLM 重构标准化导图树。"""
    task = db.query(Task).filter(Task.id == task_id, Task.user_id == current_user.id).first()
    if not task:
        raise BizException(404, "任务不存在")
    note = db.query(Note).filter(Note.task_id == task_id, Note.user_id == current_user.id).first()
    if not note:
        raise BizException(404, "笔记不存在")

    markdown = note.markdown_edited or note.markdown_raw or ""
    if len(markdown.strip()) < 200:
        raise BizException(400, "笔记过短（<200 字），建议使用同源复刻模式")

    existing_data = _normalize_mindmap_data(note.mindmap_data)
    ai_entry = (existing_data.get("modes") or {}).get("ai_refactor") or {}
    if not req.force and ai_entry.get("edited"):
        raise BizException(409, "结构优化导图已被编辑，确认覆盖请传 force=true")

    user_llm_config = _user_llm_config(req)
    provider = _get_provider(db, task.provider_id, user_llm_config, current_user.id) if task.provider_id or user_llm_config else None
    if not provider:
        raise BizException(400, "未配置 LLM 供应商，请先在设置中添加")

    try:
        llm = NoteLLM(provider.api_key, provider.base_url, _runtime_model_name(task, user_llm_config))
        tree = await asyncio.to_thread(generate_mindmap, llm, markdown, req.video_type, req.instruction)
    except Exception as e:
        raise BizException(500, f"AI 导图生成失败：{e}")

    note.mindmap_data = _with_mode_entry(
        note.mindmap_data,
        "ai_refactor",
        tree,
        False,
        existing_data.get("sync_enabled", False),
    )
    note.updated_at = datetime.utcnow()
    db.commit()
    return success({"task_id": task_id, "tree": tree, "mode": "ai_refactor"})


@router.post("/{task_id}/export")
def export_note(task_id: str, req: ExportRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    note = db.query(Note).filter(Note.task_id == task_id, Note.user_id == current_user.id).first()
    task = db.query(Task).filter(Task.id == task_id, Task.user_id == current_user.id).first()
    if not note or not task:
        raise BizException(404, "笔记不存在")

    raw = note.markdown_edited or note.markdown_raw or ""
    title = (req.title or "").strip() or task.title or "视频笔记"
    ext = "pdf" if req.format == "pdf" else "md"
    filename = safe_export_filename(title, ext)

    if req.format == "pdf":
        try:
            data, media_type, out_filename = export_pdf(raw, filename)
        except ValueError as e:
            raise BizException(500, str(e))
    else:
        content = ensure_body_toc_for_export(raw)
        data, media_type, out_filename = export_markdown(content, filename)

    return StreamingResponse(
        iter([data]),
        media_type=media_type,
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(out_filename)}"},
    )


@router.post("/{task_id}/recommendations/refresh")
async def refresh_recommendations_route(
    task_id: str,
    req: RefreshRecommendationsRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from app.db.database import PlatformCookie

    task = db.query(Task).filter(Task.id == task_id, Task.user_id == current_user.id).first()
    if not task:
        raise BizException(404, "任务不存在")

    cookie_row = db.query(PlatformCookie).filter(PlatformCookie.platform == f"{current_user.id}:bilibili", PlatformCookie.user_id == current_user.id).first()
    cookie = cookie_row.cookie if cookie_row else None

    if not req.prompt or not req.prompt.strip():
        raise BizException(400, "请使用「智能搜片」并说明诉求；同步笔记推荐请润色「延伸知识点」章节")

    note = db.query(Note).filter(Note.task_id == task_id, Note.user_id == current_user.id).first()
    markdown = (note.markdown_edited or note.markdown_raw or "") if note else ""
    keywords = extract_keywords_from_note(markdown)
    if not keywords:
        raise BizException(400, "笔记中暂无延伸知识点，请先生成或编辑笔记")

    user_llm_config = _user_llm_config(req)
    provider = _get_provider(db, task.provider_id, user_llm_config, current_user.id) if task.provider_id or user_llm_config else None
    if not provider:
        raise BizException(400, "LLM 供应商不存在")

    rec_items = await refresh_recommendations(
        keywords,
        cookie=cookie,
        user_prompt=req.prompt,
        note_title=task.title or "",
        provider=provider,
        model_name=_runtime_model_name(task, user_llm_config),
    )

    rec = db.query(Recommendation).filter(Recommendation.task_id == task_id, Recommendation.user_id == current_user.id).first()
    if not rec:
        rec = Recommendation(task_id=task_id, user_id=current_user.id)
        db.add(rec)
    rec.items = rec_items
    rec.updated_at = datetime.utcnow()
    db.commit()
    return success(rec_items)
