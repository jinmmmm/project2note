import { ChevronLeft, ChevronRight } from 'lucide-react'
import { formatTimestamp } from '@/lib/timestamp'
import { cn } from '@/lib/utils'
import type { TocItem } from '@/lib/markdown'

interface Props {
  items: TocItem[]
  activeId?: string
  onNavigate: (id: string) => void
  onSeek?: (seconds: number) => void
  collapsed?: boolean
  onCollapsedChange?: (collapsed: boolean) => void
  className?: string
}

export default function NoteToc({
  items,
  activeId,
  onNavigate,
  onSeek,
  collapsed = false,
  onCollapsedChange,
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
          title="展开目录"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </aside>
    )
  }

  return (
    <aside className={cn('flex h-full w-full flex-col rounded-xl bg-white shadow-sm', className)}>
      <div className="flex items-center justify-between px-3 py-2.5">
        <p className="text-xs font-semibold tracking-wide text-slate-500">正文目录</p>
        <button
          type="button"
          onClick={() => onCollapsedChange?.(true)}
          className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
          title="折叠目录"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
      </div>
      <nav className="flex-1 overflow-y-auto px-3 pb-3">
        {items.length === 0 ? (
          <p className="text-xs text-slate-300">暂无目录</p>
        ) : (
          <div className="space-y-0.5">
            {items.map((item, idx) => (
              <div
                key={`${item.id}-${idx}`}
                className={cn(
                  'flex items-start gap-1 rounded-md transition-colors',
                  activeId === item.id && 'bg-blue-50/80',
                )}
              >
                <button
                  type="button"
                  onClick={() => onNavigate(item.id)}
                  className={cn(
                    'min-w-0 flex-1 py-1 text-left text-xs leading-relaxed transition-colors',
                    item.level === 1 && 'font-semibold text-slate-800',
                    item.level === 2 && 'border-l border-slate-200 pl-2.5 font-normal text-slate-600',
                    item.level >= 3 && 'border-l border-slate-200 pl-4 text-slate-500',
                    activeId === item.id ? 'font-medium text-blue-600' : 'hover:text-blue-600',
                  )}
                  title={item.text}
                >
                  <span className="line-clamp-2">{item.text}</span>
                </button>
                {item.timestamp != null && onSeek && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      onSeek(item.timestamp!)
                    }}
                    className="note-timestamp note-timestamp-btn shrink-0 px-1 py-1 text-[10px]"
                    title={`跳转到 ${formatTimestamp(item.timestamp)}`}
                  >
                    {formatTimestamp(item.timestamp)}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </nav>
    </aside>
  )
}
