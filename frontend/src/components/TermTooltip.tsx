import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'
import { formatTermDefinitionForDisplay, type NoteStyle } from '@/lib/terms'

interface Props {
  term: string
  definition: string
  variant?: NoteStyle
  className?: string
}

const TOOLTIP_Z = 99999

/** 术语正文 + 右上角轻量 ? 标识，悬停 ? 在顶层浮层展示释义 */
export default function TermTooltip({
  term,
  definition,
  variant = 'beginner',
  className,
}: Props) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const timer = useRef<number | undefined>(undefined)
  const btnRef = useRef<HTMLButtonElement>(null)

  const updatePosition = useCallback(() => {
    const el = btnRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    setPos({
      top: rect.top - 6,
      left: rect.left + rect.width / 2,
    })
  }, [])

  useEffect(() => {
    if (!open) return
    updatePosition()
    const scrollRoot = document.querySelector('[data-note-scroll]')
    const onMove = () => updatePosition()
    window.addEventListener('scroll', onMove, true)
    window.addEventListener('resize', onMove)
    scrollRoot?.addEventListener('scroll', onMove)
    return () => {
      window.removeEventListener('scroll', onMove, true)
      window.removeEventListener('resize', onMove)
      scrollRoot?.removeEventListener('scroll', onMove)
    }
  }, [open, updatePosition])

  const show = () => {
    window.clearTimeout(timer.current)
    setOpen(true)
  }

  const hide = () => {
    timer.current = window.setTimeout(() => setOpen(false), 120)
  }

  const displayDefinition = formatTermDefinitionForDisplay(definition, variant)

  const tooltip =
    open &&
    createPortal(
      <span
        role="tooltip"
        style={{
          position: 'fixed',
          top: pos.top,
          left: pos.left,
          transform: 'translate(-50%, -100%)',
          zIndex: TOOLTIP_Z,
        }}
        className={cn(
          'pointer-events-auto block w-64 max-w-[min(16rem,calc(100vw-2rem))] rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs leading-relaxed text-slate-700 shadow-xl',
          variant === 'beginner' && 'border-amber-200',
        )}
        onMouseEnter={show}
        onMouseLeave={hide}
      >
        <span className="mb-0.5 block font-semibold text-slate-900">{term}</span>
        {displayDefinition}
      </span>,
      document.body,
    )

  return (
    <>
      <span
        className={cn(
          'term-with-hint inline-flex max-w-full items-baseline gap-0.5 align-baseline',
          className,
        )}
      >
        <span className="term-with-hint-text">{term}</span>
        <button
          ref={btnRef}
          type="button"
          tabIndex={-1}
          className="term-hint-btn relative -top-1.5 inline-flex h-3 w-3 shrink-0 items-center justify-center rounded-full border border-slate-300/70 bg-white text-[8px] font-normal leading-none text-slate-400 transition-colors hover:border-slate-400 hover:text-slate-600"
          aria-label={`${term} 释义`}
          onMouseEnter={show}
          onMouseLeave={hide}
          onFocus={show}
          onBlur={hide}
          onClick={(e) => e.preventDefault()}
        >
          ?
        </button>
      </span>
      {tooltip}
    </>
  )
}
