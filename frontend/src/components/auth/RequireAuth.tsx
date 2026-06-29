import { useEffect } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'

export default function RequireAuth() {
  const location = useLocation()
  const user = useAuthStore((s) => s.user)
  const loading = useAuthStore((s) => s.loading)
  const initialized = useAuthStore((s) => s.initialized)
  const fetchMe = useAuthStore((s) => s.fetchMe)

  useEffect(() => {
    if (!initialized) {
      fetchMe().catch(() => {})
    }
  }, [fetchMe, initialized])

  if (!initialized || loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50 text-sm text-slate-500">
        正在检查登录状态...
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/auth" replace state={{ from: location }} />
  }

  return <Outlet />
}
