from pathlib import Path

from PIL import Image, ImageDraw

from app.gpt import prompts
from app.services.keyframe_selector import LOOSE_MIN_SCORE, score_frame, select_keyframe


def _save_plain(path: Path, color: tuple[int, int, int] = (245, 245, 245)) -> None:
    Image.new("RGB", (320, 180), color).save(path)


def _save_slide(path: Path) -> None:
    image = Image.new("RGB", (320, 180), (245, 245, 245))
    draw = ImageDraw.Draw(image)
    draw.rectangle((18, 18, 302, 160), outline=(30, 30, 30), width=3)
    draw.rectangle((40, 40, 280, 70), fill=(70, 110, 190))
    for y in (90, 112, 134):
        draw.line((45, y, 260, y), fill=(35, 35, 35), width=3)
    image.save(path)


def _save_subtitle_heavy(path: Path) -> None:
    image = Image.new("RGB", (320, 180), (245, 245, 245))
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 150, 320, 180), fill=(20, 20, 20))
    for x in range(20, 300, 12):
        draw.line((x, 158, x + 8, 158), fill=(255, 255, 255), width=2)
    image.save(path)


def test_score_frame_prefers_slide_over_plain(tmp_path):
    plain = tmp_path / "plain.jpg"
    slide = tmp_path / "slide.jpg"
    _save_plain(plain)
    _save_slide(slide)

    assert score_frame(str(slide)) > score_frame(str(plain))


def test_score_frame_penalizes_subtitle_heavy_frame(tmp_path):
    slide = tmp_path / "slide.jpg"
    subtitle = tmp_path / "subtitle.jpg"
    _save_slide(slide)
    _save_subtitle_heavy(subtitle)

    assert score_frame(str(slide)) > score_frame(str(subtitle))


def test_select_keyframe_returns_none_when_all_candidates_below_threshold(monkeypatch, tmp_path):
    def fake_extract_frame(video_path, seconds, output_dir, file_stem=None):
        path = Path(output_dir) / f"{file_stem}.jpg"
        _save_plain(path)
        return str(path)

    monkeypatch.setattr("app.services.keyframe_selector.extract_frame", fake_extract_frame)

    selected = select_keyframe("video.mp4", 10, str(tmp_path), "ss_task_10", min_score=0.95)

    assert selected is None
    assert not (tmp_path / "ss_task_10.jpg").exists()


def test_select_keyframe_loose_mode_falls_back_to_best_candidate(monkeypatch, tmp_path):
    def fake_extract_frame(video_path, seconds, output_dir, file_stem=None):
        path = Path(output_dir) / f"{file_stem}.jpg"
        _save_plain(path)
        return str(path)

    monkeypatch.setattr("app.services.keyframe_selector.extract_frame", fake_extract_frame)

    selected = select_keyframe(
        "video.mp4",
        10,
        str(tmp_path),
        "ss_task_10",
        min_score=LOOSE_MIN_SCORE,
    )

    assert selected is not None
    assert (tmp_path / "ss_task_10.jpg").exists()


def test_select_keyframe_invalidates_cached_frame_below_threshold(monkeypatch, tmp_path):
    cached = tmp_path / "ss_task_10.jpg"
    _save_plain(cached)

    def fake_extract_frame(video_path, seconds, output_dir, file_stem=None):
        path = Path(output_dir) / f"{file_stem}.jpg"
        _save_slide(path)
        return str(path)

    monkeypatch.setattr("app.services.keyframe_selector.extract_frame", fake_extract_frame)

    selected = select_keyframe("video.mp4", 10, str(tmp_path), "ss_task_10", min_score=0.95)

    assert selected is None


def test_select_keyframe_saves_best_candidate(monkeypatch, tmp_path):
    def fake_extract_frame(video_path, seconds, output_dir, file_stem=None):
        path = Path(output_dir) / f"{file_stem}.jpg"
        if seconds == 10:
            _save_slide(path)
        else:
            _save_plain(path)
        return str(path)

    monkeypatch.setattr("app.services.keyframe_selector.extract_frame", fake_extract_frame)

    selected = select_keyframe("video.mp4", 10, str(tmp_path), "ss_task_10", window_seconds=1, min_score=0.1)

    assert selected is not None
    assert selected.seconds == 10
    assert (tmp_path / "ss_task_10.jpg").exists()


def test_embed_screenshots_respects_smart_screenshot_toggle(monkeypatch, tmp_path):
    video = tmp_path / "video.mp4"
    video.write_bytes(b"fake")
    markdown = "## 2. 结构化笔记\n### 主题 <!-- ts:00:10 -->\n- 内容"

    monkeypatch.setattr(prompts.settings, "enable_smart_screenshots", False)

    assert prompts.embed_screenshots_into_note(markdown, str(video), "task", str(tmp_path)) == markdown


def test_embed_screenshots_skips_when_no_keyframe_selected(monkeypatch, tmp_path):
    video = tmp_path / "video.mp4"
    video.write_bytes(b"fake")
    markdown = "## 2. 结构化笔记\n### 主题 <!-- ts:00:10 -->\n- 内容"

    monkeypatch.setattr(prompts.settings, "enable_smart_screenshots", True)
    monkeypatch.setattr(prompts, "select_keyframe", lambda *args, **kwargs: None)

    out = prompts.embed_screenshots_into_note(markdown, str(video), "task", str(tmp_path))

    assert "![截图]" not in out


def test_embed_screenshots_uses_refined_timestamp(monkeypatch, tmp_path):
    video = tmp_path / "video.mp4"
    video.write_bytes(b"fake")
    markdown = "## 2. 结构化笔记\n### 环境安装 <!-- ts:00:10 -->\n- 内容"
    captured: dict[str, int] = {}

    monkeypatch.setattr(prompts.settings, "enable_smart_screenshots", True)
    monkeypatch.setattr(
        prompts,
        "refine_screenshot_timestamp",
        lambda *args, **kwargs: 18,
    )

    def fake_select_keyframe(_video, timestamp_seconds, *args, **kwargs):
        captured["seconds"] = timestamp_seconds
        from app.services.keyframe_selector import KeyframeCandidate

        out = tmp_path / "ss_task_10.jpg"
        Image.new("RGB", (320, 180), (200, 200, 200)).save(out)
        return KeyframeCandidate(str(out), timestamp_seconds, 0.5)

    monkeypatch.setattr(prompts, "select_keyframe", fake_select_keyframe)

    client = prompts.VisionRefineClient(api_key="k", base_url="https://example.com/v1", model_name="vision")
    out = prompts.embed_screenshots_into_note(
        markdown,
        str(video),
        "task",
        str(tmp_path),
        vision_refine_enabled=True,
        vision_client=client,
    )

    assert captured.get("seconds") == 18
    assert "![截图]" in out
