from pathlib import Path

from PIL import Image, ImageDraw

from app.services.screenshot_vision_refine import (
    VisionRefineClient,
    build_candidate_timestamps,
    build_preview_grid,
    parse_timestamp_from_response,
    refine_screenshot_timestamp,
)


def test_build_candidate_timestamps_respects_anchor_zero():
    stamps = build_candidate_timestamps(6, half_window=6, step=3)
    assert stamps[0] == 0
    assert 6 in stamps
    assert stamps[-1] == 12


def test_parse_timestamp_from_response_formats():
    assert parse_timestamp_from_response("03:15", allowed_seconds={195}) == 195
    assert parse_timestamp_from_response("1:05:30", min_seconds=0, max_seconds=4000) == 3930
    assert parse_timestamp_from_response("no time") is None


def test_build_preview_grid_returns_data_url():
    tmp = Path(__file__).parent / "_tmp_grid"
    tmp.mkdir(exist_ok=True)
    path = tmp / "frame.jpg"
    Image.new("RGB", (64, 36), (200, 200, 200)).save(path)
    try:
        data_url, seconds = build_preview_grid([(10, str(path))], grid_size=(1, 1), cell_width=64, cell_height=36)
        assert data_url.startswith("data:image/jpeg;base64,")
        assert seconds == [10]
    finally:
        path.unlink(missing_ok=True)
        tmp.rmdir()


def test_refine_screenshot_timestamp_uses_model_reply(monkeypatch, tmp_path):
    frame = tmp_path / "frame.jpg"
    Image.new("RGB", (64, 36), (120, 120, 120)).save(frame)

    def fake_extract(video_path, timestamps, temp_dir):
        return [(ts, str(frame)) for ts in timestamps]

    monkeypatch.setattr(
        "app.services.screenshot_vision_refine.extract_candidate_frames",
        fake_extract,
    )

    client = VisionRefineClient(api_key="k", base_url="https://example.com/v1", model_name="vision")

    def fake_call(_client, _prompt, _url):
        return "00:18"

    refined = refine_screenshot_timestamp(
        "video.mp4",
        15,
        "环境安装",
        client,
        half_window=6,
        step=3,
        call_vision=fake_call,
    )
    assert refined == 18


def test_refine_screenshot_timestamp_falls_back_on_api_error(monkeypatch, tmp_path):
    frame = tmp_path / "frame.jpg"
    Image.new("RGB", (64, 36), (120, 120, 120)).save(frame)

    monkeypatch.setattr(
        "app.services.screenshot_vision_refine.extract_candidate_frames",
        lambda *args, **kwargs: [(15, str(frame))],
    )

    client = VisionRefineClient(api_key="k", base_url="https://example.com/v1", model_name="vision")

    def boom(*args, **kwargs):
        raise RuntimeError("api down")

    assert refine_screenshot_timestamp(
        "video.mp4",
        15,
        "主题",
        client,
        call_vision=boom,
    ) == 15


def test_refine_screenshot_timestamp_falls_back_on_invalid_reply(monkeypatch, tmp_path):
    frame = tmp_path / "frame.jpg"
    Image.new("RGB", (64, 36), (120, 120, 120)).save(frame)

    monkeypatch.setattr(
        "app.services.screenshot_vision_refine.extract_candidate_frames",
        lambda *args, **kwargs: [(15, str(frame))],
    )

    client = VisionRefineClient(api_key="k", base_url="https://example.com/v1", model_name="vision")

    refined = refine_screenshot_timestamp(
        "video.mp4",
        15,
        "主题",
        client,
        call_vision=lambda *_: "not-a-time",
    )
    assert refined == 15
