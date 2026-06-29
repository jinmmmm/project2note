async def enrich_note_with_external_links(
    markdown: str,
    transcript_text: str,
    *,
    style: str = "beginner",
) -> str:
    """链接补全改由 LLM 写入「工具与链接补充」表格，此处不再追加 bullet 链接节。"""
    return markdown
