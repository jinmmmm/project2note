import { ChevronLeft, ChevronRight, Film } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Props {
  collapsed?: boolean
  onCollapsedChange?: (collapsed: boolean) => void
  children: React.ReactNode
  className?: string
}

export default function VideoDrawer({
  collapsed = false,
  onCollapsedChange,
  children,
  className,
}: Props) {
  if (collapsed) {
    return (
      <aside
        className={cn(
          'flex h-full w-full flex-col items-center rounded-xl bg-white py-3 shadow-sm',
          className,
        )}
      >
        <button
          type="button"
          onClick={() => onCollapsedChange?.(false)}
          className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
          title="展开视频"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <Film className="mt-2 h-4 w-4 text-slate-300" />
      </aside>
    )
  }

  return (
    <aside
      className={cn(
        'flex h-full w-full flex-col overflow-y-auto rounded-xl bg-white p-3 shadow-sm',
        className,
      )}
    >
      <div className="mb-2 flex shrink-0 items-center justify-between">
        <p className="text-xs font-semibold text-slate-500">原视频</p>
        <button
          type="button"
          onClick={() => onCollapsedChange?.(true)}
          className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
          title="收起视频"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="w-full">{children}</div>
    </aside>
  )
}
