import uuid
from datetime import datetime

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db.database import get_db, ProviderConfig, PlatformCookie, User
from app.auth import get_current_user
from app.exceptions.biz_exception import BizException
from app.config import settings
from app.services.transcriber_config_manager import transcriber_config_manager
from app.utils.response import success

router = APIRouter(prefix="/settings", tags=["settings"])


class CookieRequest(BaseModel):
    cookie: str


class ProviderRequest(BaseModel):
    id: str | None = None
    name: str
    api_key: str
    base_url: str = "https://api.openai.com/v1"
    enabled: str = "true"


class TranscriberConfigRequest(BaseModel):
    transcriber_type: str
    whisper_model_size: str | None = None
    whisper_model_dir: str | None = None


@router.get("/cookies/{platform}")
def get_cookie(platform: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    storage_platform = f"{current_user.id}:{platform}"
    row = db.query(PlatformCookie).filter(PlatformCookie.platform == storage_platform, PlatformCookie.user_id == current_user.id).first()
    return success({"platform": platform, "cookie": row.cookie if row else ""})


@router.put("/cookies/{platform}")
def set_cookie(platform: str, req: CookieRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    storage_platform = f"{current_user.id}:{platform}"
    row = db.query(PlatformCookie).filter(PlatformCookie.platform == storage_platform, PlatformCookie.user_id == current_user.id).first()
    if not row:
        row = PlatformCookie(platform=storage_platform, user_id=current_user.id, cookie=req.cookie)
        db.add(row)
    else:
        row.cookie = req.cookie
        row.updated_at = datetime.utcnow()
    db.commit()
    return success({"platform": platform})


@router.get("/llm-default")
def get_llm_default(current_user: User = Depends(get_current_user)):
    return success({
        "provider_id": settings.llm_provider_id,
        "provider_name": settings.llm_provider_name,
        "base_url": settings.llm_base_url,
        "model_name": settings.llm_model_name,
        "vision_model_name": settings.vision_model_name,
    })


@router.get("/providers")
def list_providers(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    providers = db.query(ProviderConfig).filter(ProviderConfig.user_id.in_([current_user.id, "legacy"])).all()
    return success([
        {
            "id": p.id,
            "name": p.name,
            "base_url": p.base_url,
            "enabled": p.enabled,
            "has_key": bool(p.api_key),
        }
        for p in providers
    ])


@router.post("/providers")
def upsert_provider(req: ProviderRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    pid = req.id or str(uuid.uuid4())
    row = db.query(ProviderConfig).filter(ProviderConfig.id == pid, ProviderConfig.user_id == current_user.id).first()
    if not row:
        row = ProviderConfig(id=pid, user_id=current_user.id, name=req.name, api_key=req.api_key, base_url=req.base_url, enabled=req.enabled)
        db.add(row)
    else:
        row.name = req.name
        row.api_key = req.api_key
        row.base_url = req.base_url
        row.enabled = req.enabled
    db.commit()
    return success({"id": pid})


@router.delete("/providers/{provider_id}")
def delete_provider(provider_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    db.query(ProviderConfig).filter(ProviderConfig.id == provider_id, ProviderConfig.user_id == current_user.id).delete()
    db.commit()
    return success(None)


@router.get("/transcriber_config")
def get_transcriber_config(current_user: User = Depends(get_current_user)):
    return success(transcriber_config_manager.get_config())


@router.post("/transcriber_config")
def update_transcriber_config(req: TranscriberConfigRequest, current_user: User = Depends(get_current_user)):
    allowed = {t["value"] for t in transcriber_config_manager.get_config()["available_types"]}
    if req.transcriber_type not in allowed:
        raise BizException(400, f"不支持的转写引擎：{req.transcriber_type}")
    config = transcriber_config_manager.update_config(
        req.transcriber_type,
        req.whisper_model_size,
        req.whisper_model_dir,
    )
    return success(config)
