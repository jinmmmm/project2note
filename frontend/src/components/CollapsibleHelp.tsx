import { useState } from 'react'
import { ChevronDown, ChevronRight, CircleHelp } from 'lucide-react'
import { cn } from '@/lib/utils'

interface CollapsibleHelpProps {
  title?: string
  defaultOpen?: boolean
  children: React.ReactNode
}

export default function CollapsibleHelp({
  title = '使用说明',
  defaultOpen = false,
  children,
}: CollapsibleHelpProps) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-slate-600 hover:bg-slate-100/80"
      >
        <CircleHelp className="h-4 w-4 shrink-0 text-blue-500" />
        <span className="font-medium">{title}</span>
        {open ? (
          <ChevronDown className="ml-auto h-4 w-4 text-slate-400" />
        ) : (
          <ChevronRight className="ml-auto h-4 w-4 text-slate-400" />
        )}
      </button>
      <div
        className={cn(
          'overflow-hidden border-t border-slate-200 transition-all',
          open ? 'max-h-[2000px] opacity-100' : 'max-h-0 border-t-0 opacity-0',
        )}
      >
        <div className="space-y-3 px-3 py-3 text-sm leading-relaxed text-slate-600">{children}</div>
      </div>
    </div>
  )
}
