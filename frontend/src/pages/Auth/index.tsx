import { FormEvent, useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { BookOpen, Loader2 } from 'lucide-react'
import { useAuthStore } from '@/store/authStore'

export default function AuthPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const user = useAuthStore((s) => s.user)
  const login = useAuthStore((s) => s.login)
  const register = useAuthStore((s) => s.register)
  const [mode, setMode] = useState<'login' | 'register'>('register')
  const [email, setEmail] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname || '/'

  if (user) {
    return <Navigate to={from} replace />
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    const normalizedEmail = email.trim()
    if (!normalizedEmail || !password) {
      toast.error('请填写邮箱和密码')
      return
    }
    if (password.length < 8) {
      toast.error('密码至少需要 8 位')
      return
    }
    if (mode === 'register' && password !== confirmPassword) {
      toast.error('两次输入的密码不一致')
      return
    }

    setSubmitting(true)
    try {
      if (mode === 'register') {
        await register(normalizedEmail, password, username.trim() || undefined)
        toast.success('注册成功，欢迎使用')
      } else {
        await login(normalizedEmail, password)
        toast.success('登录成功')
      }
      navigate(from, { replace: true })
    } catch (err) {
      toast.error((err as Error).message || '操作失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50 px-4 py-10">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-5xl items-center justify-center">
        <div className="grid w-full overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl md:grid-cols-[1fr_420px]">
          <section className="hidden bg-slate-950 p-10 text-white md:block">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-500">
                <BookOpen className="h-6 w-6" />
              </div>
              <div>
                <h1 className="text-xl font-bold">Project2Note</h1>
                <p className="text-sm text-slate-300">视频转 AI 笔记工具</p>
              </div>
            </div>
            <div className="mt-20 space-y-5">
              <h2 className="text-3xl font-bold leading-tight">注册账号后，开始管理你的专属视频笔记空间。</h2>
              <p className="text-sm leading-6 text-slate-300">
                每个账号拥有独立的任务、笔记、模型配置、B站 Cookie 和飞书授权。公开分享链接仍可直接访问，适合把成果发给他人查看。
              </p>
            </div>
          </section>

          <section className="p-6 sm:p-10">
            <div className="mb-8 md:hidden">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-blue-600 text-white">
                  <BookOpen className="h-5 w-5" />
                </div>
                <div>
                  <h1 className="text-lg font-bold text-slate-900">Project2Note</h1>
                  <p className="text-xs text-slate-500">视频转 AI 笔记工具</p>
                </div>
              </div>
            </div>

            <div className="mb-6">
              <h2 className="text-2xl font-bold text-slate-900">{mode === 'register' ? '创建账号' : '欢迎回来'}</h2>
              <p className="mt-1 text-sm text-slate-500">
                {mode === 'register' ? '注册后即可使用全部功能' : '登录后继续使用你的笔记空间'}
              </p>
            </div>

            <div className="mb-6 grid grid-cols-2 rounded-xl bg-slate-100 p-1 text-sm font-medium">
              <button
                type="button"
                onClick={() => setMode('login')}
                className={`rounded-lg px-4 py-2 ${mode === 'login' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
              >
                登录
              </button>
              <button
                type="button"
                onClick={() => setMode('register')}
                className={`rounded-lg px-4 py-2 ${mode === 'register' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
              >
                注册
              </button>
            </div>

            <form onSubmit={onSubmit} className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">邮箱</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50"
                />
              </div>

              {mode === 'register' && (
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">昵称</label>
                  <input
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="用于在界面中显示，可选"
                    className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50"
                  />
                </div>
              )}

              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">密码</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="至少 8 位"
                  className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50"
                />
              </div>

              {mode === 'register' && (
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">确认密码</label>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="再次输入密码"
                    className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50"
                  />
                </div>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                {mode === 'register' ? '注册并开始使用' : '登录'}
              </button>
            </form>
          </section>
        </div>
      </div>
    </div>
  )
}
