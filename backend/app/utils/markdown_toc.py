import re
from dataclasses import dataclass
from typing import List, Optional


@dataclass
class TocItem:
    id: str
    text: str
    level: int


def slugify(text: str) -> str:
    s = re.sub(r"[^\w\u4e00-\u9fff\s-]", "", text.strip().lower())
    s = re.sub(r"\s+", "-", s)
    return s[:48] or "section"


def _strip_named_section(markdown: str, title_keyword: str) -> str:
    if not markdown:
        return markdown

    lines = markdown.split("\n")
    out: List[str] = []
    skipping = False
    title_pattern = re.compile(
        rf"^#{{1,6}}\s+(?:0\.\s*)?(?:\d+(?:\.\d+)*\.\s*)?{re.escape(title_keyword)}"
    )

    for line in lines:
        trimmed = line.strip()
        if title_pattern.match(trimmed):
            skipping = True
            continue
        if skipping and re.match(r"^##\s+", trimmed) and title_keyword not in trimmed:
            skipping = False
        if not skipping:
            out.append(line)

    return re.sub(r"\n{3,}", "\n\n", "\n".join(out)).strip()


def strip_video_toc_section(markdown: str) -> str:
    return _strip_named_section(markdown, "视频目录")


def strip_body_toc_section(markdown: str) -> str:
    return _strip_named_section(markdown, "正文目录")


def _strip_for_display(markdown: str) -> str:
    body = strip_body_toc_section(strip_video_toc_section(markdown or ""))
    body = re.sub(r"<!--\s*term-defs[\s\S]*?-->\s*", "", body, flags=re.IGNORECASE)
    body = re.sub(r"<!--\s*glossary[\s\S]*?-->\s*", "", body, flags=re.IGNORECASE)
    return body


def _parse_leading_number(text: str) -> tuple[Optional[str], str]:
    match = re.match(r"^(\d+(?:\.\d+)*)\.\s+(.+)$", text)
    if match:
        return match.group(1), match.group(2)
    return None, text


def _clean_label(raw_text: str, depth: int) -> str:
    num, label = _parse_leading_number(raw_text)
    if num:
        return label
    if depth >= 3:
        return re.sub(r"^\d+(?:\.\d+)*\.?\s*", "", raw_text)
    return raw_text


def _should_skip_heading(text: str) -> bool:
    return "视频目录" in text or "正文目录" in text


class _HeadingNumberState:
    def __init__(self) -> None:
        self.visible_section_index = 0
        self.current_section_num: Optional[str] = None
        self.h3 = 0
        self.h4 = 0


def _next_heading_number(depth: int, state: _HeadingNumberState) -> str:
    if depth <= 2:
        state.h3 = 0
        state.h4 = 0
        state.visible_section_index += 1
        state.current_section_num = str(state.visible_section_index)
        return state.current_section_num
    if depth == 3:
        state.h4 = 0
        state.h3 += 1
        return f"{state.current_section_num or '1'}.{state.h3}"
    state.h4 += 1
    return f"{state.current_section_num or '1'}.{state.h3 or 1}.{state.h4}"


def _heading_indent_level(depth: int) -> int:
    if depth <= 2:
        return 1
    if depth == 3:
        return 2
    return min(depth - 1, 4)


def renumber_headings_in_markdown(markdown: str) -> str:
    state = _HeadingNumberState()
    out: List[str] = []

    for line in markdown.split("\n"):
        match = re.match(r"^(#{1,6})\s+(.+)$", line.strip())
        if not match:
            out.append(line)
            continue

        depth = len(match.group(1))
        raw_text = re.sub(r"\*\*", "", match.group(2)).strip()
        if _should_skip_heading(raw_text):
            continue

        label = _clean_label(raw_text, depth)
        display_num = _next_heading_number(depth, state)
        out.append(f"{match.group(1)} {display_num}. {label}")

    return "\n".join(out)


def get_display_markdown(markdown: str) -> str:
    return renumber_headings_in_markdown(_strip_for_display(markdown))


def _make_heading_id(title: str, slug_count: dict[str, int]) -> str:
    base = slugify(title)
    slug_count[base] = slug_count.get(base, 0) + 1
    return base if slug_count[base] == 1 else f"{base}-{slug_count[base]}"


def extract_toc_from_source(source: str) -> List[TocItem]:
    items: List[TocItem] = []
    slug_count: dict[str, int] = {}

    for line in source.split("\n"):
        match = re.match(r"^(#{1,6})\s+(.+)$", line.strip())
        if not match:
            continue

        depth = len(match.group(1))
        title = re.sub(r"\*\*", "", match.group(2)).strip()
        if _should_skip_heading(title):
            continue

        items.append(
            TocItem(
                id=_make_heading_id(title, slug_count),
                text=title,
                level=_heading_indent_level(depth),
            )
        )

    return items


def extract_toc(markdown: str) -> List[TocItem]:
    return extract_toc_from_source(get_display_markdown(markdown))


def generate_body_toc_block(markdown: str) -> str:
    headings = extract_toc(markdown)
    if not headings:
        return ""

    lines = ["## 0. 正文目录", ""]
    for item in headings:
        lines.append(f"- [{item.text}](#{item.id})")
    lines.append("")
    return "\n".join(lines)


def ensure_body_toc_for_export(markdown: str) -> str:
    body = get_display_markdown(markdown)
    block = generate_body_toc_block(markdown)
    if not block:
        return body
    return f"{block}\n{body.lstrip()}"


def prepare_markdown_for_pdf_export(markdown: str) -> str:
    """Strip web-only TOC anchors and normalize content for PDF engines."""
    body = get_display_markdown(markdown)
    # Internal anchor links break markdown-pdf / pymupdf link resolution.
    body = re.sub(r"\[([^\]]+)\]\(#[^)]+\)", r"\1", body)
    return body.strip()


def prepare_markdown_for_feishu_sync(markdown: str) -> str:
    """Prepare note markdown for Feishu docx sync."""
    body = get_display_markdown(markdown).strip()
    body = re.sub(r"\[([^\]]+)\]\(#[^)]+\)", r"\1", body)
    body = re.sub(r"==([^=\n]+)==", r"**\1**", body)
    return body


def safe_export_filename(title: str, ext: str) -> str:
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "", (title or "note").strip())[:80]
    return f"{name or 'note'}.{ext}"
