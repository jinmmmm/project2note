from sqlalchemy.orm import Session

from app.db.database import Note, Task, Transcript
from app.services.vector_store import vector_store


def reindex_task_note(db: Session, task_id: str) -> bool:
    """Rebuild ChromaDB index from latest note markdown and transcript."""
    task = db.query(Task).filter(Task.id == task_id).first()
    note = db.query(Note).filter(Note.task_id == task_id).first()
    if not task or not note:
        return False

    markdown = (note.markdown_edited or note.markdown_raw or "").strip()
    if not markdown:
        return False

    transcript = db.query(Transcript).filter(Transcript.task_id == task_id).first()
    segments = transcript.segments if transcript and transcript.segments else []

    vector_store.delete(task_id)
    vector_store.index_task(
        task_id,
        segments,
        markdown,
        {"title": task.title or "", "source_url": task.source_url or ""},
    )
    return True
