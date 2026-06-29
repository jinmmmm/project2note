import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { Send } from 'lucide-react'
import { chatApi, settingsApi, taskApi } from '@/services'
import { useAppStore } from '@/store/appStore'
import { useLlmConfig } from '@/hooks/useLlmConfig'
import { useUIStore } from '@/store/uiStore'
import { useChatStore } from '@/store/chatStore'
import ChatNotePicker from '@/components/chat/ChatNotePicker'
import ChatMarkdown from '@/components/chat/ChatMarkdown'
import { cn } from '@/lib/utils'

export default function ChatPage() {
  const { tasks, setTasks, setProviders, setLlmDefaults } = useAppStore()
  const { providerId, modelName, requestPayload } = useLlmConfig()
  const setSidebarSection = useUIStore((s) => s.setSidebarSection)
  const ensureActiveSession = useChatStore((s) => s.ensureActiveSession)
  const activeSessionId = useChatStore((s) => s.activeSessionId)
  const activeSession = useChatStore((s) => s.getActiveSession())
  const setActiveMode = useChatStore((s) => s.setActiveMode)
  const appendToActiveSession = useChatStore((s) => s.appendToActiveSession)
  const setActiveMessages = useChatStore((s) => s.setActiveMessages)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)

  useEffect(() => {
    setSidebarSection('chat')
    ensureActiveSession()
  }, [setSidebarSection, ensureActiveSession])

  useEffect(() => {
    Promise.all([
      settingsApi.listProviders().then(setProviders),
      settingsApi.getLlmDefault().then(setLlmDefaults),
    ]).catch(() => {})
  }, [setProviders, setLlmDefaults])

  useEffect(() => {
    if (tasks.length === 0) {
      taskApi.list().then(setTasks).catch(() => {})
    }
  }, [tasks.length, setTasks])

  const loadSessionHistory = useCallback(
    async (sessionId: string) => {
      setHistoryLoading(true)
      try {
        const msgs = await chatApi.globalMessages(sessionId)
        setActiveMessages(msgs)
      } catch {
        /* 保留本地缓存 */
      } finally {
        setHistoryLoading(false)
      }
    },
    [setActiveMessages],
  )

  useEffect(() => {
    if (!activeSessionId) return
    loadSessionHistory(activeSessionId)
  }, [activeSessionId, loadSessionHistory])

  const mode = activeSession?.mode ?? 'notes'
  const messages = activeSession?.messages ?? []
  const selectedIds = activeSession?.selectedTaskIds ?? []
  const selectedSummary = useMemo(() => {
    const selectedTitles = selectedIds
      .map((id) => tasks.find((task) => task.id === id)?.title || '未命名笔记')
      .filter(Boolean)
    if (selectedTitles.length === 0) return ''
    if (selectedTitles.length === 1) return `基于「${selectedTitles[0]}」笔记问答`
    const previewTitles = selectedTitles.slice(0, 3).map((title) => `「${title}」`).join('、')
    const suffix = selectedTitles.length > 3 ? `等 ${selectedTitles.length} 篇` : `${selectedTitles.length} 篇`
    return `基于${previewTitles}${suffix}笔记问答`
  }, [selectedIds, tasks])

  const send = async () => {
    if (!input.trim() || loading || !activeSessionId) return
    if (!providerId || !modelName) {
      toast.error('LLM 配置加载中，请稍后再试')
      return
    }
    if (mode === 'notes' && selectedIds.length === 0) {
      toast.error('请先选择至少一篇参考笔记')
      return
    }

    const q = input.trim()
    setInput('')
    setLoading(true)
    appendToActiveSession({ id: Date.now().toString(), role: 'user', content: q })

    try {
      const res = await chatApi.globalAsk(
        q,
        providerId,
        modelName,
        activeSessionId,
        mode === 'notes' ? selectedIds : [],
        requestPayload,
      )
      appendToActiveSession({
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: res.answer,
        sources: res.sources,
      })
    } catch (e) {
      appendToActiveSession({
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: `错误：${(e as Error).message}`,
      })
    } finally {
      setLoading(false)
    }
  }

  const scrollRef = useRef<HTMLDivElement>(null)
  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages, loading, scrollToBottom])

  return (
    <div className="flex h-full flex-col bg-white">
      <div className="shrink-0 border-b border-slate-100 px-5 py-3">
        <h1 className="text-sm font-semibold text-slate-800">跨笔记问答</h1>
        <p className="mt-1 text-xs text-slate-400">
          左侧管理对话记录；可选择多篇笔记联合问答，或切换自由提问联网搜索
        </p>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-5 space-y-4">
        {historyLoading && messages.length === 0 && (
          <p className="text-center text-sm text-slate-400">加载对话记录...</p>
        )}
        {!historyLoading && messages.length === 0 && (
          <p className="text-center text-sm text-slate-400">
            {mode === 'notes'
              ? '选择「基于笔记」并勾选参考笔记后开始提问'
              : '选择「自由提问」后将联网检索并回答'}
          </p>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            className={cn(
              'rounded-xl p-4 text-sm',
              m.role === 'user' ? 'ml-12 bg-blue-50' : 'mr-12 bg-slate-50',
            )}
          >
            {m.role === 'assistant' ? (
              <ChatMarkdown content={m.content} />
            ) : (
              <p className="whitespace-pre-wrap">{m.content}</p>
            )}
          </div>
        ))}
        {loading && <p className="text-sm text-slate-400">思考中...</p>}
      </div>

      <div className="shrink-0 space-y-3 border-t border-slate-100 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveMode('notes')}
            className={cn(
              'rounded-lg px-3 py-1.5 text-xs',
              mode === 'notes' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600',
            )}
          >
            基于笔记
          </button>
          <button
            type="button"
            onClick={() => setActiveMode('free')}
            className={cn(
              'rounded-lg px-3 py-1.5 text-xs',
              mode === 'free' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600',
            )}
          >
            自由提问
          </button>
        </div>

        {mode === 'notes' && <ChatNotePicker compact />}

        {mode === 'notes' && selectedSummary && (
          <p className="rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-700">
            {selectedSummary}
          </p>
        )}

        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && send()}
            placeholder={mode === 'notes' ? '基于所选笔记提问...' : '自由提问（将联网搜索）...'}
            className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
          />
          <button
            type="button"
            onClick={send}
            disabled={loading}
            className="rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
