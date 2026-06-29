import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Copy, MessageCircle } from 'lucide-react'
import toast from 'react-hot-toast'

interface SelectionState {
  text: string
  x: number
  y: number
}

interface Options {
  containerRef: React.RefObject<HTMLElement | null>
  enabled?: boolean
  onAsk: (text: string) => void
  showPopover?: boolean
}

const HIGHLIGHT_KEY = 'selection-ask'

// Inject ::highlight rule via JS to bypass PostCSS/Tailwind stripping it
if (typeof document !== 'undefined' && 'highlights' in CSS) {
  const style = document.createElement('style')
  style.textContent = `::highlight(${HIGHLIGHT_KEY}) { background-color: rgba(191, 219, 254, 0.95); color: rgb(30 41 59); }`
  document.head.appendChild(style)
}

function applyHighlight(range: Range) {
  // @ts-ignore — CSS Highlight API, Chrome 105+ / Safari 17.2+
  if ('highlights' in CSS) {
    // @ts-ignore
    CSS.highlights.set(HIGHLIGHT_KEY, new Highlight(range))
  }
}

function clearHighlight() {
  // @ts-ignore
  if ('highlights' in CSS) CSS.highlights.delete(HIGHLIGHT_KEY)
}

export function useTextSelectionAsk({
  containerRef,
  enabled = true,
  onAsk,
  showPopover = true,
}: Options) {
  const [selection, setSelection] = useState<SelectionState | null>(null)
  const savedRangeRef = useRef<Range | null>(null)

  useEffect(() => {
    if (!enabled) {
      clearHighlight()
      savedRangeRef.current = null
      setSelection(null)
      return
    }

    const handleMouseUp = () => {
      window.setTimeout(() => {
        const sel = window.getSelection()
        if (!sel || sel.isCollapsed || !sel.rangeCount) {
          clearHighlight()
          savedRangeRef.current = null
          setSelection(null)
          return
        }

        const text = sel.toString().trim()
        if (text.length < 2) {
          clearHighlight()
          savedRangeRef.current = null
          setSelection(null)
          return
        }

        const range = sel.getRangeAt(0)
        const container = containerRef.current
        if (!container || !container.contains(range.commonAncestorContainer)) {
          clearHighlight()
          savedRangeRef.current = null
          setSelection(null)
          return
        }

        const cloned = range.cloneRange()
        savedRangeRef.current = cloned

        // Apply highlight synchronously NOW, before setSelection triggers re-render
        applyHighlight(cloned)

        const rect = range.getBoundingClientRect()
        setSelection({
          text,
          x: rect.left + rect.width / 2,
          y: rect.top - 8,
        })
      }, 10)
    }

    const handleMouseDown = (e: MouseEvent) => {
      // If click is outside the popover portal, clear selection
      const target = e.target as Node
      if (savedRangeRef.current && !containerRef.current?.contains(target)) {
        // Let the click proceed; highlight will clear when mouseup fires with no selection
      }
    }

    const handleScroll = () => {
      clearHighlight()
      setSelection(null)
    }

    document.addEventListener('mouseup', handleMouseUp)
    document.addEventListener('mousedown', handleMouseDown)
    const container = containerRef.current
    container?.addEventListener('scroll', handleScroll)

    return () => {
      document.removeEventListener('mouseup', handleMouseUp)
      document.removeEventListener('mousedown', handleMouseDown)
      container?.removeEventListener('scroll', handleScroll)
      clearHighlight()
    }
  }, [containerRef, enabled])

  const dismiss = () => {
    clearHighlight()
    savedRangeRef.current = null
    window.getSelection()?.removeAllRanges()
    setSelection(null)
  }

  const Popover = showPopover && selection ? createPortal(
    <div
      className="fixed z-[9999] -translate-x-1/2 -translate-y-full"
      style={{ left: selection.x, top: selection.y }}
    >
      <div className="flex items-center gap-1 rounded-full bg-slate-900 p-1 shadow-lg">
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            onAsk(selection.text)
            dismiss()
          }}
          className="flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
        >
          <MessageCircle className="h-3.5 w-3.5" />
          追问
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(selection.text)
              toast.success('已复制')
            } catch {
              toast.error('复制失败')
            }
            dismiss()
          }}
          className="flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
        >
          <Copy className="h-3.5 w-3.5" />
          复制
        </button>
      </div>
    </div>,
    document.body,
  ) : null

  return { Popover }
}
