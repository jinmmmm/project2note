import os
import re

from app.config import settings
from app.services.keyframe_selector import select_keyframe
from app.services.screenshot_vision_refine import VisionRefineClient, refine_screenshot_timestamp

PLATFORM_LABELS = {
    "bilibili": "B站",
    "douyin": "抖音",
    "local": "本地视频",
}

GLOBAL_CONSTRAINTS = """
## 全局强制约束（两版本通用）
- **一级标题（##）固定且仅 4 个，顺序与名称不可改**：
  - 小白：1.视频基础信息 → 2.结构化笔记 → 3.工具与链接补充 → 4.延伸知识点
  - 专业：1.视频基础信息 → 2.结构化笔记 → 3.补充最新版本 → 4.延伸知识点
  禁止增加、删减或替换其它 ## 大节；用户额外要求仅可在上述框架内调整细节（如侧重、详略、小节命名），不得改动一级结构。
- 禁止生成独立「术语表 / 术语速查 / 术语解释」章节。
- 专业术语在正文中用 **术语** 标记（供前端 ? 悬浮释义，正文不加粗）；**每个被标记的术语必须写入文末隐藏块**，与正文一一对应：
```
<!-- term-defs
- 术语名 — 释义内容
-->
```
- **小白版**：5–10 条术语释义，语言通俗易懂；需要时可自然穿插类比（如「就像…」），**禁止**写「比喻：」字样，也**不必**每条都强行比喻。
- **专业版**：4–7 条释义，一句精确定义即可，无需比喻。
- 仅标记术语，非术语内容勿用 ** **；每个术语在全文第 2 节中仅首次出现时用 **术语** 包裹，后续重复出现用普通文本，不要多处重复 ? 释义。
- **联网补充的可执行细节（命令、安装步骤、配置、直达链接）必须写入第 2 节结构化笔记正文**（对应 ### 内的列表/代码块/链接）；第 3 节承担各自板块的汇总/索引职能（小白：工具链接表；专业：补充最新版本），不得用第 3 节替代第 2 节正文中的命令与步骤。
- 禁止单独追加仅含 bullet 链接列表、无表格且无正文上下文的附录节。
- 仅输出 Markdown，不要用代码块包裹整篇笔记。
- 笔记主体使用中文（非中文视频术语可保留英文）。
"""

HEADING_TIMESTAMP_RULE = """
## 视频时间戳（强制执行 · 第 2 节 ### 小节）
- 第 2 节「结构化笔记」内**每个 ### 主题标题行末尾**必须附 `<!-- ts:mm:ss -->` 或 `<!-- ts:h:mm:ss -->`，对应该主题在逐字稿中**开始讲解**的时间点。
- **禁止**把 `[mm:ss]` 写在标题可见文字中；时间戳只用 HTML 注释，前端会渲染在标题**下方**供点击跳转视频。
- 时间戳须来自下方逐字稿 `[mm:ss]` 分段前缀，不得编造；合并片段时保留各 ### 的 ts 注释。
"""

TRANSCRIPT_CORRECTION = """
## 逐字稿理解与术语纠错（生成笔记时一并完成，不要单独输出纠错结果）
- 先理解下方视频分段，识别听写错误、同音错字、产品名/术语误写
- 笔记中的专有名词须准确（例如 cloud code → Claude Code、open AI → OpenAI）
- 只修正明显错误，不改变原意；笔记正文使用纠正后的准确用词
- **命令、路径、URL、斜杠开头的指令必须按逐字稿/画面原文保留**，例如 `/goal`、`/go`、`/help` 属于不同命令，禁止擅自缩短、补全、改写；不确定时保留原样并用反引号标记
"""

BEGINNER_TOOL_INSTALL_BLOCK = """
## 小白版 · 工具提及强制格式（违反即不合格）
凡在第 2 节正文出现「安装 / 下载 / 使用 xxx 工具/软件/插件」或视频口播提到但未演示安装的工具（如 cc-switch、CC Switch），**禁止**只写一句「安装 xxx」就结束。
必须在**同一条 bullet 或紧随其后的子列表**中补齐（取自下方「联网检索结果」或可靠公开信息，不得编造链接）：

- **安装命令**：`brew install …` / `npm install …` 等**完整可复制**命令必须写在 ```bash 代码块``` 中，**禁止**写「访问官方安装指南复制命令」「粘贴到终端执行」却不给出命令本身
- **获取方式**（仅当无 CLI 安装、必须手动下载时）：`[GitHub Releases 页面](真实url)` 并说明下载哪个安装包
- **环境要求**：如 Node 18+、macOS 版本等（一行）
- **启动/打开**：如 `cc-switch` 图形界面启动方式或 CLI 命令（一行）

**反例（禁止）**：
- 「安装 cc-switch…」且无任何下载链接或安装命令
- 「访问 [Claude Code 官方安装指南](url)，复制安装命令并粘贴到终端」——若 npm/brew 命令已知，必须直接写出 ```bash npm install -g @anthropic-ai/claude-code```
**正例（必须）**：
- 安装 **CC Switch**（模型切换工具）：
  - 获取：从 [GitHub Releases](https://github.com/…/releases) 下载对应系统安装包，或 `brew install --cask cc-switch`（以检索结果为准）
  - 环境：macOS 12+ / Windows 10+
  - 启动：安装后先打开 CC Switch，再启动 Claude Code
  - 配置：填写 API Key 与 Base URL 并保存

视频中已给出完整命令的工具可引用视频步骤，但仍须保留可复制代码块。
"""

WEB_SUPPLEMENT_BEGINNER = """
## 联网补充规则（小白版 · 强制执行）
针对视频中**仅提及、未详细说明**的内容，**必须联网检索并补齐**（系统已在下方提供检索结果，必须引用）：
- **各类工具、软件、插件**：完整下载地址、安装命令、启动指令、环境要求。
- **命令行工具**：完整可复制指令、参数说明、执行前提。
- **配置类内容**：基础配置步骤、文件路径、模板示例。
- **资源类**：文档、源码、资料包，补充直达链接 / 获取方式。
- **全部写入第 2 节「结构化笔记」正文**（对应 ### 内的列表/代码块/链接），与讲解步骤合并。
- **第 3 节「工具与链接补充」**：表格汇总快查；**不得**用表格替代第 2 节正文里的完整命令。
- **目标**：零基础用户拿到笔记 → 在第 2 节复制指令即可操作，零额外搜索。
"""

WEB_SUPPLEMENT_PROFESSIONAL = """
## 联网补充规则（专业版 · 强制执行）
专业版同样**必须补充**：基础下载、安装、入门配置、新手指令；但**一级框架保持不变**，不得新增「工具链接补充」大节。
**写法要求**：
- **第 2 节正文**：凡视频提到但未完整演示的工具、软件、插件、CLI、资源，必须在相关 ### 内写出获取方式 / 安装命令 / 环境要求 / 入门配置 / 首次启动或新手指令。
- **第 3 节「补充最新版本」**：继续承担版本适配、高阶用法、生态工具、优化建议；可顺带标注「下载 / 安装 / 配置见第 2 节某主题」，但不能替代第 2 节正文。
- 不需要像小白版那样单独做「工具链接补充」表格；只需在正文中把基础信息标识清楚，并与专业结论放在一起。
- 若同时存在高阶要点与基础操作，先给可落地的基础步骤，再补版本差异、进阶参数、生产建议。
- **目标**：默认读者具备领域知识，但拿到笔记后仍能直接完成下载、安装、基础配置和首次上手，无需额外搜索。
"""

EXTENSION_SECTION = """
## 4. 延伸知识点（固定格式，供 B 站延伸推荐，必须输出）
- **必须严格按以下模板，共 4 条 bullet，不多不少**
- **前置基础、后续进阶必须用 `###` 三级标题**

### 前置基础
- 关键词1 — 一句话说明（学本视频前需掌握）
- 关键词2 — 一句话说明

### 后续进阶
- 关键词3 — 一句话说明（学完本视频后可深入）
- 关键词4 — 一句话说明

- 每条必须是 `- ` 开头的 bullet；关键词 2–10 字，适合 B 站搜索
"""

STYLE_BEGINNER = """
## 风格：小白学习版
1. **结构化笔记（第 2 节）是核心正文区**：安装步骤、命令、避坑、学习顺序、联网补充的可执行细节全部写在这里，用 `###` 主题拆分。
2. **### 主题归纳规则（强制）**：**严格限制 4–6 个 ###**，按「主题/模块」聚合归纳，**超过 6 个视为不合格**；禁止为「第一步/第二步/第 X 阶段/各功能点」各建 ###；多个相关步骤/功能必须合并到同一 ### 下的有序/无序列表；内容多时加密正文而非拆分新 ###。
3. **### 标题命名（小白版专有）**：标题用简洁专业的知识主题名；**字数强制要求：中文字 + 英文单词合计 ≤ 6 个**（如 Harness、Engineering 各算 1 个，"什么是 Harness Engineering" = 3+2=5 个但含禁止前缀词，不合格）；**禁止**以「什么是/如何/为什么/如何理解」等疑问修饰词开头；正确示例：「Harness 概念」「环境安装」「权限模式」；错误示例：「什么是 Harness Engineering」「如何理解四大理论」；**禁止**照搬博主原话、口语小标题、比喻/梗式命名（如「后悔药」「越用越懂你」）；博主比喻可写在正文或 term-defs，**不得出现在 ### 标题**；标题禁止引号、感叹号、emoji。
4. **正文 bullet 格式（思维导图兼容，强制）**：每条 bullet 正文的第一个名词/动词短语（2–8 字）必须用 `**粗体**` 包裹作为关键词，其后可接冒号或空格加说明；**禁止**以完整陈述句开头（如「视频提到将手把手搭建…」「目前适合实现…」）；**禁止**把整句话加粗；**禁止** `**Step 1：...**` 序号式粗体，应写 `**关键步骤名**：具体说明`。
5. **禁止空 ###**：每个 ### 下须有至少 1 条有效正文（bullet/段落/代码块）；内容不足则合并到最相关 ###，不得留下无正文的标题。
6. **术语释义**：文末 `<!-- term-defs -->` 写 **5–10 条**；格式 `- 术语 — 通俗解释`（1–2 句，语言浅显；需要时可自然用「就像…」类比，**禁止**写「比喻：」前缀，不必每条都比喻）；第 2 节术语**仅首次出现**用 **术语** 包裹，供 ? 悬浮释义；仅标记读者可能不懂的词，勿滥用 ** **。
7. **第 3 节工具与链接补充**：必须用 Markdown 表格 `| 工具/资源 | 说明 | 链接/获取方式 |` 汇总快查；禁止仅用 bullet 链接列表代替表格。
8. 禁止单独输出：概述总结、分章节内容、新手避坑指南、学习路径、视频目录等 ## 大节。
"""

STYLE_PROFESSIONAL = """
## 风格：专业精简版
1. **结构化笔记（第 2 节）**：清单式输出结论、命令、参数及联网补充；**3–5 个 ### 主题**，合并冗余步骤，禁止逐步骤拆 ###。
2. **### 标题命名**：用简洁专业主题名；**字数强制要求：中文字 + 英文单词合计 ≤ 6 个**（如 Harness、Engineering 各算 1 个）；**禁止**以「什么是/如何/为什么/如何理解」等疑问修饰词开头；正确示例：「权限模式」「版本回退」「Harness 概念」；**禁止**博主口语、比喻/梗式标题；标题禁止引号、感叹号、emoji。
3. **正文 bullet 格式（思维导图兼容，强制）**：每条 bullet 正文的第一个名词/动词短语（2–8 字）必须用 `**粗体**` 包裹作为关键词，其后可接冒号或空格加说明；**禁止**以完整陈述句开头；**禁止**把整句话加粗；**禁止** `**Step 1：...**` 序号式粗体，应写 `**关键步骤名**：具体说明`。
4. **禁止空 ###**：每个 ### 下须有有效正文；内容不足则合并到相邻主题，不得留空标题。
5. 术语标记：专业术语用 **术语** 标记；term-defs 写 **4–7 条**精确定义（无需比喻）；仅标记领域专有词。
6. **专业版也必须补齐基础可执行信息**：凡提到工具/软件/CLI，正文内要给出下载或安装方式、基础配置、首次使用指令；同时可保留版本差异、高阶用法、生态工具、优化建议。
7. **第 3 节补充最新版本**：版本适配、高阶用法、生态工具、优化建议（条目或短表格）；无拓展内容可写「暂无」。
8. 禁止：避坑指南、学习路径、逐步骤 ##/### 镜像视频目录、额外新增「工具链接补充」大节。
"""

BASE_STRUCTURE_BEGINNER = """
请严格按照以下 **4 个一级板块（##）** 生成笔记，顺序不可打乱：

## 1. 视频基础信息
- 视频标题、来源平台、来源链接、笔记生成时间。

## 2. 结构化笔记
- 开头用 3–5 条 bullet 概括：主题、适合人群、核心收获（每条 ≤30 字）。
- 正文用 **4–6 个 ### 主题小节** 展开（安装/操作/避坑/练习顺序/联网补充的可执行细节写入对应 ###，不要另开 ##）：
  - 按主题归纳聚合，**禁止**为「第一步、第二步、第一阶段、各独立功能点…」各建 ###；**最多 6 个 ###，超出不合格**；内容多时在同一 ### 内扩展，不得靠拆分 ### 应对内容量；
  - ### 标题用简洁专业主题名，中文字 + 英文单词合计 ≤ 6 个，**禁止**以「什么是/如何/为什么」开头，**禁止**照搬博主口语/比喻式小标题；
  - **每个 ### 必须有正文**；无内容则不建该 ###，合并到相邻主题；
  - 步骤用有序/无序列表写在同一 ### 下；
  - **每个 ### 标题行末尾附 `<!-- ts:mm:ss -->`**（对应该节在逐字稿中首次讲解的时间，勿把 `[mm:ss]` 写进标题文字）；
  - 视频未讲全的安装/命令须按联网补充规则与下方「联网检索结果」补全进本节正文；专业术语用 **术语** 标记；
  - 代码/命令用代码块，可直接复制。

## 3. 工具与链接补充
- **必须使用 Markdown 表格**，表头固定为：
  `| 工具/资源 | 说明 | 链接/获取方式 |`
- 每行一个工具/资源，作快查索引；无链接写「见第 2 节对应主题」或「官方站点搜索 xxx」。
- **禁止**在本节仅用 `- [名称](url)` bullet 列表代替表格；**禁止**仅写表格而第 2 节缺少完整命令与步骤。

## 4. 延伸知识点
（见 EXTENSION_SECTION 固定格式）

整体要求：4 个一级 ## 固定；第 2 节 4–6 个归纳后的 ###（严格不超过 6 个）；新手在第 2 节正文即可复制操作。
"""

BASE_STRUCTURE_PROFESSIONAL = """
请严格按照以下 **4 个一级板块（##）** 生成笔记，顺序不可打乱：

## 1. 视频基础信息
- 标题、来源链接、生成时间（精简）。

## 2. 结构化笔记
- 开头 1–3 句核心结论速览。
- **3–5 个 ### 主题小节**：清单式列结论、命令、配置及联网补充；合并相近内容，禁止逐步骤拆 ###。
- **每个 ### 标题行末尾附 `<!-- ts:mm:ss -->`**（来自逐字稿，勿写进标题可见文字）；
- ### 标题用简洁专业主题名，中文字 + 英文单词合计 ≤ 6 个，**禁止**以「什么是/如何/为什么」开头，**禁止**博主口语/比喻式小标题；每个 ### 必须有正文，无内容则合并；
- 专业术语用 **术语** 标记；代码/命令单独成块。
- **专业版同样必须补齐基础执行信息**：视频提到但未完整展开的工具/软件/CLI，要在对应 ### 内写出下载或安装方式、环境要求、基础配置、首次使用命令；不得只保留高阶结论。

## 3. 补充最新版本
- 版本适配、高阶用法、生态工具、优化建议（条目或短表格）；无可写「暂无」。
- 不新增小白版那种「工具与链接补充」大节；基础下载/安装/配置信息仍以内文方式写在第 2 节，本节只做拓展与索引。

## 4. 延伸知识点
（见 EXTENSION_SECTION 固定格式）

整体要求：极致精简，4 个一级标题清晰，### 不超过 5 个。
"""

MERGE_PROMPT_BEGINNER = """
你将收到同一视频的多个 Markdown 笔记片段，请合并为一份完整笔记：
1. 保持 4 个一级 ## 结构：视频基础信息 → 结构化笔记 → 工具与链接补充（表格）→ 延伸知识点。
2. 结构化笔记内 ### 归纳合并为 **4–6 个主题**（严格最多 6 个，超过不合格），禁止 7+ 个小节；联网补充的可执行细节（地址/命令/配置）保留在第 2 节对应 ### 正文。
3. **删除无正文的空 ###**；将零散内容并入最相关主题，不保留空标题。
4. **重写 ### 标题**：改为简洁专业主题名，中文字 + 英文单词合计 ≤ 6 个，禁止「什么是/如何/为什么」开头，去除博主口语、比喻、梗（如「后悔药」「越用越懂你」）；**保留** `<!-- ts:mm:ss -->` 注释。
5. 保留 **术语** 标记、完整步骤与 term-defs 隐藏块；合并去重术语释义。
6. 第 3 节工具与链接补充必须是表格，删除纯 bullet 链接附录。
7. 延伸知识点保留 ### 前置基础 + ### 后续进阶 各 2 条 bullet。
8. 禁止术语表可见章节；输出纯 Markdown。
"""

MERGE_PROMPT_PROFESSIONAL = """
你将收到同一视频的多个 Markdown 笔记片段，请合并为一份完整笔记：
1. 保持 4 个一级 ## 结构：基础信息 → 结构化笔记 → 补充最新版本 → 延伸知识点。
2. 结构化笔记内 ### 合并为 **3–5 个主题**，去重精简命令与参数；**与工具相关的下载链接、安装命令、基础配置、首次使用指令必须保留在第 2 节正文**，不得只保留高阶摘要。
3. **删除无正文的空 ###**；将零散内容并入最相关主题。
4. **重写 ### 标题**：改为简洁专业主题名，去除博主口语、比喻、梗；**保留** `<!-- ts:mm:ss -->` 注释。
5. 术语统一 **术语** 标记；保留 term-defs 隐藏块。
6. 第 3 节仅保留版本适配、高阶用法、生态工具、优化建议；若第 2 节已有安装步骤，本节可引用但不得替代。
7. 延伸知识点保留 ### 前置基础 + ### 后续进阶 各 2 条 bullet。
8. 禁止术语表可见章节；输出纯 Markdown。
"""


def get_merge_prompt(style: str) -> str:
    return MERGE_PROMPT_BEGINNER if style == "beginner" else MERGE_PROMPT_PROFESSIONAL


def format_source_link(
    platform: str,
    source_url: str | None = None,
    local_path: str | None = None,
) -> str:
    if platform == "local":
        return local_path or "（本地文件）"
    return source_url or "无"


def build_basic_info_section(
    title: str,
    platform: str,
    source_url: str | None,
    local_path: str | None,
    generated_at: str,
    author: str | None = None,
    published_at: str | None = None,
) -> str:
    platform_label = PLATFORM_LABELS.get(platform, platform)
    source_link = format_source_link(platform, source_url, local_path)
    lines = [
        "## 视频基础信息",
        f"- 视频标题：{title}",
        f"- 来源平台：{platform_label}",
        f"- 来源链接：{source_link}",
    ]
    if author:
        lines.append(f"- 视频作者：{author}")
    if published_at:
        lines.append(f"- 视频发布时间：{published_at}")
    lines.append(f"- 笔记生成时间：{generated_at}")
    return "\n".join(lines)


def extract_note_generated_at(markdown: str) -> str:
    match = re.search(r"笔记生成时间[：:]\s*(.+)", markdown)
    return match.group(1).strip() if match else ""


def patch_note_basic_info(
    markdown: str,
    title: str,
    platform: str,
    source_url: str | None,
    local_path: str | None,
    generated_at: str,
    author: str | None = None,
    published_at: str | None = None,
) -> str:
    section = build_basic_info_section(
        title, platform, source_url, local_path, generated_at, author, published_at
    )
    pattern = r"#{1,6}\s*(?:\d+\.\s*)?视频基础信息.*?(?=\n#{1,6}\s|\Z)"
    if re.search(pattern, markdown, re.DOTALL):
        return re.sub(pattern, section + "\n", markdown, count=1, flags=re.DOTALL)
    return section + "\n\n" + markdown


TERM_DEFS_RE = re.compile(r"<!--\s*term-defs\s*([\s\S]*?)-->", re.IGNORECASE)
LEGACY_GLOSSARY_RE = re.compile(r"<!--\s*glossary\s*([\s\S]*?)-->", re.IGNORECASE)
GLOSSARY_VISIBLE_RE = re.compile(
    r"#{1,6}\s*(?:\d+\.\s*)?术语(?:速查|解释|释义)\s*\n([\s\S]*?)(?=\n#{1,6}\s|\Z)",
    re.MULTILINE,
)
BULLET_LINK_SECTION_RE = re.compile(
    r"(?:^|\n)(#{1,6}\s*(?:\d+\.\s*)?工具(?:与|及)?链接补充\s*\n"
    r"(?:(?!^\|)(?!^#{1,6}\s).*\n)+)",
    re.MULTILINE | re.IGNORECASE,
)


def strip_visible_glossary_sections(markdown: str) -> str:
    """移除可见术语章节（兼容旧笔记），释义保留在 term-defs 隐藏块。"""
    if not markdown:
        return markdown

    result = GLOSSARY_VISIBLE_RE.sub("", markdown)
    lines = result.split("\n")
    out: list[str] = []
    skipping = False
    for line in lines:
        trimmed = line.strip()
        if re.match(r"^#{1,6}\s*(?:\d+\.\s*)?术语(?:速查|解释|释义)", trimmed):
            skipping = True
            continue
        if skipping and re.match(r"^#{1,6}\s+", trimmed):
            skipping = False
        if not skipping:
            out.append(line)
    return re.sub(r"\n{3,}", "\n\n", "\n".join(out)).strip() + "\n"


def _clean_table_multiline_cells(markdown: str) -> str:
    """Strip embedded code blocks and <br>-folded multi-line content from table cells.

    The section-3 table is a quick-reference index; install commands belong in
    section-2正文. When the LLM (especially the gap-repair pass) inserts
    ```bash blocks or <br>-wrapped multi-line snippets into a table cell, the
    markdown table breaks.  This function cleans up the table by:
    1. Collecting any multi-line code blocks that appear between/within table rows
    2. Stripping ``` fences and <br> tags from table rows
    3. Replacing broken cells with a short "见第2节" reference
    """
    # First pass: collect entire table section and rebuild it cleanly
    lines = markdown.split("\n")
    out: list[str] = []
    i = 0

    while i < len(lines):
        line = lines[i]
        # Detect start of a markdown table section (## heading + table header + separator)
        if re.match(r"^#{1,6}\s+(?:\d+\.\s*)?(?:工具(?:与|及)?链接补充|补充最新版本)", line.strip()):
            # Collect all lines until the next ## heading
            table_lines: list[str] = []
            i += 1
            while i < len(lines) and not re.match(r"^#{1,6}\s+", lines[i].strip()):
                table_lines.append(lines[i])
                i += 1

            # Clean the collected table section
            cleaned_table = _rebuild_table(table_lines)
            out.append(line)
            out.extend(cleaned_table)
            continue

        out.append(line)
        i += 1
    return "\n".join(out)


def _rebuild_table(table_lines: list[str]) -> list[str]:
    """Rebuild a markdown table, stripping embedded code blocks and <br> tags.

    Strategy: first collect the entire table section into a single string,
    remove all ```…``` code blocks and <br> tags, then re-parse each line
    as a table row. Rows that don't match the expected column count are
    merged with their continuation lines or discarded.
    """
    # Step 1: join all lines, strip code blocks and <br> tags
    joined = "\n".join(table_lines)
    # Remove ```…``` code blocks (multiline)
    joined = re.sub(r"```[a-z]*\n.*?```", "", joined, flags=re.DOTALL)
    # Remove any remaining ``` fences
    joined = re.sub(r"```[a-z]*", "", joined)
    joined = re.sub(r"```", "", joined)
    # Remove <br> tags
    joined = re.sub(r"<br\s*/?>", " ", joined)
    # Collapse excessive whitespace
    joined = re.sub(r"\s{2,}", " ", joined)

    # Step 2: re-parse into lines and rebuild table rows
    cleaned_lines = joined.split("\n")
    # Determine expected column count from header or separator row
    col_count = 0
    for cl in cleaned_lines:
        if cl.strip().startswith("|") and re.match(r"^\|[-:| ]+\|$", cl.strip()):
            col_count = cl.count("|") - 1  # subtract leading |
            break

    result: list[str] = []
    pending_row = ""

    for cl in cleaned_lines:
        stripped = cl.strip()
        if not stripped:
            result.append("")
            continue
        if stripped.startswith("|") and "|" in stripped[1:]:
            # This is a table row
            pipe_count = stripped.count("|") - 1  # subtract leading |
            if col_count > 0 and pipe_count == col_count:
                # Valid complete row
                # Fix truncated URLs with …  in cells
                cleaned_row = re.sub(
                    r"\[.*?….*?\]\(https?://[^)]*…[^)]*\)",
                    "见第2节",
                    stripped,
                )
                result.append(cleaned_row)
                pending_row = ""
            elif col_count > 0 and pipe_count < col_count:
                # Broken row — missing cells, accumulate
                pending_row = stripped
            else:
                result.append(stripped)
                pending_row = ""
        elif pending_row:
            # This line is a continuation of a broken row — discard it
            # (it was part of the embedded code block content)
            continue
        elif re.match(r"^\|[-:| ]+\|$", stripped):
            # Table separator row
            result.append(stripped)
        else:
            result.append(cl)

    # If there's a pending broken row, fix it by adding missing cells
    if pending_row:
        current_pipes = pending_row.count("|") - 1
        missing = col_count - current_pipes
        if missing > 0:
            pending_row = pending_row.rstrip() + " " + " | 见第2节 " * missing + "|"
        result.append(pending_row)

    return result


def strip_bullet_only_link_sections(markdown: str) -> str:
    """删除仅含 bullet 链接、无表格的「工具与链接补充」节（多为系统自动追加）。"""
    if not markdown:
        return markdown

    def _replace(match: re.Match) -> str:
        block = match.group(1)
        if "|" in block and re.search(r"^\|.+\|", block, re.MULTILINE):
            return match.group(0)
        if re.search(r"^-\s+\[.+?\]\(.+?\)", block, re.MULTILINE):
            return "\n"
        return match.group(0)

    return BULLET_LINK_SECTION_RE.sub(_replace, markdown)


def normalize_term_def_text(text: str) -> str:
    """小白术语释义：去掉「比喻：」标签，保留通俗表述。"""
    cleaned = text.strip()
    cleaned = re.sub(r"^(?:比喻|比喩)[：:]\s*", "", cleaned)
    cleaned = re.sub(r"[。；]\s*(?:比喻|比喩)[：:]\s*", "，就像", cleaned)
    cleaned = re.sub(r"\s{2,}", " ", cleaned)
    return cleaned.strip()


def dedupe_term_defs_block(markdown: str, *, style: str = "beginner") -> str:
    """term-defs 内同名术语只保留一条。"""
    match = TERM_DEFS_RE.search(markdown)
    if not match:
        return markdown

    seen: set[str] = set()
    lines: list[str] = []
    for line in match.group(1).split("\n"):
        trimmed = line.strip()
        if not trimmed:
            continue
        m = re.match(r"^([-*•]\s*)(.+?)\s*[—\-–:：]\s*(.+)$", trimmed)
        if not m:
            lines.append(line)
            continue
        prefix, term, definition = m.group(1), m.group(2).strip(), m.group(3).strip()
        key = re.sub(r"\s+", " ", term).strip().lower()
        if key in seen:
            continue
        seen.add(key)
        if style == "beginner":
            definition = normalize_term_def_text(definition)
        lines.append(f"{prefix}{term} — {definition}")

    body = "\n".join(lines).strip()
    return TERM_DEFS_RE.sub(f"<!-- term-defs\n{body}\n-->", markdown, count=1)


def strip_duplicate_term_marks(markdown: str) -> str:
    """正文同一术语仅首次保留 **术语** 标记，后续重复改为纯文本。"""
    if not markdown:
        return markdown

    lines = markdown.split("\n")
    out: list[str] = []
    seen: set[str] = set()
    in_fence = False

    for line in lines:
        stripped = line.strip()
        if stripped.startswith("```"):
            in_fence = not in_fence
            out.append(line)
            continue
        if in_fence or stripped.startswith("|") or "<!-- term-defs" in stripped or "<!-- glossary" in stripped:
            out.append(line)
            continue

        def _replace(match: re.Match) -> str:
            term = match.group(1).strip()
            key = re.sub(r"\s+", " ", term).strip().lower()
            if key in seen:
                return term
            seen.add(key)
            return f"**{term}**"

        out.append(re.sub(r"\*\*(.+?)\*\*", _replace, line))

    return "\n".join(out)


def normalize_formula_blockquotes(markdown: str) -> str:
    """保持公式引用块边界：多重引用压成单层，误拼到公式后的内容拆回下一条 bullet。"""
    if not markdown:
        return markdown
    out: list[str] = []
    for line in markdown.split("\n"):
        trimmed = line.strip()
        run_on = re.match(r"^(?:>\s*)+(\*\*[^*\n]+[ \t]*=[ \t]*[^*\n]+\*\*)-(.+)$", trimmed)
        if run_on:
            out.extend([f"> {run_on.group(1)}", "", f"- {run_on.group(2).strip()}"])
            continue
        quoted_formula = re.match(r"^(?:>\s*)+(\*\*[^*\n]+[ \t]*=[ \t]*[^*\n]+\*\*)[ \t]*$", trimmed)
        if quoted_formula:
            out.append(f"> {quoted_formula.group(1)}")
            continue
        out.append(line)
    return "\n".join(out)


def polish_term_defs_block(markdown: str, *, style: str = "beginner") -> str:
    """规范化 term-defs 隐藏块内释义措辞（仅小白版）。"""
    if style != "beginner":
        return dedupe_term_defs_block(markdown, style=style)

    match = TERM_DEFS_RE.search(markdown)
    if not match:
        return markdown

    lines: list[str] = []
    for line in match.group(1).split("\n"):
        trimmed = line.strip()
        if not trimmed:
            lines.append(line)
            continue
        m = re.match(r"^([-*•]\s*)(.+?)\s*[—\-–:：]\s*(.+)$", trimmed)
        if not m:
            lines.append(line)
            continue
        prefix, term, definition = m.group(1), m.group(2), m.group(3)
        lines.append(f"{prefix}{term} — {normalize_term_def_text(definition)}")

    body = "\n".join(lines)
    markdown = TERM_DEFS_RE.sub(f"<!-- term-defs\n{body}\n-->", markdown, count=1)
    return dedupe_term_defs_block(markdown, style=style)


def normalize_term_defs_block(markdown: str) -> str:
    """确保 term-defs 隐藏块存在；兼容旧 glossary 注释。"""
    if not markdown or not markdown.strip():
        return markdown

    markdown = strip_visible_glossary_sections(markdown)
    if TERM_DEFS_RE.search(markdown):
        return markdown

    legacy = LEGACY_GLOSSARY_RE.search(markdown)
    if legacy and legacy.group(1).strip():
        body = legacy.group(1).strip()
        markdown = LEGACY_GLOSSARY_RE.sub("", markdown, count=1).rstrip()
        return f"{markdown}\n\n<!-- term-defs\n{body}\n-->\n"

    visible = GLOSSARY_VISIBLE_RE.search(markdown)
    if visible and visible.group(1).strip():
        body = visible.group(1).strip()
        markdown = GLOSSARY_VISIBLE_RE.sub("", markdown, count=1).rstrip()
        return f"{markdown}\n\n<!-- term-defs\n{body}\n-->\n"

    return markdown


def _dedupe_summary_bullets(markdown: str) -> str:
    """Remove duplicate "- 核心收获" / "- 适合人群" / "- 主题" bullet blocks
    that appear when the merge pass redundantly includes both detailed and
    abbreviated versions of the same summary.
    """
    pattern = re.compile(
        r"(-\s*\*{0,2}(?:主题|适合人群|核心收获)\*{0,2}[^|\n]+?)\s*\n"
        r"(?:-\s*(?:主题|适合人群|核心收获)[^|\n]+\s*\n)*"
        r"(-\s*\*{0,2}(?:主题|适合人群|核心收获)\*{0,2}[^|\n]+)",
        re.MULTILINE,
    )
    # Simple strategy: if the same keyword appears twice in adjacent bullets,
    # keep only the first (more detailed) one.
    lines = markdown.split("\n")
    out: list[str] = []
    seen_summary_keywords: set[str] = set()

    in_section2_header = False
    for line in lines:
        stripped = line.strip()
        if re.match(r"^##\s+(?:\d+\.\s*)?结构化笔记", stripped):
            in_section2_header = True
        elif in_section2_header and re.match(r"^###?\s+", stripped):
            in_section2_header = False

        if in_section2_header and re.match(r"^-\s+", stripped):
            m = re.match(r"^-\s+\*{0,2}(主题|适合人群|核心收获)\*{0,2}", stripped)
            if m:
                key = m.group(1)
                if key in seen_summary_keywords:
                    # Skip duplicate summary bullet
                    continue
                seen_summary_keywords.add(key)
        out.append(line)

    return "\n".join(out)


def _subsection_body_has_content(body: str) -> bool:
    """判断 ### 及以下标题的正文是否含有效内容。"""
    for line in body.split("\n"):
        t = line.strip()
        if not t:
            continue
        if t in ("---", "***", "___"):
            continue
        if t.startswith("<!--"):
            continue
        if re.match(r"^[-*+]\s*$", t):
            continue
        if re.match(r"^\d+\.\s*$", t):
            continue
        return True
    return False


def strip_empty_subsections(markdown: str, min_depth: int = 3) -> str:
    """移除无正文的 ### / #### 小节（兼容合并后残留的空标题）。"""
    if not markdown:
        return markdown

    lines = markdown.split("\n")
    out: list[str] = []
    i = 0
    while i < len(lines):
        line = lines[i]
        m = re.match(r"^(#{1,6})\s+", line)
        if m and len(m.group(1)) >= min_depth:
            depth = len(m.group(1))
            i += 1
            body: list[str] = []
            while i < len(lines):
                nxt = lines[i]
                nm = re.match(r"^(#+)\s+", nxt)
                if nm and len(nm.group(1)) <= depth:
                    break
                body.append(nxt)
                i += 1
            if _subsection_body_has_content("\n".join(body)):
                out.append(line)
                out.extend(body)
            continue
        out.append(line)
        i += 1
    return re.sub(r"\n{3,}", "\n\n", "\n".join(out)).strip() + "\n"


_TS_BRACKET_RE = re.compile(r"\[(\d{1,2}):(\d{2})(?::(\d{2}))?\]")
_TS_COMMENT_RE = re.compile(r"<!--\s*ts:(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*-->|[^\n]*)", re.I)
_HEADING_LINE_RE = re.compile(r"^(#{1,6})\s+(.+)$")
_AUDIO_EXTENSIONS = {".m4a", ".mp3", ".wav", ".aac", ".flac", ".ogg"}


def _sanitize_heading_title_text(text: str) -> str:
    cleaned = _TS_COMMENT_RE.sub("", text)
    cleaned = _TS_BRACKET_RE.sub("", cleaned)
    cleaned = re.sub(r"`([^`]+)`", r"\1", cleaned)
    cleaned = re.sub(r"(^|\s)```+\s*", " ", cleaned)
    cleaned = re.sub(r"\s+```+$", " ", cleaned)
    cleaned = re.sub(r"\s+`+$", " ", cleaned)
    cleaned = re.sub(r"^`+\s+", "", cleaned)
    cleaned = re.sub(r"\s{2,}", " ", cleaned)
    return cleaned.strip()


def _ts_comment_from_match(m: re.Match) -> str:
    if m.lastindex and m.lastindex >= 3 and m.group(3):
        return f"<!-- ts:{m.group(1)}:{m.group(2)}:{m.group(3)} -->"
    return f"<!-- ts:{m.group(1)}:{m.group(2)} -->"


def _heading_has_ts_comment(text: str) -> bool:
    return bool(_TS_COMMENT_RE.search(text))


def _first_ts_in_text(text: str) -> str | None:
    cm = _TS_COMMENT_RE.search(text)
    if cm:
        return _ts_comment_from_match(cm)
    bm = _TS_BRACKET_RE.search(text)
    if bm:
        return _ts_comment_from_match(bm)
    return None


def normalize_heading_timestamps(markdown: str) -> str:
    """将标题行内可见的 [mm:ss] 转为 <!-- ts:... -->，避免时间戳出现在标题文字里。"""
    if not markdown:
        return markdown

    out: list[str] = []
    for line in markdown.split("\n"):
        m = _HEADING_LINE_RE.match(line)
        if not m:
            out.append(line)
            continue

        hashes, body = m.group(1), m.group(2).strip()
        existing = _TS_COMMENT_RE.search(body)
        if existing:
            title = _sanitize_heading_title_text(body)
            out.append(f"{hashes} {title} {_ts_comment_from_match(existing)}")
            continue

        prefix = _TS_BRACKET_RE.match(body)
        if prefix:
            title = _sanitize_heading_title_text(body[prefix.end() :])
            out.append(f"{hashes} {title} {_ts_comment_from_match(prefix)}")
            continue

        suffix = None
        for sm in _TS_BRACKET_RE.finditer(body):
            suffix = sm
        if suffix and suffix.end() == len(body):
            title = _sanitize_heading_title_text(body[: suffix.start()])
            out.append(f"{hashes} {title} {_ts_comment_from_match(suffix)}")
            continue

        out.append(f"{hashes} {_sanitize_heading_title_text(body)}")
    return "\n".join(out)


def promote_subsection_timestamps(markdown: str) -> str:
    """### 标题无 ts 时，从该节正文首个时间戳提升到标题注释（兼容旧笔记/LLM 漏标）。"""
    if not markdown:
        return markdown

    lines = markdown.split("\n")
    out: list[str] = []
    in_section2 = False
    i = 0
    while i < len(lines):
        line = lines[i]
        stripped = line.strip()

        if re.match(r"^##\s+(?:\d+\.\s*)?结构化笔记", stripped):
            in_section2 = True
            out.append(line)
            i += 1
            continue
        if in_section2 and re.match(r"^##\s+", stripped):
            in_section2 = False

        hm = _HEADING_LINE_RE.match(line)
        if not in_section2 or not hm or len(hm.group(1)) < 3:
            out.append(line)
            i += 1
            continue

        depth = len(hm.group(1))
        body = hm.group(2).strip()
        if _heading_has_ts_comment(body):
            out.append(line)
            i += 1
            continue

        section_body: list[str] = []
        i += 1
        while i < len(lines):
            nxt = lines[i]
            nm = _HEADING_LINE_RE.match(nxt)
            if nm and len(nm.group(1)) <= depth:
                break
            section_body.append(nxt)
            i += 1

        ts = _first_ts_in_text("\n".join(section_body))
        if ts:
            out.append(f"{hm.group(1)} {body} {ts}")
        else:
            out.append(line)
        out.extend(section_body)

    return "\n".join(out)


def _ts_comment_to_seconds(m: re.Match) -> int:
    first = int(m.group(1))
    second = int(m.group(2))
    third = m.group(3)
    if third is not None:
        return first * 3600 + second * 60 + int(third)
    return first * 60 + second


def _insert_missing_video_notice(markdown: str) -> str:
    if not markdown:
        return markdown
    notice = "> 提示：当前任务无可用本地视频文件，未生成截图。"
    if notice in markdown:
        return markdown

    lines = markdown.split("\n")
    out: list[str] = []
    inserted = False
    for line in lines:
        out.append(line)
        if not inserted and re.match(r"^##\s+(?:\d+\.\s*)?结构化笔记", line.strip()):
            out.append("")
            out.append(notice)
            out.append("")
            inserted = True
    return "\n".join(out)


def embed_screenshots_into_note(
    markdown: str,
    video_path: str | None,
    task_id: str,
    uploads_path: str,
    *,
    enabled: bool | None = None,
    min_score: float | None = None,
    vision_refine_enabled: bool | None = None,
    vision_client: VisionRefineClient | None = None,
) -> str:
    if not markdown:
        return markdown

    if enabled is None:
        enabled = settings.enable_smart_screenshots
    if not enabled:
        return markdown

    if vision_refine_enabled is None:
        vision_refine_enabled = settings.enable_vision_screenshot_refine

    if not video_path or not os.path.exists(video_path):
        return _insert_missing_video_notice(markdown)

    ext = os.path.splitext(video_path)[1].lower()
    if ext in _AUDIO_EXTENSIONS:
        return _insert_missing_video_notice(markdown)

    lines = markdown.split("\n")
    out: list[str] = []
    in_section2 = False
    pending_seconds: int | None = None
    pending_section_title: str = ""
    pending_body_preview: str = ""
    pending_filename: str | None = None
    pending_inserted = False

    for line in lines:
        stripped = line.strip()

        if re.match(r"^##\s+(?:\d+\.\s*)?结构化笔记", stripped):
            in_section2 = True
            pending_seconds = None
            pending_section_title = ""
            pending_body_preview = ""
            pending_filename = None
            pending_inserted = False
            out.append(line)
            continue

        if in_section2 and re.match(r"^##\s+", stripped):
            in_section2 = False
            pending_seconds = None
            pending_section_title = ""
            pending_body_preview = ""
            pending_filename = None
            pending_inserted = False

        heading = _HEADING_LINE_RE.match(line)
        if in_section2 and heading and len(heading.group(1)) >= 3:
            ts_match = _TS_COMMENT_RE.search(heading.group(2))
            if ts_match:
                pending_seconds = _ts_comment_to_seconds(ts_match)
                pending_section_title = _TS_COMMENT_RE.sub("", heading.group(2)).strip()
                pending_body_preview = ""
                pending_filename = f"ss_{task_id}_{pending_seconds}.jpg"
                pending_inserted = False
            else:
                pending_seconds = None
                pending_section_title = ""
                pending_body_preview = ""
                pending_filename = None
                pending_inserted = False
            out.append(line)
            continue

        out.append(line)

        if in_section2 and pending_seconds is not None and not pending_body_preview and stripped:
            if not stripped.startswith("#") and not stripped.startswith("![") and stripped != "---":
                pending_body_preview = stripped

        if not in_section2 or pending_seconds is None or pending_filename is None or pending_inserted:
            continue

        if not stripped:
            continue

        try:
            target_seconds = pending_seconds
            if vision_refine_enabled and vision_client is not None:
                target_seconds = refine_screenshot_timestamp(
                    video_path,
                    pending_seconds,
                    pending_section_title,
                    vision_client,
                    body_preview=pending_body_preview,
                )

            image_stem = pending_filename[:-4]
            selected = select_keyframe(
                video_path,
                target_seconds,
                uploads_path,
                image_stem,
                window_seconds=settings.smart_screenshot_window_seconds,
                min_score=min_score if min_score is not None else settings.smart_screenshot_min_score,
            )
            if selected is not None and os.path.exists(selected.path):
                out.append("")
                out.append(f"![截图](/static/uploads/{pending_filename})")
                out.append("")
            pending_inserted = True
        except Exception:
            pending_inserted = True

    return "\n".join(out)


def _strip_llm_preamble(markdown: str) -> str:
    """Remove LLM conversational preamble that appears before the first ## heading.

    The gap-repair pass sometimes outputs explanatory text like
    "好的，已根据联网检索结果补全..." before the actual note markdown.
    This strips any such preamble.
    """
    if not markdown:
        return markdown
    # Find the first ## heading
    idx = markdown.find("\n## ")
    if idx <= 0:
        # Also check for ## at the very start (no preceding newline)
        if markdown.startswith("## "):
            return markdown
        # Check if there's preamble before a ## that starts on its own line
        idx2 = markdown.find("## ")
        if idx2 > 0:
            before = markdown[:idx2].strip()
            # If the text before ## doesn't start with # or |, it's preamble
            if not before.startswith("#") and not before.startswith("|") and not before.startswith("-"):
                return markdown[idx2:].lstrip()
        return markdown
    # Check if content before the first ## looks like preamble (not a heading)
    before = markdown[:idx].strip()
    if not before.startswith("#") and not before.startswith("|"):
        return markdown[idx:].lstrip("\n")
    return markdown


def postprocess_note_markdown(
    markdown: str,
    title: str,
    platform: str,
    source_url: str | None,
    local_path: str | None,
    generated_at: str,
    *,
    style: str = "beginner",
    author: str | None = None,
    published_at: str | None = None,
) -> str:
    markdown = _strip_llm_preamble(markdown)
    markdown = normalize_formula_blockquotes(markdown)
    markdown = patch_note_basic_info(
        markdown, title, platform, source_url, local_path, generated_at, author, published_at
    )
    markdown = strip_bullet_only_link_sections(markdown)
    markdown = _clean_table_multiline_cells(markdown)
    markdown = strip_empty_subsections(markdown)
    markdown = _dedupe_summary_bullets(markdown)
    markdown = normalize_heading_timestamps(markdown)
    markdown = promote_subsection_timestamps(markdown)
    markdown = normalize_term_defs_block(markdown)
    markdown = strip_duplicate_term_marks(markdown)
    return polish_term_defs_block(markdown, style=style)


WEB_CONTEXT_SECTION = """
## 联网检索结果（生成笔记时必须引用，不得忽略）
以下为系统已完成的联网检索。视频中仅提及、未详讲的内容，**必须**从中提取下载地址、安装命令、官方链接、版本与参数说明：
- **小白版**：每个被提及的工具（如 cc-switch）须在第 2 节正文写出获取链接/安装命令/启动方式；禁止只写「安装 xxx」而无命令或链接。
- **专业版**：每个被提及的工具同样须在第 2 节正文写出获取链接或安装命令、基础配置、首次使用方式；高阶要点继续写入第 2 节正文，拓展信息可写入第 3 节补充最新版本。
禁止仅写在文末附录或仅有链接无正文上下文。检索结果不足时可结合公开信息（优先 GitHub Releases / 官网）补充，找不到则写明「请搜索：工具名 + releases」；不得编造 URL。

{web_context}
"""

WEB_CONTEXT_EMPTY_BEGINNER = """
## 联网检索结果（本次未返回有效条目）
仍须遵守小白版联网补充规则：凡正文出现「安装/下载 xxx」或视频口播提到但未演示安装的工具，必须补充获取方式、安装命令、环境要求、启动方式。
优先 GitHub Releases / 官方文档；无法确认链接时写明确检索词，禁止只写「安装 xxx」一句带过。
"""


def build_note_prompt(
    title: str,
    segment_text: str,
    style: str,
    extras: str = "",
    generated_at: str = "",
    platform: str = "bilibili",
    source_url: str | None = None,
    local_path: str | None = None,
    web_context: str = "",
    author: str | None = None,
    published_at: str | None = None,
) -> str:
    if style == "beginner":
        core = (
            BASE_STRUCTURE_BEGINNER
            + EXTENSION_SECTION
            + TRANSCRIPT_CORRECTION
            + WEB_SUPPLEMENT_BEGINNER
            + BEGINNER_TOOL_INSTALL_BLOCK
            + STYLE_BEGINNER
        )
    else:
        core = (
            BASE_STRUCTURE_PROFESSIONAL
            + EXTENSION_SECTION
            + TRANSCRIPT_CORRECTION
            + WEB_SUPPLEMENT_PROFESSIONAL
            + STYLE_PROFESSIONAL
        )

    platform_label = PLATFORM_LABELS.get(platform, platform)
    source_link = format_source_link(platform, source_url, local_path)

    prompt = core + GLOBAL_CONSTRAINTS + HEADING_TIMESTAMP_RULE
    prompt += (
        f"\n\n## 视频基础信息（以下字段必须原样写入，不得修改或编造）\n"
        f"- 视频标题：{title}\n"
        f"- 来源平台：{platform_label}\n"
        f"- 来源链接：{source_link}\n"
    )
    if author:
        prompt += f"- 视频作者：{author}\n"
    if published_at:
        prompt += f"- 视频发布时间：{published_at}\n"
    prompt += f"- 笔记生成时间：{generated_at}\n"
    if extras:
        prompt += (
            f"\n用户额外要求（在保持上述 4 节一级结构不变的前提下执行）：{extras}\n"
        )
    if web_context.strip():
        prompt += "\n" + WEB_CONTEXT_SECTION.format(web_context=web_context.strip()) + "\n"
    elif style == "beginner":
        prompt += "\n" + WEB_CONTEXT_EMPTY_BEGINNER + "\n"
    prompt += f"\n---\n视频分段（格式：开始时间 - 内容）：\n{segment_text}\n---\n"
    return prompt


MINDMAP_SYSTEM_PROMPT = """你是专业视频内容结构化梳理师。基于用户提供的视频笔记，生成「关键子点可继续展开」的结构优化思维导图。

约束规则：
1. 输出关键子点导图，不是标题目录，也不是长解释笔记。
2. 固定最多 4 层：根主题 → 模块 → 概念 → 最细关键子点。禁止超过 4 层。
3. 节点 label 保持 4-8 字精炼关键词，禁止超过 10 字，禁止长段落、口语废话。
4. 集合概念不能当最终叶子：如「五大组件」「三阶段协作」「安装与命令」「核心步骤」必须展开到具体组件/阶段/命令/步骤。
5. 同一父节点下禁止重复 label；同名或近似概念必须合并为一个节点，然后把细节放到 children。
6. 每个非叶节点建议 2-8 个子节点；避免单链和重复散点。
7. 必须保留原文专有名词、专业术语、命令、工具名。
8. 可选 detail：仅用于放短补充（不超过 40 字）；主图仍靠 label 和 children 表达。
9. 输出格式：仅返回标准 JSON，无额外解释、无 markdown 代码块包裹。
   格式：{"label":"主题","children":[{"label":"模块","children":[{"label":"概念","children":[{"label":"关键子点","detail":"可选短补充"}]}]}]}
"""
