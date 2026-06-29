import json
import os
from pathlib import Path
from typing import Any

from app.config import settings

AVAILABLE_TYPES = [
    {"value": "kuaishou", "label": "快手（在线，国内）"},
    {"value": "bcut", "label": "必剪（在线，国内）"},
    {"value": "fast-whisper", "label": "Whisper 本地（fast-whisper）"},
]

WHISPER_SIZES = ["tiny", "base", "small", "medium", "large-v3"]


class TranscriberConfigManager:
    def __init__(self):
        self.path = settings.data_path / "config" / "transcriber.json"
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def _read(self) -> dict:
        if not self.path.exists():
            return {}
        try:
            return json.loads(self.path.read_text(encoding="utf-8"))
        except Exception:
            return {}

    def _write(self, data: dict):
        self.path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

    def _resolve_whisper_model_dir(self, data: dict) -> str:
        raw = data.get("whisper_model_dir", os.getenv("WHISPER_MODEL_DIR", settings.whisper_model_dir)).strip()
        if not raw:
            return ""
        p = Path(raw).expanduser()
        if not p.is_absolute():
            p = settings.base_dir / p
        return str(p)

    def get_config(self) -> dict[str, Any]:
        data = self._read()
        return {
            "transcriber_type": data.get(
                "transcriber_type",
                os.getenv("TRANSCRIBER_TYPE", os.getenv("ASR_ENGINE", "bcut")),
            ),
            "whisper_model_size": data.get(
                "whisper_model_size",
                os.getenv("WHISPER_MODEL_SIZE", settings.whisper_model_size),
            ),
            "whisper_model_dir": self._resolve_whisper_model_dir(data),
            "available_types": AVAILABLE_TYPES,
            "whisper_model_sizes": WHISPER_SIZES,
        }

    def update_config(
        self,
        transcriber_type: str,
        whisper_model_size: str | None = None,
        whisper_model_dir: str | None = None,
    ) -> dict:
        data = self._read()
        data["transcriber_type"] = transcriber_type
        if whisper_model_size is not None:
            data["whisper_model_size"] = whisper_model_size
        if whisper_model_dir is not None:
            data["whisper_model_dir"] = whisper_model_dir.strip()
        self._write(data)
        return self.get_config()


transcriber_config_manager = TranscriberConfigManager()
