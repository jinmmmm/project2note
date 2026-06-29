import { useState, useEffect } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { ArrowLeft, Copy, ExternalLink, ChevronDown, ChevronUp, LogOut, User } from 'lucide-react'
import { settingsApi, feishuApi } from '@/services'
import { useAuthStore } from '@/store/authStore'
import { useAppStore, defaultUserLLMConfig } from '@/store/appStore'
import type { UserLLMConfig } from '@/store/appStore'
import FeishuFolderPicker from '@/components/FeishuFolderPicker'
import BilibiliCookieHelp from '@/components/settings/BilibiliCookieHelp'
import FeishuSyncHelp from '@/components/settings/FeishuSyncHelp'

const WHISPER_TYPES = ['fast-whisper']
const DEFAULT_FEISHU_REDIRECT = 'http://localhost:8483/api/feishu/callback'

export default function SettingsPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const authUser = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)

  const userLLMConfig = useAppStore((s) => s.userLLMConfig)
  const setUserLLMConfig = useAppStore((s) => s.setUserLLMConfig)
  const clearUserLLMConfig = useAppStore((s) => s.clearUserLLMConfig)
  const llmDefaults = useAppStore((s) => s.llmDefaults)

  const [draftLlm, setDraftLlm] = useState<UserLLMConfig>(userLLMConfig)

  useEffect(() => {
    setDraftLlm(userLLMConfig)
  }, [userLLMConfig])

  const [biliCookie, setBiliCookie] = useState('')
  const [feishuOk, setFeishuOk] = useState(false)
  const [feishuConfigured, setFeishuConfigured] = useState(false)
  const [feishuAppId, setFeishuAppId] = useState('')
  const [feishuAppSecret, setFeishuAppSecret] = useState('')
  const [feishuRedirectUri, setFeishuRedirectUri] = useState(DEFAULT_FEISHU_REDIRECT)
  const [feishuAuthUrl, setFeishuAuthUrl] = useState('')
  const [feishuSaving, setFeishuSaving] = useState(false)
  const [feishuAuthing, setFeishuAuthing] = useState(false)
  const [feishuSyncFolderToken, setFeishuSyncFolderToken] = useState('')
  const [feishuSyncFolderName, setFeishuSyncFolderName] = useState('我的空间')

  const [transcriberType, setTranscriberType] = useState('bcut')
  const [whisperSize, setWhisperSize] = useState('tiny')
  const [whisperModelDir, setWhisperModelDir] = useState('')
  const [availableTypes, setAvailableTypes] = useState<{ value: string; label: string }[]>([])
  const [whisperSizes, setWhisperSizes] = useState<string[]>([])

  const refreshFeishuStatus = async () => {
    const [status, config] = await Promise.all([feishuApi.status(), feishuApi.appConfig()])
    setFeishuOk(status.authorized)
    setFeishuConfigured(status.configured)
    setFeishuRedirectUri(status.redirect_uri || config.redirect_uri || DEFAULT_FEISHU_REDIRECT)
    setFeishuAppId(config.app_id || '')
    setFeishuSyncFolderToken(status.default_folder_token || config.default_folder_token || '')
    setFeishuSyncFolderName(status.default_folder_name || config.default_folder_name || '我的空间')
  }

  useEffect(() => {
    settingsApi.getCookie('bilibili').then((r) => setBiliCookie(r.cookie || '')).catch(() => {})
    refreshFeishuStatus().catch(() => {})
    settingsApi.getTranscriberConfig().then((cfg) => {
      setTranscriberType(cfg.transcriber_type)
      setWhisperSize(cfg.whisper_model_size)
      setWhisperModelDir(cfg.whisper_model_dir || '')
      setAvailableTypes(cfg.available_types)
      setWhisperSizes(cfg.whisper_model_sizes)
    }).catch(() => {})
    if (searchParams.get('feishu') === 'ok') {
      toast.success('飞书授权成功')
      refreshFeishuStatus().catch(() => {})
    }
    if (searchParams.get('feishu') === 'fail') {
      const reason = searchParams.get('reason')
      toast.error(reason ? `飞书授权失败：${decodeURIComponent(reason)}` : '飞书授权失败，请检查 App 配置与开放平台重定向 URL')
    }
  }, [searchParams])

  const saveCookie = async () => {
    await settingsApi.setCookie('bilibili', biliCookie)
    toast.success('B站 Cookie 已保存')
  }

  const saveTranscriberConfig = async () => {
    await settingsApi.saveTranscriberConfig({
      transcriber_type: transcriberType,
      whisper_model_size: WHISPER_TYPES.includes(transcriberType) ? whisperSize : undefined,
      whisper_model_dir: WHISPER_TYPES.includes(transcriberType) ? whisperModelDir.trim() : '',
    })
    toast.success('转写引擎已保存')
  }

  const saveLlmConfig = () => {
    setUserLLMConfig(draftLlm)
    toast.success('模型配置已保存')
  }

  const [showCustomLlm, setShowCustomLlm] = useState(false)

  const resetLlmConfig = () => {
    clearUserLLMConfig()
    setDraftLlm(defaultUserLLMConfig)
    toast.success('已清除自定义模型配置')
  }

  const saveFeishuApp = async () => {
    if (!feishuAppId.trim() || !feishuAppSecret.trim()) {
      toast.error('请填写 App ID 和 App Secret')
      return
    }
    setFeishuSaving(true)
    try {
      const res = await feishuApi.saveAppConfig({
        app_id: feishuAppId.trim(),
        app_secret: feishuAppSecret.trim(),
        redirect_uri: feishuRedirectUri.trim() || DEFAULT_FEISHU_REDIRECT,
      })
      setFeishuConfigured(res.configured)
      setFeishuRedirectUri(res.redirect_uri)
      setFeishuAppSecret('')
      toast.success('飞书应用配置已保存')
    } catch (e) {
      toast.error((e as Error).message || '保存失败')
    } finally {
      setFeishuSaving(false)
    }
  }

  const loadAuthUrl = async () => {
    if (feishuAuthing) return
    setFeishuAuthing(true)
    try {
      const res = await feishuApi.authUrl()
      if (!res.url) {
        toast.error('未获取到授权链接')
        return
      }
      setFeishuAuthUrl(res.url)
      toast.success('授权链接已生成，打开链接完成飞书登录即可')
    } catch (e) {
      toast.error((e as Error).message || '获取授权链接失败')
    } finally {
      setFeishuAuthing(false)
    }
  }

  const copyAuthUrl = async () => {
    if (!feishuAuthUrl) return
    await navigator.clipboard.writeText(feishuAuthUrl)
    toast.success('授权链接已复制')
  }

  const handleLogout = async () => {
    try {
      await logout()
      toast.success('已退出登录')
      navigate('/auth', { replace: true })
    } catch (e) {
      toast.error((e as Error).message || '退出失败')
    }
  }

  return (
    <div className="h-full overflow-y-auto bg-slate-50">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-slate-200 bg-white px-6 py-4">
        <Link to="/" className="text-slate-500 hover:text-slate-700">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-lg font-semibold text-slate-900">设置</h1>
      </header>

      <div className="mx-auto max-w-2xl space-y-6 p-6">
        {/* 账号信息 */}
        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-600">
                <User className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <h2 className="font-semibold text-slate-800">账号信息</h2>
                <p className="mt-1 truncate text-sm text-slate-600">{authUser?.username || '当前用户'}</p>
                <p className="mt-0.5 truncate text-xs text-slate-400">{authUser?.email || '未获取到邮箱'}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleLogout}
              className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:border-red-200 hover:bg-red-50 hover:text-red-600"
            >
              <LogOut className="h-4 w-4" />
              退出登录
            </button>
          </div>
          <p className="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-500">
            当前账号的数据与其他用户隔离；下方可统一管理大模型、音频转写、B站 Cookie 和飞书同步配置。
          </p>
        </section>

        {/* 模型配置 */}
        <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="font-semibold text-slate-800">模型配置</h2>

          {llmDefaults && (
            <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600 space-y-1">
              <p className="font-medium text-slate-700">
                默认供应商：{llmDefaults.provider_name}（无需配置即可使用）
              </p>
              <p>笔记生成模型：<span className="font-medium text-slate-800">{llmDefaults.model_name}</span></p>
              <p>视觉多模态模型：<span className="font-medium text-slate-800">{llmDefaults.vision_model_name}</span></p>
            </div>
          )}

          <div className="border-t border-slate-100 pt-3">
            <button
              type="button"
              onClick={() => setShowCustomLlm((v) => !v)}
              className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600"
            >
              {showCustomLlm ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              自定义模型配置
            </button>

            {showCustomLlm && (
              <div className="mt-3 space-y-3">
                <p className="text-xs text-slate-500">填写后将覆盖默认模型，使用你自己的 API Key。</p>
                <div className="rounded-xl border border-slate-100 p-4 space-y-2">
                  <h4 className="text-sm font-semibold text-slate-700">笔记生成</h4>
                  <input
                    type="password"
                    value={draftLlm.note_api_key}
                    onChange={(e) => setDraftLlm({ ...draftLlm, note_api_key: e.target.value })}
                    placeholder="API Key（留空则使用默认）"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
                  />
                  <input
                    value={draftLlm.note_base_url}
                    onChange={(e) => setDraftLlm({ ...draftLlm, note_base_url: e.target.value })}
                    placeholder="Base URL"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
                  />
                  <input
                    value={draftLlm.note_model_name}
                    onChange={(e) => setDraftLlm({ ...draftLlm, note_model_name: e.target.value })}
                    placeholder="模型名"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
                  />
                </div>

                <div className="rounded-xl border border-slate-100 p-4 space-y-2">
                  <h4 className="text-sm font-semibold text-slate-700">视觉多模态</h4>
                  <p className="text-xs text-slate-500">仅在截图模式为「增强」时使用，用于从视频截图中识别关键画面时间戳，提升笔记内容质量。</p>
                  <input
                    type="password"
                    value={draftLlm.vision_api_key}
                    onChange={(e) => setDraftLlm({ ...draftLlm, vision_api_key: e.target.value })}
                    placeholder="视觉 API Key（留空则使用默认）"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
                  />
                  <input
                    value={draftLlm.vision_base_url}
                    onChange={(e) => setDraftLlm({ ...draftLlm, vision_base_url: e.target.value })}
                    placeholder="视觉 Base URL"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
                  />
                  <input
                    value={draftLlm.vision_model_name}
                    onChange={(e) => setDraftLlm({ ...draftLlm, vision_model_name: e.target.value })}
                    placeholder={llmDefaults?.vision_model_name || '视觉模型名'}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
                  />
                </div>

                <div className="flex justify-between gap-2">
                  <button
                    type="button"
                    onClick={resetLlmConfig}
                    className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-500 hover:bg-slate-50"
                  >
                    清除自定义配置
                  </button>
                  <button
                    type="button"
                    onClick={saveLlmConfig}
                    className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                  >
                    保存
                  </button>
                </div>
              </div>
            )}
          </div>

        </section>

        {/* 音频转写引擎 */}
        <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="font-semibold text-slate-800">音频转写引擎</h2>
          <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600 space-y-2">
            <p><strong>1.</strong> B站视频会<strong>优先使用官方字幕</strong>，有字幕则跳过转写。</p>
            <p><strong>2.</strong> 无字幕时（B站无字幕 / 抖音 / 本地视频），自动提取音频并转写：</p>
            <p className="pl-4">首选<strong>快手</strong>在线转写 → 失败则降级<strong>必剪</strong> → 再失败降级<strong>本地 Whisper</strong></p>
            <p><strong>3.</strong> 所有链路均失败才会报错，确保转写尽量成功。</p>
          </div>
        </section>

        {/* B站 Cookie */}
        <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="font-semibold text-slate-800">B站 Cookie</h2>
          <BilibiliCookieHelp />
          <textarea
            value={biliCookie}
            onChange={(e) => setBiliCookie(e.target.value)}
            rows={4}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-sm"
            placeholder="SESSDATA=...; bili_jct=..."
          />
          <button onClick={saveCookie} className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700">
            保存 Cookie
          </button>
        </section>

        {/* 飞书同步 */}
        <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="font-semibold text-slate-800">飞书同步</h2>
          <FeishuSyncHelp />
          <p className="text-sm text-slate-500">
            配置 App 凭证并授权后，可在笔记详情页点「飞书」同步到云文档。
          </p>
          <div>
            <label className="text-sm text-slate-600">App ID</label>
            <input
              value={feishuAppId}
              onChange={(e) => setFeishuAppId(e.target.value)}
              placeholder="cli_xxx"
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-sm text-slate-600">App Secret</label>
            <input
              value={feishuAppSecret}
              onChange={(e) => setFeishuAppSecret(e.target.value)}
              placeholder={feishuConfigured ? '已保存，重新填写可更新' : '应用密钥'}
              type="password"
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-sm text-slate-600">重定向 URL（需与开放平台一致）</label>
            <input
              value={feishuRedirectUri}
              onChange={(e) => setFeishuRedirectUri(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-xs"
            />
          </div>
          <button
            onClick={saveFeishuApp}
            disabled={feishuSaving}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm hover:bg-slate-50 disabled:opacity-50"
          >
            {feishuSaving ? '保存中…' : '保存应用配置'}
          </button>

          <div className="border-t border-slate-100 pt-4">
            <p className="text-sm">
              账号状态：{feishuOk ? <span className="text-green-600">已授权</span> : <span className="text-slate-400">未授权</span>}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                onClick={loadAuthUrl}
                disabled={!feishuConfigured || feishuAuthing}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {feishuAuthing ? '生成中…' : feishuOk ? '重新授权' : '生成授权链接'}
              </button>
              {feishuAuthUrl && (
                <>
                  <a
                    href={feishuAuthUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm text-blue-700 hover:bg-blue-100"
                  >
                    <ExternalLink className="h-4 w-4" />
                    打开授权页
                  </a>
                  <button
                    onClick={copyAuthUrl}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-4 py-2 text-sm hover:bg-slate-50"
                  >
                    <Copy className="h-4 w-4" />
                    复制链接
                  </button>
                </>
              )}
            </div>
            {feishuAuthUrl && (
              <p className="mt-3 break-all rounded-lg bg-slate-50 px-3 py-2 font-mono text-xs text-slate-600">
                {feishuAuthUrl}
              </p>
            )}

            <FeishuFolderPicker
              disabled={!feishuOk}
              savedToken={feishuSyncFolderToken}
              savedName={feishuSyncFolderName}
              onSaved={(token, name) => {
                setFeishuSyncFolderToken(token)
                setFeishuSyncFolderName(name)
              }}
            />
          </div>
        </section>
      </div>
    </div>
  )
}
