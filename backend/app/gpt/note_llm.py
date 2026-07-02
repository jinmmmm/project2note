import asyncio

from typing import Callable, Optional

from openai import OpenAI

from app.config import settings
from app.gpt.prompts import build_note_prompt, get_merge_prompt
from app.gpt.chunker import chunk_segments


class NoteLLM:
    def __init__(self, api_key: str, base_url: str, model_name: str):
        self.client = OpenAI(api_key=api_key, base_url=base_url)
        self.model_name = model_name

    @staticmethod
    def _strip_preamble(text: str) -> str:
        """Strip LLM conversational preamble before the first ## heading."""
        idx = text.find("\n## ")
        if idx > 0:
            return text[idx:].lstrip("\n")
        # Also handle preamble where ## is at position 0 with preceding text on same line
        idx2 = text.find("## ")
        if idx2 > 0 and not text[:idx2].strip().startswith("#"):
            return text[idx2:].lstrip()
        return text

    def _call(self, system: str, user: str, temperature: float = 0.3) -> str:
        resp = self.client.chat.completions.create(
            model=self.model_name,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            temperature=temperature,
        )
        content = resp.choices[0].message.content or ""
        if content.startswith("```"):
            lines = content.split("\n")
            content = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])
        content = content.strip()
        content = self._strip_preamble(content)
        return content

    async def _call_async(self, system: str, user: str, temperature: float = 0.3) -> str:
        return await asyncio.to_thread(self._call, system, user, temperature)

    def _build_system(self, style: str, language: str) -> str:
        system = "你是专业的视频笔记助手，输出结构化 Markdown 笔记（非线形流水账）。"
        if language != "zh":
            system += " 逐字稿为外语，笔记请翻译为中文输出。"
        system += (
            " 生成笔记前先理解逐字稿并修正听写/术语错误，笔记中使用准确专有名词。"
            " 但命令、路径、URL、斜杠开头的指令（如 /goal、/go、/help）必须逐字保留，不得擅自缩短或改写。"
        )
        if style == "beginner":
            system += """
 当前生成【小白学习版】笔记，面向零基础初学者：
1. 整体风格：教程感，讲解细致；写成「跟着走、学着懂」，先解释为什么，再给操作，再告诉怎么确认成功。
2. 一级结构固定 4 节且不可改：视频基础信息 → 结构化笔记 → 工具与链接补充（Markdown 表格）→ 延伸知识点（前置基础+后续进阶各 2 条）。用户额外要求仅可调整框架内细节。
3. 第 2 节开头必须有：适合人群 / 不适合人群 / 前置知识检查 / 学完能达成的目标。
4. 安装/操作/避坑/学习顺序/联网补充的可执行细节全部写入「## 2. 结构化笔记」内的 **4–6 个**归纳后的 ### 主题（**严格最多 6 个，超出不合格**），禁止逐步骤或分阶段各建 ###，内容多时在同一 ### 内扩展。
5. 概念类主题按「是什么 / 为什么重要 / 怎么用」讲；安装、配置、操作类主题按「操作目的 / 具体步骤 / 成功验证 / 常见卡点」写，常见卡点给新手可跟做的修复路径。
6. ### 标题须简洁专业（如「环境安装」「版本回退」），禁止照搬博主口语/比喻式标题（如「后悔药」「越用越懂你」）；比喻只放正文或 term-defs。
7. 每个 ### 下必须有正文；无内容则不建该节，合并到相邻主题，禁止空 ###。
8. 联网补充（强制执行）：凡提及「安装/下载 xxx」或口播提到未演示安装的工具（如 cc-switch），必须在同段补齐获取链接或安装命令、环境要求、启动方式、自检方式；禁止只写「安装 xxx」无命令/链接。写入第 2 节 ### 正文；第 3 节表格作快查索引，表头优先用「工具/资源 | 用途 | 环境要求 | 安装/获取方式 | 启动/自检方式」。
9. 第 4 节写成下一步学习路径：前置基础=先补什么基础，后续进阶=学完后往哪里深入。
10. 术语：正文 **术语** 标记 + 文末 <!-- term-defs --> **5–10 条**通俗释义（通俗易懂，可自然类比，禁止写「比喻：」，不必每条都比喻）；第 2 节术语首次出现须 **包裹**。
11. 禁止：术语表章节、纯链接 bullet 附录、超过 6 个 ###、独立避坑/学习路径 ## 大节。
12. 第 2 节每个 ### 标题行末尾须附 `<!-- ts:mm:ss -->`（来自逐字稿，勿把 `[mm:ss]` 写进标题文字）。"""
        else:
            system += """
 当前生成【专业精简版】笔记，面向有基础的从业者：
1. 整体风格：手册 / 速查表感，写成「查结论、拿命令」，默认读者知道背景，不做小白式铺垫。
2. 一级结构固定 4 节且不可改：视频基础信息 → 结构化笔记 → 补充最新版本 → 延伸知识点（前置基础+后续进阶各 2 条）。用户额外要求仅可调整框架内细节。
3. 第 2 节开头必须有 `核心结论`（100 字以内，纯干货结论）和 `核心要点速览`（3–5 条结论/边界/适用场景）。
4. 结构化笔记内 3–5 个 ### 主题，清单式列结论/命令/参数/配置及联网补充；禁止逐步骤拆 ###，禁止小白式「是什么 / 为什么 / 操作目的 / 成功验证」长解释。
5. ### 标题须简洁专业，禁止博主口语/比喻式标题（如「后悔药」「越用越懂你」）；每个 ### 必须有正文，无内容则合并。
6. 联网补充（强制执行）：即使是专业版，也必须补充基础下载/安装/入门配置/新手指令；写入第 2 节相关 ### 正文，不新增「工具链接补充」大节。基础信息要短，命令用代码块，参数/配置/版本差异用短表格。
7. 第 3 节「补充最新版本」必须按 `### 版本兼容与升级`、`### 进阶与优化`、`### 已知问题与 Workaround` 三个三级小节输出，不使用表格。每个小节 1–3 条短 bullet；每条必须是 `- **关键词**：结论/建议`，关键词 2–8 字；禁止裸 bullet 分类、空小节、长段 bullet 和多个要点拼同一行。
8. 术语用 **术语** 标记；<!-- term-defs --> 写 **4–7 条**精确定义（无需比喻）。
9. 禁止：== == 标记、术语表、避坑/学习路径 ## 大节、超过 5 个 ###、额外新增「工具链接补充」大节。
10. 第 2 节每个 ### 标题行末尾须附 `<!-- ts:mm:ss -->`（来自逐字稿，勿写进标题可见文字）。"""
        return system

    def generate_note(
        self,
        title: str,
        segments: list,
        style: str,
        extras: str = "",
        generated_at: str = "",
        language: str = "zh",
        platform: str = "bilibili",
        source_url: str | None = None,
        local_path: str | None = None,
        on_progress: Optional[Callable[[str], None]] = None,
        web_context: str = "",
        author: str | None = None,
        published_at: str | None = None,
    ) -> str:
        system = self._build_system(style, language)
        chunks = chunk_segments(segments)
        prompt_kwargs = {
            "style": style,
            "extras": extras,
            "generated_at": generated_at,
            "platform": platform,
            "source_url": source_url,
            "local_path": local_path,
            "web_context": web_context,
            "author": author,
            "published_at": published_at,
        }
        merge_prompt = get_merge_prompt(style)

        if len(chunks) == 1:
            if on_progress:
                on_progress("generating_note:1/1")
            user_prompt = build_note_prompt(title, chunks[0], **prompt_kwargs)
            return self._call(system, user_prompt)

        total_steps = len(chunks) + 1
        partials = []
        for i, chunk in enumerate(chunks):
            if on_progress:
                on_progress(f"generating_note:{i + 1}/{total_steps}")
            user_prompt = build_note_prompt(
                f"{title} (片段 {i+1}/{len(chunks)})",
                chunk,
                **prompt_kwargs,
            )
            partials.append(self._call(system, user_prompt))

        if on_progress:
            on_progress("generating_note:merge")
        merge_user = merge_prompt + "\n\n" + "\n\n---\n\n".join(partials)
        return self._call(system, merge_user)

    async def generate_note_async(
        self,
        title: str,
        segments: list,
        style: str,
        extras: str = "",
        generated_at: str = "",
        language: str = "zh",
        platform: str = "bilibili",
        source_url: str | None = None,
        local_path: str | None = None,
        on_progress: Optional[Callable[[str], None]] = None,
        web_context: str = "",
        author: str | None = None,
        published_at: str | None = None,
    ) -> str:
        system = self._build_system(style, language)
        chunks = chunk_segments(segments)
        prompt_kwargs = {
            "style": style,
            "extras": extras,
            "generated_at": generated_at,
            "platform": platform,
            "source_url": source_url,
            "local_path": local_path,
            "web_context": web_context,
            "author": author,
            "published_at": published_at,
        }
        merge_prompt = get_merge_prompt(style)

        if len(chunks) == 1:
            if on_progress:
                on_progress("generating_note:1/1")
            user_prompt = build_note_prompt(title, chunks[0], **prompt_kwargs)
            return await self._call_async(system, user_prompt)

        total_steps = len(chunks) + 1
        sem = asyncio.Semaphore(settings.chunk_llm_concurrency)
        partials = [None] * len(chunks)
        completed = 0

        async def process_chunk(idx: int, chunk: list):
            nonlocal completed
            async with sem:
                user_prompt = build_note_prompt(
                    f"{title} (片段 {idx+1}/{len(chunks)})",
                    chunk,
                    **prompt_kwargs,
                )
                partials[idx] = await self._call_async(system, user_prompt)
            completed += 1
            if on_progress:
                on_progress(f"generating_note:{completed}_of_{total_steps}_done")

        await asyncio.gather(*[process_chunk(i, c) for i, c in enumerate(chunks)])

        if on_progress:
            on_progress("generating_note:merge")
        merge_user = merge_prompt + "\n\n" + "\n\n---\n\n".join(partials)
        return await self._call_async(system, merge_user)

    def polish_markdown(self, content: str, instruction: str = "", style: str = "beginner") -> str:
        mark_rule = (
            "保留 **术语** 标记与 4 节结构（基础信息/结构化笔记/工具链接表格/延伸知识点），"
            "结构化笔记内 ### 4–6 个（最多 6 个），### 标题简洁专业、禁止比喻式标题，"
            "保留课前须知（适合人群/不适合人群/前置知识检查/学完目标）和学习路径式延伸，"
            "删除无正文空 ###，禁止术语表章节。"
            if style == "beginner"
            else (
                "术语用 **术语** 标记；保持 4 节结构，### 不超过 5 个，"
                "保留核心结论、核心要点速览、指令/参数内容和第 3 节 Workaround/版本兼容信息，"
                "### 标题简洁专业、禁止比喻式标题，删除无正文空 ###，禁止术语表章节。"
            )
        )
        system = (
            "你是笔记润色助手。根据用户要求润色 Markdown 笔记片段。"
            "保持原有标题层级与板块结构。"
            f"{mark_rule} "
            "术语释义仅保留在 <!-- term-defs --> 隐藏块。"
            "命令、路径、URL、斜杠开头的指令（如 /goal、/go、/help）必须逐字保留，不得擅自缩短、补全或改写。"
            "仅输出润色后的 Markdown，不要用代码块包裹，不要添加解释。"
        )
        user_instruction = instruction.strip() or "修正专有名词与表述，使行文更准确流畅。"
        user = (
            f"润色要求：{user_instruction}\n\n"
            f"---\n{content}\n---\n"
            "请输出润色后的完整片段（含标题行）。"
        )
        return self._call(system, user)

    def repair_install_gaps(
        self,
        markdown: str,
        gap_tools: list[str],
        web_context: str = "",
    ) -> str:
        tools = ", ".join(gap_tools[:12])
        system = (
            "你是笔记修补助手。用户笔记第 2 节「结构化笔记」中，部分安装/下载/官网提及缺少可执行细节。"
            "根据联网检索结果补全：安装命令必须写在 ```bash 代码块``` 中，禁止写「访问官方安装指南复制命令」却不给出命令。"
            "仅当必须手动下载安装包时才给 Releases/官网链接；有 npm/brew/pip 命令时直接写出。"
            "保持 4 节一级结构、**术语** 标记、term-defs 隐藏块不变；只修改第 2 节相关 bullet 及第 3 节表格对应行。"
            "禁止编造 URL；检索无结果时写明确搜索词。仅输出完整 Markdown 笔记。"
        )
        web_block = web_context.strip() or "（无检索结果，请基于公开信息谨慎补充或写搜索关键词）"
        user = (
            f"需补全的工具/资源：{tools}\n\n"
            f"--- 联网检索 ---\n{web_block}\n---\n\n"
            f"--- 当前笔记 ---\n{markdown}\n---\n"
            "请输出修补后的完整笔记。"
        )
        return self._call(system, user, temperature=0.2)
