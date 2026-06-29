import uuid
from urllib.parse import quote

from fastapi import APIRouter, Depends, Query
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth import create_access_token, decode_access_token, get_current_user
from app.config import settings
from app.db.database import get_db, Task, Note, Transcript, Recommendation, FeishuSyncRecord, User
from app.exceptions.biz_exception import BizException
from app.integrations import feishu as feishu_service
from app.services.feishu_config_manager import (
    get_feishu_app_settings,
    save_feishu_app_settings,
    save_feishu_sync_folder,
)
from app.utils.markdown_toc import prepare_markdown_for_feishu_sync
from app.utils.response import success

router = APIRouter(prefix="/feishu", tags=["feishu"])


class FeishuAppConfigRequest(BaseModel):
    app_id: str
    app_secret: str
    redirect_uri: str = ""


class FeishuSyncFolderRequest(BaseModel):
    folder_token: str = ""
    folder_name: str = "我的空间"


class SyncRequest(BaseModel):
    folder_token: str = ""
    folder_name: str = ""
    title: str = ""
    bitable_app_token: str = ""
    bitable_table_id: str = ""


@router.get("/app-config")
def get_app_config(current_user: User = Depends(get_current_user)):
    cfg = get_feishu_app_settings()
    return success({
        "app_id": cfg.app_id,
        "has_secret": bool(cfg.app_secret),
        "redirect_uri": cfg.redirect_uri,
        "configured": cfg.configured,
        "default_folder_token": cfg.default_folder_token,
        "default_folder_name": cfg.default_folder_name or "我的空间",
    })


@router.put("/app-config")
def update_app_config(req: FeishuAppConfigRequest, current_user: User = Depends(get_current_user)):
    if not req.app_id.strip() or not req.app_secret.strip():
        raise BizException(400, "请填写飞书 App ID 和 App Secret")
    cfg = save_feishu_app_settings(req.app_id, req.app_secret, req.redirect_uri)
    return success({
        "app_id": cfg.app_id,
        "has_secret": bool(cfg.app_secret),
        "redirect_uri": cfg.redirect_uri,
        "configured": cfg.configured,
        "default_folder_token": cfg.default_folder_token,
        "default_folder_name": cfg.default_folder_name or "我的空间",
    })


@router.put("/sync-folder")
def update_sync_folder(req: FeishuSyncFolderRequest, current_user: User = Depends(get_current_user)):
    cfg = save_feishu_sync_folder(req.folder_token, req.folder_name)
    return success({
        "default_folder_token": cfg.default_folder_token,
        "default_folder_name": cfg.default_folder_name or "我的空间",
    })


@router.get("/auth-url")
def auth_url(current_user: User = Depends(get_current_user)):
    cfg = get_feishu_app_settings()
    if not cfg.configured:
        raise BizException(1006, "请先在下方填写并保存飞书 App ID / App Secret")
    return success({"url": feishu_service.get_auth_url(create_access_token(current_user.id))})


@router.get("/callback")
async def callback(
    code: str = Query(default=""),
    state: str = Query(default=""),
    error: str = Query(default=""),
    error_description: str = Query(default=""),
):
    if error:
        reason = quote(error_description or error)
        redirect = f"{settings.share_base_url}/settings?feishu=fail&reason={reason}"
        return RedirectResponse(url=redirect)
    if not code:
        redirect = f"{settings.share_base_url}/settings?feishu=fail&reason={quote('未收到授权码')}"
        return RedirectResponse(url=redirect)
    try:
        user_id = decode_access_token(state).get("sub")
    except Exception:
        redirect = f"{settings.share_base_url}/settings?feishu=fail&reason={quote('授权状态已过期，请重新发起授权')}"
        return RedirectResponse(url=redirect)
    ok, reason = await feishu_service.exchange_code(code, user_id)
    if ok:
        redirect = f"{settings.share_base_url}/settings?feishu=ok"
    else:
        redirect = f"{settings.share_base_url}/settings?feishu=fail&reason={quote(reason or '授权失败')}"
    return RedirectResponse(url=redirect)


@router.get("/status")
def status(current_user: User = Depends(get_current_user)):
    cfg = get_feishu_app_settings()
    return success({
        "authorized": feishu_service.is_authorized(current_user.id),
        "configured": cfg.configured,
        "redirect_uri": cfg.redirect_uri if cfg.configured else "",
        "default_folder_token": cfg.default_folder_token,
        "default_folder_name": cfg.default_folder_name or "我的空间",
    })


@router.get("/folders")
async def folders(parent_token: str = "", current_user: User = Depends(get_current_user)):
    if not feishu_service.is_authorized(current_user.id):
        raise BizException(1006, "请先授权飞书账号")
    result = await feishu_service.list_folder_children(parent_token, current_user.id)
    return success(result)


@router.post("/sync/{task_id}")
async def sync_task(task_id: str, req: SyncRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if not feishu_service.is_authorized(current_user.id):
        raise BizException(1006, "请先授权飞书账号")

    task = db.query(Task).filter(Task.id == task_id, Task.user_id == current_user.id).first()
    note = db.query(Note).filter(Note.task_id == task_id, Note.user_id == current_user.id).first()
    if not task or not note:
        raise BizException(404, "任务或笔记不存在")

    content = prepare_markdown_for_feishu_sync(note.markdown_edited or note.markdown_raw or "")
    title = (req.title or "").strip() or task.title or "视频笔记"

    cfg = get_feishu_app_settings()
    folder_token = req.folder_token or cfg.default_folder_token

    try:
        doc_url, content_warning = await feishu_service.create_docx(title, content, folder_token, current_user.id)
    except ValueError as e:
        raise BizException(1006, str(e))

    bitable_record_id = None
    if req.bitable_app_token and req.bitable_table_id:
        if task.platform == "local":
            fields = {
                "笔记标题": title,
                "本地视频位置": task.local_video_path or "",
                "生成时间": task.created_at.strftime("%Y-%m-%d %H:%M") if task.created_at else "",
            }
        else:
            fields = {
                "视频标题": title,
                "视频链接": task.source_url or "",
                "生成时间": task.created_at.strftime("%Y-%m-%d %H:%M") if task.created_at else "",
            }
        if doc_url:
            fields["飞书笔记链接"] = doc_url
        bitable_record_id = await feishu_service.add_bitable_record(
            req.bitable_app_token, req.bitable_table_id, fields, current_user.id
        )

    record = FeishuSyncRecord(
        id=str(uuid.uuid4()),
        user_id=current_user.id,
        task_id=task_id,
        doc_url=doc_url,
        bitable_record_id=bitable_record_id,
    )
    db.add(record)
    db.commit()

    return success({
        "doc_url": doc_url,
        "bitable_record_id": bitable_record_id,
        "content_warning": content_warning,
    })
