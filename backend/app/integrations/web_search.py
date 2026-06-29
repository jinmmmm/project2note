import logging
import re
from html import unescape

import httpx

logger = logging.getLogger(__name__)

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
}


def _parse_bing(html: str, max_results: int) -> list[dict]:
    results: list[dict] = []
    blocks = re.findall(r'<li class="b_algo"[^>]*>([\s\S]*?)</li>', html)
    for block in blocks[:max_results]:
        link_match = re.search(
            r'<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)</a>',
            block,
            re.IGNORECASE,
        )
        if not link_match:
            continue
        url = link_match.group(1).strip()
        if url.startswith("/"):
            continue
        title = re.sub(r"<[^>]+>", "", unescape(link_match.group(2))).strip()
        snippet_match = re.search(r"<p[^>]*>([\s\S]*?)</p>", block, re.IGNORECASE)
        snippet = ""
        if snippet_match:
            snippet = re.sub(r"<[^>]+>", "", unescape(snippet_match.group(1))).strip()
        if title or snippet:
            results.append({"title": title or url, "snippet": snippet, "url": url})
    return results


def _parse_ddg_lite(html: str, max_results: int) -> list[dict]:
    results: list[dict] = []
    link_pattern = re.compile(
        r'<a[^>]+class="result-link"[^>]+href="([^"]+)"[^>]*>(.*?)</a>',
        re.IGNORECASE | re.DOTALL,
    )
    snippet_pattern = re.compile(
        r'<td[^>]+class="result-snippet"[^>]*>(.*?)</td>',
        re.IGNORECASE | re.DOTALL,
    )
    links = link_pattern.findall(html)
    snippets = snippet_pattern.findall(html)
    for i, (url, title_html) in enumerate(links[:max_results]):
        title = re.sub(r"<[^>]+>", "", unescape(title_html)).strip()
        snippet_raw = snippets[i] if i < len(snippets) else ""
        snippet = re.sub(r"<[^>]+>", "", unescape(snippet_raw)).strip()
        if title or snippet:
            results.append({"title": title or url, "snippet": snippet, "url": url})
    return results


def _parse_ddg_instant(data: dict, max_results: int) -> list[dict]:
    results: list[dict] = []
    abstract = (data.get("AbstractText") or "").strip()
    if abstract:
        results.append({
            "title": data.get("Heading") or "摘要",
            "snippet": abstract,
            "url": data.get("AbstractURL") or "",
        })

    def walk(topics: list, limit: int):
        for item in topics:
            if len(results) >= limit:
                return
            if not isinstance(item, dict):
                continue
            if "Topics" in item:
                walk(item["Topics"], limit)
                continue
            text = (item.get("Text") or "").strip()
            url = (item.get("FirstURL") or "").strip()
            if text:
                results.append({"title": text[:120], "snippet": text, "url": url})

    walk(data.get("RelatedTopics") or [], max_results)
    return results[:max_results]


async def _search_bing(query: str, max_results: int) -> list[dict]:
    async with httpx.AsyncClient(timeout=20, follow_redirects=True, headers=_HEADERS) as client:
        resp = await client.get("https://cn.bing.com/search", params={"q": query})
        resp.raise_for_status()
        return _parse_bing(resp.text, max_results)


async def search_web(query: str, max_results: int = 5) -> list[dict]:
    q = query.strip()
    if not q:
        return []

    try:
        parsed = await _search_bing(q, max_results)
        if parsed:
            return parsed
    except Exception as e:
        logger.warning("Bing search failed: %s", e)

    try:
        async with httpx.AsyncClient(timeout=20, follow_redirects=True, headers=_HEADERS) as client:
            resp = await client.post("https://lite.duckduckgo.com/lite/", data={"q": q})
            resp.raise_for_status()
            parsed = _parse_ddg_lite(resp.text, max_results)
            if parsed:
                return parsed
    except Exception as e:
        logger.warning("DuckDuckGo lite search failed: %s", e)

    try:
        async with httpx.AsyncClient(timeout=15, headers=_HEADERS) as client:
            resp = await client.get(
                "https://api.duckduckgo.com/",
                params={"q": q, "format": "json", "no_html": 1, "skip_disambig": 1},
            )
            resp.raise_for_status()
            return _parse_ddg_instant(resp.json(), max_results)
    except Exception as e:
        logger.warning("DuckDuckGo instant search failed: %s", e)
        return []
