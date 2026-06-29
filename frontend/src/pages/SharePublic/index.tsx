import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { ExternalLink } from 'lucide-react'
import { shareApi, settingsApi, type ShareData } from '@/services'
import MarkdownContent, { useNoteToc } from '@/components/MarkdownContent'
import NoteToc from '@/components/NoteToc'
import NoteThreeColumnLayout from '@/components/NoteThreeColumnLayout'
import VideoPlayer, { type VideoPlayerHandle } from '@/components/VideoPlayer'
import VideoDrawer from '@/components/VideoDrawer'
import RightPanel, { type RightPanelMode } from '@/components/RightPanel'
import NoteChatPanel from '@/components/NoteChatPanel'
import { useTextSelectionAsk } from '@/hooks/useTextSelectionAsk'
import { scrollToHeadingInContainerWithRetry } from '@/lib/markdown'
import { getCategoryLabel } from '@/lib/recommendCategories'
import { cn } from '@/lib/utils'

const SHARE_CHAT_SESSION_KEY = 'project2note-share-chat-session'

function getOrCreateShareSessionId(token: string): string {
  const key = `${SHARE_CHAT_SESSION_KEY}:${token}`
  const existing = window.localStorage.getItem(key)
  if (existing) return existing
  const created = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  window.localStorage.setItem(key, created)
  return created
}

export default function SharePublicPage() {
  const { token } = useParams<{ token: string }>()
  const [data, setData] = useState<ShareData | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [tab, setTab] = useState<'note' | 'recommend'>('note')
  const [activeTocId, setActiveTocId] = useState<string>()
  const [tocCollapsed, setTocCollapsed] = useState(false)
  const [rightCollapsed, setRightCollapsed] = useState(true)
  const [rightPanelMode, setRightPanelMode] = useState<RightPanelMode>('video')
  const [chatPrefill, setChatPrefill] = useState<string>()
  const [providerId, setProviderId] = useState('')
  const [modelName, setModelName] = useState('')
  const [shareSessionId, setShareSessionId] = useState('')
  const noteScrollRef = useRef<HTMLDivElement>(null)
  const videoPlayerRef = useRef<VideoPlayerHandle>(null)

  const markdown = data?.note?.markdown || ''
  const noteStyle = data?.style === 'professional' ? 'professional' : 'beginner'
  const tocItems = useNoteToc(markdown, noteStyle)
  const recommendations = data?.recommendations || []

  useEffect(() => {
    if (!token) return
    setShareSessionId(getOrCreateShareSessionId(token))
    setLoadError(null)
    shareApi
      .get(token)
      .then((res) => {
        setData(res)
        setProviderId(res.provider_id || '')
        setModelName(res.model_name || '')
      })
      .catch((e: Error) => setLoadError(e.message || '分享内容加载失败'))

    settingsApi.getLlmDefault()
      .then((defaults) => {
        setProviderId((prev) => prev || defaults.provider_id || '')
        setModelName((prev) => prev || defaults.model_name || '')
      })
      .catch(() => {})
  }, [token])

  const scrollToHeading = useCallback((id: string) => {
    setActiveTocId(id)
    scrollToHeadingInContainerWithRetry(noteScrollRef.current, id)
  }, [])

  useEffect(() => {
    const container = noteScrollRef.current
    if (!container || !tocItems.length) return
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveTocId(entry.target.id)
            break
          }
        }
      },
      { root: container, threshold: 0, rootMargin: '0px 0px -80% 0px' },
    )
    const els = container.querySelectorAll<HTMLElement>('.note-heading-block[id]')
    els.forEach((el) => observer.observe(el))
    return () => observer.disconnect()
  }, [markdown, tocItems, tab])

  const openVideoPanel = useCallback(() => {
    setRightPanelMode('video')
    setRightCollapsed(false)
  }, [])

  const openAiPanel = useCallback(() => {
    setRightPanelMode('ai')
    setRightCollapsed(false)
  }, [])

  const seekFromTimestamp = useCallback((seconds: number) => {
    openVideoPanel()
    window.setTimeout(() => videoPlayerRef.current?.seekTo(seconds), 50)
  }, [openVideoPanel])

  const handleSelectionAsk = useCallback((text: string) => {
    openAiPanel()
    const needsLink = /下载|安装|链接|命令|switch|Switch|github|npm/i.test(text)
    const question = needsLink
      ? `「${text}」给我下载链接或安装命令`
      : `「${text}」`
    setChatPrefill(question)
  }, [openAiPanel])

  const { Popover: selectionPopover } = useTextSelectionAsk({
    containerRef: noteScrollRef,
    enabled: tab === 'note',
    onAsk: handleSelectionAsk,
    showPopover: true,
  })

  if (loadError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 p-8 text-center text-sm text-red-600">
        {loadError}
      </div>
    )
  }

  if (!data) {
    return <div className="p-8 text-center text-gray-400">加载中...</div>
  }

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <header className="border-b bg-white px-6 py-4">
        <p className="mb-1 text-xs text-gray-400">公开分享 · 只读（可看视频 / 可划词追问 / 不可编辑）</p>
        <h1 className="text-xl font-bold">{data.title}</h1>
      </header>

      <div className="flex border-b bg-white px-6">
        {(['note', 'recommend'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-4 py-3 text-sm ${
              tab === t ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500'
            }`}
          >
            {t === 'note' ? '笔记' : '延伸推荐'}
          </button>
        ))}
      </div>

      <NoteThreeColumnLayout
        enabled={Boolean(markdown)}
        sidebarCollapsed={tocCollapsed}
        rightCollapsed={rightCollapsed}
        sidebar={
          <NoteToc
            items={tocItems}
            activeId={activeTocId}
            onNavigate={scrollToHeading}
            onSeek={seekFromTimestamp}
            collapsed={tocCollapsed}
            onCollapsedChange={setTocCollapsed}
          />
        }
        rightPanel={
          <RightPanel
            mode={rightPanelMode}
            collapsed={rightCollapsed}
            onCollapsedChange={setRightCollapsed}
            onOpenVideo={openVideoPanel}
            onOpenAi={openAiPanel}
            video={
              <VideoDrawer collapsed={false}>
                <VideoPlayer
                  ref={videoPlayerRef}
                  videoUrl={data.video_url}
                  sourceUrl={data.source_url}
                  platform={data.platform}
                  mediaKind={data.media_kind}
                  openUrl={data.open_url}
                />
              </VideoDrawer>
            }
            chat={
              providerId && modelName && token && shareSessionId ? (
                <NoteChatPanel
                  taskId={`share:${token}`}
                  mode="share"
                  shareToken={token}
                  shareSessionId={shareSessionId}
                  providerId={providerId}
                  modelName={modelName}
                  prefilledQuestion={chatPrefill}
                  onPrefilledConsumed={() => setChatPrefill(undefined)}
                />
              ) : (
                <div className="flex h-full items-center justify-center p-4 text-sm text-slate-400">
                  暂无可用追问配置
                </div>
              )
            }
          />
        }
      >
        <div
          ref={noteScrollRef}
          data-note-scroll
          className={cn('h-full min-h-0', tab === 'recommend' ? 'overflow-hidden' : 'overflow-y-auto')}
        >
          {tab === 'note' && (
            markdown ? (
              <MarkdownContent
                content={markdown}
                style={noteStyle}
                onSeek={seekFromTimestamp}
              />
            ) : (
              <p className="p-8 text-center text-sm text-gray-400">暂无笔记内容</p>
            )
          )}
          {tab === 'recommend' && (
            <div className="space-y-4 overflow-y-auto p-6">
              {recommendations.length > 0 ? (
                recommendations.map((rec, i) => (
                  <div key={i} className="rounded-xl border border-slate-200 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-medium text-slate-800">{rec.topic}</p>
                      {rec.type && (
                        <span className="shrink-0 rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                          {getCategoryLabel(rec)}
                        </span>
                      )}
                    </div>
                    {rec.description && (
                      <p className="mt-1 text-sm text-slate-500">{rec.description}</p>
                    )}
                    <div className="mt-3 space-y-2">
                      {(rec.videos || []).map((v, j) => (
                        <a
                          key={j}
                          href={v.url}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-2 rounded-lg border border-slate-100 p-3 hover:bg-slate-50"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-slate-800">{v.title}</p>
                            {v.author && (
                              <p className="mt-0.5 text-xs text-slate-400">{v.author}</p>
                            )}
                          </div>
                          <ExternalLink className="h-4 w-4 shrink-0 text-slate-400" />
                        </a>
                      ))}
                      {(rec.videos || []).length === 0 && (
                        <p className="text-xs text-slate-400">暂无推荐视频</p>
                      )}
                    </div>
                  </div>
                ))
              ) : (
                <p className="py-12 text-center text-sm text-gray-400">暂无延伸推荐</p>
              )}
            </div>
          )}
        </div>
        {selectionPopover}
      </NoteThreeColumnLayout>
    </div>
  )
}
