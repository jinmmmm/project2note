from app.gpt.prompts import (
    _should_skip_screenshot_heading,
    normalize_heading_timestamps,
    normalize_professional_summary_label,
    promote_subsection_timestamps,
)


def test_convert_suffix_timestamp_to_comment():
    md = "## 2. 结构化笔记\n### 环境安装 [03:45]\n- step"
    out = normalize_heading_timestamps(md)
    assert "<!-- ts:03:45 -->" in out
    assert "[03:45]" not in out.split("\n")[1]



def test_promote_body_timestamp_to_heading():
    md = """
## 2. 结构化笔记
### 环境安装
- [03:45] 打开终端
- 执行命令
"""
    out = promote_subsection_timestamps(md)
    assert "### 环境安装 <!-- ts:03:45 -->" in out


def test_repair_unclosed_timestamp_comment_in_heading():
    md = "### 实战案例：AI 内容审美偏好对齐 <!-- ts:7:32 |"
    out = normalize_heading_timestamps(md)
    assert out == "### 实战案例：AI 内容审美偏好对齐 <!-- ts:7:32 -->"


def test_skip_screenshot_for_opening_summary_headings():
    assert _should_skip_screenshot_heading("核心结论")
    assert _should_skip_screenshot_heading("核心要点速览")
    assert _should_skip_screenshot_heading("课前须知")
    assert not _should_skip_screenshot_heading("环境安装")


def test_normalize_professional_summary_label_to_chinese_with_colon():
    examples = [
        ("**TL;DR** Harness Engineering", "**核心结论**：Harness Engineering"),
        ("**TLDR**：Harness Engineering", "**核心结论**：Harness Engineering"),
        ("TL;DR Harness Engineering", "核心结论：Harness Engineering"),
        ("**核心结论** Harness Engineering", "**核心结论**：Harness Engineering"),
    ]
    for source, expected in examples:
        assert normalize_professional_summary_label(source) == expected
