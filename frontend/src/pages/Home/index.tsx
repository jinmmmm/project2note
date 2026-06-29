import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Settings, Upload, Link2, Loader2 } from 'lucide-react'
import { taskApi, uploadApi, settingsApi } from '@/services'
import { useAppStore } from '@/store/appStore'
import { useLlmConfig } from '@/hooks/useLlmConfig'
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
  { value: 'off', label: '关闭', description: '笔记中不包含任何视频截图' },
  { value: 'basic', label: '标准', description: '自动抽取关键帧，按画面质量评分筛选' },
  { value: 'enhanced', label: '增强', description: 'AI 先看候选帧选最佳时刻，再评分筛选' },
]

// 图片严格度：控制截图质量阈值，宽松多插图、严格只留高质量画面
const SCREENSHOT_STRICTNESS = [
  { value: 'low', label: '宽松', score: 0.2 },
  { value: 'medium', label: '标准', score: 0.3 },
  { value: 'high', label: '严格', score: 0.4 },
]

export default function HomePage() {
  const { tasks, setTasks, setSelectedTaskId, setProviders, setLlmDefaults } = useAppStore()
  const { providerId, modelName } = useLlmConfig()
  const [platform, setPlatform] = useState('bilibili')
  const [title, setTitle] = useState('')
  const [videoUrl, setVideoUrl] = useState('')
  const [localPath, setLocalPath] = useState('')
  const [style, setStyle] = useState('beginner')
  const [extras, setExtras] = useState('')
  const [screenshotMode, setScreenshotMode] = useState('enhanced')
  const [screenshotStrictness, setScreenshotStrictness] = useState('medium')
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [submitting, setSubmitting] = useState(false)
  const [uploading, setUploading] = useState(false)

  const load = async () => {
    const [t, p, llm] = await Promise.all([
      taskApi.list(statusFilter || undefined),
      settingsApi.listProviders(),
      settingsApi.getLlmDefault(),
    ])
    setTasks(t)
    setProviders(p)
    setLlmDefaults(llm)
  }

  useEffect(() => {
    load().catch(() => {})
  }, [statusFilter])

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
    setSubmitting(true)
    try {
      const strictness = SCREENSHOT_STRICTNESS.find((item) => item.value === screenshotStrictness) ?? SCREENSHOT_STRICTNESS[1]
      const res = await taskApi.create({
        platform,
        title: title.trim() || undefined,
        video_url: platform !== 'local' ? videoUrl : undefined,
        local_path: platform === 'local' ? localPath : undefined,
        style,
        extras: extras || undefined,
        screenshot_mode: screenshotMode,
        screenshot_min_score: screenshotMode !== 'off' ? strictness.score : undefined,
        provider_id: providerId,
        model_name: modelName,
      })
      toast.success('任务已提交')
      setSelectedTaskId(res.task_id)
      await load()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  const statusLabel: Record<string, string> = {
    PENDING: '排队中',
    PROCESSING: '处理中',
    COMPLETED: '已完成',
    FAILED: '失败',
    CANCELED: '已停止',
  }

  const statusColor: Record<string, string> = {
    PENDING: 'bg-yellow-100 text-yellow-800',
    PROCESSING: 'bg-blue-100 text-blue-800',
    COMPLETED: 'bg-green-100 text-green-800',
    FAILED: 'bg-red-100 text-red-800',
    CANCELED: 'bg-gray-200 text-gray-700',
  }

  return (
    <div className="min-h-screen">
      <header className="border-b bg-white px-6 py-4 flex items-center justify-between">
        <h1 className="text-xl font-bold">Project2Note</h1>
        <Link to="/settings" className="text-gray-500 hover:text-gray-700">
          <Settings className="h-5 w-5" />
        </Link>
      </header>

      <div className="mx-auto max-w-6xl p-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 space-y-4">
          <div className="rounded-lg border bg-white p-4 space-y-4">
            <h2 className="font-semibold">新建任务</h2>

            <div>
              <label className="text-sm text-gray-600">平台</label>
              <select
                value={platform}
                onChange={(e) => setPlatform(e.target.value)}
                className="mt-1 w-full rounded border px-3 py-2 text-sm"
              >
                {PLATFORMS.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-sm text-gray-600">笔记标题（可选）</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="留空则使用视频原标题"
                className="mt-1 w-full rounded border px-3 py-2 text-sm"
              />
            </div>

            {platform === 'local' ? (
              <div>
                <label className="text-sm text-gray-600">上传视频/音频 (mp4/mov/m4a)</label>
                <label className="mt-1 flex cursor-pointer items-center gap-2 rounded border border-dashed p-4 text-sm text-gray-500 hover:bg-gray-50">
                  <Upload className="h-4 w-4" />
                  {uploading ? '上传中...' : localPath || '选择文件'}
                  <input
                    type="file"
                    accept=".mp4,.mov,.m4a"
                    className="hidden"
                    onChange={(e) => e.target.files?.[0] && handleUpload(e.target.files[0])}
                  />
                </label>
              </div>
            ) : (
              <div>
                <label className="text-sm text-gray-600">视频链接</label>
                <div className="mt-1 flex gap-2">
                  <Link2 className="mt-2 h-4 w-4 text-gray-400" />
                  <input
                    value={videoUrl}
                    onChange={(e) => setVideoUrl(e.target.value)}
                    placeholder="粘贴视频链接..."
                    className="flex-1 rounded border px-3 py-2 text-sm"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="text-sm text-gray-600">笔记风格</label>
              <select value={style} onChange={(e) => setStyle(e.target.value)} className="mt-1 w-full rounded border px-2 py-2 text-sm">
                {STYLES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>

            <div>
              <label className="text-sm text-gray-600">截图模式</label>
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
                  <label className="text-sm text-gray-600">图片严格度</label>
                  <select
                    value={screenshotStrictness}
                    onChange={(e) => setScreenshotStrictness(e.target.value)}
                    className="mt-1 w-full rounded border px-2 py-2 text-sm"
                  >
                    {SCREENSHOT_STRICTNESS.map((item) => (
                      <option key={item.value} value={item.value}>{item.label}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <div>
              <label className="text-sm text-gray-600">自定义 Prompt（可选）</label>
              <textarea
                value={extras}
                onChange={(e) => setExtras(e.target.value)}
                rows={2}
                className="mt-1 w-full rounded border px-3 py-2 text-sm"
                placeholder="额外生成要求..."
              />
            </div>

            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="w-full rounded bg-blue-600 py-2 text-white hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              生成笔记
            </button>
          </div>
        </div>

        <div className="lg:col-span-2">
          <div className="rounded-lg border bg-white">
            <div className="flex items-center gap-2 border-b p-4">
              <h2 className="font-semibold">历史任务</h2>
              <div className="ml-auto flex gap-1">
                {['', 'PROCESSING', 'FAILED', 'CANCELED', 'COMPLETED'].map((s) => (
                  <button
                    key={s}
                    onClick={() => setStatusFilter(s)}
                    className={cn(
                      'rounded px-2 py-1 text-xs',
                      statusFilter === s ? 'bg-blue-100 text-blue-700' : 'text-gray-500 hover:bg-gray-100',
                    )}
                  >
                    {s === '' ? '全部' : statusLabel[s]}
                  </button>
                ))}
              </div>
            </div>
            <div className="divide-y max-h-[70vh] overflow-y-auto">
              {tasks.length === 0 && (
                <p className="p-8 text-center text-gray-400 text-sm">暂无任务</p>
              )}
              {tasks.map((task) => (
                <Link
                  key={task.id}
                  to={`/task/${task.id}`}
                  onClick={() => setSelectedTaskId(task.id)}
                  className="flex items-center gap-3 p-4 hover:bg-gray-50"
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{task.title || '处理中...'}</p>
                    {task.error_message && (
                      <p className="text-xs text-red-500 mt-1 truncate">{task.error_message}</p>
                    )}
                    <p className="text-xs text-gray-400 mt-1">{task.created_at?.slice(0, 16)}</p>
                  </div>
                  <span className={cn('rounded px-2 py-0.5 text-xs', statusColor[task.status])}>
                    {statusLabel[task.status] || task.status}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
