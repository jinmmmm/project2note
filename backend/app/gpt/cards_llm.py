"""Knowledge card generation via LLM.

Two style-specific prompts produce a JSON array of card objects
from a note's markdown content.
"""

import json
import re
import logging
from typing import Optional

from app.gpt.note_llm import NoteLLM

logger = logging.getLogger(__name__)

BEGINNER_SYSTEM_PROMPT = """\
你是一位面向零基础初学者的知识卡片设计师。

给定一篇结构化 Markdown 笔记，从中提炼 3–5 张知识卡片，帮助初学者快速回忆与巩固核心知识点。

卡片提取规则：
1. 优先从第 2 节（结构化笔记）的 ### 小节标题和核心概念中提取
2. 也可从文末术语定义（<!-- term-defs -->）中选取关键术语
3. 每张卡片聚焦一个核心知识点，不重叠
4. 按笔记章节顺序排列

每张卡片的字段：
- title: 知识点标题（简洁，3–8 字）
- conclusion: 一句话结论（15–30 字，初学者看完即可回忆起要点）
- explanation: 通俗解释（50–100 字，必须含一个日常类比或例子帮助理解）
- pitfalls: 易错避坑提醒（1–2 条，每条 10–25 字，指出初学者最常犯的错）
- source_heading: 该知识点来源的 ### 标题（如有）

输出格式：纯 JSON 数组，不要用代码块包裹，不要附加解释。
示例：
[
  {"title": "环境变量", "conclusion": "环境变量是系统级配置，所有进程都能读取", "explanation": "就像小区公告栏，所有住户（进程）都能看到上面的通知（变量值）", "pitfalls": ["修改变量后需重启终端才能生效", "PATH 顺序影响命令查找"], "source_heading": "环境配置"},
  {"title": "Docker 镜像", "conclusion": "镜像是只读的运行模板，容器是镜像的运行实例", "explanation": "就像类和对象的关系：镜像是蓝图，容器是按蓝图盖出来的房子", "pitfalls": ["删除容器不会删除镜像"], "source_heading": "容器基础"}
]
"""

PROFESSIONAL_SYSTEM_PROMPT = """\
你是一位面向从业者的专业知识卡片设计师。

给定一篇结构化 Markdown 笔记，从中提炼 8–12 张知识卡片，帮助从业者快速检索和复用核心干货。

卡片提取规则：
1. 从第 2 节（结构化笔记）的 ### 小节中提取核心结论、关键命令、重要参数、核心方法论
2. 从第 3 节（补充最新版本）中提取版本兼容、升级要点、已知 workaround
3. 也可从术语定义中选取关键术语
4. 每张卡片聚焦一个独立知识点，不重叠
5. 按笔记章节顺序排列

每张卡片的字段：
- title: 知识点名称（标准专业术语，3–10 字）
- hierarchy: 所属知识层级（如「环境配置 → 变量管理 → 环境变量」）
- tags: 1–2 个分类标签（如 ["配置", "运维"]）
- knowledge: 精准知识点（定义/公式/执行步骤/方法论，50–120 字，可直接复用）
- source_heading: 该知识点来源的 ### 标题（如有）

输出格式：纯 JSON 数组，不要用代码块包裹，不要附加解释。
示例：
[
  {"title": "环境变量", "hierarchy": "环境配置 → 变量管理 → 环境变量", "tags": ["配置", "运维"], "knowledge": "系统级键值对，进程通过 getenv/readenv 读取。修改后需 export（Linux）或 setx（Windows）+ 重启终端。PATH 变量决定命令查找顺序。", "source_heading": "环境配置"},
  {"title": "Docker 镜像层", "hierarchy": "容器 → 镜像 → 镜像层", "tags": ["容器"], "knowledge": "镜像由只读层叠加构成，每条 Dockerfile 指令生成一层。容器运行时在镜像顶部添加可写层。多镜像共享相同基础层可节省磁盘。", "source_heading": "容器基础"}
]
"""


def _extract_json_array(content: str) -> list[dict]:
    content = content.strip()
    if content.startswith("```"):
        lines = content.split("\n")
        content = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])
    match = re.search(r"\[.*\]", content, re.DOTALL)
    if match:
        content = match.group(0)
    return json.loads(content)


def generate_cards_from_note(
    llm: NoteLLM,
    note_markdown: str,
    style: str,
) -> list[dict]:
    system = BEGINNER_SYSTEM_PROMPT if style == "beginner" else PROFESSIONAL_SYSTEM_PROMPT
    user = f"--- 笔记全文 ---\n{note_markdown}\n---\n\n请提取知识卡片。"

    raw = llm._call(system, user, temperature=0.25)
    try:
        cards = _extract_json_array(raw)
    except (json.JSONDecodeError, ValueError) as e:
        logger.warning("Card generation JSON parse failed: %s, raw=%s", e, raw[:200])
        return []

    if not isinstance(cards, list):
        logger.warning("Card generation returned non-list: %s", type(cards))
        return []

    for card in cards:
        if not isinstance(card, dict):
            continue
        card.setdefault("source_heading", None)

    return cards


async def generate_cards_from_note_async(
    llm: NoteLLM,
    note_markdown: str,
    style: str,
) -> list[dict]:
    import asyncio
    return await asyncio.to_thread(generate_cards_from_note, llm, note_markdown, style)
