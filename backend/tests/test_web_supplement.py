from app.services.web_supplement import extract_search_queries, format_web_context


def test_extract_cc_switch_and_claude_code():
    text = (
        "第一步安装 Claude Code，命令是 npm install -g @anthropic-ai/claude-code。"
        "然后使用 CC Switch 配置 API Key 和 Base URL，必须在启动前操作。"
    )
    queries = extract_search_queries(text, "Claude Code 入门")
    joined = " ".join(queries).lower()
    assert "cc switch" in joined or "claude code" in joined
    assert "npm" in joined or "anthropic" in joined


def test_install_cc_switch_prioritized_in_beginner():
    text = (
        "npm install -g @anthropic-ai/claude-code。"
        "若用国产模型需安装 cc-switch（模型切换工具），填写 API Key。"
    )
    queries = extract_search_queries(text, "Claude Code", style="beginner", max_queries=10)
    joined = " ".join(queries).lower()
    assert "cc-switch" in joined or "cc switch" in joined
    assert "npm install" in joined


def test_extract_professional_queries_include_install_and_advanced():
    text = (
        "Claude Code 支持多种权限模式，可用 npm install -g @anthropic-ai/claude-code 安装。"
    )
    queries = extract_search_queries(text, "Claude Code", style="professional", max_queries=12)
    joined = " ".join(queries).lower()
    assert "advanced" in joined or "changelog" in joined or "版本" in joined or "高阶用法" in joined
    assert "npm install" in joined or "下载 安装" in joined


def test_format_web_context():
    ctx = format_web_context(
        [
            {
                "title": "CC Switch Releases",
                "url": "https://example.com/cc-switch",
                "snippet": "Download for macOS and Windows.",
                "query": "CC Switch 下载",
            }
        ]
    )
    assert "CC Switch Releases" in ctx
    assert "https://example.com/cc-switch" in ctx
    assert "检索词" in ctx
