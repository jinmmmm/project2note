import asyncio
import os
import uuid
from datetime import datetime
from functools import partial
from typing import Optional, Any

from sqlalchemy.orm import Session

from app.config import settings
from app.db.database import SessionLocal, Task, Note, Transcript, Recommendation, ProviderConfig, PlatformCookie
from app.downloaders.platforms import BilibiliDownloader, DouyinDownloader, LocalDownloader
from app.downloaders.bilibili_subtitle import fetch_bilibili_subtitles
from app.exceptions.biz_exception import BizException
from app.exceptions.task_canceled import TaskCanceledError
from app.transcriber.factory import get_transcriber, get_fallback_transcribers
from app.services.transcript_cleaner import clean_transcript
from app.utils.ffmpeg_helper import extract_audio, extract_audio_async
from app.utils.time_utils import now_local_str
from app.utils.crypto import decrypt_secret
from app.gpt.note_llm import NoteLLM
from app.gpt.prompts import postprocess_note_markdown, embed_screenshots_into_note
from app.services.screenshot_vision_refine import VisionRefineClient
from app.services.vector_store import vector_store
from app.services.recommendation_service import DEFAULT_REC_VIDEO_LIMIT, search_videos_for_keywords
from app.services.web_supplement import fetch_web_supplement_context
from app.services.install_gap_auditor import repair_beginner_install_gaps, repair_install_gaps
from app.integrations.bilibili_search import extract_keywords_from_note


# 转写 API 并发限制：即使 task_executor 有 2 个 worker，
# 也只允许 1 个任务同时调用在线转写 API（快手/必剪），避免被限流
_transcribe_semaphore = asyncio.Semaphore(1)

DOWNLOADERS = {
    "bilibili": BilibiliDownloader(),
    "douyin": DouyinDownloader(),
    "local": LocalDownloader(),
}


def _get_provider(db: Session, provider_id: str, user_llm_config: Optional[dict] = None, user_id: str | None = None) -> Optional[Any]:
    if user_llm_config and user_llm_config.get("note_api_key"):
        return type("RuntimeProvider", (), {
            "api_key": user_llm_config.get("note_api_key"),
            "base_url": user_llm_config.get("note_base_url"),
        })()
    if user_id:
        provider = db.query(ProviderConfig).filter(ProviderConfig.id == provider_id, ProviderConfig.user_id == user_id).first()
        if provider:
            return provider
    return db.query(ProviderConfig).filter(ProviderConfig.id == provider_id, ProviderConfig.user_id == "legacy").first()


def _runtime_model_name(task: Task, user_llm_config: Optional[dict] = None) -> str:
    if user_llm_config and user_llm_config.get("note_model_name"):
        return user_llm_config["note_model_name"]
    return task.model_name


def _screenshot_mode(task: Task) -> str:
    """解析截图模式：优先读 screenshot_mode，否则从旧字段推算。
    返回值: off / basic / enhanced
    """
    mode = getattr(task, 'screenshot_mode', None)
    if mode and mode in ('off', 'basic', 'enhanced'):
        return mode
    # 兼容旧字段
    if task.enable_screenshots == "false":
        return 'off'
    return 'enhanced' if task.enable_vision_screenshot_refine != "false" else 'basic'


def _vision_refine_enabled(task: Task) -> bool:
    """视觉增强是否开启：screenshot_mode=enhanced 且全局配置允许。"""
    return (
        _screenshot_mode(task) == 'enhanced'
        and settings.enable_vision_screenshot_refine
    )


def _build_vision_client(db: Session, task: Task, user_llm_config: Optional[dict] = None) -> VisionRefineClient | None:
    if not _vision_refine_enabled(task):
        return None
    if user_llm_config and user_llm_config.get("vision_api_key"):
        return VisionRefineClient(
            api_key=user_llm_config.get("vision_api_key"),
            base_url=user_llm_config.get("vision_base_url"),
            model_name=user_llm_config.get("vision_model_name") or settings.vision_model_name,
        )
    provider = _get_provider(db, task.provider_id, user_id=task.user_id) if task.provider_id else None
    if not provider or not provider.api_key:
        return None
    return VisionRefineClient(
        api_key=decrypt_secret(provider.api_key),
        base_url=provider.base_url,
        model_name=settings.vision_model_name,
    )


def _get_cookie(db: Session, platform: str) -> Optional[str]:
    row = db.query(PlatformCookie).filter(PlatformCookie.platform == platform, PlatformCookie.user_id == "legacy").first()
    return row.cookie if row else None


def _update_task(db: Session, task_id: str, **kwargs):
    task = db.query(Task).filter(Task.id == task_id).first()
    if task:
        for k, v in kwargs.items():
            setattr(task, k, v)
        task.updated_at = datetime.utcnow()
        db.commit()


def _check_canceled(db: Session, task_id: str):
    """阶段间检查任务是否被用户取消。命中则抛 TaskCanceledError, 让 _worker 保持 CANCELED 状态。"""
    task = db.query(Task).filter(Task.id == task_id).first()
    if task and task.status == "CANCELED":
        raise TaskCanceledError()


def _clear_task_screenshots(task_id: str) -> None:
    uploads = settings.uploads_path
    if not uploads.exists():
        return
    prefix = f"ss_{task_id}_"
    for path in uploads.iterdir():
        if path.name.startswith(prefix) and path.suffix.lower() == ".jpg":
            try:
                path.unlink()
            except OSError:
                pass


def _make_note_progress_callback(task_id: str):
    def on_progress(progress: str):
        db = SessionLocal()
        try:
            _check_canceled(db, task_id)
            _update_task(db, task_id, progress=progress)
        finally:
            db.close()

    return on_progress


async def _generate_recommendations(db: Session, markdown: str) -> list:
    keywords = extract_keywords_from_note(markdown)
    bili_cookie = _get_cookie(db, "bilibili")
    return await search_videos_for_keywords(keywords, bili_cookie, limit=DEFAULT_REC_VIDEO_LIMIT)


async def _load_or_fetch_web_context(db: Session, task: Task, full_text: str, note_title: str, llm: NoteLLM) -> str:
    """断点续跑: 已有 web_context 直接复用; 否则联网拉取并持久化为 checkpoint。"""
    if task.web_context:
        return task.web_context
    _check_canceled(db, task.id)
    web_context = await fetch_web_supplement_context(
        full_text,
        note_title,
        style=task.style,
        llm=llm,
    )
    _update_task(db, task.id, web_context=web_context)
    return web_context


async def run_regenerate_pipeline(task_id: str, user_llm_config: Optional[dict] = None):
    """Reuse transcript/video; regenerate note + recommendations only."""
    db = SessionLocal()
    try:
        task = db.query(Task).filter(Task.id == task_id).first()
        if not task:
            return

        transcript = db.query(Transcript).filter(Transcript.task_id == task_id).first()
        if not transcript or not transcript.segments:
            _update_task(db, task_id, status="FAILED", error_message="无逐字稿，无法重新生成笔记")
            return

        provider = _get_provider(db, task.provider_id, user_llm_config, task.user_id) if task.provider_id or user_llm_config else None
        if not provider:
            _update_task(db, task_id, status="FAILED", error_message="未配置 LLM 供应商，请先在设置中添加")
            return

        _update_task(db, task_id, status="PROCESSING", progress="generating_note", error_message=None)
        _clear_task_screenshots(task_id)
        _check_canceled(db, task_id)

        cleaned_segments = transcript.segments
        generated_at = now_local_str()
        note_title = task.title or "未命名视频"
        full_text = transcript.full_text or " ".join(
            s.get("text", "") for s in cleaned_segments
        )

        try:
            llm = NoteLLM(decrypt_secret(provider.api_key), provider.base_url, _runtime_model_name(task, user_llm_config))
            on_progress = _make_note_progress_callback(task_id)
            _update_task(db, task_id, progress="web_search")
            web_context = await _load_or_fetch_web_context(db, task, full_text, note_title, llm)
            _check_canceled(db, task_id)
            markdown = await llm.generate_note_async(
                note_title,
                cleaned_segments,
                task.style,
                task.extras or "",
                generated_at,
                transcript.language,
                task.platform,
                task.source_url,
                task.local_video_path,
                on_progress,
                web_context,
                task.author,
                task.published_at,
            )
            _check_canceled(db, task_id)
            markdown = postprocess_note_markdown(
                markdown,
                note_title,
                task.platform,
                task.source_url,
                task.local_video_path,
                generated_at,
                style=task.style or "beginner",
                author=task.author,
                published_at=task.published_at,
            )
            if task.style in {"beginner", "professional"}:
                repair_style = task.style or "beginner"
                markdown = await repair_install_gaps(
                    markdown,
                    llm,
                    style=repair_style,
                    on_progress=on_progress,
                )
                _check_canceled(db, task_id)
                markdown = postprocess_note_markdown(
                    markdown,
                    note_title,
                    task.platform,
                    task.source_url,
                    task.local_video_path,
                    generated_at,
                    style=task.style or "beginner",
                    author=task.author,
                    published_at=task.published_at,
                )
                markdown = embed_screenshots_into_note(
                    markdown,
                    task.video_path,
                    task_id,
                    str(settings.uploads_path),
                    enabled=_screenshot_mode(task) != 'off',
                    min_score=float(task.screenshot_min_score) if task.screenshot_min_score else None,
                    vision_refine_enabled=_vision_refine_enabled(task),
                    vision_client=_build_vision_client(db, task, user_llm_config),
                )
        except TaskCanceledError:
            raise
        except Exception as e:
            _update_task(db, task_id, status="FAILED", error_message=f"笔记生成失败：{e}")
            return

        _check_canceled(db, task_id)
        note = db.query(Note).filter(Note.task_id == task_id).first()
        if not note:
            note = Note(task_id=task_id, user_id=task.user_id)
            db.add(note)
        note.markdown_raw = markdown
        note.markdown_edited = markdown
        db.commit()

        _update_task(db, task_id, progress="recommendations")
        _check_canceled(db, task_id)
        rec_items = await _generate_recommendations(db, markdown)

        rec = db.query(Recommendation).filter(Recommendation.task_id == task_id).first()
        if not rec:
            rec = Recommendation(task_id=task_id, user_id=task.user_id)
            db.add(rec)
        rec.items = rec_items
        db.commit()

        _update_task(db, task_id, progress="indexing")
        vector_store.delete(task_id)
        vector_store.index_task(
            task_id,
            cleaned_segments,
            markdown,
            {"title": task.title, "source_url": task.source_url},
        )

        _update_task(db, task_id, status="COMPLETED", progress="done")
    finally:
        db.close()


async def run_pipeline(task_id: str, user_llm_config: Optional[dict] = None):
    db = SessionLocal()
    try:
        task = db.query(Task).filter(Task.id == task_id).first()
        if not task:
            return
        _check_canceled(db, task_id)

        start_progress = "fetching_subtitle" if task.platform == "bilibili" else "downloading"
        _update_task(db, task_id, status="PROCESSING", progress=start_progress)

        cookie_platform = task.platform if task.platform != "local" else "bilibili"
        cookie_key = f"{task.user_id}:{cookie_platform}"
        cookie_row = db.query(PlatformCookie).filter(PlatformCookie.platform == cookie_key, PlatformCookie.user_id == task.user_id).first()
        cookie = cookie_row.cookie if cookie_row else None
        url = task.local_video_path if task.platform == "local" else task.source_url

        # B 站字幕优先：有官方字幕则跳过下载与 ASR
        raw_transcript = None
        subtitle_title = None
        if task.platform == "bilibili" and task.source_url:
            raw_transcript = await asyncio.to_thread(
                fetch_bilibili_subtitles, task.source_url, cookie or ""
            )
            _check_canceled(db, task_id)
            if raw_transcript:
                subtitle_title = raw_transcript.get("title")
                _update_task(db, task_id, progress="subtitle_ok")

        result = None
        audio_path = None
        skip_download = False

        if skip_download:
            _update_task(db, task_id, progress="download_skipped")
            if not (task.title or "").strip() and subtitle_title:
                _update_task(db, task_id, title=subtitle_title)
                task.title = subtitle_title
            # save author/published_at from subtitle API
            _update_task(
                db, task_id,
                author=raw_transcript.get("author"),
                published_at=raw_transcript.get("published_at"),
            )
            note_title = (task.title or "").strip() or subtitle_title or "未命名视频"
        else:
            downloader = DOWNLOADERS.get(task.platform)
            if not downloader:
                _update_task(db, task_id, status="FAILED", error_message="不支持的平台")
                return

            _update_task(db, task_id, progress="downloading")
            try:
                if task.platform == "bilibili":
                    result = await asyncio.to_thread(
                        downloader.download,
                        url,
                        str(settings.uploads_path),
                        cookie,
                        audio_only=False,
                    )
                else:
                    result = await asyncio.to_thread(
                        downloader.download, url, str(settings.uploads_path), cookie
                    )
            except BizException as e:
                _update_task(db, task_id, status="FAILED", error_message=e.message)
                return
            except TaskCanceledError:
                raise
            except Exception as e:
                _update_task(db, task_id, status="FAILED", error_message=str(e))
                return
            _check_canceled(db, task_id)

            download_updates = {
                "video_path": result.video_path,
                "author": result.author,
                "published_at": result.published_at,
            }
            if not (task.title or "").strip():
                download_updates["title"] = result.title
            _update_task(db, task_id, **download_updates)
            note_title = (task.title or "").strip() or result.title

        if raw_transcript is None:
            if not result:
                _update_task(db, task_id, status="FAILED", error_message="无逐字稿且下载失败")
                return
            _update_task(db, task_id, progress="extracting_audio")
            try:
                audio_path = await extract_audio_async(
                    result.video_path, str(settings.uploads_path)
                )
            except TaskCanceledError:
                raise
            except Exception as e:
                _update_task(db, task_id, status="FAILED", error_message=str(getattr(e, "message", str(e))))
                return
            _check_canceled(db, task_id)

            _update_task(db, task_id, progress="transcribing")
            async with _transcribe_semaphore:
                try:
                    transcriber = get_transcriber(db)
                    raw_transcript = await asyncio.to_thread(transcriber.transcribe, audio_path)
                except TaskCanceledError:
                    raise
                except Exception as primary_err:
                    fallback_errors = [str(primary_err)]
                    fallback_transcribers = get_fallback_transcribers(db)
                    raw_transcript = None
                    for idx, fallback in enumerate(fallback_transcribers, start=1):
                        _check_canceled(db, task_id)
                        _update_task(db, task_id, progress=f"transcribing_fallback_{idx}")
                        try:
                            raw_transcript = await asyncio.to_thread(fallback.transcribe, audio_path)
                            break
                        except TaskCanceledError:
                            raise
                        except Exception as fallback_err:
                            fallback_errors.append(str(fallback_err))
                    if raw_transcript is None:
                        _update_task(
                            db,
                            task_id,
                            status="FAILED",
                            error_message="转写失败（多链路回退均失败）：" + " / ".join(fallback_errors),
                        )
                        return
            _check_canceled(db, task_id)
        else:
            _update_task(db, task_id, progress="transcribing_skipped")

        cleaned_segments = clean_transcript(raw_transcript["segments"])
        full_text = " ".join(s["text"] for s in cleaned_segments)

        transcript = db.query(Transcript).filter(Transcript.task_id == task_id).first()
        if not transcript:
            transcript = Transcript(task_id=task_id, user_id=task.user_id)
            db.add(transcript)
        transcript.language = raw_transcript.get("language", "zh")
        transcript.segments = cleaned_segments
        transcript.full_text = full_text
        db.commit()

        _update_task(db, task_id, progress="generating_note")
        _check_canceled(db, task_id)

        provider = _get_provider(db, task.provider_id, user_llm_config, task.user_id) if task.provider_id or user_llm_config else None
        if not provider:
            _update_task(db, task_id, status="FAILED", error_message="未配置 LLM 供应商，请先在设置中添加")
            return

        try:
            llm = NoteLLM(decrypt_secret(provider.api_key), provider.base_url, _runtime_model_name(task, user_llm_config))
            generated_at = now_local_str()
            on_progress = _make_note_progress_callback(task_id)
            _update_task(db, task_id, progress="web_search")
            web_context = await _load_or_fetch_web_context(db, task, full_text, note_title, llm)
            _check_canceled(db, task_id)
            markdown = await llm.generate_note_async(
                note_title,
                cleaned_segments,
                task.style,
                task.extras or "",
                generated_at,
                transcript.language,
                task.platform,
                task.source_url,
                task.local_video_path,
                on_progress,
                web_context,
                task.author,
                task.published_at,
            )
            _check_canceled(db, task_id)
            markdown = postprocess_note_markdown(
                markdown,
                note_title,
                task.platform,
                task.source_url,
                task.local_video_path,
                generated_at,
                style=task.style or "beginner",
                author=task.author,
                published_at=task.published_at,
            )
            if task.style in {"beginner", "professional"}:
                repair_style = task.style or "beginner"
                markdown = await repair_install_gaps(
                    markdown,
                    llm,
                    style=repair_style,
                    on_progress=on_progress,
                )
                _check_canceled(db, task_id)
                markdown = postprocess_note_markdown(
                    markdown,
                    note_title,
                    task.platform,
                    task.source_url,
                    task.local_video_path,
                    generated_at,
                    style=task.style or "beginner",
                    author=task.author,
                    published_at=task.published_at,
                )
                markdown = embed_screenshots_into_note(
                    markdown,
                    task.video_path,
                    task_id,
                    str(settings.uploads_path),
                    enabled=_screenshot_mode(task) != 'off',
                    min_score=float(task.screenshot_min_score) if task.screenshot_min_score else None,
                    vision_refine_enabled=_vision_refine_enabled(task),
                    vision_client=_build_vision_client(db, task, user_llm_config),
                )
        except TaskCanceledError:
            raise
        except Exception as e:
            _update_task(db, task_id, status="FAILED", error_message=f"笔记生成失败：{e}")
            return

        _check_canceled(db, task_id)
        note = db.query(Note).filter(Note.task_id == task_id).first()
        if not note:
            note = Note(task_id=task_id, user_id=task.user_id)
            db.add(note)
        note.markdown_raw = markdown
        note.markdown_edited = markdown
        db.commit()

        _update_task(db, task_id, progress="recommendations")
        _check_canceled(db, task_id)

        rec_items = await _generate_recommendations(db, markdown)

        rec = db.query(Recommendation).filter(Recommendation.task_id == task_id).first()
        if not rec:
            rec = Recommendation(task_id=task_id, user_id=task.user_id)
            db.add(rec)
        rec.items = rec_items
        db.commit()

        _update_task(db, task_id, progress="indexing")
        _check_canceled(db, task_id)

        vector_store.index_task(
            task_id,
            cleaned_segments,
            markdown,
            {"title": note_title, "source_url": task.source_url},
        )

        _update_task(db, task_id, status="COMPLETED", progress="done")

        # Cleanup temp audio
        if (
            audio_path
            and os.path.exists(audio_path)
            and result
            and audio_path != result.video_path
        ):
            try:
                os.remove(audio_path)
            except OSError:
                pass

    finally:
        db.close()


class TaskExecutor:
    def __init__(self):
        self._queue: asyncio.Queue = asyncio.Queue()
        self._running = False
        self._current: dict[str, asyncio.Task] = {}

    async def start(self):
        if self._running:
            return
        self._running = True
        for _ in range(settings.task_executor_concurrency):
            asyncio.create_task(self._worker())
        # 启动恢复：把上次崩溃/重启残留的 PENDING/PROCESSING 任务重新入队
        asyncio.create_task(self._recover_stuck_tasks())

    async def _recover_stuck_tasks(self):
        try:
            db = SessionLocal()
            try:
                stuck = (
                    db.query(Task)
                    .filter(Task.status.in_(["PENDING", "PROCESSING"]))
                    .all()
                )
                for t in stuck:
                    self.enqueue(t.id)
            finally:
                db.close()
        except Exception:
            # 恢复失败不应阻塞启动；任务会停留在原状态，可手动重试
            pass

    async def _worker(self):
        while True:
            item = await self._queue.get()
            if isinstance(item, tuple):
                if len(item) == 3:
                    task_id, mode, user_llm_config = item
                else:
                    task_id, mode = item
                    user_llm_config = None
            else:
                task_id, mode, user_llm_config = item, "full", None
            coro = (
                run_regenerate_pipeline(task_id, user_llm_config)
                if mode == "regenerate"
                else run_pipeline(task_id, user_llm_config)
            )
            fut = asyncio.ensure_future(coro)
            self._current[task_id] = fut
            try:
                await fut
            except (TaskCanceledError, asyncio.CancelledError):
                # 用户取消: 状态已由 cancel 端点置为 CANCELED, 这里不覆盖
                pass
            except Exception as e:
                db = SessionLocal()
                try:
                    _update_task(db, task_id, status="FAILED", error_message=str(e))
                finally:
                    db.close()
            finally:
                self._current.pop(task_id, None)
            self._queue.task_done()

    def enqueue(self, task_id: str, mode: str = "full", user_llm_config: Optional[dict] = None):
        self._queue.put_nowait((task_id, mode, user_llm_config))

    def cancel(self, task_id: str) -> bool:
        """取消正在运行的任务。返回是否找到正在运行的任务。"""
        fut = self._current.get(task_id)
        if fut and not fut.done():
            fut.cancel()
            return True
        return False


task_executor = TaskExecutor()
