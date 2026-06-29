import ResizeHandle from '@/components/layout/ResizeHandle'
import { useHorizontalResize } from '@/hooks/useHorizontalResize'
import { cn } from '@/lib/utils'

interface Props {
  sidebar?: React.ReactNode
  children: React.ReactNode
  rightPanel?: React.ReactNode
  enabled?: boolean
  sidebarCollapsed?: boolean
  rightCollapsed?: boolean
  className?: string
}

/** 结构化笔记三栏：目录 | 笔记 | 右栏，左右拖拽调宽 */
export default function NoteThreeColumnLayout({
  sidebar,
  children,
  rightPanel,
  enabled = true,
  sidebarCollapsed = false,
  rightCollapsed = false,
  className,
}: Props) {
  const { width: sidebarWidth, onMouseDown: onSidebarResize } = useHorizontalResize({
    defaultWidth: 208,
    minWidth: 160,
    maxWidth: 420,
    storageKey: 'project2note-note-toc-width',
  })

  const { width: rightWidth, onMouseDown: onRightResize } = useHorizontalResize({
    defaultWidth: 320,
    minWidth: 280,
    maxWidth: 720,
    storageKey: 'project2note-note-video-width',
    invertDelta: true,
  })

  if (!enabled) {
    return <div className={cn('min-h-0 flex-1 overflow-hidden', className)}>{children}</div>
  }

  return (
    <div className={cn('flex min-h-0 flex-1 bg-slate-50 px-2 pb-2', className)}>
      {sidebar && (
        <div
          className="hidden h-full shrink-0 overflow-hidden lg:block"
          style={{ width: sidebarCollapsed ? 40 : sidebarWidth }}
        >
          {sidebar}
        </div>
      )}

      {sidebar && !sidebarCollapsed && (
        <div className="hidden h-full shrink-0 items-stretch lg:flex">
          <ResizeHandle variant="subtle" onMouseDown={onSidebarResize} />
        </div>
      )}

      <div className="min-h-0 min-w-0 flex-1 overflow-hidden rounded-xl bg-white shadow-sm">
        {children}
      </div>

      {rightPanel && !rightCollapsed && (
        <div className="hidden h-full shrink-0 items-stretch lg:flex">
          <ResizeHandle variant="subtle" onMouseDown={onRightResize} />
        </div>
      )}

      {rightPanel && (
        <div
          className="hidden h-full shrink-0 overflow-hidden lg:block"
          style={{ width: rightCollapsed ? 40 : rightWidth }}
        >
          {rightPanel}
        </div>
      )}
    </div>
  )
}
