from __future__ import annotations

import base64
import io
import re
import shutil
import tempfile
from dataclasses import dataclass
from typing import Callable

from openai import OpenAI
from PIL import Image, ImageDraw, ImageFont

from app.config import settings
from app.utils.ffmpeg_helper import extract_frame

_TIMESTAMP_RE = re.compile(r"(\d{1,2}):(\d{2})(?::(\d{2}))?")


@dataclass(frozen=True)
class VisionRefineClient:
    api_key: str
    base_url: str
    model_name: str


def build_candidate_timestamps(
    anchor: int,
    *,
    half_window: int | None = None,
    step: int | None = None,
) -> list[int]:
    half = half_window if half_window is not None else settings.vision_refine_half_window_seconds
    interval = step if step is not None else settings.vision_refine_sample_step_seconds
    start = max(0, anchor - half)
    end = anchor + half
    return list(range(start, end + 1, max(1, interval)))


def seconds_to_mmss(seconds: int) -> str:
    mm = seconds // 60
    ss = seconds % 60
    return f"{mm:02d}:{ss:02d}"


def parse_timestamp_from_response(
    text: str,
    *,
    allowed_seconds: set[int] | None = None,
    min_seconds: int | None = None,
    max_seconds: int | None = None,
) -> int | None:
    if not text:
        return None
    match = _TIMESTAMP_RE.search(text.strip())
    if not match:
        return None
    first = int(match.group(1))
    second = int(match.group(2))
    third = match.group(3)
    total = first * 3600 + second * 60 + int(third) if third is not None else first * 60 + second
    if min_seconds is not None and total < min_seconds:
        return None
    if max_seconds is not None and total > max_seconds:
        return None
    if allowed_seconds is not None and total not in allowed_seconds:
        return None
    return total


def extract_candidate_frames(
    video_path: str,
    timestamps: list[int],
    temp_dir: str,
) -> list[tuple[int, str]]:
    frames: list[tuple[int, str]] = []
    for ts in timestamps:
        try:
            path = extract_frame(video_path, ts, temp_dir, file_stem=f"candidate_{ts}")
            frames.append((ts, path))
        except Exception:
            continue
    return frames


def _resize_cell(image: Image.Image, max_long_edge: int = 1024) -> Image.Image:
    w, h = image.size
    long_edge = max(w, h)
    if long_edge <= max_long_edge:
        return image
    scale = max_long_edge / long_edge
    return image.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.Resampling.LANCZOS)


def build_preview_grid(
    frame_items: list[tuple[int, str]],
    *,
    grid_size: tuple[int, int] | None = None,
    cell_width: int = 320,
    cell_height: int = 180,
) -> tuple[str, list[int]]:
    if not frame_items:
        raise ValueError("frame_items is empty")

    cols, rows = grid_size or settings.vision_refine_grid_size
    capacity = cols * rows
    selected = frame_items[:capacity]
    seconds_list = [ts for ts, _ in selected]

    font = ImageFont.load_default()
    images: list[Image.Image] = []
    for ts, path in selected:
        img = Image.open(path).convert("RGB")
        img = _resize_cell(img, max_long_edge=1024)
        img = img.resize((cell_width, cell_height), Image.Resampling.LANCZOS)
        draw = ImageDraw.Draw(img)
        label = seconds_to_mmss(ts)
        draw.text((8, 8), label, fill="yellow", stroke_width=1, stroke_fill="black", font=font)
        images.append(img)

    grid_w = cell_width * cols
    grid_h = cell_height * rows
    grid_img = Image.new("RGB", (grid_w, grid_h), (255, 255, 255))
    for idx, img in enumerate(images):
        x = (idx % cols) * cell_width
        y = (idx // cols) * cell_height
        grid_img.paste(img, (x, y))

    buf = io.BytesIO()
    grid_img.save(buf, format="JPEG", quality=85)
    b64 = base64.b64encode(buf.getvalue()).decode("utf-8")
    return f"data:image/jpeg;base64,{b64}", seconds_list


def _build_refine_prompt(
    anchor_seconds: int,
    section_title: str,
    *,
    body_preview: str = "",
) -> str:
    anchor_label = seconds_to_mmss(anchor_seconds)
    title = section_title.strip() or "（无标题）"
    preview = body_preview.strip()
    preview_block = f"\n本节正文摘要：{preview[:80]}" if preview else ""
    return (
        "你将看到一张视频候选帧网格图。每个小格左上角标注了该帧在视频中的时间（mm:ss 格式）。\n"
        f"当前小节主题：{title}\n"
        f"逐字稿锚点时间：{anchor_label}{preview_block}\n\n"
        "请选出最能代表本节讲解内容的一格（例如 PPT、图表、UI 演示、操作步骤、产品界面）。\n"
        "要求：\n"
        "1. 只返回一个时间，格式为 mm:ss（例如 03:15）\n"
        "2. 不要输出任何解释或其他文字\n"
        f"3. 若无法判断，请返回锚点时间 {anchor_label}"
    )


def refine_screenshot_timestamp(
    video_path: str,
    anchor_seconds: int,
    section_title: str,
    client: VisionRefineClient,
    *,
    body_preview: str = "",
    half_window: int | None = None,
    step: int | None = None,
    call_vision: Callable[..., str] | None = None,
) -> int:
    half = half_window if half_window is not None else settings.vision_refine_half_window_seconds
    candidates = build_candidate_timestamps(anchor_seconds, half_window=half, step=step)
    allowed = set(candidates)
    min_sec = max(0, anchor_seconds - half)
    max_sec = anchor_seconds + half

    temp_dir = tempfile.mkdtemp(prefix="p2n_vision_refine_")
    try:
        frame_items = extract_candidate_frames(video_path, candidates, temp_dir)
        if not frame_items:
            return anchor_seconds

        grid_data_url, grid_seconds = build_preview_grid(frame_items)
        prompt = _build_refine_prompt(anchor_seconds, section_title, body_preview=body_preview)

        if call_vision is not None:
            reply = call_vision(client, prompt, grid_data_url)
        else:
            reply = _default_vision_call(client, prompt, grid_data_url)

        parsed = parse_timestamp_from_response(
            reply,
            allowed_seconds=set(grid_seconds),
            min_seconds=min_sec,
            max_seconds=max_sec,
        )
        if parsed is None:
            parsed = parse_timestamp_from_response(
                reply,
                min_seconds=min_sec,
                max_seconds=max_sec,
            )
        return parsed if parsed is not None else anchor_seconds
    except Exception:
        return anchor_seconds
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


def _default_vision_call(client: VisionRefineClient, prompt: str, grid_data_url: str) -> str:
    openai_client = OpenAI(api_key=client.api_key, base_url=client.base_url)
    resp = openai_client.chat.completions.create(
        model=client.model_name,
        messages=[{
            "role": "user",
            "content": [
                {"type": "text", "text": prompt},
                {"type": "image_url", "image_url": {"url": grid_data_url}},
            ],
        }],
        temperature=0.2,
        max_tokens=64,
    )
    return (resp.choices[0].message.content or "").strip()
