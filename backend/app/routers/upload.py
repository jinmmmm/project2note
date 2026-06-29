import uuid
import aiofiles
from fastapi import APIRouter, Depends, UploadFile, File

from app.auth import get_current_user
from app.config import settings
from app.db.database import User
from app.exceptions.biz_exception import BizException
from app.utils.response import success

router = APIRouter(prefix="/upload", tags=["upload"])

ALLOWED_VIDEO_EXTENSIONS = {".mp4", ".mov", ".m4a"}
ALLOWED_COVER_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".webp"}


@router.post("/video")
async def upload_video(file: UploadFile = File(...), current_user: User = Depends(get_current_user)):
    ext = "." + file.filename.split(".")[-1].lower() if file.filename and "." in file.filename else ""
    if ext not in ALLOWED_VIDEO_EXTENSIONS:
        raise BizException(400, f"仅支持 mp4、mov、m4a 格式，当前：{ext}")

    filename = f"{uuid.uuid4().hex}{ext}"
    user_dir = settings.uploads_path / current_user.id
    user_dir.mkdir(parents=True, exist_ok=True)
    filepath = user_dir / filename

    async with aiofiles.open(filepath, "wb") as f:
        content = await file.read()
        await f.write(content)

    return success({
        "path": str(filepath),
        "filename": filename,
        "url": f"/static/uploads/{current_user.id}/{filename}",
    })


@router.post("/cover")
async def upload_cover(file: UploadFile = File(...), current_user: User = Depends(get_current_user)):
    ext = "." + file.filename.split(".")[-1].lower() if file.filename and "." in file.filename else ""
    if ext not in ALLOWED_COVER_EXTENSIONS:
        raise BizException(400, f"仅支持 jpg、png、gif、webp 格式，当前：{ext}")

    filename = f"{uuid.uuid4().hex}{ext}"
    user_dir = settings.covers_path / current_user.id
    user_dir.mkdir(parents=True, exist_ok=True)
    filepath = user_dir / filename

    async with aiofiles.open(filepath, "wb") as f:
        content = await file.read()
        await f.write(content)

    return success({
        "path": str(filepath),
        "filename": filename,
        "url": f"/static/covers/{current_user.id}/{filename}",
    })
