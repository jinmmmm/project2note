export const TASK_PROGRESS_LABEL: Record<string, string> = {
  queued: '排队中',
  fetching_subtitle: '获取 B 站字幕',
  subtitle_ok: '字幕获取成功',
  downloading: '下载音视频',
  download_skipped: '跳过下载（使用字幕）',
  extracting_audio: '提取音频',
  transcribing: '语音转写',
  transcribing_skipped: '跳过转写（使用字幕）',
  generating_note: '生成结构化笔记',
  web_search: '联网补充信息',
  install_repair: '补全安装与下载细节',
  generating_cards: '生成知识卡片',
  recommendations: '搜索延伸视频',
  indexing: '建立索引',
  done: '已完成',
}

const BEGINNER_PROGRESS_LABEL: Partial<Record<string, string>> = {
  web_search: '联网补充工具信息',
  install_repair: '补全安装与下载细节',
}

const PROFESSIONAL_PROGRESS_LABEL: Partial<Record<string, string>> = {
  web_search: '补充最新版本信息',
}

/** Canonical pipeline order for comparing step position. */
export const PIPELINE_STEP_ORDER = [
  'queued',
  'fetching_subtitle',
  'subtitle_ok',
  'downloading',
  'download_skipped',
  'extracting_audio',
  'transcribing',
  'transcribing_skipped',
  'generating_note',
  'web_search',
  'install_repair',
  'generating_cards',
  'recommendations',
  'indexing',
  'done',
] as const

const PLATFORM_SUBTITLE_LABEL: Record<string, string> = {
  bilibili: '获取 B 站字幕',
  douyin: '获取抖音字幕',
  local: '获取本地字幕',
}

function isStepAtOrAfter(step: string, target: string): boolean {
  const order = PIPELINE_STEP_ORDER as readonly string[]
  const stepIdx = order.indexOf(step)
  const targetIdx = order.indexOf(target)
  if (stepIdx < 0 || targetIdx < 0) return false
  return stepIdx >= targetIdx
}

/** Map sub-progress (e.g. generating_note:2/4, transcribing_fallback_1) to pipeline step key. */
export function normalizeProgressStep(progress?: string): string {
  if (!progress) return 'queued'
  if (progress.startsWith('transcribing_fallback')) return 'transcribing'
  if (progress === 'generating_note:merge' || progress.startsWith('generating_note:')) {
    return 'generating_note'
  }
  return progress
}

/** Build visible steps for the task detail progress UI (platform + path aware). */
export function getPipelineSteps(platform?: string, progress?: string): string[] {
  const normalized = normalizeProgressStep(progress)
  const steps: string[] = []

  if (platform === 'bilibili') {
    steps.push('fetching_subtitle', 'subtitle_ok')
  }

  steps.push('downloading')

  const skippedTranscribe =
    normalized === 'transcribing_skipped' ||
    (platform === 'bilibili' && isStepAtOrAfter(normalized, 'generating_note'))

  if (skippedTranscribe) {
    steps.push('transcribing_skipped')
  } else {
    steps.push('extracting_audio', 'transcribing')
  }

  steps.push(
    'generating_note',
    'web_search',
    'install_repair',
    'generating_cards',
    'recommendations',
    'indexing',
    'done',
  )

  return steps
}

export function getProgressStepIndex(steps: string[], progress?: string): number {
  const normalized = normalizeProgressStep(progress)
  const direct = steps.indexOf(normalized)
  if (direct >= 0) return direct

  const order = PIPELINE_STEP_ORDER as readonly string[]
  const progressOrder = order.indexOf(normalized)
  if (progressOrder < 0) return 0

  for (let i = steps.length - 1; i >= 0; i -= 1) {
    const stepOrder = order.indexOf(steps[i])
    if (stepOrder >= 0 && stepOrder <= progressOrder) return i
  }
  return 0
}

export function getProgressPercent(steps: string[], progress?: string): number {
  if (steps.length <= 1) return 0
  const currentIndex = getProgressStepIndex(steps, progress)
  return Math.round((currentIndex / (steps.length - 1)) * 100)
}

export function getTaskProgressLabel(
  progress?: string,
  style: 'beginner' | 'professional' = 'beginner',
  platform?: string,
): string {
  if (!progress) return '处理中'

  const fallbackMatch = progress.match(/^transcribing_fallback_(\d+)$/)
  if (fallbackMatch) {
    return `语音转写（备用引擎 ${fallbackMatch[1]}）`
  }

  if (progress === 'generating_note:merge') {
    return '生成笔记（合并片段）'
  }

  const chunkMatch = progress.match(/^generating_note:(\d+)\/(\d+)$/)
  if (chunkMatch) {
    const current = chunkMatch[1]
    const total = chunkMatch[2]
    if (total === '1') return '生成结构化笔记'
    return `生成笔记（第 ${current}/${total} 步）`
  }

  if (progress === 'fetching_subtitle' && platform) {
    return PLATFORM_SUBTITLE_LABEL[platform] ?? '获取字幕'
  }

  const styleLabels = style === 'professional' ? PROFESSIONAL_PROGRESS_LABEL : BEGINNER_PROGRESS_LABEL
  return styleLabels[progress] || TASK_PROGRESS_LABEL[progress] || progress
}

export const TASK_STATUS_LABEL: Record<string, string> = {
  PENDING: '排队中',
  PROCESSING: '处理中',
  COMPLETED: '已完成',
  FAILED: '失败',
}
