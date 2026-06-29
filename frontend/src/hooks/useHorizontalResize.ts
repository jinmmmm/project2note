import { useCallback, useEffect, useRef, useState } from 'react'

interface Options {
  defaultWidth: number
  minWidth: number
  maxWidth: number
  storageKey?: string
  width?: number
  onWidthChange?: (width: number) => void
  /** 拖拽手柄在列左侧时设为 true（向右拖缩小列宽） */
  invertDelta?: boolean
}

export function useHorizontalResize({
  defaultWidth,
  minWidth,
  maxWidth,
  storageKey,
  width: controlledWidth,
  onWidthChange,
  invertDelta = false,
}: Options) {
  const [internalWidth, setInternalWidth] = useState(() => {
    if (controlledWidth !== undefined) return controlledWidth
    if (storageKey) {
      const saved = localStorage.getItem(storageKey)
      if (saved) {
        const n = Number(saved)
        if (!Number.isNaN(n)) return Math.min(maxWidth, Math.max(minWidth, n))
      }
    }
    return defaultWidth
  })

  const width = controlledWidth ?? internalWidth
  const setWidth = onWidthChange ?? setInternalWidth

  const widthRef = useRef(width)
  widthRef.current = width
  const dragging = useRef(false)
  const startX = useRef(0)
  const startWidth = useRef(0)

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragging.current = true
    startX.current = e.clientX
    startWidth.current = widthRef.current
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [])

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!dragging.current) return
      const delta = e.clientX - startX.current
      const adjusted = invertDelta ? -delta : delta
      setWidth(Math.min(maxWidth, Math.max(minWidth, startWidth.current + adjusted)))
    }
    const onMouseUp = () => {
      if (!dragging.current) return
      dragging.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      if (storageKey && !onWidthChange) {
        localStorage.setItem(storageKey, String(widthRef.current))
      }
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [maxWidth, minWidth, onWidthChange, storageKey])

  return { width, onMouseDown }
}
