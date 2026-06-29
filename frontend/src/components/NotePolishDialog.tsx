import { useEffect, useState } from 'react'
import { Loader2, Sparkles, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { cn } from '@/lib/utils'

export interface PolishTarget {
  scope: 'full' | 'section'
  label: string
  headingTitle?: string
  headingDepth?: number
}

interface Props {
  open: boolean
  target: PolishTarget | null
  onClose: () => void
  onConfirm: (instruction: string) => Promise<void>
}

export default function NotePolishDialog({ open, target, onClose, onConfirm }: Props) {
  const [instruction, setInstruction] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (open) setInstruction('')
  }, [open, target?.label])

  if (!open || !target) return null

  const handleSubmit = async () => {
    setSubmitting(true)
    try {
      await onConfirm(instruction.trim())
      onClose()
    } catch (e) {
      toast.error((e as Error).message || '润色失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-violet-600" />
            <h2 className="text-sm font-semibold text-slate-800">AI 润色</h2>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          <p className="text-xs text-slate-500">
            润色范围：
            <span className="font-medium text-slate-700">{target.label}</span>
          </p>
          <div>
            <label className="text-xs font-medium text-slate-700">润色要求（可选）</label>
            <textarea
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              rows={4}
              placeholder="例如：将全文中的 Cloud Code 统一改为 Claude Code"
              className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
            <p className="mt-1 text-[10px] text-slate-400">留空则自动修正专有名词并优化表述</p>
          </div>

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-lg border border-slate-200 py-2 text-sm text-slate-600 hover:bg-slate-50"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting}
              className={cn(
                'flex flex-1 items-center justify-center gap-2 rounded-lg bg-violet-600 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50',
              )}
            >
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              开始润色
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
