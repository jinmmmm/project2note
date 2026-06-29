from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageFilter, ImageStat

from app.utils.ffmpeg_helper import extract_frame

# 与前端「宽松」档 score=0.2 对齐：低于此阈值视为宽松模式，允许兜底选帧
LOOSE_MIN_SCORE = 0.25


@dataclass(frozen=True)
class KeyframeCandidate:
    path: str
    seconds: int
    score: float


def average_hash(image: Image.Image, size: int = 8) -> int:
    gray = image.convert("L").resize((size, size))
    pixels = list(gray.getdata())
    avg = sum(pixels) / len(pixels)
    value = 0
    for pixel in pixels:
        value = (value << 1) | int(pixel >= avg)
    return value


def hamming_distance(left: int, right: int) -> int:
    return (left ^ right).bit_count()


def score_frame(image_path: str) -> float:
    with Image.open(image_path) as image:
        image = image.convert("RGB")
        width, height = image.size
        if width < 2 or height < 2:
            return 0.0

        gray = image.convert("L")
        brightness = ImageStat.Stat(gray).mean[0] / 255
        contrast = ImageStat.Stat(gray).stddev[0] / 128
        edges = gray.filter(ImageFilter.FIND_EDGES)
        edge_density = ImageStat.Stat(edges).mean[0] / 64

        bottom = gray.crop((0, int(height * 0.9), width, height))
        bottom_edges = bottom.filter(ImageFilter.FIND_EDGES)
        subtitle_density = ImageStat.Stat(bottom_edges).mean[0] / 64

        center = gray.crop((int(width * 0.1), int(height * 0.1), int(width * 0.9), int(height * 0.85)))
        center_edges = center.filter(ImageFilter.FIND_EDGES)
        content_density = ImageStat.Stat(center_edges).mean[0] / 64

        brightness_score = 1 - min(abs(brightness - 0.62) / 0.62, 1)
        subtitle_penalty = min(max(subtitle_density - content_density * 1.2, 0), 0.35)
        score = (
            min(content_density, 1) * 0.45
            + min(edge_density, 1) * 0.25
            + min(contrast, 1) * 0.2
            + brightness_score * 0.1
            - subtitle_penalty
        )
        return max(0.0, min(score, 1.0))


def _candidate_seconds(timestamp_seconds: int, window_seconds: int) -> list[int]:
    start = max(0, timestamp_seconds - window_seconds)
    end = timestamp_seconds + window_seconds
    return list(range(start, end + 1))


def select_keyframe(
    video_path: str,
    timestamp_seconds: int,
    output_dir: str,
    file_stem: str,
    *,
    window_seconds: int = 5,
    min_score: float = 0.3,
) -> KeyframeCandidate | None:
    Path(output_dir).mkdir(parents=True, exist_ok=True)
    final_path = os.path.join(output_dir, f"{file_stem}.jpg")
    if os.path.exists(final_path):
        cached_score = score_frame(final_path)
        if cached_score >= min_score:
            return KeyframeCandidate(final_path, timestamp_seconds, cached_score)
        try:
            os.remove(final_path)
        except OSError:
            pass

    scored: list[tuple[KeyframeCandidate, int]] = []
    temp_paths: list[str] = []

    for seconds in _candidate_seconds(timestamp_seconds, window_seconds):
        temp_stem = f"{file_stem}_candidate_{seconds}"
        try:
            path = extract_frame(video_path, seconds, output_dir, temp_stem)
            temp_paths.append(path)
            with Image.open(path) as image:
                image_hash = average_hash(image)
            scored.append((KeyframeCandidate(path, seconds, score_frame(path)), image_hash))
        except Exception:
            continue

    selected: KeyframeCandidate | None = None
    seen_hashes: list[int] = []
    for candidate, image_hash in sorted(scored, key=lambda item: item[0].score, reverse=True):
        if any(hamming_distance(image_hash, seen) <= 5 for seen in seen_hashes):
            continue
        seen_hashes.append(image_hash)
        if candidate.score >= min_score:
            selected = candidate
            break

    if selected is None and scored and min_score <= LOOSE_MIN_SCORE:
        best = max(item[0] for item in scored)
        if best.score > 0:
            selected = best

    if selected is not None:
        os.replace(selected.path, final_path)
        selected = KeyframeCandidate(final_path, selected.seconds, selected.score)

    selected_path = selected.path if selected else None
    for path in temp_paths:
        if path == selected_path:
            continue
        try:
            if os.path.exists(path):
                os.remove(path)
        except OSError:
            pass

    return selected
