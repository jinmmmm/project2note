import re
from difflib import SequenceMatcher
from typing import List


FILLER_WORDS = {
    "嗯", "啊", "呃", "哦", "那个", "然后", "就是", "这个", "对吧",
    "你知道", "其实", "所以说", "怎么说呢", "好吧", "对对对",
}


def _strip_fillers(text: str) -> str:
    result = text
    for word in FILLER_WORDS:
        result = re.sub(rf"(^|[，,。！？\s]){re.escape(word)}([，,。！？\s]|$)", r"\1\2", result)
    result = re.sub(r"\s+", " ", result).strip()
    return result


def _similarity(a: str, b: str) -> float:
    return SequenceMatcher(None, a, b).ratio()


def clean_transcript(segments: List[dict]) -> List[dict]:
    """Filter filler words and deduplicate repetitive segments."""
    cleaned = []
    prev_text = ""

    for seg in segments:
        text = _strip_fillers((seg.get("text") or "").strip())
        if not text or len(text) < 2:
            continue
        if prev_text and _similarity(text, prev_text) > 0.85:
            continue
        cleaned.append({
            "start": float(seg.get("start", 0)),
            "end": float(seg.get("end", 0)),
            "text": text,
        })
        prev_text = text

    return cleaned
