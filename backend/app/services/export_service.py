import io
import logging
import os
import re
import tempfile

from markdown import markdown

from app.utils.markdown_toc import prepare_markdown_for_pdf_export

logger = logging.getLogger(__name__)


def export_markdown(content: str, filename: str = "note.md") -> tuple[bytes, str, str]:
    return content.encode("utf-8"), "text/markdown", filename


def _markdown_to_html(content: str) -> str:
    html_body = markdown(content, extensions=["extra", "tables", "fenced_code"])
    html_body = re.sub(r"==(.+?)==", r'<mark style="background:#fef08a">\1</mark>', html_body)
    return f"""<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
body {{ font-family: "PingFang SC", "Microsoft YaHei", sans-serif; line-height: 1.6; padding: 40px; max-width: 800px; margin: auto; color: #1a1a1a; }}
h1,h2,h3,h4 {{ color: #111; }}
mark {{ background: #fef08a; padding: 0 2px; }}
code {{ background: #f4f4f5; padding: 2px 4px; border-radius: 3px; }}
pre {{ background: #f4f4f5; padding: 12px; overflow-x: auto; }}
table {{ border-collapse: collapse; width: 100%; }}
th, td {{ border: 1px solid #e5e7eb; padding: 6px 8px; }}
a {{ color: #2563eb; word-break: break-all; }}
</style></head><body>{html_body}</body></html>"""


def _render_pdf_with_markdown_pdf(content: str) -> bytes:
    from markdown_pdf import MarkdownPdf, Section

    pdf = MarkdownPdf(toc_level=0)
    pdf.add_section(Section(content, toc=False))
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
        tmp_path = tmp.name
    try:
        pdf.save(tmp_path)
        with open(tmp_path, "rb") as f:
            return f.read()
    finally:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)


def _render_pdf_with_html_story(html: str) -> bytes:
    import fitz

    story = fitz.Story(html=html)
    buffer = io.BytesIO()
    writer = fitz.DocumentWriter(buffer)
    rect = fitz.paper_rect("a4")
    where = rect + (36, 36, -36, -36)
    more = 1
    while more:
        device = writer.begin_page(rect)
        more, _ = story.place(where)
        story.draw(device)
        writer.end_page()
    writer.close()
    return buffer.getvalue()


def export_pdf(content: str, filename: str = "note.pdf") -> tuple[bytes, str, str]:
    """Convert markdown to PDF with highlight support."""
    prepared = prepare_markdown_for_pdf_export(content)

    try:
        data = _render_pdf_with_markdown_pdf(prepared)
        if data.startswith(b"%PDF"):
            return data, "application/pdf", filename
    except Exception as exc:
        logger.warning("markdown-pdf export failed, trying HTML fallback: %s", exc)

    html = _markdown_to_html(prepared)
    try:
        data = _render_pdf_with_html_story(html)
        if data.startswith(b"%PDF"):
            return data, "application/pdf", filename
    except Exception as exc:
        logger.exception("HTML story PDF export failed: %s", exc)
        raise ValueError(f"PDF 导出失败：{exc}") from exc

    raise ValueError("PDF 导出失败：生成的文件无效")
