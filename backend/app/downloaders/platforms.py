import os
import re
import shutil
import uuid
from typing import Optional
from urllib.parse import urlparse, parse_qs

import yt_dlp

from app.config import settings
from app.downloaders.base import BaseDownloader, DownloadResult
from app.exceptions.biz_exception import BizException
from app.utils.cookie_file import remove_cookie_file, write_netscape_cookie_file

_VIDEO_EXTENSIONS = (".mp4", ".mkv", ".webm")
_AUDIO_EXTENSIONS = (".m4a", ".mp3", ".wav", ".aac", ".flac", ".ogg")


def _ffmpeg_location() -> str | None:
    bin_path = settings.ffmpeg_bin
    if os.path.sep in bin_path or (os.altsep and os.altsep in bin_path):
        return os.path.dirname(os.path.abspath(bin_path))
    resolved = shutil.which(bin_path)
    return os.path.dirname(resolved) if resolved else None


def _resolve_download_path(base: str, *, audio_only: bool) -> str:
    exts = _AUDIO_EXTENSIONS if audio_only else _VIDEO_EXTENSIONS
    for ext in exts:
        candidate = base + ext
        if os.path.exists(candidate):
            return candidate
    if audio_only:
        raise BizException(1003, "B站音频下载失败：未找到音频文件")
    raise BizException(
        1003,
        "B站视频下载失败：未找到视频文件（需安装 FFmpeg 以合并音视频流）",
    )


def _format_upload_date(raw: str | None) -> str | None:
    """yt-dlp upload_date 'yyyymmdd' → 'yyyy-MM-dd'"""
    if raw and len(raw) == 8 and raw.isdigit():
        return f"{raw[:4]}-{raw[4:6]}-{raw[6:]}"
    return None


class BilibiliDownloader(BaseDownloader):
    def download(
        self,
        url: str,
        output_dir: str,
        cookie: Optional[str] = None,
        *,
        audio_only: bool = False,
    ) -> DownloadResult:
        if not cookie:
            raise BizException(1002, "B站视频需要配置 Cookie，请在设置中粘贴登录 Cookie")

        out_template = os.path.join(output_dir, f"{uuid.uuid4().hex}.%(ext)s")
        video_format = (
            "bestaudio[ext=m4a]/bestaudio/best"
            if audio_only
            else "bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720][ext=mp4]/best"
        )
        cookiefile = write_netscape_cookie_file(cookie)
        ydl_opts = {
            "format": video_format,
            "outtmpl": out_template,
            "quiet": True,
            "no_warnings": True,
            "referer": "https://www.bilibili.com",
            "noplaylist": True,
        }
        if not audio_only:
            ydl_opts["merge_output_format"] = "mp4"
            ffmpeg_location = _ffmpeg_location()
            if ffmpeg_location:
                ydl_opts["ffmpeg_location"] = ffmpeg_location
        if cookiefile:
            ydl_opts["cookiefile"] = cookiefile

        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(url, download=True)
                video_path = ydl.prepare_filename(info)
                base = os.path.splitext(video_path)[0]
                video_path = _resolve_download_path(base, audio_only=audio_only)
                return DownloadResult(
                    video_path=video_path,
                    title=info.get("title", "未知标题"),
                    source_url=url,
                    author=info.get("uploader"),
                    published_at=_format_upload_date(info.get("upload_date")),
                )
        except Exception as e:
            err = str(e).lower()
            if "cookie" in err or "login" in err or "403" in err:
                raise BizException(1002, f"B站 Cookie 已失效或权限不足，请重新粘贴 Cookie：{e}")
            raise BizException(1003, f"B站视频解析失败：{e}")
        finally:
            remove_cookie_file(cookiefile)


class DouyinDownloader(BaseDownloader):
    @staticmethod
    def _normalize_url(url: str) -> str:
        """Convert jingxuan?modal_id=ID and other non-standard Douyin URLs to video/ID format."""
        parsed = urlparse(url)
        qs = parse_qs(parsed.query)
        modal_id = qs.get("modal_id", [None])[0]
        if modal_id:
            return f"https://www.douyin.com/video/{modal_id}"
        # Already standard format or short URL — return as-is
        return url

    def download(self, url: str, output_dir: str, cookie: Optional[str] = None) -> DownloadResult:
        url = self._normalize_url(url)
        out_template = os.path.join(output_dir, f"{uuid.uuid4().hex}.%(ext)s")
        ydl_opts = {
            "format": "best[ext=mp4]/best",
            "outtmpl": out_template,
            "quiet": True,
            "no_warnings": True,
        }
        if cookie:
            ydl_opts["http_headers"] = {"Cookie": cookie}

        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(url, download=True)
                video_path = ydl.prepare_filename(info)
                return DownloadResult(
                    video_path=video_path,
                    title=info.get("title", "未知标题"),
                    source_url=url,
                    author=info.get("channel") or info.get("artist") or info.get("uploader"),
                    published_at=_format_upload_date(info.get("upload_date")),
                )
        except Exception as e:
            raise BizException(1003, f"抖音视频解析失败（仅支持公开普通视频）：{e}")


class LocalDownloader(BaseDownloader):
    def download(self, url: str, output_dir: str, cookie: Optional[str] = None) -> DownloadResult:
        if not os.path.exists(url):
            raise BizException(1003, f"本地视频文件不存在：{url}")
        title = os.path.splitext(os.path.basename(url))[0]
        return DownloadResult(video_path=url, title=title, source_url=None)
