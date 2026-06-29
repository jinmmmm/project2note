"""B 站官方 API 直拉字幕，有字幕时可跳过 ASR。"""

import datetime
from typing import Optional

import httpx

from app.utils.url_parser import extract_bilibili_bvid, extract_bilibili_page

UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)


def _headers(cookie: str = "") -> dict:
    h = {"User-Agent": UA, "Referer": "https://www.bilibili.com"}
    if cookie:
        h["Cookie"] = cookie
    return h


def _pick_subtitle(subtitles: list) -> Optional[dict]:
    if not subtitles:
        return None

    def is_zh(s: dict) -> bool:
        lan = (s.get("lan") or "").lower()
        return lan.startswith("zh") or lan == "ai-zh"

    for s in subtitles:
        if is_zh(s) and not s.get("ai_type"):
            return s
    for s in subtitles:
        if is_zh(s):
            return s
    return subtitles[0]


def fetch_bilibili_subtitles(video_url: str, cookie: str = "") -> Optional[dict]:
    """
    返回 {language, full_text, segments: [{start, end, text}], source: bilibili_subtitle}
    失败返回 None，走 ASR 兜底。
    """
    bvid = extract_bilibili_bvid(video_url)
    if not bvid:
        return None

    headers = _headers(cookie)
    try:
        with httpx.Client(timeout=15) as client:
            view = client.get(
                "https://api.bilibili.com/x/web-interface/view",
                params={"bvid": bvid},
                headers=headers,
            ).json()
            if view.get("code") != 0:
                return None
            view_data = view.get("data", {}) or {}
            video_title = view_data.get("title") or ""
            author = (view_data.get("owner") or {}).get("name") or None
            pubdate = view_data.get("pubdate")
            published_at = (
                datetime.date.fromtimestamp(pubdate).strftime("%Y-%m-%d")
                if pubdate
                else None
            )
            cid = view_data.get("cid")
            pages = view_data.get("pages") or []
            page = extract_bilibili_page(video_url) or 1
            if pages and 1 <= page <= len(pages):
                cid = pages[page - 1].get("cid") or cid
            if not cid:
                return None

            player = client.get(
                "https://api.bilibili.com/x/player/wbi/v2",
                params={"bvid": bvid, "cid": cid},
                headers=headers,
            ).json()
            if player.get("code") != 0:
                return None

            subtitles = player.get("data", {}).get("subtitle", {}).get("subtitles", []) or []
            track = _pick_subtitle(subtitles)
            if not track or not track.get("subtitle_url"):
                return None

            sub_url = track["subtitle_url"]
            if sub_url.startswith("//"):
                sub_url = "https:" + sub_url

            body = client.get(sub_url, headers=headers).json().get("body") or []
            segments = []
            for item in body:
                text = (item.get("content") or "").strip()
                if not text:
                    continue
                segments.append({
                    "start": float(item.get("from", 0)),
                    "end": float(item.get("to", 0)),
                    "text": text,
                })

            if not segments:
                return None

            full_text = " ".join(s["text"] for s in segments)
            return {
                "language": track.get("lan") or "zh",
                "full_text": full_text,
                "segments": segments,
                "source": "bilibili_subtitle",
                "title": video_title,
                "author": author,
                "published_at": published_at,
            }
    except Exception:
        return None
