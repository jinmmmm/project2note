"""B站视频信息查询接口，用于前端检测分P视频。"""

from typing import Optional

import httpx
from fastapi import APIRouter, Depends, Query

from app.auth import get_current_user
from app.db.database import User
from app.utils.url_parser import extract_bilibili_bvid

router = APIRouter()

UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)


@router.get("/bilibili/video-info")
async def get_bilibili_video_info(url: str = Query(...), current_user: User = Depends(get_current_user)):
    """
    查询B站视频信息，返回分P列表。
    前端用于在提交前检测是否为多P视频。
    """
    bvid = extract_bilibili_bvid(url)
    if not bvid:
        return {"code": 1, "msg": "无法从URL中提取BV号"}

    headers = {"User-Agent": UA, "Referer": "https://www.bilibili.com"}
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                "https://api.bilibili.com/x/web-interface/view",
                params={"bvid": bvid},
                headers=headers,
            )
            data = resp.json()
    except Exception as e:
        return {"code": 1, "msg": f"请求B站API失败: {e}"}

    if data.get("code") != 0:
        return {"code": 1, "msg": f"B站API错误: {data.get('message', '未知')}"}

    view = data.get("data") or {}
    raw_pages = view.get("pages") or []

    pages = [
        {
            "page": p.get("page", i + 1),
            "part": p.get("part") or f"P{p.get('page', i + 1)}",
            "duration": p.get("duration", 0),
            "cid": p.get("cid"),
        }
        for i, p in enumerate(raw_pages)
    ]

    if not pages:
        pages = [{"page": 1, "part": view.get("title") or bvid, "duration": view.get("duration", 0), "cid": view.get("cid")}]

    return {
        "code": 0,
        "data": {
            "bvid": bvid,
            "title": view.get("title") or bvid,
            "total_pages": len(pages),
            "pages": pages,
        },
    }
