import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { Download, Loader2, X } from 'lucide-react'

interface Props {
  open: boolean
  onClose: () => void
  defaultTitle: string
  format: 'md' | 'pdf'
  onConfirm: (title: string) => Promise<void>
}

const LABELS = {
  md: { title: '导出 Markdown', confirm: '下载 Markdown' },
  pdf: { title: '导出 PDF', confirm: '下载 PDF' },
}

export default function NoteExportDialog({
  open,
  onClose,
  defaultTitle,
  format,
  onConfirm,
}: Props) {
  const [title, setTitle] = useState(defaultTitle)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    if (open) {
      setTitle(defaultTitle)
    }
  }, [open, defaultTitle])

  const handleConfirm = async () => {
    const trimmed = title.trim()
    if (!trimmed) {
      toast.error('请填写导出标题')
      return
    }
    setExporting(true)
    try {
      await onConfirm(trimmed)
      onClose()
    } catch (e) {
      toast.error((e as Error).message || '导出失败')
    } finally {
      setExporting(false)
    }
  }

  if (!open) return null

  const labels = LABELS[format]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div className="flex items-center gap-2">
            <Download className="h-4 w-4 text-blue-600" />
            <h2 className="text-sm font-semibold text-slate-800">{labels.title}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={exporting}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          <div>
            <label className="text-xs font-medium text-slate-700">导出标题</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="默认使用视频标题"
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
            <p className="mt-1.5 text-xs text-slate-500">将用作下载文件名；默认与视频标题一致，可按需修改。</p>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={exporting}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={exporting}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {exporting && <Loader2 className="h-4 w-4 animate-spin" />}
            {exporting ? '导出中…' : labels.confirm}
          </button>
        </div>
      </div>
    </div>
  )
}
