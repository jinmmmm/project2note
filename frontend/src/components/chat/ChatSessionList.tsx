import { Plus, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { chatApi } from '@/services'
import { useChatStore } from '@/store/chatStore'
import { cn } from '@/lib/utils'

export default function ChatSessionList() {
  const sessions = useChatStore((s) => s.sessions)
  const activeSessionId = useChatStore((s) => s.activeSessionId)
  const createSession = useChatStore((s) => s.createSession)
  const deleteSession = useChatStore((s) => s.deleteSession)
  const setActiveSession = useChatStore((s) => s.setActiveSession)
  const ensureActiveSession = useChatStore((s) => s.ensureActiveSession)

  if (sessions.length === 0) {
    ensureActiveSession()
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-slate-100 px-3 py-2">
        <button
          type="button"
          onClick={createSession}
          className="flex w-full items-center justify-center gap-1 rounded-lg border border-dashed border-slate-300 py-2.5 text-xs text-slate-600 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
        >
          <Plus className="h-3.5 w-3.5" />
          新建对话
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {sessions.length === 0 && (
          <p className="p-4 text-center text-xs text-slate-400">暂无对话</p>
        )}
        {sessions.map((session) => (
          <div
            key={session.id}
            className={cn(
              'group mb-1 flex items-start gap-1 rounded-lg px-3 py-2.5 transition-colors',
              activeSessionId === session.id
                ? 'bg-blue-50 text-blue-700'
                : 'text-slate-800 hover:bg-slate-50',
            )}
          >
            <button
              type="button"
              onClick={() => setActiveSession(session.id)}
              className="min-w-0 flex-1 text-left"
            >
              <p className="truncate text-sm font-medium">{session.title}</p>
              <p className="mt-1 text-[10px] text-slate-400">
                {session.messages.length > 0
                  ? `${session.messages.length} 条消息`
                  : '空对话'}
              </p>
            </button>
            <button
              type="button"
              onClick={async () => {
                if (!window.confirm('删除这条对话记录？')) return
                try {
                  await chatApi.clearGlobal(session.id)
                } catch (e) {
                  toast.error((e as Error).message)
                  return
                }
                deleteSession(session.id)
              }}
              className="shrink-0 rounded p-1 text-slate-300 opacity-0 transition-opacity hover:bg-red-50 hover:text-red-500 group-hover:opacity-100"
              title="删除对话"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
