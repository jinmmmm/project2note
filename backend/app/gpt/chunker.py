from typing import List


def _format_segment_clock(seconds: float) -> str:
    total = max(0, int(seconds))
    h, rem = divmod(total, 3600)
    m, s = divmod(rem, 60)
    if h > 0:
        return f"{h}:{m:02d}:{s:02d}"
    return f"{m}:{s:02d}"


def chunk_segments(segments: List[dict], max_chars: int = 8000) -> List[str]:
    """Split transcript segments into chunks for LLM processing."""
    chunks = []
    current_lines = []
    current_len = 0

    for seg in segments:
        line = f"[{_format_segment_clock(seg['start'])}] {seg['text']}"
        if current_len + len(line) > max_chars and current_lines:
            chunks.append("\n".join(current_lines))
            current_lines = [line]
            current_len = len(line)
        else:
            current_lines.append(line)
            current_len += len(line)

    if current_lines:
        chunks.append("\n".join(current_lines))
    return chunks
