from datetime import datetime
from sqlalchemy import Column, String, Text, DateTime, JSON, Integer, create_engine, event
from sqlalchemy.orm import declarative_base, sessionmaker

from app.config import settings

Base = declarative_base()


class User(Base):
    __tablename__ = "users"

    id = Column(String, primary_key=True)
    email = Column(String, nullable=False, unique=True, index=True)
    username = Column(String, nullable=False)
    password_hash = Column(String, nullable=False)
    is_active = Column(String, default="true")
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class Task(Base):
    __tablename__ = "tasks"

    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=True, index=True)
    status = Column(String, default="PENDING")  # PENDING, PROCESSING, COMPLETED, FAILED
    progress = Column(String, default="queued")
    platform = Column(String, nullable=False)
    source_url = Column(String, nullable=True)
    local_video_path = Column(String, nullable=True)
    title = Column(String, nullable=True)
    style = Column(String, default="beginner")  # beginner | professional
    detail_mode = Column(String, default="detailed")  # detailed | minimal
    extras = Column(Text, nullable=True)
    # 截图模式: off=不截图, basic=纯算法评分选帧, enhanced=AI辅助选时间戳+算法评分
    screenshot_mode = Column(String, default="enhanced")
    # 旧字段保留用于兼容迁移，新代码优先读 screenshot_mode
    enable_screenshots = Column(String, default="true")
    screenshot_min_score = Column(String, nullable=True)
    enable_vision_screenshot_refine = Column(String, default="true")
    provider_id = Column(String, nullable=True)
    model_name = Column(String, nullable=True)
    error_message = Column(Text, nullable=True)
    video_path = Column(String, nullable=True)
    author = Column(String, nullable=True)
    published_at = Column(String, nullable=True)  # YYYY-MM-DD
    web_context = Column(Text, nullable=True)  # checkpoint: 联网补充上下文 JSON, 停止后重跑时复用
    parent_task_id = Column(String, nullable=True, index=True)  # 合集父任务ID，同一合集的子任务指向第一个P的Task
    page_index = Column(Integer, nullable=True)  # P编号（1,2,3...）
    collection_id = Column(String, nullable=True)  # 笔记分类合集ID
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class Note(Base):
    __tablename__ = "notes"

    task_id = Column(String, primary_key=True)
    user_id = Column(String, nullable=True, index=True)
    markdown_raw = Column(Text, nullable=True)
    markdown_edited = Column(Text, nullable=True)
    structured_content = Column(JSON, nullable=True)
    mindmap_data = Column(JSON, nullable=True)  # {mode, tree, edited, updated_at}
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class Transcript(Base):
    __tablename__ = "transcripts"

    task_id = Column(String, primary_key=True)
    user_id = Column(String, nullable=True, index=True)
    language = Column(String, default="zh")
    segments = Column(JSON, default=list)
    full_text = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=True, index=True)
    task_id = Column(String, nullable=False, index=True)
    role = Column(String, nullable=False)  # user | assistant
    content = Column(Text, nullable=False)
    sources = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class ProviderConfig(Base):
    __tablename__ = "provider_configs"

    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=True, index=True)
    name = Column(String, nullable=False)
    api_key = Column(String, nullable=False)
    base_url = Column(String, default="https://api.openai.com/v1")
    enabled = Column(String, default="true")
    created_at = Column(DateTime, default=datetime.utcnow)


class PlatformCookie(Base):
    __tablename__ = "platform_cookies"

    platform = Column(String, primary_key=True)
    user_id = Column(String, nullable=True, index=True)
    cookie = Column(Text, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class FeishuAppConfig(Base):
    __tablename__ = "feishu_app_configs"

    id = Column(String, primary_key=True, default="default")
    app_id = Column(String, nullable=True)
    app_secret = Column(String, nullable=True)
    redirect_uri = Column(String, nullable=True)
    default_folder_token = Column(String, nullable=True)
    default_folder_name = Column(String, nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class FeishuToken(Base):
    __tablename__ = "feishu_tokens"

    id = Column(String, primary_key=True, default="default")
    user_id = Column(String, nullable=True, index=True)
    access_token = Column(Text, nullable=True)
    refresh_token = Column(Text, nullable=True)
    expires_at = Column(DateTime, nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class FeishuSyncRecord(Base):
    __tablename__ = "feishu_sync_records"

    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=True, index=True)
    task_id = Column(String, nullable=False)
    doc_url = Column(String, nullable=True)
    bitable_record_id = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class ShareLink(Base):
    __tablename__ = "share_links"

    token = Column(String, primary_key=True)
    user_id = Column(String, nullable=True, index=True)
    task_id = Column(String, nullable=False, unique=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class Recommendation(Base):
    __tablename__ = "recommendations"

    task_id = Column(String, primary_key=True)
    user_id = Column(String, nullable=True, index=True)
    items = Column(JSON, default=list)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


def get_engine():
    db_path = settings.data_path / "project2note.db"
    url = f"sqlite:///{db_path}"
    engine = create_engine(url, connect_args={"check_same_thread": False})

    @event.listens_for(engine, "connect")
    def _set_pragma(dbapi_conn, _):
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA journal_mode=WAL")
        cur.execute("PRAGMA busy_timeout=5000")
        cur.execute("PRAGMA synchronous=NORMAL")
        cur.close()

    return engine


engine = get_engine()
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def seed_default_llm_provider():
    """从 .env 同步默认 LLM 供应商（SenseNova 等），启动时 upsert。"""
    if not settings.llm_api_key:
        return
    db = SessionLocal()
    try:
        row = db.query(ProviderConfig).filter(ProviderConfig.id == settings.llm_provider_id).first()
        if not row:
            row = ProviderConfig(id=settings.llm_provider_id, user_id="legacy")
            db.add(row)
        row.name = settings.llm_provider_name
        row.user_id = row.user_id or "legacy"
        row.api_key = settings.llm_api_key
        row.base_url = settings.llm_base_url.rstrip("/")
        row.enabled = "true"
        db.commit()
    finally:
        db.close()


def init_db():
    Base.metadata.create_all(bind=engine)
    _migrate_auth_columns()
    _migrate_feishu_app_config_columns()
    _migrate_task_columns()
    _migrate_note_columns()
    seed_default_llm_provider()
    from app.services.feishu_config_manager import seed_feishu_app_from_env

    seed_feishu_app_from_env()


def _migrate_auth_columns():
    from sqlalchemy import text

    legacy_user_id = "legacy"
    with engine.connect() as conn:
        conn.execute(text(
            "INSERT OR IGNORE INTO users (id, email, username, password_hash, is_active, created_at, updated_at) "
            "VALUES (:id, :email, :username, :password_hash, 'true', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
        ), {
            "id": legacy_user_id,
            "email": "legacy@project2note.local",
            "username": "历史数据",
            "password_hash": "legacy-disabled",
        })

        for table in (
            "tasks",
            "notes",
            "transcripts",
            "chat_messages",
            "provider_configs",
            "platform_cookies",
            "feishu_tokens",
            "feishu_sync_records",
            "share_links",
            "recommendations",
        ):
            rows = conn.execute(text(f"PRAGMA table_info({table})")).fetchall()
            cols = {row[1] for row in rows}
            if "user_id" not in cols:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN user_id VARCHAR"))
            conn.execute(text(f"UPDATE {table} SET user_id = :uid WHERE user_id IS NULL OR user_id = ''"), {"uid": legacy_user_id})
            conn.execute(text(f"CREATE INDEX IF NOT EXISTS ix_{table}_user_id ON {table}(user_id)"))

        conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS ix_users_email ON users(email)"))
        conn.commit()


def _migrate_task_columns():
    from sqlalchemy import text

    with engine.connect() as conn:
        rows = conn.execute(text("PRAGMA table_info(tasks)")).fetchall()
        cols = {row[1] for row in rows}
        if "author" not in cols:
            conn.execute(text("ALTER TABLE tasks ADD COLUMN author VARCHAR"))
        if "published_at" not in cols:
            conn.execute(text("ALTER TABLE tasks ADD COLUMN published_at VARCHAR"))
        if "enable_screenshots" not in cols:
            conn.execute(text("ALTER TABLE tasks ADD COLUMN enable_screenshots VARCHAR DEFAULT 'true'"))
        if "screenshot_min_score" not in cols:
            conn.execute(text("ALTER TABLE tasks ADD COLUMN screenshot_min_score VARCHAR"))
        if "enable_vision_screenshot_refine" not in cols:
            conn.execute(text("ALTER TABLE tasks ADD COLUMN enable_vision_screenshot_refine VARCHAR DEFAULT 'true'"))
        if "screenshot_mode" not in cols:
            conn.execute(text("ALTER TABLE tasks ADD COLUMN screenshot_mode VARCHAR DEFAULT 'enhanced'"))
            # 从旧字段推算 screenshot_mode：未开启截图→off, 开启截图+视觉增强→enhanced, 仅截图→basic
            conn.execute(text(
                "UPDATE tasks SET screenshot_mode = "
                "CASE WHEN enable_screenshots = 'false' THEN 'off' "
                "ELSE CASE WHEN enable_vision_screenshot_refine = 'true' THEN 'enhanced' ELSE 'basic' END END"
            ))
        if "web_context" not in cols:
            conn.execute(text("ALTER TABLE tasks ADD COLUMN web_context TEXT"))
        if "parent_task_id" not in cols:
            conn.execute(text("ALTER TABLE tasks ADD COLUMN parent_task_id VARCHAR"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_tasks_parent_task_id ON tasks(parent_task_id)"))
        if "page_index" not in cols:
            conn.execute(text("ALTER TABLE tasks ADD COLUMN page_index INTEGER"))
        if "collection_id" not in cols:
            conn.execute(text("ALTER TABLE tasks ADD COLUMN collection_id VARCHAR"))
        conn.commit()


def _migrate_feishu_app_config_columns():
    from sqlalchemy import text

    with engine.connect() as conn:
        rows = conn.execute(text("PRAGMA table_info(feishu_app_configs)")).fetchall()
        cols = {row[1] for row in rows}
        if "default_folder_token" not in cols:
            conn.execute(text("ALTER TABLE feishu_app_configs ADD COLUMN default_folder_token VARCHAR"))
        if "default_folder_name" not in cols:
            conn.execute(text("ALTER TABLE feishu_app_configs ADD COLUMN default_folder_name VARCHAR"))
        conn.commit()


def _migrate_note_columns():
    from sqlalchemy import text

    with engine.connect() as conn:
        rows = conn.execute(text("PRAGMA table_info(notes)")).fetchall()
        cols = {row[1] for row in rows}
        if "mindmap_data" not in cols:
            conn.execute(text("ALTER TABLE notes ADD COLUMN mindmap_data JSON"))
        conn.commit()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
