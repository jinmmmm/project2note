import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import {
  Download, Share2, Save, Edit3, Trash2, RotateCcw, Loader2, Check, X, Sparkles, Square,
} from 'lucide-react'
import { taskApi } from '@/services'
import type { Task, RecommendationItem } from '@/services'
import { useTaskPolling } from '@/hooks/useTaskPolling'
import { useAppStore } from '@/store/appStore'
import { useCollectionStore } from '@/store/collectionStore'
import { useUIStore } from '@/store/uiStore'
import MarkdownContent, { useNoteToc, type PolishSectionInfo } from '@/components/MarkdownContent'
import NotePolishDialog, { type PolishTarget } from '@/components/NotePolishDialog'
import NoteToc from '@/components/NoteToc'
import NoteThreeColumnLayout from '@/components/NoteThreeColumnLayout'
import RightPanel, { type RightPanelMode } from '@/components/RightPanel'
import NoteChatPanel from '@/components/NoteChatPanel'
import VideoPlayer, { type VideoPlayerHandle } from '@/components/VideoPlayer'
import RegenerateTaskPanel from '@/components/RegenerateTaskPanel'
import FeishuSyncDialog from '@/components/FeishuSyncDialog'
import NoteExportDialog from '@/components/NoteExportDialog'
import RecommendPanel from '@/components/RecommendPanel'
import PlaceholderPanel from '@/components/PlaceholderPanel'
import MindmapPanel from './MindmapPanel'
import ActionTip from '@/components/ActionTip'
import { downloadBlob } from '@/lib/download'
import { scrollToHeadingInContainerWithRetry, safeDownloadFilename } from '@/lib/markdown'
import type { NoteStyle } from '@/lib/terms'
import { formatLocalDate } from '@/lib/time'
import { getTaskProgressLabel, getPipelineSteps, getProgressPercent, getProgressStepIndex } from '@/lib/taskProgress'
import { useTextSelectionAsk } from '@/hooks/useTextSelectionAsk'
import { useLlmConfig } from '@/hooks/useLlmConfig'
import { cn } from '@/lib/utils'

const RIGHT_PANEL_MODE_KEY = 'project2note-right-panel-mode'

type Tab = 'note' | 'cards' | 'mindmap' | 'recommend'

function TaskProcessingView({ task, onCancel }: { task: Task; onCancel: () => void }) {
  const style = task.style === 'professional' ? 'professional' : 'beginner'
  const platform = task.platform
  const steps = getPipelineSteps(platform, task.progress)
  const visibleSteps = steps.filter((s) => s !== 'queued')
  const currentIndex = getProgressStepIndex(steps, task.progress)
  const percent = getProgressPercent(steps, task.progress)
  const label = getTaskProgressLabel(task.progress, style, platform)

  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 bg-white p-8">
      <Loader2 className="h-10 w-10 animate-spin text-blue-600" />
      <div className="text-center">
        <p className="text-base font-medium text-slate-800">
          {task.status === 'PENDING' ? '任务排队中…' : `正在${label}…`}
        </p>
        <p className="mt-2 text-sm text-slate-500">
          完成后会自动刷新，你也可以在左侧「任务列表」查看状态
        </p>
      </div>
      <div className="w-full max-w-md">
        <div className="mb-2 flex items-center justify-between text-xs text-slate-500">
          <span>整体进度</span>
          <span>{percent}%</span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full rounded-full bg-blue-600 transition-all duration-500 ease-out"
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>
      <div className="w-full max-w-md space-y-2">
        {visibleSteps.map((step) => {
          const stepIndex = steps.indexOf(step)
          const isDone = currentIndex > stepIndex || task.progress === 'done'
          const isCurrent = currentIndex === stepIndex && task.progress !== 'done'
          return (
            <div
              key={step}
              className={cn(
                'flex items-center gap-2 rounded-lg px-3 py-2 text-xs transition-colors',
                isCurrent && 'border border-blue-200 bg-blue-50 text-blue-700',
                isDone && !isCurrent && 'bg-blue-50/60 text-blue-600',
                !isDone && !isCurrent && 'text-slate-400',
              )}
            >
              <span
                className={cn(
                  'flex h-4 w-4 shrink-0 items-center justify-center rounded-full',
                  isCurrent && 'bg-blue-600',
                  isDone && !isCurrent && 'bg-blue-500',
                  !isDone && !isCurrent && 'bg-slate-300',
                )}
              >
                {isDone && !isCurrent && <Check className="h-2.5 w-2.5 text-white" />}
                {isCurrent && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
              </span>
              {getTaskProgressLabel(step, style, platform)}
              {isCurrent && <Loader2 className="ml-auto h-3 w-3 animate-spin text-blue-600" />}
            </div>
          )
        })}
      </div>
      <button
        onClick={onCancel}
        className="flex items-center gap-2 rounded-lg border border-red-200 px-4 py-2 text-sm text-red-600 hover:bg-red-50"
      >
        <Square className="h-4 w-4" />
        停止任务
      </button>
      <p className="text-xs text-slate-400">
        停止后会保留已完成的阶段（逐字稿、联网补充等），重新开始时自动续跑
      </p>
    </div>
  )
}

export default function NoteDetailPage() {
  const { taskId } = useParams<{ taskId: string }>()
  const navigate = useNavigate()
  const removeTask = useAppStore((s) => s.removeTask)
  const updateTaskInStore = useAppStore((s) => s.updateTask)
  const setTasks = useAppStore((s) => s.setTasks)
  const assignTask = useCollectionStore((s) => s.assignTask)
  const setWorkbenchTaskId = useUIStore((s) => s.setWorkbenchTaskId)
  const setSidebarSection = useUIStore((s) => s.setSidebarSection)

  const [task, setTask] = useState<Task | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('note')
  const [editing, setEditing] = useState(false)
  const [editContent, setEditContent] = useState('')
  const [recs, setRecs] = useState<RecommendationItem[]>([])
  const [shareUrl, setShareUrl] = useState('')
  const [activeTocId, setActiveTocId] = useState<string>()
  const [showRegenerate, setShowRegenerate] = useState(false)
  const [showFeishuSync, setShowFeishuSync] = useState(false)
  const [exportDialog, setExportDialog] = useState<'md' | 'pdf' | null>(null)
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleInput, setTitleInput] = useState('')
  const [savingTitle, setSavingTitle] = useState(false)
  const [polishTarget, setPolishTarget] = useState<PolishTarget | null>(null)
  const [tocCollapsed, setTocCollapsed] = useState(false)
  const [rightCollapsed, setRightCollapsed] = useState(true)
  const [rightPanelMode, setRightPanelMode] = useState<RightPanelMode>('video')
  const [chatPrefill, setChatPrefill] = useState<string>()
  const noteScrollRef = useRef<HTMLDivElement>(null)
  const videoPlayerRef = useRef<VideoPlayerHandle>(null)
  const { providerId, modelName, requestPayload } = useLlmConfig()

  const load = useCallback(async () => {
    if (!taskId) return
    try {
      setLoadError(null)
      const t = await taskApi.get(taskId)
      setTask(t)
      setEditContent(t.note?.markdown_edited || t.note?.markdown_raw || '')
      setRecs(t.recommendations || [])
    } catch (e) {
      setLoadError((e as Error).message || '加载失败')
      setTask(null)
    }
  }, [taskId])

  const isProcessing = task?.status === 'PROCESSING' || task?.status === 'PENDING'
  useTaskPolling(isProcessing ? taskId || null : null, isProcessing, 3000, load)

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (!task) return
    if (task.status === 'FAILED' || task.status === 'CANCELED') {
      setWorkbenchTaskId(task.id)
      setSidebarSection('workbench')
      navigate('/', { replace: true })
    }
  }, [task, navigate, setSidebarSection, setWorkbenchTaskId])

  const noteStyle: NoteStyle = task?.style === 'professional' ? 'professional' : 'beginner'
  const tocItems = useNoteToc(editContent, noteStyle)

  const scrollToHeading = useCallback((id: string) => {
    setActiveTocId(id)
    scrollToHeadingInContainerWithRetry(noteScrollRef.current, id)
  }, [])

  // Scroll → highlight active TOC item
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
  }, [editContent, tocItems, tab, editing])

  const openVideoPanel = useCallback(() => {
    setRightPanelMode('video')
    setRightCollapsed(false)
    localStorage.setItem(RIGHT_PANEL_MODE_KEY, 'video')
  }, [])

  const openAiPanel = useCallback(() => {
    setRightPanelMode('ai')
    setRightCollapsed(false)
    localStorage.setItem(RIGHT_PANEL_MODE_KEY, 'ai')
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
    enabled: tab === 'note' && !editing,
    onAsk: handleSelectionAsk,
    showPopover: true,
  })

  const handleRightCollapsedChange = (collapsed: boolean) => {
    setRightCollapsed(collapsed)
  }

  const saveNote = async () => {
    if (!taskId) return
    await taskApi.updateNote(taskId, editContent)
    toast.success('已保存')
    setEditing(false)
    await load()
  }

  const persistImageContent = useCallback(async (next: string) => {
    if (!taskId) return
    setEditContent(next)
    await taskApi.updateNote(taskId, next)
  }, [taskId])

  const openPolishFull = () => {
    setPolishTarget({
      scope: 'full',
      label: '整篇结构化笔记',
    })
  }

  const openPolishSection = useCallback((info: PolishSectionInfo) => {
    const levelLabel = info.depth === 2 ? '大节' : '小节'
    setPolishTarget({
      scope: 'section',
      label: `${levelLabel}：${info.title}`,
      headingTitle: info.title,
      headingDepth: info.depth,
    })
  }, [])

  const handlePolishConfirm = async (instruction: string) => {
    if (!taskId || !polishTarget) return
    const res = await taskApi.polishNote(taskId, {
      scope: polishTarget.scope,
      heading_title: polishTarget.headingTitle,
      heading_depth: polishTarget.headingDepth,
      instruction: instruction || undefined,
      ...requestPayload,
    })
    setEditContent(res.markdown_edited)
    if (res.recommendations_refreshed && res.recommendations) {
      setRecs(res.recommendations)
      toast.success('润色完成，延伸推荐已同步刷新')
    } else {
      toast.success('润色完成，已自动保存')
    }
    await load()
  }

  const startEditTitle = () => {
    setTitleInput(task?.title || '')
    setEditingTitle(true)
  }

  const cancelEditTitle = () => {
    setEditingTitle(false)
    setTitleInput('')
  }

  const saveTitle = async () => {
    if (!taskId) return
    const trimmed = titleInput.trim()
    if (!trimmed) {
      toast.error('标题不能为空')
      return
    }
    setSavingTitle(true)
    try {
      const updated = await taskApi.updateTitle(taskId, trimmed)
      setTask((prev) => (prev ? { ...prev, title: updated.title } : prev))
      updateTaskInStore(updated)
      setEditContent((prev) => {
        if (!prev) return prev
        return prev.replace(
          /(-\s*视频标题[：:]\s*).+/,
          `$1${trimmed}`,
        )
      })
      setEditingTitle(false)
      toast.success('标题已更新')
      await load()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSavingTitle(false)
    }
  }

  const handleExport = async (format: 'md' | 'pdf', title: string) => {
    if (!taskId) return
    const blob = await taskApi.export(taskId, format, title)
    downloadBlob(blob, safeDownloadFilename(title, format))
    toast.success(format === 'pdf' ? 'PDF 已下载' : 'Markdown 已下载')
  }

  const handleShare = async () => {
    if (!taskId) return
    const res = await taskApi.share(taskId)
    setShareUrl(res.url)
    navigator.clipboard.writeText(res.url)
    toast.success('局域网分享链接已复制（对方只读，可查看笔记与延伸推荐）')
  }

  const handleCancel = async () => {
    if (!taskId) return
    try {
      await taskApi.cancel(taskId)
      toast.success('已停止任务')
      setWorkbenchTaskId(taskId)
      setSidebarSection('workbench')
      navigate('/', { replace: true })
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const handleDelete = async () => {
    if (!taskId || !task) return
    if (!window.confirm(`确定删除「${task.title || '未命名任务'}」？`)) return
    try {
      await taskApi.delete(taskId)
      removeTask(taskId)
      assignTask(taskId, null)
      toast.success('已删除')
      navigate('/')
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  if (loadError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 bg-white p-8">
        <p className="font-medium text-red-500">加载失败</p>
        <p className="max-w-md text-center text-sm text-slate-600">{loadError}</p>
        <button onClick={() => load()} className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white">
          重试
        </button>
      </div>
    )
  }

  if (!task) {
    return (
      <div className="flex h-full items-center justify-center bg-white text-sm text-slate-400">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        加载中...
      </div>
    )
  }

  if (task.status === 'PROCESSING' || task.status === 'PENDING') {
    return <TaskProcessingView task={task} onCancel={handleCancel} />
  }

  if (task.status === 'FAILED' || task.status === 'CANCELED') {
    return (
      <div className="flex h-full items-center justify-center bg-white text-sm text-slate-400">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        正在返回工作台…
      </div>
    )
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: 'note', label: '结构化笔记' },
    { key: 'cards', label: '知识卡片' },
    { key: 'mindmap', label: '思维导图' },
    { key: 'recommend', label: '延伸推荐' },
  ]

  return (
    <div className="flex h-full flex-col bg-white">
      <header className="relative z-20 flex shrink-0 flex-wrap items-center gap-2 overflow-visible border-b border-slate-100 px-5 py-3">
        <div className="min-w-0 flex-1">
          {editingTitle ? (
            <div className="flex items-center gap-1.5">
              <input
                value={titleInput}
                onChange={(e) => setTitleInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveTitle()
                  if (e.key === 'Escape') cancelEditTitle()
                }}
                className="min-w-0 flex-1 rounded-lg border border-slate-200 px-2.5 py-1 text-sm font-semibold outline-none focus:border-blue-400"
                autoFocus
              />
              <button
                type="button"
                onClick={saveTitle}
                disabled={savingTitle}
                className="rounded p-1 text-green-600 hover:bg-green-50 disabled:opacity-50"
              >
                <Check className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={cancelEditTitle}
                className="rounded p-1 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <div className="flex max-w-full items-center gap-2">
              <button
                type="button"
                onClick={startEditTitle}
                className="group flex min-w-0 items-center gap-1 text-left"
                title="点击编辑标题"
              >
                <h1 className="truncate text-base font-semibold text-slate-900 group-hover:text-blue-700">
                  {task.title || '未命名视频'}
                </h1>
                <Edit3 className="h-3.5 w-3.5 shrink-0 text-slate-300 group-hover:text-blue-500" />
              </button>
              {tab === 'note' && !editing && (
                <ActionTip tip="对整篇笔记 AI 润色，例如统一专有名词">
                  <button
                    type="button"
                    onClick={openPolishFull}
                    className="flex shrink-0 items-center gap-1 rounded-lg border border-violet-200 bg-violet-50 px-2 py-1 text-[10px] font-medium text-violet-700 hover:bg-violet-100"
                  >
                    <Sparkles className="h-3 w-3" />
                    润色全文
                  </button>
                </ActionTip>
              )}
            </div>
          )}
          <p className="text-[10px] text-slate-400">
            {task.style === 'beginner' ? '小白' : '专业'}
            {' · '}
            {formatLocalDate(task.created_at)}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <ActionTip tip="保留原视频链接，可更换笔记风格或补充提示词后重新生成">
            <button
              type="button"
              onClick={() => setShowRegenerate(true)}
              className="flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-xs text-blue-700 hover:bg-blue-100"
            >
              <RotateCcw className="h-3.5 w-3.5" />重新生成
            </button>
          </ActionTip>
          {tab === 'note' && (
            <>
              <ActionTip tip={editing ? '返回预览，查看排版后的笔记' : '进入编辑，直接修改 Markdown 原文'}>
                <button
                  onClick={() => setEditing(!editing)}
                  className="flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs hover:bg-slate-50"
                >
                  <Edit3 className="h-3.5 w-3.5" />{editing ? '预览' : '编辑'}
                </button>
              </ActionTip>
              {editing && (
                <ActionTip tip="保存当前编辑内容，更新本地笔记">
                  <button
                    onClick={saveNote}
                    className="flex items-center gap-1 rounded-lg bg-green-600 px-2.5 py-1.5 text-xs text-white"
                  >
                    <Save className="h-3.5 w-3.5" />保存
                  </button>
                </ActionTip>
              )}
            </>
          )}
          <ActionTip tip="导出 Markdown 到本地，可先自定义标题">
            <button
              onClick={() => setExportDialog('md')}
              className="flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs hover:bg-slate-50"
            >
              <Download className="h-3.5 w-3.5" />MD
            </button>
          </ActionTip>
          <ActionTip tip="导出 PDF 到本地，可先自定义标题">
            <button
              onClick={() => setExportDialog('pdf')}
              className="flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs hover:bg-slate-50"
            >
              <Download className="h-3.5 w-3.5" />PDF
            </button>
          </ActionTip>
          <ActionTip tip="生成公开分享链接，他人无需登录即可只读查看">
            <button
              onClick={handleShare}
              className="flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs hover:bg-slate-50"
            >
              <Share2 className="h-3.5 w-3.5" />分享
            </button>
          </ActionTip>
          <ActionTip tip="同步到飞书云文档，可先确认目录并自定义标题">
            <button
              onClick={() => setShowFeishuSync(true)}
              className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs hover:bg-slate-50"
            >
              飞书
            </button>
          </ActionTip>
          <ActionTip tip="删除本条任务及笔记，操作不可恢复">
            <button
              onClick={handleDelete}
              className="flex items-center gap-1 rounded-lg border border-red-100 px-2.5 py-1.5 text-xs text-red-600 hover:bg-red-50"
            >
              <Trash2 className="h-3.5 w-3.5" />删除
            </button>
          </ActionTip>
        </div>
      </header>

      {shareUrl && (
        <div className="shrink-0 truncate bg-blue-50 px-5 py-1.5 text-xs text-blue-700">
          局域网分享（只读）：{shareUrl}
        </div>
      )}

      <div className="flex shrink-0 border-b border-slate-100 px-5">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              'border-b-2 px-4 py-2.5 text-sm -mb-px transition-colors',
              tab === t.key ? 'border-blue-600 text-blue-600 font-medium' : 'border-transparent text-slate-500 hover:text-slate-700',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <NoteThreeColumnLayout
        enabled={tab === 'note' && !editing}
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
          taskId ? (
            <RightPanel
              mode={rightPanelMode}
              collapsed={rightCollapsed}
              onCollapsedChange={handleRightCollapsedChange}
              onOpenVideo={openVideoPanel}
              onOpenAi={openAiPanel}
              video={
                <VideoPlayer
                  ref={videoPlayerRef}
                  videoUrl={task.video_url}
                  sourceUrl={task.source_url}
                  platform={task.platform}
                  mediaKind={task.media_kind}
                  openUrl={task.open_url}
                />
              }
              chat={
                <NoteChatPanel
                  taskId={taskId}
                  providerId={providerId}
                  modelName={modelName}
                  prefilledQuestion={chatPrefill}
                  onPrefilledConsumed={() => setChatPrefill(undefined)}
                />
              }
            />
          ) : undefined
        }
      >
        <div
          ref={noteScrollRef}
          data-note-scroll
          className={cn(
            'relative h-full min-h-0',
            tab === 'recommend' ? 'flex flex-col overflow-hidden' : 'overflow-y-auto',
          )}
        >
          {tab === 'note' && (
            editing ? (
              <textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                className="h-full w-full resize-none p-6 font-mono text-sm outline-none"
              />
            ) : (
              <MarkdownContent
                content={editContent}
                sourceContent={editContent}
                style={noteStyle}
                onPolishSection={openPolishSection}
                onSeek={seekFromTimestamp}
                editableImages
                onImageContentChange={setEditContent}
                onImageContentPersist={persistImageContent}
              />
            )
          )}
          {tab === 'cards' && (
            <PlaceholderPanel
              title="知识卡片"
              description="将在此展示从笔记提炼的可复习知识卡片，功能即将上线。"
            />
          )}
          {tab === 'mindmap' && taskId && (
            <MindmapPanel
              taskId={taskId}
              noteMarkdown={editContent}
              videoTitle={task?.title}
              mindmapData={task?.note?.mindmap_data ?? null}
              onSeek={seekFromTimestamp}
              onScrollToHeading={scrollToHeading}
            />
          )}
          {tab === 'recommend' && taskId && (
            <RecommendPanel taskId={taskId} items={recs} onChange={setRecs} />
          )}
        </div>
      </NoteThreeColumnLayout>
      {selectionPopover}

      <RegenerateTaskPanel
        taskId={task.id}
        taskTitle={task.title}
        initialStyle={task.style}
        initialExtras={task.extras}
        initialScreenshotMode={task.screenshot_mode}
        initialEnableScreenshots={task.enable_screenshots}
        initialEnableVisionScreenshotRefine={task.enable_vision_screenshot_refine}
        initialScreenshotMinScore={task.screenshot_min_score}
        open={showRegenerate}
        onClose={() => setShowRegenerate(false)}
        onSubmitted={async (resultTaskId, mode) => {
          const tasks = await taskApi.list()
          setTasks(tasks)
          if (mode === 'save_as_new' && resultTaskId !== task.id) {
            navigate(`/task/${resultTaskId}`)
          } else {
            await load()
          }
        }}
      />
      {taskId && exportDialog && (
        <NoteExportDialog
          open={!!exportDialog}
          format={exportDialog}
          defaultTitle={task.title || '视频笔记'}
          onClose={() => setExportDialog(null)}
          onConfirm={(title) => handleExport(exportDialog, title)}
        />
      )}
      {taskId && (
        <FeishuSyncDialog
          open={showFeishuSync}
          onClose={() => setShowFeishuSync(false)}
          taskId={taskId}
          defaultTitle={task.title || '视频笔记'}
        />
      )}
      <NotePolishDialog
        open={!!polishTarget}
        target={polishTarget}
        onClose={() => setPolishTarget(null)}
        onConfirm={handlePolishConfirm}
      />
    </div>
  )
}
