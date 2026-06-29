from app.services.install_gap_auditor import find_incomplete_install_gaps


SAMPLE_MD = """
## 1. 视频基础信息
- 标题：test

## 2. 结构化笔记
- 主题概括

### 模型配置
- 安装 cc-switch（模型切换工具），填写 API Key 和 Base URL。

### 环境安装
- 安装 **Claude Code**：
  - 获取：[GitHub](https://github.com/anthropics/claude-code)
  - 安装命令：
```bash
npm install -g @anthropic-ai/claude-code
```

## 3. 工具与链接补充
| 工具 | 说明 | 链接 |
"""

def test_find_gap_for_cc_switch_only():
    gaps = find_incomplete_install_gaps(SAMPLE_MD)
    assert any("cc-switch" in g.lower() or "cc switch" in g.lower() for g in gaps)
    assert not any("claude" in g.lower() for g in gaps)


def test_no_gap_when_install_has_code_block():
    md = """
## 2. 结构化笔记
- 安装 Node.js 后执行：
```bash
brew install node
```
"""
    gaps = find_incomplete_install_gaps(md)
    assert gaps == []


DEFER_GUIDE_MD = """
## 2. 结构化笔记
### 环境安装
- 安装 **Claude Code**：
  1. 在 Cursor 中，点击 Terminal → New Terminal 打开终端
  2. 访问 [Claude Code 官方安装指南](https://docs.anthropic.com)，复制安装命令并粘贴到终端执行
  3. 安装后，输入 `claude --version` 并回车验证
"""


def test_find_gap_when_only_official_guide_link():
    gaps = find_incomplete_install_gaps(DEFER_GUIDE_MD)
    assert any("claude" in g.lower() for g in gaps)
