# API 设计文档

> Base URL: `http://localhost:8483/api`  
> 响应格式：统一 `ResponseWrapper`

## 1. 通用响应格式

```json
{
  "code": 0,
  "message": "success",
  "data": { }
}
```

### 错误码

| code | 说明 |
|------|------|
| 0 | 成功 |
| 400 | 请求参数错误 |
| 404 | 资源不存在 |
| 500 | 服务器内部错误 |
| 1001 | 平台不支持 |
| 1002 | Cookie 失效 |
| 1003 | 视频解析失败 |
| 1004 | 转写失败 |
| 1005 | LLM 生成失败 |
| 1006 | 飞书未授权 |
| 1007 | 分享链接无效 |

---

## 2. 任务 API

### POST /tasks

创建笔记生成任务。

**Request:**
```json
{
  "platform": "bilibili | douyin | local",
  "video_url": "https://...",
  "local_path": "/data/uploads/xxx.mp4",
  "style": "beginner | professional",
  "detail_mode": "detailed | minimal",
  "extras": "自定义 prompt 补充",
  "provider_id": "uuid",
  "model_name": "gpt-4o-mini"
}
```

**Response:**
```json
{
  "code": 0,
  "data": { "task_id": "uuid", "status": "PENDING" }
}
```

### GET /tasks

任务列表，支持状态筛选。

**Query:** `status=PROCESSING|FAILED|COMPLETED`（可选）

**Response:**
```json
{
  "code": 0,
  "data": [
    {
      "id": "uuid",
      "status": "COMPLETED",
      "platform": "bilibili",
      "title": "视频标题",
      "style": "beginner",
      "detail_mode": "detailed",
      "error_message": null,
      "created_at": "2026-06-07T10:00:00",
      "updated_at": "2026-06-07T10:05:00"
    }
  ]
}
```

### GET /tasks/{task_id}

任务详情（含笔记、逐字稿、推荐）。

### GET /tasks/{task_id}/status

轮询任务状态与进度。

**Response:**
```json
{
  "code": 0,
  "data": {
    "status": "PROCESSING",
    "progress": "fetching_subtitle | subtitle_ok | extracting_audio | transcribing | transcribing_skipped | generating_note | ...",
    "error_message": null
  }
}
```

### POST /tasks/{task_id}/retry

手动重试失败任务。

### DELETE /tasks/{task_id}

删除任务及相关数据。

---

## 3. 上传 API

### POST /upload

上传本地视频（mp4/mov）。

**Request:** `multipart/form-data`, field `file`

**Response:**
```json
{
  "code": 0,
  "data": { "path": "uploads/xxx.mp4", "filename": "xxx.mp4" }
}
```

---

## 4. 笔记 API

### PUT /tasks/{task_id}/note

保存用户编辑后的笔记。

**Request:**
```json
{ "markdown_edited": "# 编辑后的内容..." }
```

### POST /tasks/{task_id}/export

导出笔记。

**Request:**
```json
{ "format": "md | pdf" }
```

**Response:** 文件流下载

---

## 5. 推荐 API

### POST /tasks/{task_id}/recommendations/refresh

刷新 B 站延伸推荐。

**Request:**
```json
{
  "keywords": [
    { "topic": "React Hooks", "type": "prerequisite" },
    { "topic": "Next.js", "type": "advanced" }
  ]
}
```

---

## 6. 问答 API

### GET /chat/{task_id}/messages

获取聊天记录。

### POST /chat/{task_id}/ask

发送问题。

**Request:**
```json
{
  "question": "这个视频讲了什么？",
  "provider_id": "uuid",
  "model_name": "gpt-4o-mini"
}
```

**Response:**
```json
{
  "code": 0,
  "data": {
    "answer": "...",
    "sources": [{ "source_type": "transcript", "start_time": 120 }]
  }
}
```

### DELETE /chat/{task_id}/messages

清空聊天记录。

---

## 7. 设置 API

### GET /settings/cookies/{platform}

获取平台 Cookie。

### PUT /settings/cookies/{platform}

**Request:** `{ "cookie": "SESSDATA=..." }`

B 站 Cookie 用途：视频下载（yt-dlp）、官方字幕拉取（player API，AI 字幕需登录态）、延伸视频搜索。

### GET /settings/transcriber_config

获取当前转写引擎配置。

**Response:**
```json
{
  "code": 0,
  "data": {
    "transcriber_type": "bcut",
    "whisper_model_size": "tiny",
    "available_types": [
      { "value": "bcut", "label": "必剪（在线，国内推荐）" },
      { "value": "kuaishou", "label": "快手（在线，国内）" },
      { "value": "fast-whisper", "label": "Whisper 本地（fast-whisper）" },
      { "value": "groq", "label": "Groq 在线（Whisper API，需翻墙）" }
    ],
    "whisper_model_sizes": ["tiny", "base", "small", "medium", "large-v3"]
  }
}
```

配置持久化于 `data/config/transcriber.json`；未保存时回退环境变量 `TRANSCRIBER_TYPE`（默认 `bcut`）。

### POST /settings/transcriber_config

更新转写引擎。

**Request:**
```json
{
  "transcriber_type": "bcut",
  "whisper_model_size": "tiny"
}
```

`whisper_model_size` 仅在 `transcriber_type=fast-whisper` 时生效。

### GET /settings/providers

LLM 供应商列表。

### POST /settings/providers

新增/更新供应商。

---

## 8. 飞书 API

### GET /feishu/auth-url

获取 OAuth 授权 URL。

### GET /feishu/callback

OAuth 回调（浏览器重定向）。

### GET /feishu/status

授权状态。

### GET /feishu/folders

云空间文件夹列表。

**Query:** `parent_token`（可选）

### POST /feishu/sync/{task_id}

同步笔记到飞书。

**Request:**
```json
{
  "folder_token": "xxx",
  "bitable_app_token": "xxx",
  "bitable_table_id": "xxx"
}
```

**Response:**
```json
{
  "code": 0,
  "data": {
    "doc_url": "https://...",
    "bitable_record_id": "recxxx"
  }
}
```

---

## 9. 分享 API

### POST /tasks/{task_id}/share

生成公开分享链接。

**Response:**
```json
{
  "code": 0,
  "data": {
    "token": "uuid",
    "url": "http://localhost:3015/share/uuid"
  }
}
```

### GET /share/{token}

公开只读数据（无需认证）。

**Response:** 完整任务数据（笔记、逐字稿、推荐）

---

## 10. 健康检查

### GET /health

```json
{ "code": 0, "data": { "status": "ok", "ffmpeg": true } }
```
