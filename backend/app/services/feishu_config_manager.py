from dataclasses import dataclass

from app.config import settings
from app.db.database import SessionLocal, FeishuAppConfig


@dataclass
class FeishuAppSettings:
    app_id: str
    app_secret: str
    redirect_uri: str
    default_folder_token: str = ""
    default_folder_name: str = ""

    @property
    def configured(self) -> bool:
        return bool(self.app_id and self.app_secret)


def _row_to_settings(row: FeishuAppConfig | None) -> FeishuAppSettings | None:
    if not row or not row.app_id or not row.app_secret:
        return None
    return FeishuAppSettings(
        app_id=row.app_id,
        app_secret=row.app_secret,
        redirect_uri=row.redirect_uri or settings.feishu_redirect_uri,
        default_folder_token=row.default_folder_token or "",
        default_folder_name=row.default_folder_name or "",
    )


def get_feishu_app_settings() -> FeishuAppSettings:
    db = SessionLocal()
    try:
        row = db.query(FeishuAppConfig).filter(FeishuAppConfig.id == "default").first()
        cfg = _row_to_settings(row)
        if cfg:
            return cfg
    finally:
        db.close()
    return FeishuAppSettings(
        app_id=settings.feishu_app_id,
        app_secret=settings.feishu_app_secret,
        redirect_uri=settings.feishu_redirect_uri,
    )


def save_feishu_app_settings(app_id: str, app_secret: str, redirect_uri: str) -> FeishuAppSettings:
    db = SessionLocal()
    try:
        row = db.query(FeishuAppConfig).filter(FeishuAppConfig.id == "default").first()
        if not row:
            row = FeishuAppConfig(id="default")
            db.add(row)
        row.app_id = app_id.strip()
        row.app_secret = app_secret.strip()
        row.redirect_uri = (redirect_uri or settings.feishu_redirect_uri).strip()
        db.commit()
        db.refresh(row)
        return _row_to_settings(row) or FeishuAppSettings(
            app_id=row.app_id,
            app_secret=row.app_secret,
            redirect_uri=row.redirect_uri,
            default_folder_token=row.default_folder_token or "",
            default_folder_name=row.default_folder_name or "",
        )
    finally:
        db.close()


def save_feishu_sync_folder(folder_token: str, folder_name: str) -> FeishuAppSettings:
    db = SessionLocal()
    try:
        row = db.query(FeishuAppConfig).filter(FeishuAppConfig.id == "default").first()
        if not row:
            row = FeishuAppConfig(id="default")
            db.add(row)
        row.default_folder_token = folder_token.strip()
        row.default_folder_name = folder_name.strip() or "我的空间"
        db.commit()
        db.refresh(row)
        cfg = _row_to_settings(row)
        if cfg:
            return cfg
        return FeishuAppSettings(
            app_id=row.app_id or "",
            app_secret=row.app_secret or "",
            redirect_uri=row.redirect_uri or settings.feishu_redirect_uri,
            default_folder_token=row.default_folder_token or "",
            default_folder_name=row.default_folder_name or "",
        )
    finally:
        db.close()


def seed_feishu_app_from_env():
    if not settings.feishu_app_id or not settings.feishu_app_secret:
        return
    db = SessionLocal()
    try:
        row = db.query(FeishuAppConfig).filter(FeishuAppConfig.id == "default").first()
        if row and row.app_id:
            return
        row = row or FeishuAppConfig(id="default")
        if not row.app_id:
            row.app_id = settings.feishu_app_id
            row.app_secret = settings.feishu_app_secret
            row.redirect_uri = settings.feishu_redirect_uri
            db.add(row)
            db.commit()
    finally:
        db.close()
