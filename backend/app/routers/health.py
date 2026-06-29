from fastapi import APIRouter
import shutil

from app.utils.response import success

router = APIRouter(tags=["health"])


@router.get("/health")
def health_check():
    ffmpeg_ok = shutil.which("ffmpeg") is not None
    return success({"status": "ok", "ffmpeg": ffmpeg_ok})
