import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ChatMessage } from '@/services'

export type ChatMode = 'notes' | 'free'
export type ChatCollectionFilter = 'all' | 'uncategorized' | string

export interface ChatSession {
  id: string
  title: string
  messages: ChatMessage[]
  mode: ChatMode
  selectedTaskIds: string[]
  updatedAt: string
}

function createEmptySession(): ChatSession {
  return {
    id: crypto.randomUUID(),
    title: '新对话',
    messages: [],
    mode: 'notes',
    selectedTaskIds: [],
    updatedAt: new Date().toISOString(),
  }
}

interface ChatState {
  sessions: ChatSession[]
  activeSessionId: string | null
  collectionFilter: ChatCollectionFilter
  ensureActiveSession: () => string
  createSession: () => void
  deleteSession: (id: string) => void
  setActiveSession: (id: string) => void
  setCollectionFilter: (filter: ChatCollectionFilter) => void
  setActiveMode: (mode: ChatMode) => void
  toggleActiveTask: (taskId: string) => void
  clearActiveTasks: () => void
  appendToActiveSession: (message: ChatMessage) => void
  setActiveMessages: (messages: ChatMessage[]) => void
  getActiveSession: () => ChatSession | null
}

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      sessions: [],
      activeSessionId: null,
      collectionFilter: 'all',

      getActiveSession: () => {
        const { sessions, activeSessionId } = get()
        if (!activeSessionId) return null
        return sessions.find((s) => s.id === activeSessionId) ?? null
      },

      ensureActiveSession: () => {
        const { sessions, activeSessionId } = get()
        if (sessions.length === 0) {
          const session = createEmptySession()
          set({ sessions: [session], activeSessionId: session.id })
          return session.id
        }
        if (!activeSessionId || !sessions.some((s) => s.id === activeSessionId)) {
          set({ activeSessionId: sessions[0].id })
          return sessions[0].id
        }
        return activeSessionId
      },

      createSession: () => {
        const session = createEmptySession()
        set((s) => ({
          sessions: [session, ...s.sessions],
          activeSessionId: session.id,
        }))
      },

      deleteSession: (id) => {
        set((s) => {
          const sessions = s.sessions.filter((item) => item.id !== id)
          if (sessions.length === 0) {
            const session = createEmptySession()
            return { sessions: [session], activeSessionId: session.id }
          }
          const activeSessionId =
            s.activeSessionId === id ? sessions[0].id : s.activeSessionId
          return { sessions, activeSessionId }
        })
      },

      setActiveSession: (id) => set({ activeSessionId: id }),

      setCollectionFilter: (collectionFilter) => set({ collectionFilter }),

      setActiveMode: (mode) => {
        const id = get().activeSessionId
        if (!id) return
        set((s) => ({
          sessions: s.sessions.map((item) =>
            item.id === id ? { ...item, mode, updatedAt: new Date().toISOString() } : item,
          ),
        }))
      },

      toggleActiveTask: (taskId) => {
        const id = get().activeSessionId
        if (!id) return
        set((s) => ({
          sessions: s.sessions.map((item) => {
            if (item.id !== id) return item
            const selected = item.selectedTaskIds.includes(taskId)
              ? item.selectedTaskIds.filter((tid) => tid !== taskId)
              : [...item.selectedTaskIds, taskId]
            return { ...item, selectedTaskIds: selected, updatedAt: new Date().toISOString() }
          }),
        }))
      },

      clearActiveTasks: () => {
        const id = get().activeSessionId
        if (!id) return
        set((s) => ({
          sessions: s.sessions.map((item) =>
            item.id === id ? { ...item, selectedTaskIds: [], updatedAt: new Date().toISOString() } : item,
          ),
        }))
      },

      appendToActiveSession: (message) => {
        const id = get().activeSessionId
        if (!id) return
        set((s) => ({
          sessions: s.sessions.map((item) => {
            if (item.id !== id) return item
            const messages = [...item.messages, message]
            let title = item.title
            if (title === '新对话' && message.role === 'user') {
              title =
                message.content.slice(0, 28) + (message.content.length > 28 ? '…' : '')
            }
            return { ...item, title, messages, updatedAt: new Date().toISOString() }
          }),
        }))
      },

      setActiveMessages: (messages) => {
        const id = get().activeSessionId
        if (!id) return
        set((s) => ({
          sessions: s.sessions.map((item) =>
            item.id === id ? { ...item, messages, updatedAt: new Date().toISOString() } : item,
          ),
        }))
      },
    }),
    { name: 'project2note-chat-sessions-v2' },
  ),
)
