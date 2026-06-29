import re
from typing import Optional


def normalize_heading_text(text: str) -> str:
    text = re.sub(r"\*\*|__", "", text)
    text = re.sub(r"`([^`]+)`", r"\1", text)
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)
    text = re.sub(r"^\d+(?:\.\d+)*\.?\s*", "", text.strip())
    return re.sub(r"\s+", " ", text).strip()


def _parse_heading_line(line: str) -> Optional[tuple[int, str]]:
    trimmed = line.strip()
    if trimmed.startswith("```"):
        return None
    match = re.match(r"^(#{1,6})\s+(.+)$", trimmed)
    if not match:
        return None
    return len(match.group(1)), normalize_heading_text(match.group(2))


def extract_section(
    markdown: str,
    target_title: str,
    target_depth: int,
) -> Optional[tuple[str, int, int]]:
    """返回 (section_markdown, start_line, end_line)，end_line 为开区间。"""
    lines = markdown.split("\n")
    norm_target = normalize_heading_text(target_title)
    start: Optional[int] = None
    in_fence = False

    for i, line in enumerate(lines):
        trimmed = line.strip()
        if trimmed.startswith("```"):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        parsed = _parse_heading_line(line)
        if not parsed:
            continue
        depth, title = parsed
        if depth == target_depth and title == norm_target:
            start = i
            break

    if start is None:
        return None

    end = len(lines)
    in_fence = False
    for j in range(start + 1, len(lines)):
        trimmed = lines[j].strip()
        if trimmed.startswith("```"):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        parsed = _parse_heading_line(lines[j])
        if parsed and parsed[0] <= target_depth:
            end = j
            break

    return "\n".join(lines[start:end]), start, end


def replace_section(markdown: str, start: int, end: int, new_section: str) -> str:
    lines = markdown.split("\n")
    new_lines = new_section.split("\n")
    return "\n".join(lines[:start] + new_lines + lines[end:])
