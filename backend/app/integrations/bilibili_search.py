import httpx
import html
import re
import uuid
from typing import List, Optional, Tuple

# B 站搜索 order：不传则使用站点默认（综合排序 totalrank）
BILIBILI_SORT_OPTIONS = frozenset({"totalrank", "click", "pubdate", "dm", "stow"})

KNOWN_CATEGORY_TYPES = {
    "前置基础": ("prerequisite", "前置基础"),
    "后续进阶": ("advanced", "后续进阶"),
}

SORT_KEYWORD_ALIASES: list[tuple[str, tuple[str, ...]]] = [
    ("click", ("播放量", "播放最多", "最多播放", "按播放", "播放排序", "高播放")),
    ("totalrank", ("综合排序", "默认排序", "综合")),
    ("pubdate", ("最新", "发布时间", "新发布", "最近发布")),
    ("dm", ("弹幕", "弹幕最多", "弹幕数")),
    ("stow", ("收藏", "收藏最多", "收藏数")),
]

SORT_HEAT_ALIASES = ("热度", "最热门", "热门", "最热")

MAX_EXTENSION_PER_CATEGORY = 2
MAX_EXTENSION_TOTAL = 4


def normalize_bili_pic(pic: str) -> str:
    if not pic:
        return ""
    if pic.startswith("//"):
        return f"https:{pic}"
    if pic.startswith("http://"):
        return "https://" + pic[7:]
    return pic


def _build_search_headers(cookie: Optional[str] = None) -> dict:
    """B 站搜索接口需要 buvid3，否则返回 412。"""
    parts = []
    if cookie:
        parts.append(cookie.strip().rstrip(";"))
    cookie_map = {}
    for part in parts:
        for item in part.split(";"):
            item = item.strip()
            if "=" in item:
                k, v = item.split("=", 1)
                cookie_map[k.strip()] = v.strip()
    if "buvid3" not in cookie_map:
        cookie_map["buvid3"] = f"{uuid.uuid4()}infoc"
    if "buvid4" not in cookie_map:
        cookie_map["buvid4"] = str(uuid.uuid4()).replace("-", "")
    cookie_str = "; ".join(f"{k}={v}" for k, v in cookie_map.items())
    return {
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        ),
        "Referer": "https://search.bilibili.com/",
        "Cookie": cookie_str,
    }


def _strip_html(text: str) -> str:
    return html.unescape(re.sub(r"<[^>]+>", "", text or "").strip())


def normalize_bilibili_sort(order: Optional[str]) -> Optional[str]:
    if not order:
        return None
    key = str(order).strip().lower()
    return key if key in BILIBILI_SORT_OPTIONS else None


def parse_bilibili_sort_from_text(text: str) -> Optional[str]:
    """从用户自然语言中解析 B 站搜索排序；未提及则返回 None（使用站点默认）。"""
    if not text or not text.strip():
        return None
    lowered = text.lower()
    for key in BILIBILI_SORT_OPTIONS:
        if key in lowered:
            return key
    for alias in SORT_HEAT_ALIASES:
        if alias in text:
            return "click"
    for order, aliases in SORT_KEYWORD_ALIASES:
        for alias in aliases:
            if alias in text:
                return order
    return None


def parse_category_from_bullet(text: str) -> Tuple[str, str]:
    """解析 bullet 中的 [类别] 或 [类型:类别]，返回 (type, category_label)。"""
    match = re.match(r"^\[(?:类型[:：])?([^\]]+)\]\s*", text)
    if not match:
        return "related", "相关延伸"
    label = match.group(1).strip()
    if label in KNOWN_CATEGORY_TYPES:
        return KNOWN_CATEGORY_TYPES[label]
    slug = re.sub(r"[^\w\u4e00-\u9fff-]+", "_", label).strip("_")[:48] or "custom"
    return slug, label


def _clean_search_keyword(text: str) -> str:
    text = re.sub(r"^\[(?:类型[:：])?[^\]]+\]\s*", "", text)
    text = re.sub(r"\[类型[:：][^\]]+\]\s*", "", text)
    text = text.split("—")[0].split("–")[0].strip()
    if " — " in text:
        text = text.split(" — ")[0].strip()
    text = re.sub(r"^[\-\*]\s*", "", text)
    text = re.sub(r"^\d+(?:\.\d+)*\.?\s*", "", text)
    text = re.sub(r"\s*[\(（][^)）]+[\)）]\s*", " ", text)
    return re.sub(r"\s+", " ", text).strip()[:40]


def _cap_extension_keywords(keywords: List[dict]) -> List[dict]:
    """Keep at most 2 prerequisite + 2 advanced (4 total)."""
    pre: List[dict] = []
    adv: List[dict] = []
    for kw in keywords:
        item_type = kw.get("type", "related")
        if item_type == "prerequisite" and len(pre) < MAX_EXTENSION_PER_CATEGORY:
            pre.append(kw)
        elif item_type == "advanced" and len(adv) < MAX_EXTENSION_PER_CATEGORY:
            adv.append(kw)
    if len(pre) + len(adv) >= MAX_EXTENSION_TOTAL:
        return pre[:MAX_EXTENSION_PER_CATEGORY] + adv[:MAX_EXTENSION_PER_CATEGORY]

    for kw in keywords:
        if kw in pre or kw in adv:
            continue
        if len(pre) < MAX_EXTENSION_PER_CATEGORY:
            pre.append({
                **kw,
                "type": "prerequisite",
                "category_label": "前置基础",
            })
        elif len(adv) < MAX_EXTENSION_PER_CATEGORY:
            adv.append({
                **kw,
                "type": "advanced",
                "category_label": "后续进阶",
            })
        if len(pre) + len(adv) >= MAX_EXTENSION_TOTAL:
            break
    return pre[:MAX_EXTENSION_PER_CATEGORY] + adv[:MAX_EXTENSION_PER_CATEGORY]


def extract_keywords_from_note(markdown: str) -> List[dict]:
    """Extract extension knowledge keywords from note section (4 items: 2+2)."""
    keywords: List[dict] = []
    in_section = False
    section_type = ""
    section_label = ""

    for line in markdown.split("\n"):
        stripped = line.strip()
        if re.match(r"^#{1,6}\s+.*延伸知识点", stripped):
            in_section = True
            section_type = ""
            section_label = ""
            continue
        if not in_section:
            continue
        if stripped.startswith("<!--"):
            break
        if re.match(r"^##\s+", stripped) and "延伸知识点" not in stripped:
            break
        if re.match(r"^###\s+前置", stripped):
            section_type, section_label = "prerequisite", "前置基础"
            continue
        if re.match(r"^###\s+后续", stripped):
            section_type, section_label = "advanced", "后续进阶"
            continue
        if not stripped.startswith("- "):
            continue

        text = stripped[2:]
        topic_type, category_label = parse_category_from_bullet(text)
        if topic_type == "related" and section_type:
            topic_type, category_label = section_type, section_label
        topic = _clean_search_keyword(text)
        if not topic:
            continue
        keywords.append({
            "topic": topic,
            "type": topic_type,
            "category_label": category_label,
            "description": text,
            "limit": 2,
        })

    return _cap_extension_keywords(keywords)


async def search_bilibili(
    keyword: str,
    cookie: Optional[str] = None,
    limit: int = 3,
    order: Optional[str] = None,
) -> List[dict]:
    """Search Bilibili for related videos. Degrades gracefully on failure."""
    keyword = _clean_search_keyword(keyword)
    if not keyword:
        return []

    url = "https://api.bilibili.com/x/web-interface/search/type"
    params = {
        "search_type": "video",
        "keyword": keyword,
        "Search_key": keyword,
        "page": 1,
        "context": "",
        "duration": 0,
        "tids_2": "",
        "__refresh__": "true",
        "tids": 0,
        "highlight": 1,
    }
    sort_key = normalize_bilibili_sort(order)
    if sort_key:
        params["order"] = sort_key

    headers = _build_search_headers(cookie)

    try:
        async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
            resp = await client.get(url, params=params, headers=headers)
            if resp.status_code != 200:
                return []
            data = resp.json()
            if data.get("code") != 0:
                return []
            results = []
            for item in data.get("data", {}).get("result", [])[:limit]:
                bvid = item.get("bvid", "")
                if not bvid:
                    continue
                play_raw = item.get("play") or item.get("view") or 0
                try:
                    play_count = int(str(play_raw).replace(",", ""))
                except (TypeError, ValueError):
                    play_count = 0
                results.append({
                    "title": _strip_html(item.get("title", "")),
                    "url": f"https://www.bilibili.com/video/{bvid}",
                    "author": item.get("author", ""),
                    "pic": normalize_bili_pic(item.get("pic", "")),
                    "description": _strip_html(item.get("description", "")),
                    "play_count": play_count,
                })
            return results
    except Exception:
        return []
