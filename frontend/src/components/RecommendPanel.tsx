import { useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import {
  ChevronDown, ChevronRight, ExternalLink, Loader2, Sparkles, X,
} from 'lucide-react'
import type { RecommendationItem } from '@/services'
import { taskApi } from '@/services'
import { getCategoryLabel, getRecNavLabel, groupRecommendations } from '@/lib/recommendCategories'
import { useLlmConfig } from '@/hooks/useLlmConfig'

function normalizePic(pic?: string): string {
  if (!pic) return ''
  if (pic.startsWith('//')) return `https:${pic}`
  if (pic.startsWith('http://')) return `https://${pic.slice(7)}`
  return pic
}

function formatPlayCount(count?: number): string | null {
  if (!count || count <= 0) return null
  if (count >= 10000) return `${(count / 10000).toFixed(1)}万播放`
  return `${count}播放`
}

interface Props {
  taskId: string
  items: RecommendationItem[]
  onChange: (items: RecommendationItem[]) => void
}

export default function RecommendPanel({ taskId, items, onChange }: Props) {
  const [loading, setLoading] = useState(false)
  const [smartOpen, setSmartOpen] = useState(false)
  const [smartPrompt, setSmartPrompt] = useState('')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const { requestPayload } = useLlmConfig()

  const grouped = useMemo(() => groupRecommendations(items), [items])

  const toggleGroup = (type: string) => {
    setCollapsed((prev) => ({ ...prev, [type]: !prev[type] }))
  }

  const scrollToRec = (index: number) => {
    document.getElementById(`rec-section-${index}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const refresh = async (prompt?: string) => {
    setLoading(true)
    try {
      const updated = await taskApi.refreshRecommendations(taskId, items, prompt, requestPayload)
      onChange(updated)
      toast.success(prompt?.trim() ? '已按你的诉求重新搜片' : '推荐已刷新')
      setSmartOpen(false)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const updateTopic = (index: number, topic: string) => {
    const updated = [...items]
    updated[index] = { ...updated[index], topic }
    onChange(updated)
  }

  return (
    <div className="flex h-full min-h-0">
      {items.length > 0 && (
        <aside className="hidden w-48 shrink-0 overflow-y-auto border-r border-slate-100 bg-slate-50/60 p-3 md:block lg:w-52">
          <p className="mb-2 text-xs font-semibold text-slate-500">推荐目录</p>
          <nav className="space-y-1">
            {grouped.map((group) => {
              const isCollapsed = collapsed[group.type]
              return (
                <div key={group.type}>
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.type)}
                    className="flex w-full items-center gap-1 rounded px-1 py-1 text-left text-xs font-medium text-slate-700 hover:bg-slate-100"
                  >
                    {isCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    {group.label}
                    <span className="ml-auto text-[10px] text-slate-400">{group.items.length}</span>
                  </button>
                  {!isCollapsed && (
                    <div className="ml-4 space-y-0.5 border-l border-slate-200 pl-2">
                      {group.items.map(({ rec, index }) => (
                        <button
                          key={index}
                          type="button"
                          onClick={() => scrollToRec(index)}
                          className="block w-full truncate py-1 text-left text-[11px] text-slate-600 hover:text-blue-600"
                          title={getRecNavLabel(rec)}
                        >
                          {getRecNavLabel(rec)}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </nav>
        </aside>
      )}

      <div className="min-w-0 flex-1 overflow-y-auto p-6">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-medium text-slate-800">推荐视频</h3>
            <p className="mt-1 text-xs text-slate-400">
              默认「前置基础」「后续进阶」两类，每条知识点 5 个视频。需新增类别或调整条数/排序，请使用「智能搜片」；修改笔记后请润色「延伸知识点」以同步推荐
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setSmartOpen(true)}
              disabled={loading}
              className="flex items-center gap-1 rounded-lg border border-violet-200 bg-violet-50 px-3 py-1.5 text-xs text-violet-700 hover:bg-violet-100 disabled:opacity-50"
            >
              <Sparkles className="h-3.5 w-3.5" />
              智能搜片
            </button>
          </div>
        </div>

        <div className="space-y-4">
          {items.map((rec, i) => (
            <div
              key={i}
              id={`rec-section-${i}`}
              className="scroll-mt-4 rounded-xl border border-slate-200 p-4"
            >
              <div className="flex items-start gap-2">
                <span className="shrink-0 rounded bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500">
                  {getCategoryLabel(rec)}
                </span>
                <input
                  value={rec.topic}
                  onChange={(e) => updateTopic(i, e.target.value)}
                  className="min-w-0 flex-1 border-b border-slate-100 pb-1 text-sm font-medium outline-none focus:border-blue-300"
                />
              </div>
              {rec.description && (
                <p className="mt-2 text-xs text-slate-500">{rec.description}</p>
              )}
              {(rec.videos || []).length > 0 ? (
                <div className="mt-3 space-y-2">
                  {(rec.videos || []).map((v, j) => {
                    const pic = normalizePic(v.pic)
                    const playLabel = formatPlayCount(v.play_count)
                    return (
                      <a
                        key={j}
                        href={v.url}
                        target="_blank"
                        rel="noreferrer"
                        className="flex gap-3 rounded-lg border border-slate-100 p-3 transition-colors hover:border-blue-200 hover:bg-blue-50/50"
                      >
                        {pic ? (
                          <img
                            src={pic}
                            alt=""
                            referrerPolicy="no-referrer"
                            className="h-16 w-28 shrink-0 rounded object-cover bg-slate-100"
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display = 'none'
                            }}
                          />
                        ) : (
                          <div className="flex h-16 w-28 shrink-0 items-center justify-center rounded bg-slate-100 text-[10px] text-slate-400">
                            无封面
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="line-clamp-2 text-sm font-medium text-slate-800">{v.title}</p>
                          <p className="mt-1 text-xs text-slate-400">
                            {v.author}
                            {playLabel ? ` · ${playLabel}` : ''}
                          </p>
                          <p className="mt-1 flex items-center gap-1 truncate text-xs text-blue-600">
                            <ExternalLink className="h-3 w-3 shrink-0" />
                            {v.url}
                          </p>
                        </div>
                      </a>
                    )
                  })}
                </div>
              ) : (
                <p className="mt-3 text-xs text-amber-600">
                  未找到相关视频，可修改关键词或使用「智能搜片」
                </p>
              )}
            </div>
          ))}
          {items.length === 0 && (
            <p className="text-sm text-slate-400">暂无推荐，笔记中需包含「延伸知识点」章节</p>
          )}
        </div>
      </div>

      {smartOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-violet-600" />
                <h2 className="text-sm font-semibold text-slate-800">智能搜片</h2>
              </div>
              <button type="button" onClick={() => setSmartOpen(false)} className="rounded p-1 text-slate-400 hover:bg-slate-100">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3 p-5">
              <p className="text-xs text-slate-500">
                默认按笔记「前置基础 / 后续进阶」目录搜片，每条 5 个视频。若要新增类别、改条数或排序（播放量/热度/最新），请在下方说明。
              </p>
              <textarea
                value={smartPrompt}
                onChange={(e) => setSmartPrompt(e.target.value)}
                rows={4}
                placeholder="例如：新增「同类视频」类别 3 条，每条 5 个视频，按播放量排序"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-violet-400"
              />
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setSmartOpen(false)}
                  className="flex-1 rounded-lg border border-slate-200 py-2 text-sm text-slate-600 hover:bg-slate-50"
                >
                  取消
                </button>
                <button
                  type="button"
                  disabled={loading || !smartPrompt.trim()}
                  onClick={() => refresh(smartPrompt.trim())}
                  className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-violet-600 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
                >
                  {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                  开始搜片
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
