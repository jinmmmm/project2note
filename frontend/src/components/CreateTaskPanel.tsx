import { useCallback, useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { Clock, FileVideo, Link2, Loader2, RotateCcw, Trash2, Upload } from 'lucide-react'
import { taskApi, uploadApi, bilibiliApi } from '@/services'
import type { Task, BilibiliPageInfo } from '@/services'
import { useLlmConfig } from '@/hooks/useLlmConfig'
import { useCollectionStore } from '@/store/collectionStore'
import { cn } from '@/lib/utils'

const PLATFORMS = [
  { value: 'bilibili', label: 'B站' },
  { value: 'douyin', label: '抖音' },
  { value: 'local', label: '本地视频' },
]

const STYLES = [
  { value: 'beginner', label: '小白' },
  { value: 'professional', label: '专业' },
]

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

const readOnlyFieldClass =
  'disabled:cursor-default disabled:border-slate-200 disabled:bg-slate-50 disabled:text-slate-600'

function scoreToStrictness(score?: number | null): string {
  if (score == null) return 'medium'
  const match = SCREENSHOT_STRICTNESS.find((item) => item.score === score)
  if (match) return match.value
  if (score <= 0.25) return 'low'
  if (score <= 0.35) return 'medium'
  return 'high'
}

function screenshotModeFromTask(task: { screenshot_mode?: string; enable_screenshots?: boolean; enable_vision_screenshot_refine?: boolean }): string {
  if (task.screenshot_mode) return task.screenshot_mode
  // 兼容旧字段：从两个 boolean 推算
  if (!task.enable_screenshots) return 'off'
  return task.enable_vision_screenshot_refine ? 'enhanced' : 'basic'
}

interface Props {
  embedded?: boolean
  open?: boolean
  onClose?: () => void
  onCreated: (taskId: string) => void | Promise<void>
  resumeTaskId?: string | null
  onDeleted?: (taskId: string) => void | Promise<void>
}

export default function CreateTaskPanel({
  embedded,
  open = true,
  onClose,
  onCreated,
  resumeTaskId = null,
  onDeleted,
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
  const { collections, addCollection, assignTask } = useCollectionStore()
  const [platform, setPlatform] = useState('bilibili')
  const [title, setTitle] = useState('')
  const [videoUrl, setVideoUrl] = useState('')
  const [localPath, setLocalPath] = useState('')
  const [style, setStyle] = useState('beginner')
  const [extras, setExtras] = useState('')
  const [screenshotMode, setScreenshotMode] = useState<string>('enhanced')
  const [screenshotStrictness, setScreenshotStrictness] = useState('medium')
  const [targetCollectionId, setTargetCollectionId] = useState<string>('')
  const [newCollectionName, setNewCollectionName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [loadingResume, setLoadingResume] = useState(false)
  const [resumeTask, setResumeTask] = useState<Task | null>(null)
  // 分P检测状态
  const [detectingPages, setDetectingPages] = useState(false)
  const [bilibiliPages, setBilibiliPages] = useState<BilibiliPageInfo[]>([])
  const [selectedPages, setSelectedPages] = useState<Set<number>>(new Set())
  const [detectedTitle, setDetectedTitle] = useState('')
  const detectAbortRef = useRef<AbortController | null>(null)

  const readOnly = !!resumeTaskId && !!resumeTask

  const resetForm = useCallback(() => {
    setPlatform('bilibili')
    setTitle('')
    setVideoUrl('')
    setLocalPath('')
    setStyle('beginner')
    setExtras('')
    setScreenshotMode('enhanced')
    setScreenshotStrictness('medium')
    setTargetCollectionId('')
    setNewCollectionName('')
    setResumeTask(null)
    setBilibiliPages([])
    setSelectedPages(new Set())
    setDetectedTitle('')
  }, [])

  const applyTaskToForm = useCallback((task: Task) => {
    setPlatform(task.platform || 'bilibili')
    setTitle(task.title || '')
    setVideoUrl(task.source_url || '')
    setLocalPath(task.local_video_path || '')
    setStyle(task.style || 'beginner')
    setExtras(task.extras || '')
    setScreenshotMode(screenshotModeFromTask(task))
    setScreenshotStrictness(scoreToStrictness(task.screenshot_min_score))
    setResumeTask(task)
  }, [])

  useEffect(() => {
    if (!resumeTaskId) {
      resetForm()
      return
    }

    let cancelled = false
    setLoadingResume(true)
    taskApi
      .get(resumeTaskId)
      .then((task) => {
        if (cancelled) return
        if (task.status !== 'CANCELED' && task.status !== 'FAILED') {
          resetForm()
          return
        }
        applyTaskToForm(task)
      })
      .catch((e) => {
        if (!cancelled) toast.error((e as Error).message)
      })
      .finally(() => {
        if (!cancelled) setLoadingResume(false)
      })

    return () => {
      cancelled = true
    }
  }, [resumeTaskId, resetForm, applyTaskToForm])

  const detectBilibiliPages = useCallback(async (url: string) => {
    if (!url.trim() || !url.includes('BV')) {
      setBilibiliPages([])
      setSelectedPages(new Set())
      setDetectedTitle('')
      return
    }
    detectAbortRef.current?.abort()
    detectAbortRef.current = new AbortController()
    setDetectingPages(true)
    try {
      const info = await bilibiliApi.videoInfo(url)
      if (info.total_pages > 1) {
        setBilibiliPages(info.pages)
        setSelectedPages(new Set(info.pages.map((p) => p.page)))
        setDetectedTitle(info.title)
      } else {
        setBilibiliPages([])
        setSelectedPages(new Set())
        setDetectedTitle('')
      }
    } catch {
      setBilibiliPages([])
      setSelectedPages(new Set())
      setDetectedTitle('')
    } finally {
      setDetectingPages(false)
    }
  }, [])

  const handleUrlBlur = () => {
    if (platform === 'bilibili' && !readOnly) {
      detectBilibiliPages(videoUrl)
    }
  }

  const togglePage = (page: number) => {
    setSelectedPages((prev) => {
      const next = new Set(prev)
      if (next.has(page)) {
        next.delete(page)
      } else {
        next.add(page)
      }
      return next
    })
  }

  const toggleAllPages = () => {
    if (selectedPages.size === bilibiliPages.length) {
      setSelectedPages(new Set())
    } else {
      setSelectedPages(new Set(bilibiliPages.map((p) => p.page)))
    }
  }

  const handleUpload = async (file: File) => {
    setUploading(true)
    try {
      const res = await uploadApi.upload(file)
      setLocalPath(res.path)
      setPlatform('local')
      toast.success('上传成功')
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setUploading(false)
    }
  }

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
    const basePayload = {
      platform,
      title: title.trim() || undefined,
      local_path: platform === 'local' ? localPath : undefined,
      style,
      extras: extras || undefined,
      screenshot_mode: screenshotMode,
      screenshot_min_score: screenshotMode !== 'off' ? strictness.score : undefined,
      provider_id: providerId,
      model_name: modelName,
      ...userLLMPayload,
    }

    // 多P批量创建
    const isMultiPage = platform === 'bilibili' && bilibiliPages.length > 1 && selectedPages.size > 0
    if (isMultiPage) {
      const pagesToCreate = bilibiliPages.filter((p) => selectedPages.has(p.page))
      const collectionName = title.trim() || detectedTitle || `B站合集`
      try {
        const baseUrl = videoUrl.replace(/[?&]p=\d+/, '')
        const videoUrls = pagesToCreate.map((p) =>
          `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}p=${p.page}`
        )
        const pageTitles = pagesToCreate.map((p) => p.part || '')
        const res = await taskApi.batchCreate({
          platform,
          collection_name: collectionName,
          video_urls: videoUrls,
          page_titles: pageTitles,
          style,
          extras: extras || undefined,
          screenshot_mode: screenshotMode,
          screenshot_min_score: screenshotMode !== 'off' ? strictness.score : undefined,
          provider_id: providerId,
          model_name: modelName,
          ...userLLMPayload,
          target_collection_id: targetCollectionId || undefined,
        })
        toast.success(`已创建 ${res.task_ids.length} 份合集笔记，命名格式：${collectionName} - 第N集`, { duration: 5000 })
        await onCreated(res.parent_task_id)
        onClose?.()
        resetForm()
      } catch (e) {
        toast.error((e as Error).message)
      } finally {
        setSubmitting(false)
      }
      return
    }

    // 单P / 非B站
    try {
      const res = await taskApi.create({
        ...basePayload,
        video_url: platform !== 'local' ? videoUrl : undefined,
      })
      // 归入合集
      if (targetCollectionId === '__new__' && newCollectionName.trim()) {
        const col = addCollection(newCollectionName.trim())
        assignTask(res.task_id, col.id)
      } else if (targetCollectionId) {
        assignTask(res.task_id, targetCollectionId)
      }
      toast.success('任务已提交，正在处理中…', { duration: 4000 })
      await onCreated(res.task_id)
      onClose?.()
      resetForm()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  const handleRestart = async () => {
    if (!resumeTaskId) return
    setSubmitting(true)
    try {
      await taskApi.retry(resumeTaskId)
      toast.success('已重新提交，正在处理…')
      await onCreated(resumeTaskId)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async () => {
    if (!resumeTaskId || !resumeTask) return
    if (!window.confirm(`确定删除「${resumeTask.title || '未命名任务'}」？`)) return
    setSubmitting(true)
    try {
      await taskApi.delete(resumeTaskId)
      toast.success('已删除')
      resetForm()
      await onDeleted?.(resumeTaskId)
      onClose?.()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  if (!embedded && !open) return null

  const form = (
    <div className={cn('space-y-4', embedded && 'p-8')}>
      {readOnly && resumeTask && (
        <div
          className={cn(
            'rounded-lg border px-4 py-3 text-sm',
            resumeTask.status === 'CANCELED'
              ? 'border-amber-200 bg-amber-50 text-amber-900'
              : 'border-red-200 bg-red-50 text-red-900',
          )}
        >
          <p className="font-medium">
            {resumeTask.status === 'CANCELED' ? '任务已停止' : '笔记生成失败'}
          </p>
          {resumeTask.error_message && (
            <p className="mt-1 text-xs opacity-90">{resumeTask.error_message}</p>
          )}
          <p className="mt-2 text-xs opacity-80">
            以下为提交时的配置（只读）。已完成的阶段会保留，点击「重新开始」将从断点续跑。
          </p>
        </div>
      )}

      {loadingResume && (
        <div className="flex items-center justify-center gap-2 py-6 text-sm text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          加载任务配置…
        </div>
      )}

      {!loadingResume && (
        <>
          <div>
            <label className="text-sm font-medium text-slate-700">平台</label>
            <select
              value={platform}
              disabled={readOnly}
              onChange={(e) => setPlatform(e.target.value)}
              className={cn(
                'mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm',
                readOnlyFieldClass,
              )}
            >
              {PLATFORMS.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-sm font-medium text-slate-700">笔记标题（可选）</label>
            <input
              value={title}
              disabled={readOnly}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="留空则使用视频原标题"
              className={cn(
                'mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm',
                readOnlyFieldClass,
              )}
            />
          </div>

          {!readOnly && (
            <div>
              <label className="text-sm font-medium text-slate-700">加入合集（可选）</label>
              <select
                value={targetCollectionId}
                onChange={(e) => {
                  setTargetCollectionId(e.target.value)
                  if (e.target.value !== '__new__') setNewCollectionName('')
                }}
                className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              >
                <option value="">不归入合集</option>
                {collections.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
                <option value="__new__">+ 新建合集…</option>
              </select>
              {targetCollectionId === '__new__' && (
                <input
                  autoFocus
                  value={newCollectionName}
                  onChange={(e) => setNewCollectionName(e.target.value)}
                  placeholder="输入合集名称"
                  className="mt-1.5 w-full rounded-lg border border-blue-300 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
                />
              )}
            </div>
          )}

          {platform === 'local' ? (
            <div>
              <label className="text-sm font-medium text-slate-700">本地视频/音频</label>
              {readOnly ? (
                <input
                  value={localPath}
                  disabled
                  className={cn(
                    'mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm',
                    readOnlyFieldClass,
                  )}
                />
              ) : (
                <label className="mt-1.5 flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-500 hover:bg-slate-50">
                  <Upload className="h-5 w-5 shrink-0" />
                  {uploading ? '上传中...' : localPath || '选择 mp4 / mov / m4a 文件'}
                  <input
                    type="file"
                    accept=".mp4,.mov,.m4a"
                    className="hidden"
                    onChange={(e) => e.target.files?.[0] && handleUpload(e.target.files[0])}
                  />
                </label>
              )}
            </div>
          ) : (
            <div>
              <label className="text-sm font-medium text-slate-700">视频链接</label>
              <div className="mt-1.5 flex gap-2">
                <Link2 className="mt-2.5 h-4 w-4 shrink-0 text-slate-400" />
                <input
                  value={videoUrl}
                  disabled={readOnly}
                  onChange={(e) => setVideoUrl(e.target.value)}
                  onBlur={handleUrlBlur}
                  placeholder={
                    platform === 'douyin'
                      ? '粘贴抖音单视频分享链接，如 v.douyin.com/xxxxx/'
                      : '粘贴 B 站视频链接...'
                  }
                  className={cn(
                    'flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm',
                    readOnlyFieldClass,
                  )}
                />
              </div>
              {platform === 'douyin' && !readOnly && (
                <p className="mt-1.5 text-[10px] leading-relaxed text-slate-400">
                  请通过抖音「分享 → 复制链接」获取单条视频短链（如{' '}
                  <span className="font-mono text-slate-500">v.douyin.com/xxxxx/</span>
                  ）；
                  <br />
                  不支持首页推荐流（如{' '}
                  <span className="font-mono text-slate-500">douyin.com/?recommend=1</span>
                  ），也不要粘贴整段分享文案。
                </p>
              )}
              {platform === 'bilibili' && !readOnly && detectingPages && (
                <p className="mt-1.5 flex items-center gap-1.5 text-[10px] text-slate-400">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  检测视频信息…
                </p>
              )}
              {platform === 'bilibili' && !readOnly && bilibiliPages.length > 1 && (
                <div className="mt-2 rounded-lg border border-blue-100 bg-blue-50 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-medium text-blue-700">
                      检测到 {bilibiliPages.length}P 视频，选择要生成的集数
                    </span>
                    <button
                      type="button"
                      onClick={toggleAllPages}
                      className="text-[10px] text-blue-600 hover:underline"
                    >
                      {selectedPages.size === bilibiliPages.length ? '取消全选' : '全选'}
                    </button>
                  </div>
                  {selectedPages.size > 1 && (
                    <p className="mb-2 flex items-center gap-1 text-[11px] text-blue-600">
                      <Clock className="h-3 w-3" />
                      多集笔记会逐个转写语音（转写 API 限流保护），整体耗时比单集更长，请耐心等待。
                    </p>
                  )}
                  <div className="max-h-40 space-y-1 overflow-y-auto">
                    {bilibiliPages.map((p) => (
                      <label key={p.page} className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 hover:bg-blue-100">
                        <input
                          type="checkbox"
                          checked={selectedPages.has(p.page)}
                          onChange={() => togglePage(p.page)}
                          className="h-3.5 w-3.5 accent-blue-600"
                        />
                        <span className="text-[11px] text-slate-700">
                          P{p.page}
                          {p.part && p.part !== `P${p.page}` && (
                            <span className="ml-1 text-slate-500">· {p.part}</span>
                          )}
                          {p.duration > 0 && (
                            <span className="ml-1 text-slate-400">
                              ({Math.floor(p.duration / 60)}:{String(p.duration % 60).padStart(2, '0')})
                            </span>
                          )}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <div>
            <label className="text-sm font-medium text-slate-700">笔记风格</label>
            <select
              value={style}
              disabled={readOnly}
              onChange={(e) => setStyle(e.target.value)}
              className={cn(
                'mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm',
                readOnlyFieldClass,
              )}
            >
              {STYLES.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
            {!readOnly && (
              <p className="mt-1 text-[10px] leading-relaxed text-slate-400">
                默认均为 4 章结构；小白版强调工具链接表快查，专业版强调高阶拓展。
              </p>
            )}
          </div>

          <div>
            <label className="text-sm font-medium text-slate-700">截图模式</label>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {SCREENSHOT_MODES.map((mode) => (
                <button
                  key={mode.value}
                  type="button"
                  disabled={readOnly}
                  onClick={() => setScreenshotMode(mode.value)}
                  className={cn(
                    'rounded-lg border px-3 py-2 text-left text-xs transition-colors',
                    screenshotMode === mode.value
                      ? 'border-blue-300 bg-blue-50 text-blue-700'
                      : 'border-slate-200 text-slate-600 hover:bg-slate-50',
                    readOnly && 'cursor-default',
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
                  disabled={readOnly}
                  onChange={(e) => setScreenshotStrictness(e.target.value)}
                  className={cn(
                    'mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm',
                    readOnlyFieldClass,
                  )}
                >
                  {SCREENSHOT_STRICTNESS.map((item) => (
                    <option key={item.value} value={item.value}>{item.label}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div>
            <label className="text-sm font-medium text-slate-700">自定义 Prompt（可选）</label>
            <textarea
              value={extras}
              disabled={readOnly}
              onChange={(e) => setExtras(e.target.value)}
              rows={3}
              className={cn(
                'mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm',
                readOnlyFieldClass,
              )}
              placeholder="补充生成要求，例如：重点总结实操步骤、需要更详细/更精简"
            />
          </div>

          {readOnly ? (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleRestart}
                disabled={submitting}
                className={cn(
                  'flex flex-1 items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-medium text-white',
                  'bg-blue-600 hover:bg-blue-700 disabled:opacity-50',
                )}
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                重新开始
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={submitting}
                className="flex items-center justify-center gap-1.5 rounded-lg border border-red-200 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4" />
                删除
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting}
              className={cn(
                'flex w-full items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-medium text-white',
                'bg-blue-600 hover:bg-blue-700 disabled:opacity-50',
              )}
            >
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {bilibiliPages.length > 1 && selectedPages.size > 0
                ? `生成合集笔记（${selectedPages.size}集）`
                : '生成笔记'}
            </button>
          )}
        </>
      )}
    </div>
  )

  if (embedded) {
    return (
      <div className="h-full min-h-0 overflow-y-auto bg-white">
        <div className="mx-auto flex w-full max-w-xl flex-col items-center px-6 py-8">
          <div className="mb-6 flex flex-col items-center">
            <div className="flex items-center justify-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50">
                <FileVideo className="h-5 w-5 text-blue-600" />
              </div>
              <h1 className="text-xl font-semibold text-slate-800">
                {readOnly ? '继续任务' : '新建笔记'}
              </h1>
            </div>
            <p className="mt-3 text-center text-sm text-slate-500">
              {readOnly
                ? '确认下方链接与配置后，点击「重新开始」从断点续跑'
                : '提交 B 站 / 抖音链接或本地视频，AI 将生成结构化笔记'}
            </p>
          </div>
          <div className="w-full rounded-2xl border border-slate-200 bg-white shadow-sm">
            {form}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3 border-b border-slate-200 bg-white p-4 shadow-sm">
      {form}
    </div>
  )
}
