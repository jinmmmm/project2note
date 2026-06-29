from app.gpt.prompts import (
    normalize_heading_timestamps,
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
