from openai import OpenAI

from app.integrations.web_search import search_web
from app.services.vector_store import vector_store

GLOBAL_CHAT_TASK_ID = "__global__"
GLOBAL_CHAT_PREFIX = "global:"
MAX_NOTE_CHARS = 12000
MAX_TOTAL_CONTEXT_CHARS = 36000

TASK_QA_SYSTEM = """你是视频笔记问答助手，回答用户关于当前视频笔记的问题。
要求：
- 回答简洁直接，优先给出结论
- 使用纯文本，禁止使用 Markdown 格式（不要用 **加粗**、# 标题、列表符号等）
- 不要使用「结论：」「要点：」等带冒号的标签式小标题
- 优先使用笔记与下方检索内容；若用户询问下载链接、安装命令、工具地址，必须结合联网检索结果作答
- 联网检索有结果时，直接给出链接或命令，不要说「笔记中没有」就结束
- 笔记与检索均不足时再说明无法确认"""


async def chat_with_rag(
    task_id: str,
    question: str,
    history: list,
    api_key: str,
    base_url: str,
    model_name: str,
    note_fallbacks: list[dict] | None = None,
    enable_web_search: bool = False,
) -> dict:
    return await chat_with_tasks(
        task_ids=[task_id],
        question=question,
        history=history,
        api_key=api_key,
        base_url=base_url,
        model_name=model_name,
        note_fallbacks=note_fallbacks,
        enable_web_search=enable_web_search,
        task_qa_mode=True,
    )


def global_session_task_id(session_id: str) -> str:
    return f"{GLOBAL_CHAT_PREFIX}{session_id}"


def _chunks_from_notes(note_fallbacks: list[dict]) -> list[dict]:
    chunks: list[dict] = []
    total = 0
    for item in note_fallbacks:
        md = (item.get("markdown") or "").strip()
        if not md:
            continue
        title = item.get("title") or "未命名笔记"
        if len(md) > MAX_NOTE_CHARS:
            md = md[:MAX_NOTE_CHARS] + "\n\n...(笔记已截断)"
        text = f"《{title}》\n{md}"
        if total + len(text) > MAX_TOTAL_CONTEXT_CHARS:
            remain = MAX_TOTAL_CONTEXT_CHARS - total
            if remain <= 0:
                break
            text = text[:remain] + "\n\n...(总上下文已截断)"
        chunks.append({
            "text": text,
            "metadata": {"source_type": "note", "title": title},
        })
        total += len(text)
    return chunks


def _format_web_results(results: list[dict]) -> str:
    parts = []
    for i, item in enumerate(results, 1):
        title = item.get("title") or f"结果 {i}"
        snippet = item.get("snippet") or ""
        url = item.get("url") or ""
        block = f"{i}. {title}\n{snippet}"
        if url:
            block += f"\n来源: {url}"
        parts.append(block)
    return "\n\n".join(parts)


def _needs_web_search(question: str) -> bool:
    keywords = (
        "链接", "下载", "安装", "命令", "官网", "地址", "怎么下", "在哪下",
        "npm", "github", "switch", "Switch",
    )
    return any(k.lower() in question.lower() for k in keywords)


def _build_search_query(question: str) -> str:
    q = question.strip().strip("「」\"'")
    if _needs_web_search(q):
        return f"{q} GitHub 安装 下载"
    return q


async def chat_with_tasks(
    task_ids: list[str],
    question: str,
    history: list,
    api_key: str,
    base_url: str,
    model_name: str,
    use_style: str | None = None,
    note_fallbacks: list[dict] | None = None,
    enable_web_search: bool = False,
    task_qa_mode: bool = False,
) -> dict:
    chunks: list[dict] = []
    web_results: list[dict] = []

    if task_ids:
        per_task = 3 if task_qa_mode else 4
        for tid in task_ids:
            chunks.extend(vector_store.query(tid, question, n=per_task))

        if not chunks and note_fallbacks:
            chunks = _chunks_from_notes(note_fallbacks)

    do_web = enable_web_search or (task_qa_mode and _needs_web_search(question))
    if do_web:
        web_results = await search_web(_build_search_query(question), max_results=6)

    chunks.sort(key=lambda c: c.get("score", 0), reverse=True)
    chunks = chunks[:6 if task_qa_mode else 8]

    context = "\n\n".join(
        f"[{c['metadata'].get('source_type', 'unknown')}] {c['text']}" for c in chunks
    )
    web_context = _format_web_results(web_results)

    if task_qa_mode and task_ids:
        web_block = ""
        if do_web and web_context:
            web_block = f"\n\n--- 联网检索（优先用于链接/命令类问题） ---\n{web_context}\n---"
        elif do_web:
            web_block = "\n（联网检索未返回有效结果，可结合通用知识谨慎回答。）"
        system = f"""{TASK_QA_SYSTEM}

--- 笔记检索内容 ---
{context or '（暂无索引内容）'}
---{web_block}"""
    elif task_ids:
        web_block = ""
        if do_web and web_context:
            web_block = f"""

--- 联网检索（补充参考） ---
{web_context}
---"""
        system = f"""你是视频笔记问答助手。用户已选择笔记作为参考，请基于以下内容回答问题。
请优先使用笔记中的信息作答；若下方有联网检索结果，可作为补充。

--- 参考内容 ---
{context or '（暂无笔记内容，请提示用户检查笔记是否已生成完成）'}
---{web_block}"""
    elif do_web and web_context:
        system = f"""你是 Project2Note 的 AI 助手。用户处于自由提问模式，请结合以下联网检索结果与通用知识回答。
若引用了检索结果，请在回答中简要说明依据；检索不足时可补充常识，并说明哪些部分未在检索中验证。

--- 联网检索 ---
{web_context}
---"""
    elif do_web:
        system = (
            "你是 Project2Note 的 AI 助手。用户处于自由提问模式。"
            "本次联网检索未返回有效结果，请基于通用知识回答，并说明未能从网络获取到实时信息。"
        )
    else:
        system = "你是 Project2Note 的 AI 助手。请直接回答用户问题。"

    client = OpenAI(api_key=api_key, base_url=base_url)
    messages = [{"role": "system", "content": system}]
    history_limit = 6 if task_qa_mode else 10
    for h in history[-history_limit:]:
        messages.append({"role": h["role"], "content": h["content"]})
    messages.append({"role": "user", "content": question})

    create_kwargs: dict = {
        "model": model_name,
        "messages": messages,
        "temperature": 0.3 if task_qa_mode else 0.5,
    }
    if task_qa_mode:
        create_kwargs["max_tokens"] = 800
    resp = client.chat.completions.create(**create_kwargs)
    answer = resp.choices[0].message.content or ""

    sources = []
    for c in chunks:
        meta = c.get("metadata", {})
        source = {"source_type": meta.get("source_type"), "text": c["text"][:200]}
        if meta.get("start_time") is not None:
            source["start_time"] = meta["start_time"]
            source["end_time"] = meta.get("end_time")
        if meta.get("section_title"):
            source["section_title"] = meta["section_title"]
        if meta.get("title"):
            source["title"] = meta["title"]
        sources.append(source)

    for item in web_results:
        sources.append({
            "source_type": "web",
            "title": item.get("title"),
            "text": (item.get("snippet") or "")[:200],
            "url": item.get("url"),
        })

    return {"answer": answer, "sources": sources}
