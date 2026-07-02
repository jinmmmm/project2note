import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Copy, Trash2, X } from 'lucide-react'
import toast from 'react-hot-toast'
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Components } from 'react-markdown'
import NotePolishButton from '@/components/NotePolishButton'
import TermTooltip from '@/components/TermTooltip'
import {
  extractTocFromHeadings,
  getPlainText,
  normalizeResidualMarkdownArtifacts,
  prepareDisplayMarkdown,
  scrollToHeadingId,
} from '@/lib/markdown'
import { formatTimestamp, linkifyTimestamps, parseTimestampInTitle } from '@/lib/timestamp'
import {
  extractTermDefs,
  linkifyTermsFromDefs,
  parseTermLinkHref,
  preprocessTermMarks,
  type NoteStyle,
} from '@/lib/terms'
import type { TocItem } from '@/lib/markdown'
import { cn } from '@/lib/utils'

export interface PolishSectionInfo {
  depth: number
  title: string
}

/** react-markdown v9 默认会过滤 term:// 等自定义协议，需放行 */
function noteUrlTransform(url: string): string {
  if (url.startsWith('term://') || url.startsWith('timestamp:')) {
    return url
  }
  return defaultUrlTransform(url)
}

const IMAGE_DEFAULT_WIDTH = 420
const IMAGE_MIN_WIDTH = 180
const IMAGE_MAX_WIDTH = 900

interface MarkdownImageMatch {
  alt: string
  src: string
  title?: string
  start: number
  end: number
}

function clampImageWidth(width: number): number {
  return Math.max(IMAGE_MIN_WIDTH, Math.min(IMAGE_MAX_WIDTH, Math.round(width)))
}

function parseImageWidth(title?: string): number | null {
  const match = /\bwidth=(\d{2,4})\b/.exec(title || '')
  return match ? clampImageWidth(Number(match[1])) : null
}

function collectMarkdownImages(markdown: string): MarkdownImageMatch[] {
  const matches: MarkdownImageMatch[] = []
  const lines = markdown.split('\n')
  let offset = 0
  let inFence = false
  const re = /!\[([^\]]*)\]\((\S+?)(?:\s+"([^"]*)")?\)/g

  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      inFence = !inFence
      offset += line.length + 1
      continue
    }
    if (!inFence) {
      re.lastIndex = 0
      let match: RegExpExecArray | null
      while ((match = re.exec(line))) {
        matches.push({
          alt: match[1] || '',
          src: match[2],
          title: match[3],
          start: offset + match.index,
          end: offset + match.index + match[0].length,
        })
      }
    }
    offset += line.length + 1
  }
  return matches
}

function buildImageMarkdown(match: MarkdownImageMatch, width: number): string {
  return `![${match.alt}](${match.src} "width=${clampImageWidth(width)}")`
}

function normalizeImageSrc(src: string): string {
  const cleaned = src.trim().split('?')[0]
  if (cleaned.startsWith('http://') || cleaned.startsWith('https://')) {
    try {
      return new URL(cleaned).pathname
    } catch {
      return cleaned
    }
  }
  return cleaned
}

function findImageMatchBySrc(markdown: string, targetSrc: string): MarkdownImageMatch | null {
  const normalizedTarget = normalizeImageSrc(targetSrc)
  return (
    collectMarkdownImages(markdown).find(
      (img) => normalizeImageSrc(img.src) === normalizedTarget,
    ) ?? null
  )
}

function replaceImageBySrc(markdown: string, targetSrc: string, replacement: string): string {
  const match = findImageMatchBySrc(markdown, targetSrc)
  if (!match) return markdown
  return `${markdown.slice(0, match.start)}${replacement}${markdown.slice(match.end)}`
}

function removeImageBySrc(markdown: string, targetSrc: string): string {
  const match = findImageMatchBySrc(markdown, targetSrc)
  if (!match) return markdown
  return `${markdown.slice(0, match.start)}${markdown.slice(match.end)}`
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

interface Props {
  content: string
  style?: NoteStyle
  onPolishSection?: (info: PolishSectionInfo) => void
  onSeek?: (seconds: number) => void
  sourceContent?: string
  editableImages?: boolean
  onImageContentChange?: (next: string) => void
  onImageContentPersist?: (next: string) => Promise<void>
}

interface NoteImageProps {
  src?: string
  alt?: string
  title?: string
  occurrenceIndex: number
  sourceContent: string
  editable?: boolean
  onContentChange?: (next: string) => void
  onContentPersist?: (next: string) => Promise<void>
}

function NoteImage({
  src,
  alt,
  title,
  occurrenceIndex,
  sourceContent,
  editable,
  onContentChange,
  onContentPersist,
}: NoteImageProps) {
  const resolvedSrc = src || ''
  const initialWidth = parseImageWidth(title) ?? IMAGE_DEFAULT_WIDTH
  const [width, setWidth] = useState(initialWidth)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const widthRef = useRef(initialWidth)
  const dragState = useRef<{ startX: number; startWidth: number; didDrag: boolean } | null>(null)

  useEffect(() => {
    setWidth(initialWidth)
    widthRef.current = initialWidth
  }, [initialWidth, src])

  useEffect(() => {
    if (!previewOpen) return undefined
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPreviewOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [previewOpen])

  const persistNext = useCallback(async (next: string, successMessage: string) => {
    onContentChange?.(next)
    if (!onContentPersist) return
    setSaving(true)
    try {
      await onContentPersist(next)
      toast.success(successMessage)
    } catch (e) {
      toast.error((e as Error).message || '图片更新失败')
    } finally {
      setSaving(false)
    }
  }, [onContentChange, onContentPersist])

  const persistWidth = useCallback(async (nextWidth: number) => {
    if (!resolvedSrc) return
    const match = findImageMatchBySrc(sourceContent, resolvedSrc)
    if (!match) {
      toast.error('未能从笔记源文中定位该图片')
      return
    }
    const next = replaceImageBySrc(
      sourceContent,
      resolvedSrc,
      buildImageMarkdown(match, nextWidth),
    )
    await persistNext(next, '图片尺寸已保存')
  }, [persistNext, resolvedSrc, sourceContent])

  const deleteImage = useCallback(async () => {
    if (!window.confirm('删除这张图片？')) return
    if (!resolvedSrc) return
    const next = removeImageBySrc(sourceContent, resolvedSrc)
    if (next === sourceContent) {
      toast.error('未能从笔记源文中定位该图片，删除失败')
      return
    }
    await persistNext(next, '图片已删除')
  }, [persistNext, resolvedSrc, sourceContent])

  const startResize = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    if (!editable) return
    e.preventDefault()
    e.stopPropagation()
    const startWidth = width
    dragState.current = { startX: e.clientX, startWidth, didDrag: false }

    const onPointerMove = (event: PointerEvent) => {
      const state = dragState.current
      if (!state) return
      const delta = event.clientX - state.startX
      const nextWidth = clampImageWidth(state.startWidth + delta)
      if (Math.abs(delta) > 3) state.didDrag = true
      widthRef.current = nextWidth
      setWidth(nextWidth)
    }

    const onPointerUp = async () => {
      const state = dragState.current
      dragState.current = null
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      if (state?.didDrag) await persistWidth(widthRef.current)
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
  }, [editable, persistWidth, width])

  return (
    <span className="note-image-wrap" style={{ width: `${width}px` }}>
      <button
        type="button"
        className="note-image-button"
        onClick={() => {
          if (!dragState.current?.didDrag) setPreviewOpen(true)
        }}
        title="点击查看大图"
      >
        <img src={resolvedSrc} alt={alt || ''} title={title} className="note-image" />
      </button>
      {editable && (
        <>
          <button
            type="button"
            className="note-image-delete"
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              deleteImage()
            }}
            disabled={saving}
            title="删除图片"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className="note-image-resize-handle"
            onPointerDown={startResize}
            disabled={saving}
            title="拖动调整大小"
          />
        </>
      )}
      {previewOpen && (
        <div
          className="note-image-preview-backdrop"
          onClick={() => setPreviewOpen(false)}
          role="presentation"
        >
          <button
            type="button"
            className="note-image-preview-close"
            onClick={(e) => {
              e.stopPropagation()
              setPreviewOpen(false)
            }}
            title="关闭"
          >
            <X className="h-5 w-5" />
          </button>
          <img
            src={resolvedSrc}
            alt={alt || ''}
            className="note-image-preview"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </span>
  )
}

export function useNoteToc(content: string, style: NoteStyle = 'beginner'): TocItem[] {
  return useMemo(() => {
    const { headings } = prepareDisplayMarkdown(content, style)
    return extractTocFromHeadings(headings)
  }, [content, style])
}

function TimestampBadge({
  seconds,
  onSeek,
}: {
  seconds: number
  onSeek?: (seconds: number) => void
}) {
  const label = formatTimestamp(seconds)
  if (!onSeek) {
    return <span className="note-timestamp">{label}</span>
  }
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onSeek(seconds)
      }}
      className="note-timestamp note-timestamp-btn"
      title={`跳转到 ${label}`}
    >
      {label}
    </button>
  )
}

function CodeBlock({ className, children, ...props }: { className?: string; children?: React.ReactNode }) {
  const codeText = String(children ?? '').replace(/\n$/, '')

  return (
    <div className="relative">
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(codeText)
            toast.success('代码已复制')
          } catch {
            toast.error('复制失败')
          }
        }}
        className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-md border border-slate-600 bg-slate-800/90 px-2 py-1 text-[11px] font-medium text-slate-100 hover:bg-slate-700"
      >
        <Copy className="h-3.5 w-3.5" />
        复制
      </button>
      <pre className="note-pre">
        <code className={`note-code-block ${className || ''}`} {...props}>{children}</code>
      </pre>
    </div>
  )
}

function splitRunOnFormulaBlockquote(markdown: string): string {
  return markdown
    .replace(
      /^(?:>\s*)+(\*\*[^*\n]+\s*=\s*[^*\n]+\*\*)-(.+)$/gm,
      (_match, formula: string, rest: string) => `> ${formula}\n\n- ${rest.trim()}`,
    )
    .replace(
      /^(?:>\s*)+(\*\*[^*\n]+\s*=\s*[^*\n]+\*\*)\s*$/gm,
      '> $1',
    )
}

const MarkdownContent = React.memo(function MarkdownContent({
  content,
  style = 'beginner',
  onPolishSection,
  onSeek,
  sourceContent,
  editableImages = false,
  onImageContentChange,
  onImageContentPersist,
}: Props) {
  const termDefs = useMemo(() => extractTermDefs(content), [content])
  const { markdown: displayContent, headings } = useMemo(
    () => prepareDisplayMarkdown(content, style),
    [content, style],
  )
  const termDefMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const g of termDefs) {
      map.set(g.term, g.definition)
      map.set(g.term.toLowerCase(), g.definition)
    }
    return map
  }, [termDefs])

  const headingRenderKey = useMemo(() => headings.map((h) => h.id).join('\0'), [headings])
  const imageRenderIndexRef = useRef(0)
  const editableSourceContent = sourceContent ?? content
  const headingMetaMap = useMemo(
    () => new Map(headings.map((heading) => [heading.label, heading] as const)),
    [headings],
  )

  const processed = useMemo(() => {
    const withMarks = preprocessTermMarks(displayContent, termDefs, style)
    const withTerms = linkifyTermsFromDefs(withMarks, termDefs)
    return splitRunOnFormulaBlockquote(normalizeResidualMarkdownArtifacts(linkifyTimestamps(withTerms)))
  }, [displayContent, termDefs, style])

  const components = useMemo((): Components => {
    const mkHeading = (
      Tag: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6',
      className: string,
      depth: number,
    ) =>
      function Heading({ children }: { children?: React.ReactNode }) {
        const rawTitle = getPlainText(children)
        const parsed = parseTimestampInTitle(rawTitle)
        const rawLabel = (parsed.seconds != null ? parsed.rest : rawTitle) || rawTitle
        const normalizedLabel = rawLabel.trim().replace(/^\d+(?:\.\d+)*\.\s*/, '')
        const meta = headingMetaMap.get(normalizedLabel)
        const id = meta?.id ?? `heading-${normalizedLabel}`

        const seconds = parsed.seconds ?? meta?.timestamp ?? null
        const title = meta?.text ?? rawTitle
        const showPolish = onPolishSection && meta != null && (meta.depth === 2 || meta.depth === 3)

        return (
          <div id={id} className="note-heading-block scroll-mt-24">
            <div className="note-heading-row group flex items-start justify-between gap-2">
              <Tag className={`${className} min-w-0 flex-1`}>
                {title}
              </Tag>
              {showPolish && (
                <NotePolishButton
                  className="mt-2 shrink-0"
                  onClick={() => onPolishSection({ depth: meta?.depth ?? depth, title: meta?.label ?? title })}
                />
              )}
            </div>
            {seconds != null && (
              <div className="note-heading-ts mt-0.5">
                <TimestampBadge seconds={seconds} onSeek={onSeek} />
              </div>
            )}
          </div>
        )
      }

    return {
      h1: mkHeading('h1', 'note-h1', 1),
      h2: mkHeading('h2', 'note-h2', 2),
      h3: mkHeading('h3', 'note-h3', 3),
      h4: mkHeading('h4', 'note-h4', 4),
      h5: mkHeading('h5', 'note-h5', 5),
      h6: mkHeading('h6', 'note-h6', 6),
      p: ({ children }) => <p className="note-p">{children}</p>,
      ul: ({ children }) => <ul className="note-ul">{children}</ul>,
      ol: ({ children }) => <ol className="note-ol">{children}</ol>,
      li: ({ children }) => <li className="note-li">{children}</li>,
      strong: ({ children }) => <strong className="note-strong">{children}</strong>,
      blockquote: ({ children }) => <blockquote className="note-blockquote">{children}</blockquote>,
      hr: () => <hr className="note-hr" />,
      mark: ({ children }) => <mark className="note-mark">{children}</mark>,
      code: ({ className, children, ...props }) => {
        const isBlock = className?.includes('language-')
        if (isBlock) {
          return <code className={`note-code-block ${className || ''}`} {...props}>{children}</code>
        }
        return <code className="note-code-inline" {...props}>{children}</code>
      },
      pre: ({ children, ...props }) => {
        const child = Array.isArray(children) ? children[0] : children
        if (child && typeof child === 'object' && 'props' in child) {
          const codeChild = child as React.ReactElement<{ className?: string; children?: React.ReactNode }>
          return <CodeBlock className={codeChild.props.className}>{codeChild.props.children}</CodeBlock>
        }
        return <pre className="note-pre" {...props}>{children}</pre>
      },
      img: ({ src, alt, title }) => {
        const occurrenceIndex = imageRenderIndexRef.current
        imageRenderIndexRef.current += 1
        return (
          <NoteImage
            src={src}
            alt={alt}
            title={title}
            occurrenceIndex={occurrenceIndex}
            sourceContent={editableSourceContent}
            editable={editableImages}
            onContentChange={onImageContentChange}
            onContentPersist={onImageContentPersist}
          />
        )
      },
      a: ({ href, children }) => {
        const termFromHref = href ? parseTermLinkHref(href) : null
        if (termFromHref) {
          const definition =
            termDefMap.get(termFromHref) ?? termDefMap.get(termFromHref.toLowerCase())
          if (definition) {
            return (
              <TermTooltip
                term={termFromHref}
                definition={definition}
                variant={style}
              />
            )
          }
          return <span>{children}</span>
        }
        if (href?.startsWith('timestamp:') && onSeek) {
          const seconds = parseInt(href.slice('timestamp:'.length), 10)
          if (!Number.isNaN(seconds)) {
            return (
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  onSeek(seconds)
                }}
                className="note-timestamp note-timestamp-btn"
              >
                {children}
              </button>
            )
          }
        }
        if (href?.startsWith('#')) {
          const anchorId = href.slice(1)
          return (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                scrollToHeadingId(anchorId)
              }}
              className="note-link cursor-pointer border-0 bg-transparent p-0 text-left"
            >
              {children}
            </button>
          )
        }
        return (
          <a href={href} className="note-link" target="_blank" rel="noreferrer">{children}</a>
        )
      },
    }
  }, [editableImages, editableSourceContent, headingMetaMap, onImageContentChange, onImageContentPersist, onPolishSection, onSeek, termDefMap, style])

  imageRenderIndexRef.current = 0

  if (!processed.trim()) {
    return (
      <div className="note-content px-8 py-6 text-sm text-slate-400">
        暂无笔记内容
      </div>
    )
  }

  return (
    <div
      className={cn(
        'note-content px-8 pb-6 pt-3',
        style === 'beginner' ? 'note-content-beginner' : 'note-content-professional',
      )}
    >
      <ReactMarkdown
        key={headingRenderKey}
        remarkPlugins={[remarkGfm]}
        urlTransform={noteUrlTransform}
        components={components}
      >
        {processed}
      </ReactMarkdown>
    </div>
  )
})

export default MarkdownContent
