import { ChevronLeft, ChevronRight, Film, MessageSquare } from 'lucide-react'
import { cn } from '@/lib/utils'

export type RightPanelMode = 'video' | 'ai'

interface Props {
  mode: RightPanelMode
  collapsed?: boolean
  onCollapsedChange?: (collapsed: boolean) => void
  onOpenVideo?: () => void
  onOpenAi?: () => void
  video?: React.ReactNode
  chat?: React.ReactNode
  className?: string
}

export default function RightPanel({
  mode,
  collapsed = false,
  onCollapsedChange,
  onOpenVideo,
  onOpenAi,
  video,
  chat,
  className,
}: Props) {
  if (collapsed) {
    return (
      <aside
        className={cn(
          'flex h-full w-full flex-col items-center gap-2 rounded-xl bg-white py-3 shadow-sm',
          className,
        )}
      >
        <button
          type="button"
          onClick={() => onCollapsedChange?.(false)}
          className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
          title="展开右栏"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="flex flex-col items-center gap-1.5">
          <button
            type="button"
            onClick={onOpenVideo}
            className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-blue-50 hover:text-blue-600"
            title="视频"
          >
            <Film className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onOpenAi}
            className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-blue-50 hover:text-blue-600"
            title="本篇追问"
          >
            <MessageSquare className="h-4 w-4" />
          </button>
        </div>
      </aside>
    )
  }

  return (
    <aside className={cn('flex h-full w-full flex-col rounded-xl bg-white shadow-sm', className)}>
      <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-3 py-2">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onOpenVideo}
            className={cn(
              'flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors',
              mode === 'video'
                ? 'bg-blue-50 font-medium text-blue-600'
                : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700',
            )}
            title="视频"
          >
            <Film className="h-3.5 w-3.5" />
            视频
          </button>
          <button
            type="button"
            onClick={onOpenAi}
            className={cn(
              'flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors',
              mode === 'ai'
                ? 'bg-blue-50 font-medium text-blue-600'
                : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700',
            )}
            title="本篇追问"
          >
            <MessageSquare className="h-3.5 w-3.5" />
            本篇追问
          </button>
        </div>
        <button
          type="button"
          onClick={() => onCollapsedChange?.(true)}
          className="rounded p-1 text-slate-400 hover:bg-slate-100"
          title="收起"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {mode === 'video' && video && <div className="min-h-0 flex-1 overflow-hidden p-2">{video}</div>}
        {mode === 'ai' && chat && <div className="min-h-0 flex-1 overflow-hidden">{chat}</div>}
      </div>
    </aside>
  )
}
