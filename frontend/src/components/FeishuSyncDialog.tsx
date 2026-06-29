import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Cloud, Loader2, X } from 'lucide-react'
import { feishuApi } from '@/services'
import FeishuFolderPicker from '@/components/FeishuFolderPicker'

interface Props {
  open: boolean
  onClose: () => void
  taskId: string
  defaultTitle?: string
}

export default function FeishuSyncDialog({ open, onClose, taskId, defaultTitle = '视频笔记' }: Props) {
  const [loading, setLoading] = useState(true)
  const [authorized, setAuthorized] = useState(false)
  const [configured, setConfigured] = useState(true)
  const [folderToken, setFolderToken] = useState('')
  const [folderName, setFolderName] = useState('我的空间')
  const [docTitle, setDocTitle] = useState(defaultTitle)
  const [syncing, setSyncing] = useState(false)

  useEffect(() => {
    if (!open) return
    setDocTitle(defaultTitle)
    setLoading(true)
    feishuApi
      .status()
      .then((r) => {
        setAuthorized(r.authorized)
        setConfigured(r.configured ?? true)
        setFolderToken(r.default_folder_token || '')
        setFolderName(r.default_folder_name || '我的空间')
      })
      .catch((e) => toast.error((e as Error).message || '加载飞书状态失败'))
      .finally(() => setLoading(false))
  }, [open, defaultTitle])

  const handleConfirm = async () => {
    const trimmedTitle = docTitle.trim()
    if (!trimmedTitle) {
      toast.error('请填写文档标题')
      return
    }
    setSyncing(true)
    try {
      await feishuApi.saveSyncFolder({ folder_token: folderToken, folder_name: folderName })
      const res = await feishuApi.sync(taskId, {
        folder_token: folderToken,
        folder_name: folderName,
        title: trimmedTitle,
      })
      if (res.doc_url) {
        toast.success(
          (t) => (
            <span>
              已同步到飞书，
              <a
                href={res.doc_url}
                target="_blank"
                rel="noreferrer"
                className="underline"
                onClick={() => toast.dismiss(t.id)}
              >
                点击打开文档
              </a>
            </span>
          ),
          { duration: 8000 },
        )
      } else {
        toast.success('已同步到飞书')
      }
      if (res.content_warning) {
        toast(res.content_warning, { icon: '⚠️' })
      }
      onClose()
    } catch (e) {
      toast.error((e as Error).message || '同步失败')
    } finally {
      setSyncing(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-2xl bg-white shadow-xl">
        <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-5 py-4">
          <div className="flex items-center gap-2">
            <Cloud className="h-4 w-4 text-blue-600" />
            <h2 className="text-sm font-semibold text-slate-800">同步到飞书</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={syncing}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
          <div>
            <label className="text-xs font-medium text-slate-700">文档标题</label>
            <input
              value={docTitle}
              onChange={(e) => setDocTitle(e.target.value)}
              placeholder="默认使用视频标题"
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
            <p className="mt-1.5 text-xs text-slate-500">将用作飞书云文档标题，默认与视频标题一致。</p>
          </div>

          {loading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              加载中…
            </div>
          ) : !configured ? (
            <p className="text-sm text-slate-600">
              请先在
              <Link to="/settings" className="mx-1 text-blue-600 underline" onClick={onClose}>
                设置页
              </Link>
              填写飞书应用 App ID 与 App Secret。
            </p>
          ) : !authorized ? (
            <p className="text-sm text-slate-600">
              请先在
              <Link to="/settings" className="mx-1 text-blue-600 underline" onClick={onClose}>
                设置页
              </Link>
              完成飞书授权。
            </p>
          ) : (
            <>
              <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3">
                <p className="text-xs text-blue-700">确认保存到以下目录</p>
                <p className="mt-1 text-sm font-semibold text-blue-900">{folderName || '我的空间'}</p>
                <p className="mt-1 text-xs text-blue-600/80">可在下方浏览并更换目录，确认后开始同步。</p>
              </div>

              <FeishuFolderPicker
                mode="select"
                selectedToken={folderToken}
                selectedName={folderName}
                onSelectFolder={(token, name) => {
                  setFolderToken(token)
                  setFolderName(name)
                }}
              />
            </>
          )}
        </div>

        {authorized && configured && !loading && (
          <div className="flex shrink-0 justify-end gap-2 border-t border-slate-100 px-5 py-4">
            <button
              type="button"
              onClick={onClose}
              disabled={syncing}
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={syncing}
              className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {syncing && <Loader2 className="h-4 w-4 animate-spin" />}
              {syncing ? '同步中…' : '确认同步'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
