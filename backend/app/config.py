from pathlib import Path
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    backend_port: int = 8483
    data_dir: str = "./data"
    database_url: str = "sqlite:///./data/project2note.db"
    chroma_dir: str = "./data/chroma"
    ffmpeg_bin: str = "ffmpeg"
    enable_smart_screenshots: bool = True
    smart_screenshot_window_seconds: int = 5
    smart_screenshot_min_score: float = 0.3
    enable_vision_screenshot_refine: bool = True
    vision_model_name: str = "sensenova-6.7-flash-lite"
    vision_refine_half_window_seconds: int = 12
    vision_refine_sample_step_seconds: int = 3
    vision_refine_grid_cols: int = 3
    vision_refine_grid_rows: int = 3
    asr_engine: str = "bcut"
    whisper_model_size: str = "tiny"
    whisper_model_dir: str = ""
    groq_api_key: str = ""
    llm_provider_id: str = "sensenova"
    llm_provider_name: str = "sensenova"
    llm_api_key: str = ""
    llm_base_url: str = "https://token.sensenova.cn/v1"
    llm_model_name: str = "sensenova-6.7-flash-lite"
    feishu_app_id: str = ""
    feishu_app_secret: str = ""
    feishu_redirect_uri: str = "http://localhost:8483/api/feishu/callback"
    share_base_url: str = "http://localhost:3015"
    cors_origins: str = "http://localhost:3015,http://127.0.0.1:3015"
    task_executor_concurrency: int = 2
    chunk_llm_concurrency: int = 1
    ffmpeg_concurrency: int = 2
    auth_secret_key: str = "change-me-in-production"
    auth_cookie_name: str = "project2note_session"
    auth_token_expire_minutes: int = 10080
    auth_cookie_secure: bool = False
    auth_cookie_samesite: str = "lax"

    class Config:
        env_file = str(Path(__file__).resolve().parent.parent.parent / ".env")
        extra = "ignore"

    @property
    def base_dir(self) -> Path:
        return Path(__file__).resolve().parent.parent.parent

    @property
    def data_path(self) -> Path:
        p = Path(self.data_dir)
        if not p.is_absolute():
            p = self.base_dir / p
        p.mkdir(parents=True, exist_ok=True)
        return p

    @property
    def covers_path(self) -> Path:
        p = self.data_path / "covers"
        p.mkdir(parents=True, exist_ok=True)
        return p

    @property
    def uploads_path(self) -> Path:
        p = self.data_path / "uploads"
        p.mkdir(parents=True, exist_ok=True)
        return p

    @property
    def notes_path(self) -> Path:
        p = self.data_path / "notes"
        p.mkdir(parents=True, exist_ok=True)
        return p

    @property
    def chroma_path(self) -> Path:
        p = Path(self.chroma_dir)
        if not p.is_absolute():
            p = self.base_dir / p
        p.mkdir(parents=True, exist_ok=True)
        return p

    @property
    def whisper_model_path(self) -> Path | None:
        if not self.whisper_model_dir.strip():
            return None
        p = Path(self.whisper_model_dir).expanduser()
        if not p.is_absolute():
            p = self.base_dir / p
        return p

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def vision_refine_grid_size(self) -> tuple[int, int]:
        return (self.vision_refine_grid_cols, self.vision_refine_grid_rows)


settings = Settings()
