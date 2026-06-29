from app.services.web_supplement import (
    augment_web_context_with_known_commands,
    format_known_install_commands,
)


def test_known_claude_code_command():
    block = format_known_install_commands(["Claude Code"])
    assert "npm install -g @anthropic-ai/claude-code" in block


def test_augment_appends_known_commands():
    out = augment_web_context_with_known_commands("", ["Claude Code"])
    assert "npm install -g @anthropic-ai/claude-code" in out
    assert "禁止让用户去官网复制" in out
