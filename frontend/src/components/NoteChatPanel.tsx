import { useState, useEffect, useRef } from 'react'
import { chatApi } from '@/services'
import type { ChatMessage } from '@/services'
import { Globe, Send, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import ChatMarkdown from '@/components/chat/ChatMarkdown'
import { useLlmConfig } from '@/hooks/useLlmConfig'

interface Props {
  taskId: string
  providerId: string
  modelName: string
  prefilledQuestion?: string
  onPrefilledConsumed?: () => void
  className?: string
  mode?: 'task' | 'share'
  shareToken?: string
  shareSessionId?: string
}

export default function NoteChatPanel({
  taskId,
  providerId,
  modelName,
  prefilledQuestion,
  onPrefilledConsumed,
  className,
  mode = 'task',
  shareToken,
  shareSessionId,
}: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [webSearch, setWebSearch] = useState(true)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const { requestPayload } = useLlmConfig()

  useEffect(() => {
    const loader = mode === 'share' && shareToken && shareSessionId
      ? chatApi.shareMessages(shareToken, shareSessionId)
      : chatApi.messages(taskId)
    loader.then(setMessages).catch(() => {})
  }, [mode, shareSessionId, shareToken, taskId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  useEffect(() => {
    if (prefilledQuestion) {
      setInput(prefilledQuestion)
      onPrefilledConsumed?.()
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [prefilledQuestion, onPrefilledConsumed])

  const send = async () => {
    if (!input.trim() || loading || !providerId || !modelName) return
    const q = input.trim()
    setInput('')
    setLoading(true)
    setMessages((m) => [...m, { id: Date.now().toString(), role: 'user', content: q }])
    try {
      const res = mode === 'share' && shareToken && shareSessionId
        ? await chatApi.shareAsk(shareToken, shareSessionId, q, providerId, modelName, webSearch, requestPayload)
        : await chatApi.ask(taskId, q, providerId, modelName, webSearch, requestPayload)
      setMessages((m) => [
        ...m,
        {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: res.answer,
          sources: res.sources as ChatMessage['sources'],
        },
      ])
    } catch (e) {
      setMessages((m) => [
        ...m,
        { id: (Date.now() + 1).toString(), role: 'assistant', content: `错误：${(e as Error).message}` },
      ])
    } finally {
      setLoading(false)
    }
  }

  const clear = async () => {
    if (mode === 'share' && shareToken && shareSessionId) await chatApi.shareClear(shareToken, shareSessionId)
    else await chatApi.clear(taskId)
    setMessages([])
  }

  return (
    <div className={cn('flex h-full min-h-0 flex-col', className)}>
      <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-2 py-1.5">
        <span className="text-[10px] text-slate-400">仅本篇笔记</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setWebSearch((v) => !v)}
            className={cn(
              'flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] transition-colors',
              webSearch ? 'bg-blue-50 text-blue-600' : 'text-slate-400 hover:bg-slate-100',
            )}
            title="联网搜索补充"
          >
            <Globe className="h-3 w-3" />
            联网
          </button>
          <button type="button" onClick={clear} className="rounded p-1 text-slate-400 hover:text-red-500">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2 space-y-2">
        {messages.length === 0 && (
          <p className="py-4 text-center text-[11px] text-slate-400">
            基于本篇笔记提问；可划词「追问」或「复制」
          </p>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            className={cn(
              'rounded-lg px-2.5 py-2 text-xs leading-relaxed',
              m.role === 'user' ? 'ml-2 bg-blue-50 text-slate-800' : 'mr-2 bg-slate-50 text-slate-700',
            )}
          >
            {m.role === 'assistant' ? (
              <ChatMarkdown content={m.content} />
            ) : (
              <p className="whitespace-pre-wrap">{m.content}</p>
            )}
          </div>
        ))}
        {loading && <p className="text-[11px] text-slate-400">思考中…</p>}
        <div ref={bottomRef} />
      </div>

      <div className="flex shrink-0 gap-1.5 border-t border-slate-100 p-2">
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && send()}
          placeholder="追问…"
          className="min-w-0 flex-1 rounded-lg border border-slate-200 px-2 py-1.5 text-xs outline-none focus:border-blue-400"
        />
        <button
          type="button"
          onClick={send}
          disabled={loading || !providerId}
          className="rounded-lg bg-blue-600 p-1.5 text-white hover:bg-blue-700 disabled:opacity-50"
        >
          <Send className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}
