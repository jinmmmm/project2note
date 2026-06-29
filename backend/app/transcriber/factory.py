from typing import Optional

from sqlalchemy.orm import Session

from app.config import settings
from app.db.database import ProviderConfig
from app.services.transcriber_config_manager import transcriber_config_manager
from app.transcriber.base import BaseTranscriber
from app.transcriber.bcut import BcutTranscriber
from app.transcriber.groq_transcriber import GroqTranscriber
from app.transcriber.kuaishou import KuaishouTranscriber
from app.transcriber.whisper_local import LocalWhisperTranscriber

FALLBACK_CHAIN = {
    "kuaishou": ["bcut", "fast-whisper"],
    "bcut": ["kuaishou", "fast-whisper"],
    "fast-whisper": ["kuaishou", "bcut"],
}

# 默认引擎（不在 FALLBACK_CHAIN 中时使用）
DEFAULT_ENGINE = "kuaishou"


def _resolve_groq_api_key(db: Optional[Session] = None) -> str:
    if settings.groq_api_key:
        return settings.groq_api_key
    if db:
        for row in db.query(ProviderConfig).all():
            if row.id == "groq" or "groq.com" in (row.base_url or ""):
                return row.api_key or ""
    return ""


def _build_transcriber(
    engine: str,
    model_size: str,
    db: Optional[Session] = None,
    model_dir: str | None = None,
) -> BaseTranscriber:
    if engine == "groq":
        return GroqTranscriber(_resolve_groq_api_key(db))

    if engine == "bcut":
        return BcutTranscriber()

    if engine == "kuaishou":
        return KuaishouTranscriber()

    if engine == "fast-whisper":
        return LocalWhisperTranscriber(model_size=model_size, model_dir=model_dir)

    return BcutTranscriber()


def get_transcriber(db: Optional[Session] = None) -> BaseTranscriber:
    cfg = transcriber_config_manager.get_config()
    engine = cfg["transcriber_type"]
    # 只允许可用引擎，否则回退到默认
    if engine not in {"kuaishou", "bcut", "fast-whisper"}:
        engine = DEFAULT_ENGINE
    return _build_transcriber(
        engine,
        cfg["whisper_model_size"],
        db,
        cfg.get("whisper_model_dir"),
    )


def get_fallback_transcribers(db: Optional[Session] = None) -> list[BaseTranscriber]:
    cfg = transcriber_config_manager.get_config()
    engine = cfg["transcriber_type"]
    model_size = cfg["whisper_model_size"]
    model_dir = cfg.get("whisper_model_dir")
    fallback_engines = FALLBACK_CHAIN.get(engine, [])
    return [_build_transcriber(name, model_size, db, model_dir) for name in fallback_engines]
