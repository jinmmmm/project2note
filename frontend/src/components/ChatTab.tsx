import { useState, useEffect } from 'react'
import { chatApi } from '@/services'
import type { ChatMessage } from '@/services'
import { Send, Trash2 } from 'lucide-react'
import { useLlmConfig } from '@/hooks/useLlmConfig'

interface Props {
  taskId: string
  style: string
  providerId: string
  modelName: string
}

export default function ChatTab({ taskId, style, providerId, modelName }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const { requestPayload } = useLlmConfig()

  useEffect(() => {
    chatApi.messages(taskId).then(setMessages).catch(() => {})
  }, [taskId])

  const send = async () => {
    if (!input.trim() || loading) return
    const q = input.trim()
    setInput('')
    setLoading(true)
    setMessages((m) => [...m, { id: Date.now().toString(), role: 'user', content: q }])
    try {
      const res = await chatApi.ask(taskId, q, providerId, modelName, false, requestPayload)
      setMessages((m) => [
        ...m,
        { id: (Date.now() + 1).toString(), role: 'assistant', content: res.answer, sources: res.sources },
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
    await chatApi.clear(taskId)
    setMessages([])
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-4 py-2">
        <span className="text-sm text-gray-500">
          风格：{style === 'beginner' ? '小白通俗' : '专业严谨'}
        </span>
        <button onClick={clear} className="text-gray-400 hover:text-red-500">
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((m) => (
          <div
            key={m.id}
            className={`rounded-lg p-3 text-sm ${
              m.role === 'user' ? 'ml-8 bg-blue-50' : 'mr-8 bg-gray-50'
            }`}
          >
            {m.content}
          </div>
        ))}
        {loading && <div className="text-sm text-gray-400">思考中...</div>}
      </div>
      <div className="flex gap-2 border-t p-4">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
          placeholder="基于笔记提问，或自由提问..."
          className="flex-1 rounded border px-3 py-2 text-sm outline-none focus:border-blue-500"
        />
        <button
          onClick={send}
          disabled={loading}
          className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
        >
          <Send className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
