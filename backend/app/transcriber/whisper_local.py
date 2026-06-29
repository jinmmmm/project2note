from pathlib import Path

from app.transcriber.base import BaseTranscriber


class LocalWhisperTranscriber(BaseTranscriber):
    """本地 faster-whisper，模型下载到本机，不依赖外网 API"""

    def __init__(self, model_size: str = "tiny", model_dir: str | None = None):
        self.model_size = model_size
        self.model_dir = model_dir.strip() if model_dir else ""

    def _resolve_model_source(self) -> str:
        if not self.model_dir:
            return self.model_size
        model_path = Path(self.model_dir).expanduser()
        if not model_path.exists():
            raise RuntimeError(f"本地 Whisper 模型目录不存在：{model_path}")
        return str(model_path)

    def transcribe(self, audio_path: str) -> dict:
        try:
            from faster_whisper import WhisperModel
        except ImportError as e:
            raise RuntimeError(
                "未安装 faster-whisper。请运行: pip install faster-whisper"
            ) from e

        model = WhisperModel(self._resolve_model_source(), device="cpu", compute_type="int8")
        segments_iter, info = model.transcribe(audio_path, beam_size=5)
        segments = []
        for s in segments_iter:
            segments.append({"start": s.start, "end": s.end, "text": s.text.strip()})
        full_text = " ".join(s["text"] for s in segments)
        return {
            "language": info.language or "zh",
            "full_text": full_text,
            "segments": segments,
        }
