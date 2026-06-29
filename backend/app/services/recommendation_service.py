import json
import re
import asyncio
from datetime import datetime
from typing import List, Optional

from openai import OpenAI
from sqlalchemy.orm import Session

from app.config import settings
from app.db.database import Recommendation
from app.integrations.bilibili_search import (
    extract_keywords_from_note,
    normalize_bilibili_sort,
    parse_bilibili_sort_from_text,
    search_bilibili,
)

DEFAULT_REC_VIDEO_LIMIT = 2
BILI_SEARCH_CONCURRENCY = 5


REFINE_KEYWORDS_SYSTEM = """你是 B 站视频检索助手。根据笔记延伸知识点和用户的学习诉求，调整推荐条目与搜索策略。

要求：
- 默认目录仅两类：前置基础（prerequisite）、后续进阶（advanced），各 2 条知识点；每条默认返回 2 个 B 站视频（共 8 个）
- 仅当用户明确要求时，才可新增自定义类别（如「同类视频」「实战案例」）或调整每类条数
- 每个关键词 2-12 个汉字为主，可含必要英文缩写；topic 不要包含 [类别] 前缀
- category_label 为中文类别名；type 用 slug（前置基础=prerequisite，后续进阶=advanced）
- limit 为每条知识点返回的视频数，默认 2；用户明确要求条数时按用户要求
- sort 仅在用户明确提到排序方式时填写，否则 null（使用 B 站默认综合排序）
- sort 可选值：click(播放量)、totalrank(综合)、pubdate(最新发布)、dm(弹幕)、stow(收藏)

只输出 JSON 对象，不要其他文字：
{
  "sort": null,
  "keywords": [
    {
      "topic": "搜索关键词",
      "type": "prerequisite",
      "category_label": "前置基础",
      "description": "简要说明",
      "limit": 2
    }
  ]
}"""


def is_extension_section_heading(title: str) -> bool:
    return "延伸知识点" in (title or "")


def _normalize_keyword_item(raw: dict) -> Optional[dict]:
    topic = str(raw.get("topic", "")).strip()
    if not topic:
        return None
    item_type = str(raw.get("type", "related")).strip() or "related"
    category_label = str(raw.get("category_label", "")).strip()
    if not category_label:
        if item_type == "prerequisite":
            category_label = "前置基础"
        elif item_type == "advanced":
            category_label = "后续进阶"
        else:
            category_label = item_type
    limit_raw = raw.get("limit", DEFAULT_REC_VIDEO_LIMIT)
    try:
        limit = max(1, min(int(limit_raw), 10))
    except (TypeError, ValueError):
        limit = DEFAULT_REC_VIDEO_LIMIT
    description = str(raw.get("description", "")).strip() or f"[{category_label}] {topic}"
    return {
        "topic": topic,
        "type": item_type,
        "category_label": category_label,
        "description": description,
        "limit": limit,
    }


async def sync_recommendations_from_note(
    db: Session,
    task_id: str,
    markdown: str,
    cookie: Optional[str] = None,
    limit: int = DEFAULT_REC_VIDEO_LIMIT,
) -> list[dict]:
    keywords = extract_keywords_from_note(markdown)
    rec_items = await search_videos_for_keywords(keywords, cookie, limit=limit)
    rec = db.query(Recommendation).filter(Recommendation.task_id == task_id).first()
    if not rec:
        rec = Recommendation(task_id=task_id)
        db.add(rec)
    rec.items = rec_items
    rec.updated_at = datetime.utcnow()
    db.commit()
    return rec_items


async def search_videos_for_keywords(
    keywords: list[dict],
    cookie: Optional[str] = None,
    limit: int = DEFAULT_REC_VIDEO_LIMIT,
    sort: Optional[str] = None,
) -> list[dict]:
    from app.integrations.bilibili_search import _cap_extension_keywords

    keywords = _cap_extension_keywords(keywords)
    sort_key = normalize_bilibili_sort(sort)
    sem = asyncio.Semaphore(BILI_SEARCH_CONCURRENCY)

    async def search_one(kw: dict) -> dict:
        item_limit = kw.get("limit") or limit
        try:
            item_limit = max(1, min(int(item_limit), 10))
        except (TypeError, ValueError):
            item_limit = limit
        async with sem:
            videos = await search_bilibili(
                kw.get("topic", ""),
                cookie,
                limit=item_limit,
                order=sort_key or kw.get("sort"),
            )
        return {**kw, "videos": videos}

    if not keywords:
        return []
    return list(await asyncio.gather(*[search_one(kw) for kw in keywords]))


def refine_recommendations_with_llm(
    keywords: list[dict],
    user_prompt: str,
    note_title: str,
    api_key: str,
    base_url: str,
    model_name: str,
) -> tuple[list[dict], Optional[str]]:
    if not user_prompt.strip():
        return keywords, None

    items_text = "\n".join(
        f"{i}. [{kw.get('category_label') or kw.get('type', 'related')}] "
        f"{kw.get('topic', '')} — {kw.get('description', '')[:80]}"
        for i, kw in enumerate(keywords)
    )
    user_msg = f"""视频标题：{note_title or '未命名'}

当前推荐条目：
{items_text or '（暂无）'}

用户诉求：
{user_prompt.strip()}

请返回 JSON 对象。"""

    client = OpenAI(api_key=api_key, base_url=base_url)
    resp = client.chat.completions.create(
        model=model_name,
        messages=[
            {"role": "system", "content": REFINE_KEYWORDS_SYSTEM},
            {"role": "user", "content": user_msg},
        ],
        temperature=0.3,
    )
    content = (resp.choices[0].message.content or "").strip()
    if content.startswith("```"):
        content = re.sub(r"^```(?:json)?\n?", "", content)
        content = re.sub(r"\n?```$", "", content)

    parsed_sort = parse_bilibili_sort_from_text(user_prompt)
    try:
        parsed = json.loads(content)
        if isinstance(parsed, dict):
            llm_sort = normalize_bilibili_sort(parsed.get("sort"))
            sort_key = llm_sort or parsed_sort
            raw_keywords = parsed.get("keywords")
            if isinstance(raw_keywords, list) and raw_keywords:
                normalized = []
                for raw in raw_keywords:
                    item = _normalize_keyword_item(raw if isinstance(raw, dict) else {})
                    if item:
                        normalized.append(item)
                if normalized:
                    return normalized, sort_key
        if isinstance(parsed, list):
            # 兼容旧版仅返回数组的情况
            updated = [dict(kw) for kw in keywords]
            for item in parsed:
                idx = item.get("index")
                topic = item.get("topic", "").strip()
                if isinstance(idx, int) and 0 <= idx < len(updated) and topic:
                    updated[idx]["topic"] = topic
            return updated, parsed_sort
    except json.JSONDecodeError:
        pass
    return keywords, parsed_sort


async def refresh_recommendations(
    keywords: list[dict],
    cookie: Optional[str] = None,
    user_prompt: Optional[str] = None,
    note_title: str = "",
    provider: Optional[object] = None,
    model_name: Optional[str] = None,
    limit: int = DEFAULT_REC_VIDEO_LIMIT,
) -> list[dict]:
    items = keywords
    sort_key: Optional[str] = None
    if not items:
        return []
    if not user_prompt or not user_prompt.strip():
        return await search_videos_for_keywords(items, cookie, limit=limit, sort=sort_key)

    if user_prompt.strip():
        sort_key = parse_bilibili_sort_from_text(user_prompt)
        if provider:
            items, sort_key = refine_recommendations_with_llm(
                items,
                user_prompt,
                note_title,
                provider.api_key,
                provider.base_url,
                model_name or settings.llm_model_name,
            )

    return await search_videos_for_keywords(items, cookie, limit=limit, sort=sort_key)
