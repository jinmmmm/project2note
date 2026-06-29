import { create } from 'zustand'
import { authApi, type AuthUser } from '@/services'

interface AuthState {
  user: AuthUser | null
  loading: boolean
  initialized: boolean
  setUser: (user: AuthUser | null) => void
  fetchMe: () => Promise<AuthUser | null>
  login: (email: string, password: string) => Promise<AuthUser>
  register: (email: string, password: string, username?: string) => Promise<AuthUser>
  logout: () => Promise<void>
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  loading: false,
  initialized: false,
  setUser: (user) => set({ user, initialized: true }),
  fetchMe: async () => {
    set({ loading: true })
    try {
      const { user } = await authApi.me()
      set({ user, loading: false, initialized: true })
      return user
    } catch {
      set({ user: null, loading: false, initialized: true })
      return null
    }
  },
  login: async (email, password) => {
    const { user } = await authApi.login({ email, password })
    set({ user, initialized: true })
    return user
  },
  register: async (email, password, username) => {
    const { user } = await authApi.register({ email, password, username })
    set({ user, initialized: true })
    return user
  },
  logout: async () => {
    await authApi.logout()
    set({ user: null, initialized: true })
  },
}))
