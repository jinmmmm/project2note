# Project2Note

视频转 AI 笔记工具 — 基于 PRD V1.0 从零实现。

## 功能

- 本地视频上传 (mp4/mov)、B站/抖音链接解析（抖音仅支持公开普通视频）
- ASR 转写 + 语气词/复读清洗
- 四板块结构化笔记：视频基础信息 → 结构化笔记 → 工具/版本补充 → 延伸知识点
- 小白/专业双风格，术语悬浮释义 + B站延伸视频推荐
- 笔记编辑 + Markdown/PDF 导出
- 异步任务管理（处理中/失败/已完成）
- RAG AI 问答答疑
- 飞书 OAuth 同步（云文档 + 多维表格）
- 公开分享链接

## 快速开始

### 环境要求

- Python 3.11+
- Node.js 20+
- FFmpeg

### 本地开发

```bash
# 后端 — 建议用虚拟环境
cd backend
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt    # 仅核心依赖，不含 chromadb
cp ../.env.example ../.env
# 编辑 .env 配置 LLM（转写引擎在网页设置页配置，国内推荐必剪/快手）
python main.py

# 可选：AI 问答 RAG（macOS 需先 brew install cmake）
# pip install -r requirements-optional.txt

# 前端（新开终端）
cd ../frontend
npm install
npm run dev
```

访问 http://localhost:3015

### Docker

```bash
cp .env.example .env
docker-compose up --build
```

## 文档

- [架构设计](docs/ARCHITECTURE.md)
- [API 设计](docs/API_DESIGN.md)
- [MVP 验收清单](docs/MVP_CHECKLIST.md)

## 配置

| 变量 | 说明 |
|------|------|
| GROQ_API_KEY | 仅当转写引擎选 Groq 时需要 |
| TRANSCRIBER_TYPE | 默认转写引擎（bcut/kuaishou/fast-whisper/groq），可在设置页修改 |
| FEISHU_APP_ID | 飞书开放平台 App ID |
| FEISHU_APP_SECRET | 飞书 App Secret |
| FFMPEG_BIN | FFmpeg 路径（默认 ffmpeg） |
| ENABLE_SMART_SCREENSHOTS | 智能截图开关（默认 true；纯口播/无演示画面视频可设为 false） |
| SMART_SCREENSHOT_WINDOW_SECONDS | 智能截图搜索窗口秒数（默认 5） |
| SMART_SCREENSHOT_MIN_SCORE | 智能截图最低质量分（默认 0.3；低于阈值不插图） |

LLM API Key 通过 Web 设置页配置，落库前用 Fernet（AES-128-CBC）加密，密钥由 `AUTH_SECRET_KEY` 派生。**部署前请将 `.env` 中 `AUTH_SECRET_KEY` 改为强随机字符串。**
