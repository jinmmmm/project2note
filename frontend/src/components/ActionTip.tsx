import type { ReactElement } from 'react'
import { cn } from '@/lib/utils'

interface ActionTipProps {
  tip: string
  children: ReactElement
  placement?: 'bottom' | 'top'
}

export default function ActionTip({ tip, children, placement = 'bottom' }: ActionTipProps) {
  return (
    <span className="group/tip relative inline-flex">
      {children}
      <span
        role="tooltip"
        className={cn(
          'pointer-events-none absolute left-1/2 z-50 hidden w-max max-w-[240px] -translate-x-1/2',
          'rounded-md bg-slate-800 px-2.5 py-1.5 text-center text-[11px] leading-snug text-white shadow-lg',
          'group-hover/tip:block group-focus-within/tip:block',
          placement === 'bottom' ? 'top-[calc(100%+6px)]' : 'bottom-[calc(100%+6px)]',
        )}
      >
        {tip}
      </span>
    </span>
  )
}
