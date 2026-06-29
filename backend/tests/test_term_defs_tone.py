from app.gpt.prompts import normalize_term_def_text, polish_term_defs_block


def test_strip_biyu_label():
    raw = "能自主规划并执行。比喻：一个拥有大脑和手脚的智能助理。"
    assert "比喻" not in normalize_term_def_text(raw)
    assert "就像" in normalize_term_def_text(raw)


def test_polish_term_defs_block():
    md = """## 2. x
<!-- term-defs
- AI Agent — 能自主规划。比喻：智能数字助理。
-->
"""
    out = polish_term_defs_block(md, style="beginner")
    assert "比喻" not in out
    assert "就像" in out
