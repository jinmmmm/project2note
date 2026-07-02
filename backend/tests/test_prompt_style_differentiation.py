from app.gpt.prompts import build_note_prompt, get_merge_prompt


SEGMENT_TEXT = "00:00 - 介绍 Claude Code 安装与权限模式"


def test_beginner_prompt_enforces_tutorial_structure():
    prompt = build_note_prompt(
        title="Claude Code 入门",
        segment_text=SEGMENT_TEXT,
        style="beginner",
        generated_at="2026-07-01",
        platform="bilibili",
        source_url="https://example.com/video",
    )

    assert "适合人群" in prompt
    assert "不适合人群" in prompt
    assert "前置知识检查" in prompt
    assert "学完能达成的目标" in prompt
    assert "操作目的" in prompt
    assert "具体步骤" in prompt
    assert "成功验证" in prompt
    assert "常见卡点" in prompt
    assert "| 工具/资源 | 用途 | 环境要求 | 安装/获取方式 | 启动/自检方式 |" in prompt
    assert "教程感" in prompt


def test_professional_prompt_enforces_reference_structure():
    prompt = build_note_prompt(
        title="Claude Code 进阶",
        segment_text=SEGMENT_TEXT,
        style="professional",
        generated_at="2026-07-01",
        platform="bilibili",
        source_url="https://example.com/video",
    )

    assert "核心结论" in prompt
    assert "100 字以内" in prompt
    assert "核心要点速览" in prompt
    assert "指令集" in prompt
    assert "参数配置" in prompt
    assert "版本兼容与升级" in prompt
    assert "### 进阶与优化" in prompt
    assert "### 已知问题与 Workaround" in prompt
    assert "不使用表格" in prompt
    assert "禁止空小节" in prompt
    assert "手册 / 速查表" in prompt
    assert "禁止小白式长解释" in prompt


def test_professional_prompt_forbids_beginner_validation_template():
    prompt = build_note_prompt(
        title="Claude Code 进阶",
        segment_text=SEGMENT_TEXT,
        style="professional",
        generated_at="2026-07-01",
        platform="bilibili",
        source_url="https://example.com/video",
    )

    assert "禁止小白式长解释" in prompt
    assert "不得套用「是什么 / 为什么 / 操作目的 / 成功验证」教学模板" in prompt
    assert "按 `操作目的 / 具体步骤 / 成功验证 / 常见卡点` 写" not in prompt


def test_merge_prompts_preserve_style_difference():
    beginner_merge = get_merge_prompt("beginner")
    professional_merge = get_merge_prompt("professional")

    assert "教程感" in beginner_merge
    assert "适合人群 / 不适合人群 / 前置知识检查 / 学完能达成的目标" in beginner_merge
    assert "操作目的/具体步骤/成功验证/常见卡点" in beginner_merge
    assert "禁止压缩成专业版短清单" in beginner_merge

    assert "手册 / 速查表感" in professional_merge
    assert "核心结论" in professional_merge
    assert "核心要点速览" in professional_merge
    assert "### 版本兼容与升级" in professional_merge
    assert "### 进阶与优化" in professional_merge
    assert "### 已知问题与 Workaround" in professional_merge
    assert "禁止展开成小白式长解释" in professional_merge
