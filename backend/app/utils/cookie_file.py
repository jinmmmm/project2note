import os
import tempfile
from typing import Optional


def write_netscape_cookie_file(cookie: str, domain: str = ".bilibili.com") -> Optional[str]:
    """将 Cookie 字符串写成 Netscape 格式临时文件，供 yt-dlp cookiefile 使用。"""
    if not cookie or not cookie.strip():
        return None

    lines = ["# Netscape HTTP Cookie File\n"]
    for pair in cookie.split(";"):
        pair = pair.strip()
        if not pair or "=" not in pair:
            continue
        key, value = pair.split("=", 1)
        key, value = key.strip(), value.strip()
        if key:
            lines.append(f"{domain}\tTRUE\t/\tFALSE\t0\t{key}\t{value}\n")

    if len(lines) <= 1:
        return None

    fd, path = tempfile.mkstemp(suffix=".txt", prefix="cookies_")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.writelines(lines)
    return path


def remove_cookie_file(path: Optional[str]) -> None:
    if path and os.path.exists(path):
        try:
            os.remove(path)
        except OSError:
            pass
