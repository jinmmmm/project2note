"""从逐字稿提取工具/资源检索词，联网搜索后注入笔记生成 prompt。"""

from __future__ import annotations

import json
import logging
import re
from typing import Iterable

from app.integrations.web_search import search_web

logger = logging.getLogger(__name__)

# 常见工具的公开安装命令（检索失败时仍注入 prompt / 修补）
KNOWN_INSTALL_COMMANDS: dict[str, str] = {
    "claude code": "npm install -g @anthropic-ai/claude-code",
    "cc switch": "brew install --cask cc-switch",
    "cc-switch": "brew install --cask cc-switch",
    "node.js": "brew install node  # macOS；或从 https://nodejs.org 下载 LTS 安装包",
    "nodejs": "brew install node",
}

_NOISE_EN = frozenset(
    {
        "AI",
        "API",
        "Base URL",
        "Claude Code",
        "GitHub",
        "HTTP",
        "HTTPS",
        "JSON",
        "LLM",
        "Markdown",
        "OpenAI",
        "URL",
        "Windows",
        "Linux",
        "macOS",
        "npm",
        "Node",
        "Python",
        "JavaScript",
        "TypeScript",
        "API Key",
        "Base URL",
    }
)

_NPM_INSTALL_RE = re.compile(
    r"(npm\s+(?:install|i)\s+(?:-g\s+)?[@\w./-]+)",
    re.IGNORECASE,
)
_BREW_INSTALL_RE = re.compile(
    r"(brew\s+install\s+(?:--cask\s+)?[^\s\n]+)",
    re.IGNORECASE,
)
_PIP_INSTALL_RE = re.compile(
    r"((?:pip3?|uv)\s+install\s+[^\s\n]+)",
    re.IGNORECASE,
)
_CURL_WGET_RE = re.compile(
    r"((?:curl|wget)\s+[^\n]{10,120})",
    re.IGNORECASE,
)
_OFFICIAL_SITE_CTX_RE = re.compile(
    r"([^\s，。；]{2,24})\s*(?:官网|官方网站|官方站点)",
)
_CN_INSTALL_RE = re.compile(
    r"(?:安装|下载)\s*[「「""]?([^，。；\n「」""（()]{2,20})",
)
_NPM_PACKAGE_RE = re.compile(r"@[\w.-]+/[\w.-]+|[@]?[\w.-]+/[\w.-]+")
_ENGLISH_NAME_RE = re.compile(r"\b([A-Z][a-z0-9]*(?:\s+[A-Z][a-z0-9]+)+)\b")
_CN_TOOL_CTX_RE = re.compile(
    r"(?:使用|安装|下载|配置|叫做|名为|推荐|借助|通过)\s*[「「""]?([A-Za-z@][\w\s\-\./]{2,40})"
)
_CN_SUFFIX_RE = re.compile(
    r"([A-Za-z][\w\s\-]{2,30})\s*(?:这个工具|这款软件|这个软件|插件|客户端|工具)"
)
# 「安装 cc-switch」「下载 Foo」— 小白模式优先检索（不含「配置」，避免误抓 API Key）
_INSTALL_MENTION_RE = re.compile(
    r"(?:安装|下载)\s*[「「""]?([A-Za-z@][\w\-\./]+(?:\s+[A-Za-z@][\w\-\./]+){0,2})",
    re.IGNORECASE,
)
_USE_TOOL_RE = re.compile(
    r"使用\s+([A-Za-z@][\w\-\./]+(?:\s+[A-Za-z@][\w\-\./]+){0,2})",
    re.IGNORECASE,
)
# cc-switch、claude-code 等连字符工具名
_HYPHEN_TOOL_RE = re.compile(r"\b([a-z]{2,}(?:-[a-z0-9]+)+)\b", re.IGNORECASE)
# 全大写缩写 + 单词：CC Switch
_ACRONYM_TOOL_RE = re.compile(r"\b([A-Z]{2,})\s+([A-Za-z][\w\-]+)\b")


def _dedupe_keep_order(items: Iterable[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for item in items:
        key = item.strip().lower()
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(item.strip())
    return out


def _normalize_tool_name(name: str) -> str:
    return re.sub(r"\s+", " ", name.strip().strip("「」\"\"'（）()")).strip()


def _is_valid_tool_name(name: str) -> bool:
    n = _normalize_tool_name(name)
    if len(n) < 2:
        return False
    if n in _NOISE_EN:
        return False
    if n.lower() in {"api", "key", "url", "http", "https"}:
        return False
    return True


def _install_search_queries_for_tool(tool: str) -> list[str]:
    t = _normalize_tool_name(tool)
    if len(t) < 2:
        return []
    return [
        f"{t} github releases 下载 安装",
        f"{t} 官网 下载 安装",
        f"{t} official site install",
    ]


def _install_search_query(tool: str) -> str:
    qs = _install_search_queries_for_tool(tool)
    return qs[0] if qs else ""


def _collect_install_tool_names(text: str) -> list[str]:
    """从逐字稿提取需补全安装方式的工具名（去重）。"""
    names: list[str] = []
    seen: set[str] = set()

    def add_tool(raw: str) -> None:
        name = _normalize_tool_name(raw)
        key = name.lower()
        if not _is_valid_tool_name(name) or key in seen:
            return
        seen.add(key)
        names.append(name)

    for m in _INSTALL_MENTION_RE.finditer(text):
        add_tool(m.group(1))
    for m in _USE_TOOL_RE.finditer(text):
        add_tool(m.group(1))
    for m in _HYPHEN_TOOL_RE.finditer(text):
        add_tool(m.group(1))
    for m in _ACRONYM_TOOL_RE.finditer(text):
        add_tool(f"{m.group(1)} {m.group(2)}")
    for m in _CN_TOOL_CTX_RE.finditer(text):
        add_tool(m.group(1))
    for m in _OFFICIAL_SITE_CTX_RE.finditer(text):
        add_tool(m.group(1))
    for m in _CN_INSTALL_RE.finditer(text):
        raw = m.group(1).strip()
        if re.search(r"[A-Za-z@]", raw) or len(raw) >= 2:
            add_tool(raw)

    return names


def merge_tool_names(*groups: Iterable[str]) -> list[str]:
    return _dedupe_keep_order(
        name for group in groups for name in group if _is_valid_tool_name(name)
    )


def _collect_install_priority_queries(text: str) -> list[str]:
    """每个工具若干检索词（github / 官网），npm/brew/pip 命令优先。"""
    queries: list[str] = []
    for name in _collect_install_tool_names(text):
        queries.extend(_install_search_queries_for_tool(name))
    return queries


def _collect_tool_names(text: str) -> list[str]:
    names: list[str] = []
    for m in _ENGLISH_NAME_RE.finditer(text):
        name = m.group(1).strip()
        if name not in _NOISE_EN:
            names.append(name)
    for m in _CN_TOOL_CTX_RE.finditer(text):
        name = m.group(1).strip().strip("「」\"\"'")
        if len(name) >= 2:
            names.append(name)
    for m in _CN_SUFFIX_RE.finditer(text):
        names.append(m.group(1).strip())
    return _dedupe_keep_order(names)


def extract_search_queries(
    transcript_text: str,
    title: str = "",
    *,
    max_queries: int = 6,
    style: str = "beginner",
) -> list[str]:
    """从逐字稿与标题中提取联网检索词（无需额外 LLM 调用）。"""
    text = (transcript_text or "").strip()
    if not text and not title:
        return []

    candidates: list[str] = []

    if style == "professional":
        priority: list[str] = []
        secondary: list[str] = []

        for m in _NPM_INSTALL_RE.finditer(text):
            cmd = m.group(1).strip()
            priority.append(cmd)
            secondary.append(f"{cmd} 官方文档")
        for m in _BREW_INSTALL_RE.finditer(text):
            cmd = m.group(1).strip()
            priority.append(cmd)
            secondary.append(f"{cmd} 官网")
        for m in _PIP_INSTALL_RE.finditer(text):
            cmd = m.group(1).strip()
            priority.append(cmd)
            secondary.append(f"{cmd} 官方文档")
        for m in _CURL_WGET_RE.finditer(text):
            priority.append(m.group(1).strip()[:80])

        tool_names = _collect_tool_names(text)
        for name in tool_names[:4]:
            priority.extend(_install_search_queries_for_tool(name)[:2])
            secondary.append(f"{name} latest version changelog")
            secondary.append(f"{name} advanced CLI flags production")
            secondary.append(f"{name} 版本差异 兼容性")
        if title:
            short_title = re.sub(r"[【\[\]|｜/\\].*", "", title).strip()[:40]
            if short_title:
                secondary.append(f"{short_title} 工具 下载 安装")
                secondary.append(f"{short_title} 高阶用法 生产环境")
        candidates = _dedupe_keep_order(priority + secondary)
    else:
        priority: list[str] = []
        secondary: list[str] = []

        for m in _NPM_INSTALL_RE.finditer(text):
            cmd = m.group(1).strip()
            priority.append(cmd)
            secondary.append(f"{cmd} 官方文档")

        for m in _BREW_INSTALL_RE.finditer(text):
            cmd = m.group(1).strip()
            priority.append(cmd)
            secondary.append(f"{cmd} 官网")

        for m in _PIP_INSTALL_RE.finditer(text):
            cmd = m.group(1).strip()
            priority.append(cmd)
            secondary.append(f"{cmd} 官方文档")

        for m in _CURL_WGET_RE.finditer(text):
            priority.append(m.group(1).strip()[:80])

        priority.extend(_collect_install_priority_queries(text))

        for m in _NPM_PACKAGE_RE.finditer(text):
            pkg = m.group(0).strip()
            if pkg.startswith("@"):
                secondary.append(f"{pkg} npm install 官方")

        for name in _collect_tool_names(text):
            if _is_valid_tool_name(name):
                secondary.extend(_install_search_queries_for_tool(name))

        if title:
            short_title = re.sub(r"[【\[\]|｜/\\].*", "", title).strip()[:40]
            if short_title:
                secondary.append(f"{short_title} 工具 下载 安装")

        candidates = _dedupe_keep_order(priority + secondary)

    return candidates[:max_queries]


def format_known_install_commands(tool_names: Iterable[str]) -> str:
    """为已知 CLI 工具生成可直接引用的安装命令块。"""
    lines: list[str] = []
    seen: set[str] = set()
    for raw in tool_names:
        name = _normalize_tool_name(raw)
        key = name.lower()
        if not key or key in seen:
            continue
        cmd = None
        for pattern, command in KNOWN_INSTALL_COMMANDS.items():
            if pattern in key or key in pattern:
                cmd = command
                break
        if not cmd:
            continue
        seen.add(key)
        lines.append(f"- **{name}** 安装命令（公开信息，可直接写入笔记代码块）：")
        lines.append(f"  ```bash")
        lines.append(f"  {cmd}")
        lines.append(f"  ```")
    return "\n".join(lines)


def augment_web_context_with_known_commands(web_context: str, tool_names: Iterable[str]) -> str:
    known = format_known_install_commands(tool_names)
    if not known.strip():
        return web_context
    block = f"## 已知安装命令（优先直接写入笔记，禁止让用户去官网复制）\n{known}"
    if web_context.strip():
        return f"{web_context.strip()}\n\n{block}"
    return block


def format_web_context(results: list[dict]) -> str:
    if not results:
        return ""
    lines = []
    for i, item in enumerate(results, 1):
        title = (item.get("title") or "").strip()
        url = (item.get("url") or "").strip()
        snippet = (item.get("snippet") or "").strip()
        query = (item.get("query") or "").strip()
        head = f"{i}. [{title}]({url})" if url else f"{i}. {title or '（无标题）'}"
        if query:
            head += f"（检索词：{query}）"
        lines.append(head)
        if snippet:
            lines.append(f"   {snippet[:280]}")
    return "\n".join(lines)


async def _run_searches(
    queries: list[str],
    *,
    results_per_query: int = 3,
) -> list[dict]:
    collected: list[dict] = []
    seen_urls: set[str] = set()

    for query in queries:
        if not query.strip():
            continue
        try:
            hits = await search_web(query, max_results=results_per_query)
        except Exception as e:
            logger.warning("Web supplement search failed for %r: %s", query, e)
            continue
        for hit in hits:
            url = (hit.get("url") or "").strip()
            if url and url in seen_urls:
                continue
            if url:
                seen_urls.add(url)
            collected.append({**hit, "query": query})

    return collected


async def fetch_web_context_for_tools(
    tool_names: list[str],
    *,
    style: str = "beginner",
    results_per_query: int = 4,
) -> str:
    """对给定工具名列表逐个联网检索。"""
    queries: list[str] = []
    for name in merge_tool_names(tool_names):
        if style == "beginner":
            queries.extend(_install_search_queries_for_tool(name))
        else:
            queries.append(f"{name} latest version changelog")

    queries = _dedupe_keep_order(queries)[:max(15, len(tool_names) * 3)]
    collected: list[dict] = []
    if queries:
        collected = await _run_searches(queries, results_per_query=results_per_query)
    base = format_web_context(collected)
    if style == "beginner":
        return augment_web_context_with_known_commands(base, tool_names)
    return base


def extract_tools_via_llm(llm, transcript_text: str, title: str = "") -> list[str]:
    """用 LLM 从逐字稿提取需补全安装/下载/官网信息的工具与资源名。"""
    text = (transcript_text or "").strip()
    if not text:
        return []

    sample = text if len(text) <= 12000 else text[:6000] + "\n…\n" + text[-6000:]
    system = (
        "你是技术视频笔记助手。从逐字稿中识别「被提及但可能未给出完整安装/下载/官网链接」的工具、"
        "软件、插件、CLI、资源包（含中文名如剪映、飞书）。"
        "只输出 JSON 数组，如 [\"CC Switch\", \"剪映\", \"Node.js\"]，最多 20 项，不要解释。"
    )
    user = f"视频标题：{title or '未知'}\n\n逐字稿：\n{sample}"
    try:
        raw = llm._call(system, user, temperature=0.1).strip()
        if raw.startswith("["):
            items = json.loads(raw)
        else:
            m = re.search(r"\[[\s\S]*\]", raw)
            items = json.loads(m.group(0)) if m else []
        return [
            str(x).strip()
            for x in items
            if isinstance(x, str) and str(x).strip() and _is_valid_tool_name(str(x))
        ]
    except Exception as e:
        logger.warning("LLM tool extraction failed: %s", e)
        return []


async def fetch_web_supplement_context(
    transcript_text: str,
    title: str = "",
    *,
    style: str = "beginner",
    max_queries: int | None = None,
    results_per_query: int | None = None,
    llm=None,
) -> str:
    """联网检索工具/资源信息，供笔记生成 prompt 引用（小白：安装/下载；专业：版本/高阶）。"""
    if max_queries is None:
        max_queries = 15 if style == "beginner" else 6
    if results_per_query is None:
        results_per_query = 4 if style == "beginner" else 3

    llm_tools: list[str] = []
    if style == "beginner" and llm is not None:
        llm_tools = extract_tools_via_llm(llm, transcript_text, title)

    regex_queries = extract_search_queries(
        transcript_text, title, max_queries=max_queries, style=style
    )
    llm_queries: list[str] = []
    for name in llm_tools:
        llm_queries.extend(_install_search_queries_for_tool(name))

    queries = _dedupe_keep_order(llm_queries + regex_queries)[:max_queries]
    collected: list[dict] = []
    if queries:
        collected = await _run_searches(queries, results_per_query=results_per_query)
    base = format_web_context(collected)

    if style == "beginner":
        tool_names = merge_tool_names(
            llm_tools,
            _collect_install_tool_names(transcript_text or ""),
        )
        return augment_web_context_with_known_commands(base, tool_names)
    return base
