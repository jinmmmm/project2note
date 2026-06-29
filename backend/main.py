import sys
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

# Add backend to path
sys.path.insert(0, str(Path(__file__).parent))

from app.config import settings
from app.db.database import init_db
from app.exceptions.handlers import register_exception_handlers
from app.routers import tasks, upload, settings as settings_router, chat, feishu, share, health, bilibili, auth
from app.services.pipeline import task_executor


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    await task_executor.start()
    yield


app = FastAPI(title="Project2Note API", lifespan=lifespan)
register_exception_handlers(app)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router, prefix="/api")
app.include_router(auth.router, prefix="/api")
app.include_router(tasks.router, prefix="/api")
app.include_router(upload.router, prefix="/api")
app.include_router(settings_router.router, prefix="/api")
app.include_router(chat.router, prefix="/api")
app.include_router(feishu.router, prefix="/api")
app.include_router(share.router, prefix="/api")
app.include_router(bilibili.router, prefix="/api")

# Serve uploaded videos and static files
uploads_path = settings.uploads_path
app.mount("/static/uploads", StaticFiles(directory=str(uploads_path)), name="uploads")

covers_path = settings.covers_path
app.mount("/static/covers", StaticFiles(directory=str(covers_path)), name="covers")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=settings.backend_port)
