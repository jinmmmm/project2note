import { Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Props {
  onClick: () => void
  className?: string
  title?: string
}

export default function NotePolishButton({ onClick, className, title = 'AI 润色' }: Props) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onClick()
      }}
      title={title}
      className={cn(
        'inline-flex shrink-0 items-center gap-0.5 rounded-md border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-[10px] font-medium text-violet-700 opacity-70 transition-opacity hover:bg-violet-100 hover:opacity-100 group-hover:opacity-100 focus:opacity-100',
        className,
      )}
    >
      <Sparkles className="h-3 w-3" />
      润色
    </button>
  )
}
