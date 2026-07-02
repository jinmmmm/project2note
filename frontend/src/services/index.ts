import api, { LONG_REQUEST_TIMEOUT, unwrap } from './api'

export interface AuthUser {
  id: string
  email: string
  username: string
  created_at?: string | null
}

export const authApi = {
  register: (data: { email: string; password: string; username?: string }) =>
    api.post('/auth/register', data).then((r) => unwrap<{ user: AuthUser }>(r)),
  login: (data: { email: string; password: string }) =>
    api.post('/auth/login', data).then((r) => unwrap<{ user: AuthUser }>(r)),
  logout: () => api.post('/auth/logout').then((r) => unwrap(r)),
  me: () => api.get('/auth/me').then((r) => unwrap<{ user: AuthUser }>(r)),
}

export interface Task {
  id: string
  status: string
  progress: string
  platform: string
  source_url?: string
  local_video_path?: string
  title?: string
  style: string
  detail_mode: string
  provider_id?: string
  model_name?: string
  error_message?: string
  extras?: string
  // 截图模式：off=不截图, basic=纯算法评分选帧, enhanced=AI辅助选时间戳+算法评分
  screenshot_mode?: 'off' | 'basic' | 'enhanced'
  screenshot_min_score?: number
  enable_screenshots?: boolean
  enable_vision_screenshot_refine?: boolean
  video_url?: string
  media_kind?: 'none' | 'video' | 'audio' | 'bilibili_embed' | 'external'
  open_url?: string
  parent_task_id?: string
  page_index?: number
  collection_id?: string
  created_at?: string
  note?: { markdown_raw?: string; markdown_edited?: string; mindmap_data?: MindmapData | null }
  transcript?: { language: string; segments: Segment[]; full_text: string }
  recommendations?: RecommendationItem[]
  share_token?: string
}

export type MindmapMode = 'origin' | 'ai_refactor'

export interface MindmapNode {
  label: string
  children?: MindmapNode[]
  detail?: string
  headingId?: string
  timestamp?: number
  color?: string
  textColor?: string
  bold?: boolean
  italic?: boolean
  highlight?: boolean
}

export interface MindmapModeData {
  tree?: MindmapNode
  edited?: boolean
  updated_at?: string
}

export interface MindmapData {
  schema_version?: number
  active_mode: MindmapMode
  sync_enabled?: boolean
  modes: Partial<Record<MindmapMode, MindmapModeData>>
}

export interface Segment {
  start: number
  end: number
  text: string
}

export interface RecommendationItem {
  topic: string
  type: string
  category_label?: string
  description?: string
  limit?: number
  videos?: { title: string; url: string; author: string; pic: string; play_count?: number }[]
}

export interface Provider {
  id: string
  name: string
  base_url: string
  enabled: string
  has_key: boolean
}

export interface UserLLMPayload {
  user_note_api_key?: string
  user_note_base_url?: string
  user_note_model_name?: string
  user_vision_api_key?: string
  user_vision_base_url?: string
  user_vision_model_name?: string
}

export interface LlmDefaults {
  provider_id: string
  provider_name: string
  base_url: string
  model_name: string
  vision_model_name: string
}

export interface ChatMessage {
  id: string
  role: string
  content: string
  sources?: unknown[]
}

export const taskApi = {
  list: (status?: string) =>
    api.get('/tasks', { params: status ? { status } : {} }).then((r) => unwrap<Task[]>(r)),
  get: (id: string) => api.get(`/tasks/${id}`).then((r) => unwrap<Task>(r)),
  status: (id: string) =>
    api.get(`/tasks/${id}/status`).then((r) =>
      unwrap<{ status: string; progress: string; error_message?: string }>(r),
    ),
  create: (data: Record<string, unknown>) =>
    api.post('/tasks', data).then((r) => unwrap<{ task_id: string; status: string }>(r)),
  batchCreate: (data: Record<string, unknown>) =>
    api.post('/tasks/batch', data).then((r) =>
      unwrap<{ task_ids: string[]; parent_task_id: string; collection_name: string }>(r),
    ),
  retry: (id: string) => api.post(`/tasks/${id}/retry`).then((r) => unwrap(r)),
  cancel: (id: string) =>
    api.post(`/tasks/${id}/cancel`).then((r) => unwrap<{ task_id: string; status: string }>(r)),
  regenerate: (id: string, data: Record<string, unknown>) =>
    api.post(`/tasks/${id}/regenerate`, data).then((r) =>
      unwrap<{ task_id: string; status: string; save_mode?: string }>(r),
    ),
  updateTitle: (id: string, title: string) =>
    api.patch(`/tasks/${id}`, { title }).then((r) => unwrap<Task>(r)),
  updateCollectionId: (id: string, collectionId: string | null) =>
    api.patch(`/tasks/${id}`, { collection_id: collectionId }).then((r) => unwrap<Task>(r)),
  delete: (id: string) => api.delete(`/tasks/${id}`).then((r) => unwrap(r)),
  updateNote: (id: string, markdown: string) =>
    api.put(`/tasks/${id}/note`, { markdown_edited: markdown }).then((r) => unwrap(r)),
  polishNote: (
    id: string,
    data: {
      scope: 'full' | 'section'
      heading_title?: string
      heading_depth?: number
      instruction?: string
    } & UserLLMPayload,
  ) =>
    api.post(`/tasks/${id}/polish`, data, { timeout: LONG_REQUEST_TIMEOUT }).then((r) =>
      unwrap<{
        task_id: string
        markdown_edited: string
        scope: string
        recommendations_refreshed?: boolean
        recommendations?: RecommendationItem[]
      }>(r),
    ),
  export: async (id: string, format: 'md' | 'pdf', title?: string) => {
    const res = await api.post(`/tasks/${id}/export`, { format, title: title || '' }, { responseType: 'blob' })
    const { readExportBlob } = await import('@/lib/download')
    return readExportBlob(res.data as Blob)
  },
  refreshRecommendations: (id: string, keywords: RecommendationItem[], prompt?: string, llmPayload: UserLLMPayload = {}) =>
    api.post(
      `/tasks/${id}/recommendations/refresh`,
      { keywords, prompt: prompt || undefined, ...llmPayload },
      { timeout: LONG_REQUEST_TIMEOUT },
    ).then((r) => unwrap<RecommendationItem[]>(r)),
  share: (id: string) =>
    api.post(`/tasks/${id}/share`).then((r) => unwrap<{ token: string; url: string }>(r)),
  saveMindmap: (id: string, data: MindmapData) =>
    api.put(`/tasks/${id}/mindmap`, data).then((r) => unwrap(r)),
  generateMindmap: (id: string, video_type?: string, force = false, instruction?: string, llmPayload: UserLLMPayload = {}) =>
    api.post(`/tasks/${id}/mindmap`, { video_type, force, instruction, ...llmPayload }, { timeout: LONG_REQUEST_TIMEOUT }).then((r) =>
      unwrap<{ task_id: string; tree: MindmapNode; mode: 'ai_refactor' }>(r),
    ),
}

export const uploadApi = {
  upload: (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return api.post('/upload/video', form).then(unwrap<{ path: string; filename: string; url: string }>)
  },
  uploadCover: (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return api.post('/upload/cover', form).then(unwrap<{ path: string; filename: string; url: string }>)
  },
}

export const settingsApi = {
  getCookie: (platform: string) =>
    api.get(`/settings/cookies/${platform}`).then((r) => unwrap<{ platform: string; cookie: string }>(r)),
  setCookie: (platform: string, cookie: string) =>
    api.put(`/settings/cookies/${platform}`, { cookie }).then((r) => unwrap(r)),
  listProviders: () => api.get('/settings/providers').then((r) => unwrap<Provider[]>(r)),
  getLlmDefault: () =>
    api.get('/settings/llm-default').then((r) => unwrap<LlmDefaults>(r)),
  saveProvider: (data: Record<string, unknown>) => api.post('/settings/providers', data).then((r) => unwrap(r)),
  deleteProvider: (id: string) => api.delete(`/settings/providers/${id}`).then((r) => unwrap(r)),
  getTranscriberConfig: () =>
    api.get('/settings/transcriber_config').then((r) =>
      unwrap<{
        transcriber_type: string
        whisper_model_size: string
        whisper_model_dir: string
        available_types: { value: string; label: string }[]
        whisper_model_sizes: string[]
      }>(r),
    ),
  saveTranscriberConfig: (data: { transcriber_type: string; whisper_model_size?: string; whisper_model_dir?: string }) =>
    api.post('/settings/transcriber_config', data).then((r) => unwrap(r)),
}

export const chatApi = {
  messages: (taskId: string) => api.get(`/chat/${taskId}/messages`).then((r) => unwrap<ChatMessage[]>(r)),
  ask: (taskId: string, question: string, providerId: string, modelName: string, enableWebSearch = false, llmPayload: UserLLMPayload = {}) =>
    api.post(`/chat/${taskId}/ask`, {
      question,
      provider_id: providerId,
      model_name: modelName,
      enable_web_search: enableWebSearch,
      ...llmPayload,
    }).then((r) =>
      unwrap<{ answer: string; sources?: unknown[] }>(r),
    ),
  clear: (taskId: string) => api.delete(`/chat/${taskId}/messages`).then((r) => unwrap(r)),
  shareMessages: (token: string, sessionId: string) =>
    api.get(`/chat/share/${token}/messages`, { params: { session_id: sessionId } }).then((r) => unwrap<ChatMessage[]>(r)),
  shareAsk: (token: string, sessionId: string, question: string, providerId: string, modelName: string, enableWebSearch = false, llmPayload: UserLLMPayload = {}) =>
    api.post(`/chat/share/${token}/ask`, {
      session_id: sessionId,
      question,
      provider_id: providerId,
      model_name: modelName,
      enable_web_search: enableWebSearch,
      ...llmPayload,
    }).then((r) =>
      unwrap<{ answer: string; sources?: unknown[] }>(r),
    ),
  shareClear: (token: string, sessionId: string) =>
    api.delete(`/chat/share/${token}/messages`, { params: { session_id: sessionId } }).then((r) => unwrap(r)),
  globalMessages: (sessionId: string) =>
    api.get('/chat/global/messages', { params: { session_id: sessionId } }).then((r) =>
      unwrap<ChatMessage[]>(r),
    ),
  globalAsk: (
    question: string,
    providerId: string,
    modelName: string,
    sessionId: string,
    taskIds: string[] = [],
    llmPayload: UserLLMPayload = {},
  ) =>
    api.post('/chat/global/ask', {
      question,
      provider_id: providerId,
      model_name: modelName,
      session_id: sessionId,
      task_ids: taskIds,
      ...llmPayload,
    }).then((r) => unwrap<{ answer: string; sources?: unknown[] }>(r)),
  clearGlobal: (sessionId: string) =>
    api.delete('/chat/global/messages', { params: { session_id: sessionId } }).then((r) => unwrap(r)),
}

export const feishuApi = {
  appConfig: () =>
    api.get('/feishu/app-config').then((r) =>
      unwrap<{
        app_id: string
        has_secret: boolean
        redirect_uri: string
        configured: boolean
        default_folder_token?: string
        default_folder_name?: string
      }>(r),
    ),
  saveAppConfig: (data: { app_id: string; app_secret: string; redirect_uri?: string }) =>
    api.put('/feishu/app-config', data).then((r) =>
      unwrap<{
        app_id: string
        has_secret: boolean
        redirect_uri: string
        configured: boolean
        default_folder_token?: string
        default_folder_name?: string
      }>(r),
    ),
  saveSyncFolder: (data: { folder_token: string; folder_name: string }) =>
    api.put('/feishu/sync-folder', data).then((r) =>
      unwrap<{ default_folder_token: string; default_folder_name: string }>(r),
    ),
  authUrl: () => api.get('/feishu/auth-url').then((r) => unwrap<{ url: string }>(r)),
  status: () =>
    api.get('/feishu/status').then((r) =>
      unwrap<{
        authorized: boolean
        configured: boolean
        redirect_uri?: string
        default_folder_token?: string
        default_folder_name?: string
      }>(r),
    ),
  folders: (parentToken?: string) =>
    api.get('/feishu/folders', { params: parentToken ? { parent_token: parentToken } : {} }).then((r) =>
      unwrap<{ parent_token: string; parent_name: string; folders: { token: string; name: string }[] }>(r),
    ),
  sync: (taskId: string, data: Record<string, string>) =>
    api.post(`/feishu/sync/${taskId}`, data).then((r) =>
      unwrap<{ doc_url?: string; bitable_record_id?: string; content_warning?: string }>(r),
    ),
}

export interface ShareData {
  title: string
  platform?: string
  source_url?: string
  video_url?: string
  media_kind?: 'none' | 'video' | 'audio' | 'bilibili_embed' | 'external'
  open_url?: string
  style?: string
  provider_id?: string
  model_name?: string
  note: { markdown: string }
  transcript: { segments: Segment[] }
  recommendations?: RecommendationItem[]
}

export const shareApi = {
  get: (token: string) => api.get(`/share/${token}`).then((r) => unwrap<ShareData>(r)),
}

export const healthApi = {
  check: () => api.get('/health').then(unwrap),
}

export interface BilibiliPageInfo {
  page: number
  part: string
  duration: number
  cid: number
}

export interface BilibiliVideoInfo {
  bvid: string
  title: string
  total_pages: number
  pages: BilibiliPageInfo[]
}

export const bilibiliApi = {
  videoInfo: (url: string) =>
    api.get('/bilibili/video-info', { params: { url } }).then((r) => unwrap<BilibiliVideoInfo>(r)),
}

export interface KnowledgeCardData {
  id: string
  task_id: string
  style: string
  sort_order: number
  front_title: string
  front_subtitle: string | null
  back_content: string
  back_pitfalls: string | null
  personal_notes: string | null
  review_status: 'none' | 'mastered' | 'needs_review'
  source_heading: string | null
  source_term: string | null
}

export const cardsApi = {
  list: (taskId: string) =>
    api.get(`/tasks/${taskId}/cards`).then((r) => unwrap<KnowledgeCardData[]>(r)),
  create: (taskId: string, data: { front_title: string; front_subtitle?: string; back_content?: string; back_pitfalls?: string }) =>
    api.post(`/tasks/${taskId}/cards`, data).then((r) => unwrap<KnowledgeCardData>(r)),
  update: (taskId: string, cardId: string, data: Partial<Pick<KnowledgeCardData, 'front_title' | 'front_subtitle' | 'back_content' | 'back_pitfalls' | 'personal_notes' | 'review_status' | 'sort_order'>>) =>
    api.put(`/tasks/${taskId}/cards/${cardId}`, data).then((r) => unwrap<KnowledgeCardData>(r)),
  delete: (taskId: string, cardId: string) =>
    api.delete(`/tasks/${taskId}/cards/${cardId}`).then((r) => unwrap(r)),
  updateReview: (taskId: string, cardId: string, reviewStatus: KnowledgeCardData['review_status']) =>
    api.patch(`/tasks/${taskId}/cards/${cardId}/review`, { review_status: reviewStatus }).then((r) => unwrap<KnowledgeCardData>(r)),
  generate: (taskId: string, style?: string, force = false) =>
    api.post(`/tasks/${taskId}/cards/generate`, { style, force }, { timeout: LONG_REQUEST_TIMEOUT }).then((r) => unwrap<KnowledgeCardData[]>(r)),
}
