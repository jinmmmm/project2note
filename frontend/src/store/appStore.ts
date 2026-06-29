import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Task, Provider, LlmDefaults } from '@/services'

export interface UserLLMConfig {
  mode: 'default' | 'custom'
  note_api_key: string
  note_base_url: string
  note_model_name: string
  vision_reuse_note_key: boolean
  vision_api_key: string
  vision_base_url: string
  vision_model_name: string
}

export const defaultUserLLMConfig: UserLLMConfig = {
  mode: 'default',
  note_api_key: '',
  note_base_url: '',
  note_model_name: '',
  vision_reuse_note_key: true,
  vision_api_key: '',
  vision_base_url: '',
  vision_model_name: '',
}

interface AppState {
  tasks: Task[]
  selectedTaskId: string | null
  providers: Provider[]
  llmDefaults: LlmDefaults | null
  userLLMConfig: UserLLMConfig
  tasksLoading: boolean
  tasksError: string | null
  setTasks: (tasks: Task[]) => void
  setSelectedTaskId: (id: string | null) => void
  setProviders: (providers: Provider[]) => void
  setLlmDefaults: (defaults: LlmDefaults) => void
  setUserLLMConfig: (config: Partial<UserLLMConfig>) => void
  clearUserLLMConfig: () => void
  setTasksLoading: (loading: boolean) => void
  setTasksError: (error: string | null) => void
  updateTask: (task: Task) => void
  removeTask: (id: string) => void
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      tasks: [],
      selectedTaskId: null,
      providers: [],
      llmDefaults: null,
      userLLMConfig: defaultUserLLMConfig,
      tasksLoading: false,
      tasksError: null,
      setTasks: (tasks) => set({ tasks }),
      setSelectedTaskId: (id) => set({ selectedTaskId: id }),
      setProviders: (providers) => set({ providers }),
      setLlmDefaults: (llmDefaults) => set({ llmDefaults }),
      setUserLLMConfig: (config) =>
        set((s) => ({ userLLMConfig: { ...s.userLLMConfig, ...config } })),
      clearUserLLMConfig: () => set({ userLLMConfig: defaultUserLLMConfig }),
      setTasksLoading: (tasksLoading) => set({ tasksLoading }),
      setTasksError: (tasksError) => set({ tasksError }),
      updateTask: (task) =>
        set((s) => ({
          tasks: s.tasks.map((t) => (t.id === task.id ? { ...t, ...task } : t)),
        })),
      removeTask: (id) =>
        set((s) => ({
          tasks: s.tasks.filter((t) => t.id !== id),
          selectedTaskId: s.selectedTaskId === id ? null : s.selectedTaskId,
        })),
    }),
    {
      name: 'project2note-app',
      partialize: (s) => ({ userLLMConfig: s.userLLMConfig }),
      version: 1,
      migrate: (persisted: any) => ({
        ...persisted,
        userLLMConfig: { ...defaultUserLLMConfig, ...(persisted.userLLMConfig || {}) },
      }),
    },
  ),
)
