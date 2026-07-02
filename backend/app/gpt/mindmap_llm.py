import json
import re
from typing import Optional

from app.gpt.note_llm import NoteLLM
from app.gpt.prompts import MINDMAP_SYSTEM_PROMPT

VIDEO_TYPE_PATTERNS = {
    "课程": "课程/科普类",
    "科普": "课程/科普类",
    "访谈": "演讲/访谈类",
    "演讲": "演讲/访谈类",
    "教程": "实操教程类",
    "实操": "实操教程类",
    "影视": "影视类",
}


def _extract_structured_section(note_text: str, style: str = "beginner") -> str:
    """Extract only the '结构化笔记' section from the note markdown, and drop
    the opening preamble (适合人群/不适合人群/前置知识检查/学完目标/课前须知
    for beginner; 核心结论/核心要点速览 for professional) that sits before the
    first ### subsection — the mindmap must only cover ### topics, not preamble.
    Also strips 工具与链接补充 / 补充最新版本 / 延伸知识点 sub-sections as a guard.
    Returns the full note if no '结构化笔记' heading is found.
    """
    lines = note_text.split("\n")
    # Find structured section boundaries
    struct_start = None
    struct_end = None
    for i, line in enumerate(lines):
        stripped = line.strip()
        if stripped.startswith("## ") and "结构化笔记" in stripped:
            struct_start = i
        elif struct_start is not None and stripped.startswith("## ") and struct_end is None:
            struct_end = i
            break
    if struct_start is None:
        return note_text
    section_lines = lines[struct_start:struct_end or len(lines)]
    # Drop everything between the ## header and the first ### subsection:
    # this is the preamble (适合人群 / 核心结论 / 核心要点速览 / 课前须知 …)
    # which must never become mindmap branches.
    first_sub = None
    for i, line in enumerate(section_lines):
        if line.strip().startswith("### "):
            first_sub = i
            break
    if first_sub is not None and first_sub > 1:
        section_lines = [section_lines[0]] + section_lines[first_sub:]
    # Strip unwanted sub-sections
    out = []
    skip_sections = {"视频基础信息", "延伸知识点", "工具与链接补充", "补充最新版本"}
    skip_depth = None
    for line in section_lines:
        stripped = line.strip()
        if stripped.startswith("### ") or stripped.startswith("## "):
            heading = stripped.lstrip("#").strip()
            if heading in skip_sections:
                skip_depth = len(stripped) - len(stripped.lstrip("#"))
                continue
            if skip_depth is not None and (len(stripped) - len(stripped.lstrip("#"))) <= skip_depth:
                skip_depth = None
        if skip_depth is not None:
            continue
        out.append(line)
    return "\n".join(out)


def _user_prompt(note_text: str, video_type: Optional[str], instruction: Optional[str] = None, style: str = "beginner") -> str:
    paradigm = VIDEO_TYPE_PATTERNS.get((video_type or "").strip(), "课程/科普类")
    extra = f"\n用户本次调整要求：{instruction.strip()}\n" if instruction and instruction.strip() else ""
    return (
        f"视频类型：{paradigm}\n"
        f"{extra}\n"
        f"--- 视频笔记全文 ---\n{note_text}\n---\n\n"
        "请输出关键子点可继续展开的结构优化导图 JSON。"
    )


def _extract_json(content: str) -> dict:
    content = content.strip()
    if content.startswith("```"):
        lines = content.split("\n")
        content = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])
    match = re.search(r"\{.*\}", content, re.DOTALL)
    if match:
        content = match.group(0)
    return json.loads(content)


def _key(label: str) -> str:
    return re.sub(r"[\s\d.、:：，,（）()【】\[\]「」\-_/]", "", label or "").lower()


# 思维导图禁止作为分支的 label（归一化后的 key）。这些是第2节开场 preamble
# 与第4节延伸知识点，属于阅读引导/学习路径，不是第2节 ### 知识结构。
# 后处理硬过滤，不依赖 LLM 是否听话或服务是否已加载输入剥离逻辑。
_MINDMAP_BLOCKED_LABEL_KEYS = {
    # 第2节开场 preamble（小白课前须知 / 专业核心结论）
    "课前须知", "适合人群", "不适合人群", "前置知识检查", "前置知识",
    "学完能达成的目标", "学完目标", "核心结论", "核心要点速览",
    # 第4节延伸知识点
    "延伸知识点", "延伸知识", "前置基础", "后续进阶",
}


def _is_blocked_label(label: str) -> bool:
    return _key(label) in _MINDMAP_BLOCKED_LABEL_KEYS


def _dedupe_children(children: list[dict]) -> list[dict]:
    merged: dict[str, dict] = {}
    order: list[str] = []
    for child in children:
        if not isinstance(child, dict):
            continue
        label = (child.get("label") or child.get("root") or child.get("title") or "").strip()
        if not label:
            continue
        k = _key(label)
        if not k:
            continue
        if k not in merged:
            merged[k] = child
            order.append(k)
            continue
        target = merged[k]
        target_children = target.get("children") or []
        child_children = child.get("children") or []
        if child_children:
            target["children"] = target_children + child_children
        if not target.get("detail") and child.get("detail"):
            target["detail"] = child.get("detail")
    return [merged[k] for k in order]


def _normalize_tree(node: dict, depth: int = 0) -> dict:
    """规整 AI 返回节点：统一 label/children/detail，封顶 4 层，同级去重合并。"""
    label = (node.get("root") or node.get("label") or node.get("title") or "未命名").strip()
    label = label[:16] if len(label) > 16 else label
    out: dict = {"label": label}
    detail = (node.get("detail") or "").strip()
    if detail:
        out["detail"] = detail[:80]

    children_raw = _dedupe_children(node.get("children") or [])
    # 后处理硬过滤：丢弃命中黑名单的分支（课前须知/适合人群/延伸知识点…）
    children_raw = [
        c for c in children_raw
        if not _is_blocked_label((c.get("label") or c.get("root") or c.get("title") or "").strip())
    ]
    if depth >= 3 or not children_raw:
        return out

    children = [_normalize_tree(c, depth + 1) for c in children_raw if isinstance(c, dict)]
    children = _dedupe_children(children)
    if children:
        out["children"] = children
    return out


def generate_mindmap(
    llm: NoteLLM,
    note_text: str,
    video_type: Optional[str] = None,
    instruction: Optional[str] = None,
    style: str = "beginner",
) -> dict:
    """调用 LLM 生成结构优化导图树。返回 {label, children} 结构。"""
    filtered = _extract_structured_section(note_text, style)
    raw = llm._call(MINDMAP_SYSTEM_PROMPT, _user_prompt(filtered, video_type, instruction, style), temperature=0.25)
    parsed = _extract_json(raw)
    root_label = (parsed.get("root") or parsed.get("label") or "视频主题").strip()
    children = _dedupe_children(parsed.get("children") or [])
    # 顶层分支同样过滤黑名单（防止 LLM 把「延伸知识点/课前须知」直接挂在根下）
    children = [c for c in children if not _is_blocked_label((c.get("label") or c.get("root") or c.get("title") or "").strip())]
    tree = {"label": root_label}
    if children:
        tree["children"] = [_normalize_tree(c, 1) for c in children if isinstance(c, dict)]
        tree["children"] = _dedupe_children(tree["children"])
    return tree
