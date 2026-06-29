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


def _user_prompt(note_text: str, video_type: Optional[str], instruction: Optional[str] = None) -> str:
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
    out: dict = {"label": label}
    detail = (node.get("detail") or "").strip()
    if detail:
        out["detail"] = detail[:80]

    children_raw = _dedupe_children(node.get("children") or [])
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
) -> dict:
    """调用 LLM 生成结构优化导图树。返回 {label, children} 结构。"""
    raw = llm._call(MINDMAP_SYSTEM_PROMPT, _user_prompt(note_text, video_type, instruction), temperature=0.25)
    parsed = _extract_json(raw)
    root_label = (parsed.get("root") or parsed.get("label") or "视频主题").strip()
    children = _dedupe_children(parsed.get("children") or [])
    tree = {"label": root_label}
    if children:
        tree["children"] = [_normalize_tree(c, 1) for c in children if isinstance(c, dict)]
        tree["children"] = _dedupe_children(tree["children"])
    return tree
