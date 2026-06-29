interface Props {
  onMouseDown: (e: React.MouseEvent) => void
  variant?: 'default' | 'subtle'
}

export default function ResizeHandle({ onMouseDown, variant = 'default' }: Props) {
  if (variant === 'subtle') {
    return (
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="拖拽调整宽度"
        onMouseDown={onMouseDown}
        className="group relative z-10 flex w-3 shrink-0 cursor-col-resize items-center justify-center self-stretch"
      >
        <div className="h-12 w-1 rounded-full bg-slate-200/0 transition-colors group-hover:bg-slate-300 group-active:bg-blue-400" />
        <div className="absolute inset-y-0 -left-1 -right-1" />
      </div>
    )
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="拖拽调整宽度"
      onMouseDown={onMouseDown}
      className="group relative z-10 w-1 shrink-0 cursor-col-resize bg-slate-200/80 transition-colors hover:bg-blue-400/60 active:bg-blue-500"
    >
      <div className="absolute inset-y-0 -left-1.5 -right-1.5" />
    </div>
  )
}
