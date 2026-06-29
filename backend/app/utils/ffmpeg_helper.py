import subprocess
import os
import uuid
import asyncio

from app.config import settings
from app.exceptions.biz_exception import BizException

_ffmpeg_sem: asyncio.Semaphore | None = None


async def get_ffmpeg_semaphore() -> asyncio.Semaphore:
    global _ffmpeg_sem
    if _ffmpeg_sem is None:
        _ffmpeg_sem = asyncio.Semaphore(settings.ffmpeg_concurrency)
    return _ffmpeg_sem


def extract_audio(video_path: str, output_dir: str) -> str:
    os.makedirs(output_dir, exist_ok=True)
    audio_path = os.path.join(output_dir, f"{uuid.uuid4().hex}.wav")
    cmd = [
        settings.ffmpeg_bin,
        "-i", video_path,
        "-vn",
        "-acodec", "pcm_s16le",
        "-ar", "16000",
        "-ac", "1",
        "-y",
        audio_path,
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
        if result.returncode != 0:
            raise BizException(1004, f"音频提取失败：{result.stderr[:500]}")
        return audio_path
    except FileNotFoundError:
        raise BizException(1004, "未找到 FFmpeg，请安装 FFmpeg 并配置 FFMPEG_BIN 环境变量")
    except subprocess.TimeoutExpired:
        raise BizException(1004, "音频提取超时")


def extract_frame(video_path: str, seconds: int | float, output_dir: str, file_stem: str | None = None) -> str:
    os.makedirs(output_dir, exist_ok=True)
    stem = file_stem or uuid.uuid4().hex
    image_path = os.path.join(output_dir, f"{stem}.jpg")
    cmd = [
        settings.ffmpeg_bin,
        "-ss", str(seconds),
        "-i", video_path,
        "-frames:v", "1",
        "-q:v", "2",
        "-y",
        image_path,
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
        if result.returncode != 0:
            raise BizException(1004, f"视频截图失败：{result.stderr[:500]}")
        if not os.path.exists(image_path):
            raise BizException(1004, "视频截图失败：未生成截图文件")
        return image_path
    except FileNotFoundError:
        raise BizException(1004, "未找到 FFmpeg，请安装 FFmpeg 并配置 FFMPEG_BIN 环境变量")
    except subprocess.TimeoutExpired:
        raise BizException(1004, "视频截图超时")


async def extract_audio_async(video_path: str, output_dir: str) -> str:
    sem = await get_ffmpeg_semaphore()
    async with sem:
        return await asyncio.to_thread(extract_audio, video_path, output_dir)


async def extract_frame_async(video_path: str, seconds: int | float, output_dir: str, file_stem: str | None = None) -> str:
    sem = await get_ffmpeg_semaphore()
    async with sem:
        return await asyncio.to_thread(extract_frame, video_path, seconds, output_dir, file_stem)
