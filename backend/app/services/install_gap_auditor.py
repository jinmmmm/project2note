"""检测笔记中「安装/下载/官网」提及是否缺少可执行细节，并触发二次补全。"""

from __future__ import annotations

import asyncio
import logging
import re
from typing import Callable, Optional

from app.gpt.note_llm import NoteLLM
from app.services.web_supplement import fetch_web_context_for_tools

logger = logging.getLogger(__name__)

_SECTION2_START_RE = re.compile(r"^##\s+(?:\d+\.\s*)?结构化笔记")
_SECTION_HEADING_RE = re.compile(r"^##\s+")
_INSTALL_TRIGGER_RE = re.compile(
    r"安装|下载|官网|官方网站|去官网|GitHub|github|releases|brew\s+install|pip\s+install|npm\s+install|"
    r"复制.*终端|粘贴.*终端|官方安装",
    re.IGNORECASE,
)
_LINK_RE = re.compile(r"\]\(https?://|https?://", re.IGNORECASE)
_CODE_FENCE_RE = re.compile(r"```")
_INSTALL_CMD_RE = re.compile(
    r"npm\s+install|brew\s+install|pip3?\s+install|(?:curl|wget)\s+",
    re.IGNORECASE,
)
_BULLET_RE = re.compile(r"^(\s*)[-*]\s+")
_TOOL_IN_LINE_RE = re.compile(
    r"(?:安装|下载|使用)\s*[「「""]?([^，。；\n「」""（(]{2,40})",
    re.IGNORECASE,
)


def _block_has_install_command(block_text: str) -> bool:
    return bool(_INSTALL_CMD_RE.search(block_text))


def _block_has_manual_download(block_text: str) -> bool:
    if not _LINK_RE.search(block_text):
        return False
    return bool(
        re.search(
            r"下载|releases|Release|\.dmg|\.exe|\.msi|安装包",
            block_text,
            re.I,
        )
    )


def _block_has_actionable_detail(block_text: str) -> bool:
    if _block_has_install_command(block_text):
        return True
    if _block_has_manual_download(block_text):
        return True
    if _CODE_FENCE_RE.search(block_text) and re.search(
        r"claude\s+--version|node\s+-v|npm\s+-v",
        block_text,
        re.I,
    ):
        return True
    return False


def _extract_section2(markdown: str) -> str:
    lines = markdown.split("\n")
    out: list[str] = []
    in_section = False
    for line in lines:
        if _SECTION2_START_RE.search(line):
            in_section = True
            continue
        if in_section and _SECTION_HEADING_RE.match(line):
            break
        if in_section:
            out.append(line)
    return "\n".join(out)


def _collect_bullet_block(lines: list[str], start: int, base_indent: int) -> tuple[str, int]:
    block_lines = [lines[start]]
    i = start + 1
    while i < len(lines):
        line = lines[i]
        if not line.strip():
            block_lines.append(line)
            i += 1
            continue
        m = _BULLET_RE.match(line)
        if m and len(m.group(1)) <= base_indent:
            break
        if line.startswith("#"):
            break
        block_lines.append(line)
        i += 1
    return "\n".join(block_lines), i


def _hint_from_line(line: str) -> str:
    m = _TOOL_IN_LINE_RE.search(line)
    if m:
        return m.group(1).strip().strip("「」\"\"'（）()")
    cleaned = re.sub(r"^[-*]\s+", "", line.strip())
    cleaned = re.sub(r"\*\*([^*]+)\*\*", r"\1", cleaned)
    return cleaned[:40].strip()


def find_incomplete_install_gaps(markdown: str) -> list[str]:
    """返回需补全的工具/资源名列表（去重）。"""
    section = _extract_section2(markdown)
    if not section.strip():
        return []

    lines = section.split("\n")
    hints: list[str] = []
    seen: set[str] = set()
    i = 0
    while i < len(lines):
        line = lines[i]
        m = _BULLET_RE.match(line)
        if not m or not _INSTALL_TRIGGER_RE.search(line):
            i += 1
            continue
        base_indent = len(m.group(1))
        block, next_i = _collect_bullet_block(lines, i, base_indent)
        if not _block_has_actionable_detail(block):
            hint = _hint_from_line(line)
            key = hint.lower()
            if hint and key not in seen and len(hint) >= 2:
                seen.add(key)
                hints.append(hint)
        i = next_i

    return hints


async def repair_install_gaps(
    markdown: str,
    llm: NoteLLM,
    *,
    style: str = "beginner",
    on_progress: Optional[Callable[[str], None]] = None,
) -> str:
    """扫描安装缺口，联网检索后二次补全笔记。"""
    gaps = find_incomplete_install_gaps(markdown)
    if not gaps:
        return markdown

    logger.info("Install gap audit found %d items for %s: %s", len(gaps), style, gaps[:8])
    if on_progress:
        on_progress("install_repair")

    web_context = await fetch_web_context_for_tools(gaps, style=style)
    repaired = await asyncio.to_thread(llm.repair_install_gaps, markdown, gaps, web_context)

    still_gaps = find_incomplete_install_gaps(repaired)
    if still_gaps and still_gaps != gaps:
        logger.info("Install gaps remain after repair: %s", still_gaps[:5])

    return repaired


async def repair_beginner_install_gaps(
    markdown: str,
    llm: NoteLLM,
    *,
    on_progress: Optional[Callable[[str], None]] = None,
) -> str:
    """小白模式：扫描安装缺口，联网检索后二次补全笔记。"""
    return await repair_install_gaps(
        markdown,
        llm,
        style="beginner",
        on_progress=on_progress,
    )
