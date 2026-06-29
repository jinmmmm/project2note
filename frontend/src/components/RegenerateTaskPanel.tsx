import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { Loader2, RotateCcw, X } from 'lucide-react'
import { taskApi } from '@/services'
import { useLlmConfig } from '@/hooks/useLlmConfig'
import { cn } from '@/lib/utils'

// 截图模式三档：off=不截图, basic=纯算法评分选帧(快、省), enhanced=AI辅助选时间戳+算法评分(质量更高)
const SCREENSHOT_MODES = [
  {
    value: 'off',
    label: '关闭',
    description: '不含任何截图',
  },
  {
    value: 'basic',
    label: '标准',
    description: '算法选关键帧，适合 PPT',
  },
  {
    value: 'enhanced',
    label: '增强',
    description: 'AI 辅助选帧，质量更高',
  },
]

// 图片严格度：控制截图质量阈值，宽松多插图、严格只留高质量画面
const SCREENSHOT_STRICTNESS = [
  { value: 'low', label: '宽松', score: 0.2 },
  { value: 'medium', label: '标准', score: 0.3 },
  { value: 'high', label: '严格', score: 0.4 },
]

function strictnessFromScore(score?: number | null) {
  if (score == null) return 'medium'
  const exact = SCREENSHOT_STRICTNESS.find((item) => item.score === score)
  if (exact) return exact.value
  if (score <= 0.25) return 'low'
  if (score >= 0.35) return 'high'
  return 'medium'
}

function screenshotModeFromTask(task: { screenshot_mode?: string; enable_screenshots?: boolean; enable_vision_screenshot_refine?: boolean }): string {
  if (task.screenshot_mode) return task.screenshot_mode
  // 兼容旧字段：从两个 boolean 推算
  if (!task.enable_screenshots) return 'off'
  return task.enable_vision_screenshot_refine ? 'enhanced' : 'basic'
}

const STYLES = [
  { value: 'beginner', label: '小白' },
  { value: 'professional', label: '专业' },
]

type SaveMode = 'overwrite' | 'save_as_new'

interface Props {
  taskId: string
  taskTitle?: string
  initialStyle: string
  initialExtras?: string
  initialScreenshotMode?: string
  initialEnableScreenshots?: boolean
  initialEnableVisionScreenshotRefine?: boolean
  initialScreenshotMinScore?: number | null
  open: boolean
  onClose: () => void
  onSubmitted: (resultTaskId: string, saveMode: SaveMode) => void
}

function defaultCloneTitle(taskTitle: string, style: string) {
  const base = (taskTitle || '未命名视频').trim()
  const styleLabel = style === 'beginner' ? '小白' : '专业'
  return `${base}（${styleLabel}）`
}

export default function RegenerateTaskPanel({
  taskId,
  taskTitle,
  initialStyle,
  initialExtras,
  initialScreenshotMode,
  initialEnableScreenshots = true,
  initialEnableVisionScreenshotRefine = true,
  initialScreenshotMinScore,
  open,
  onClose,
  onSubmitted,
}: Props) {
  const {
    providerId,
    modelName,
    customEnabled,
    noteApiKey,
    noteBaseUrl,
    visionApiKey,
    visionBaseUrl,
    visionModelName,
  } = useLlmConfig()
  const [style, setStyle] = useState(initialStyle)
  const [extras, setExtras] = useState(initialExtras || '')
  // 优先用 screenshot_mode；兼容旧字段从两个 boolean 推算
  const resolvedScreenshotMode = initialScreenshotMode
    || screenshotModeFromTask({ enable_screenshots: initialEnableScreenshots, enable_vision_screenshot_refine: initialEnableVisionScreenshotRefine })
  const [screenshotMode, setScreenshotMode] = useState(resolvedScreenshotMode)
  const [screenshotStrictness, setScreenshotStrictness] = useState(strictnessFromScore(initialScreenshotMinScore))
  const [saveMode, setSaveMode] = useState<SaveMode>('overwrite')
  const [cloneTitle, setCloneTitle] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!open) return
    setStyle(initialStyle)
    setExtras(initialExtras || '')
    const newScreenshotMode = initialScreenshotMode
      || screenshotModeFromTask({ enable_screenshots: initialEnableScreenshots, enable_vision_screenshot_refine: initialEnableVisionScreenshotRefine })
    setScreenshotMode(newScreenshotMode)
    setScreenshotStrictness(strictnessFromScore(initialScreenshotMinScore))
    setSaveMode('overwrite')
    setCloneTitle('')
  }, [open, taskId, initialStyle, initialExtras, initialScreenshotMode, initialEnableScreenshots, initialEnableVisionScreenshotRefine, initialScreenshotMinScore])

  if (!open) return null

  const handleSubmit = async () => {
    if (!providerId || !modelName) {
      toast.error('LLM 配置加载中，请稍后再试')
      return
    }
    if (customEnabled && (!noteApiKey || !noteBaseUrl || !modelName)) {
      toast.error('请先在本地用户中填写完整的笔记生成 Key、Base URL 和模型名')
      return
    }
    setSubmitting(true)
    try {
      const userLLMPayload = customEnabled
        ? {
            user_note_api_key: noteApiKey,
            user_note_base_url: noteBaseUrl,
            user_note_model_name: modelName,
            user_vision_api_key: visionApiKey || undefined,
            user_vision_base_url: visionBaseUrl || undefined,
            user_vision_model_name: visionModelName || undefined,
          }
        : {}
      const strictness = SCREENSHOT_STRICTNESS.find((item) => item.value === screenshotStrictness) ?? SCREENSHOT_STRICTNESS[1]
      const res = await taskApi.regenerate(taskId, {
        style,
        extras: extras || undefined,
        screenshot_mode: screenshotMode,
        screenshot_min_score: screenshotMode !== 'off' ? strictness.score : undefined,
        provider_id: providerId,
        model_name: modelName,
        ...userLLMPayload,
        save_mode: saveMode,
        title: saveMode === 'save_as_new' ? (cloneTitle.trim() || undefined) : undefined,
      })
      toast.success(
        saveMode === 'save_as_new' ? '已另存为新任务，正在生成…' : '已开始重新生成笔记',
      )
      onSubmitted(res.task_id, saveMode)
      onClose()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div className="flex items-center gap-2">
            <RotateCcw className="h-4 w-4 text-blue-600" />
            <h2 className="text-sm font-semibold text-slate-800">重新生成笔记</h2>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          <p className="text-xs text-slate-500">
            将复用当前视频的逐字稿，仅重新生成结构化笔记与延伸推荐，无需再次填写链接。
          </p>

          <div>
            <label className="text-xs font-medium text-slate-700">保存方式</label>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setSaveMode('overwrite')}
                className={cn(
                  'rounded-lg border px-3 py-2 text-left text-xs transition-colors',
                  saveMode === 'overwrite'
                    ? 'border-blue-300 bg-blue-50 text-blue-700'
                    : 'border-slate-200 text-slate-600 hover:bg-slate-50',
                )}
              >
                <span className="font-medium">覆盖当前</span>
                <span className="mt-0.5 block text-[10px] opacity-80">替换本条任务的笔记</span>
              </button>
              <button
                type="button"
                onClick={() => setSaveMode('save_as_new')}
                className={cn(
                  'rounded-lg border px-3 py-2 text-left text-xs transition-colors',
                  saveMode === 'save_as_new'
                    ? 'border-blue-300 bg-blue-50 text-blue-700'
                    : 'border-slate-200 text-slate-600 hover:bg-slate-50',
                )}
              >
                <span className="font-medium">另存为新任务</span>
                <span className="mt-0.5 block text-[10px] opacity-80">保留原笔记便于对比</span>
              </button>
            </div>
          </div>

          {saveMode === 'save_as_new' && (
            <div>
              <label className="text-xs font-medium text-slate-700">新任务标题</label>
              <input
                value={cloneTitle}
                onChange={(e) => setCloneTitle(e.target.value)}
                placeholder={defaultCloneTitle(taskTitle || '', style)}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
              <p className="mt-1 text-[10px] text-slate-400">留空则使用上方占位标题</p>
            </div>
          )}

          <div>
            <label className="text-xs font-medium text-slate-700">笔记风格</label>
            <select
              value={style}
              onChange={(e) => setStyle(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            >
              {STYLES.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs font-medium text-slate-700">截图模式</label>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {SCREENSHOT_MODES.map((mode) => (
                <button
                  key={mode.value}
                  type="button"
                  onClick={() => setScreenshotMode(mode.value)}
                  className={cn(
                    'rounded-lg border px-3 py-2 text-left text-xs transition-colors',
                    screenshotMode === mode.value
                      ? 'border-blue-300 bg-blue-50 text-blue-700'
                      : 'border-slate-200 text-slate-600 hover:bg-slate-50',
                  )}
                >
                  <span className="font-medium">{mode.label}</span>
                  <span className="mt-0.5 block text-[10px] opacity-80">{mode.description}</span>
                </button>
              ))}
            </div>
            {screenshotMode !== 'off' && (
              <div className="mt-2">
                <label className="text-xs font-medium text-slate-700">图片严格度</label>
                <select
                  value={screenshotStrictness}
                  onChange={(e) => setScreenshotStrictness(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                >
                  {SCREENSHOT_STRICTNESS.map((item) => (
                    <option key={item.value} value={item.value}>{item.label}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div>
            <label className="text-xs font-medium text-slate-700">自定义 Prompt（可选）</label>
            <textarea
              value={extras}
              onChange={(e) => setExtras(e.target.value)}
              rows={3}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              placeholder="补充生成要求，例如：重点总结实操步骤"
            />
          </div>

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-lg border border-slate-200 py-2 text-sm text-slate-600 hover:bg-slate-50"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting}
              className={cn(
                'flex flex-1 items-center justify-center gap-2 rounded-lg bg-blue-600 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50',
              )}
            >
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              开始重新生成
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
