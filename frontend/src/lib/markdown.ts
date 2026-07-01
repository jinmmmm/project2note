import type { ReactNode, ReactElement } from 'react'
import { parseTimestampInTitle, normalizeNoteTimestamps } from '@/lib/timestamp'
import { stripTermDefsFromDisplay, type NoteStyle } from '@/lib/terms'

export function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fff\s-]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 48) || 'section'
}

function stripNamedSection(markdown: string, titleKeyword: string): string {
  if (!markdown) return markdown

  const lines = markdown.split('\n')
  const out: string[] = []
  let skipping = false
  const titlePattern = new RegExp(
    `^#{1,6}\\s+(?:0\\.\\s*)?(?:\\d+(?:\\.\\d+)*\\.\\s*)?${titleKeyword}`,
  )

  for (const line of lines) {
    const trimmed = line.trim()
    if (titlePattern.test(trimmed)) {
      skipping = true
      continue
    }
    if (skipping && /^#{1,6}\s+/.test(trimmed) && !trimmed.includes(titleKeyword)) {
      skipping = false
    }
    if (!skipping) out.push(line)
  }

  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

export function stripVideoTocSection(markdown: string): string {
  return stripNamedSection(markdown, '视频目录')
}

export function stripBodyTocSection(markdown: string): string {
  return stripNamedSection(markdown, '正文目录')
}

const BOILERPLATE_HEADING_RE =
  /^#{1,6}\s*(?:\d+(?:\.\d+)*\.?\s*)?(?:AI 提炼重点|对应原文实录)\s*$/i

function stripPolishLeadIn(markdown: string): string {
  const lines = markdown.split('\n')
  const firstHeadingIndex = lines.findIndex((line) => /^#{2,6}\s/.test(line.trim()))
  if (firstHeadingIndex <= 0) {
    return markdown.trim()
  }
  return lines.slice(firstHeadingIndex).join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

function stripChapterBoilerplate(markdown: string): string {
  const lines = markdown.split('\n')
  const out: string[] = []
  let skipTranscript = false

  for (const line of lines) {
    const trimmed = line.trim()

    if (
      BOILERPLATE_HEADING_RE.test(trimmed) ||
      /^\*\*对应原文实录\*\*:?\s*$/.test(trimmed) ||
      /^对应原文实录\s*$/.test(trimmed)
    ) {
      if (/对应原文实录/.test(trimmed)) skipTranscript = true
      continue
    }

    if (skipTranscript) {
      if (/^#{1,6}\s/.test(trimmed)) {
        skipTranscript = false
      } else if (/^\*\*[^*]+\*\*:?\s*$/.test(trimmed) && !trimmed.includes('对应原文实录')) {
        skipTranscript = false
      } else {
        continue
      }
    }

    if (/^\*\*AI 提炼重点\*\*:?\s*$/.test(trimmed) || /^AI 提炼重点\s*$/.test(trimmed)) {
      continue
    }

    out.push(line)
  }

  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

const LEGACY_HIDDEN_SECTIONS = [
  '新手避坑',
  '避坑指南',
  '小白专属学习路径',
  '分章节内容',
]

/** 兼容旧笔记：移除已废弃的独立大节，避免目录冗余 */
export function stripSectionsForStyle(markdown: string, _style: NoteStyle = 'beginner'): string {
  let result = markdown
  for (const keyword of LEGACY_HIDDEN_SECTIONS) {
    result = stripNamedSection(result, keyword)
  }
  return result
}

function normalizeInlineMarkdownArtifacts(markdown: string): string {
  return markdown
    .replace(/\\([*_`])/g, '$1')
    .replace(/\*\*\s+([^*\n]*?\S)\s*\*\*/g, '**$1**')
    .replace(/\*\*([^*\n]*?\S)\s+\*\*/g, '**$1**')
    .replace(/__\s+([^_\n]*?\S)\s*__/g, '__$1__')
    .replace(/__([^_\n]*?\S)\s+__/g, '__$1__')
}

function normalizeFormulaBlockquotes(markdown: string): string {
  return markdown
    .split('\n')
    .flatMap((line) => {
      const trimmed = line.trim()
      const runOn = /^(?:>\s*)+(\*\*[^*\n]+[ \t]*=[ \t]*[^*\n]+\*\*)-(.+)$/.exec(trimmed)
      if (runOn) {
        return [`> ${runOn[1]}`, '', `- ${runOn[2].trim()}`]
      }
      const quotedFormula = /^(?:>\s*)+(\*\*[^*\n]+[ \t]*=[ \t]*[^*\n]+\*\*)[ \t]*$/.exec(trimmed)
      if (quotedFormula) {
        return `> ${quotedFormula[1]}`
      }
      return line
    })
    .join('\n')
}

function normalizeInlineSegmentArtifacts(segment: string): string {
  let result = segment
    .replace(/\*\*\s+([^*\n]*?\S)\s*\*\*/g, '**$1**')
    .replace(/\*\*([^*\n]*?\S)\s+\*\*/g, '**$1**')
    .replace(/__\s+([^_\n]*?\S)\s*__/g, '__$1__')
    .replace(/__([^_\n]*?\S)\s+__/g, '__$1__')
    .replace(/\*\*\s*\*\*/g, '')
    .replace(/__\s*__/g, '')

  if ((result.match(/\*\*/g) || []).length % 2 === 1) {
    result = result.replace(/\*\*/g, '')
  }
  if ((result.match(/__/g) || []).length % 2 === 1) {
    result = result.replace(/__/g, '')
  }

  return result
}

export function normalizeResidualMarkdownArtifacts(markdown: string): string {
  const lines = markdown.split('\n')
  let inFence = false

  return lines.map((line) => {
    if (line.trim().startsWith('```')) {
      inFence = !inFence
      return line
    }
    if (inFence) return line

    return line
      .split(/(`[^`]*`)/g)
      .map((part, index) => (index % 2 === 1 ? part : normalizeInlineSegmentArtifacts(part)))
      .join('')
  }).join('\n')
}

function stripForDisplay(markdown: string, style: NoteStyle = 'beginner'): string {
  return stripTermDefsFromDisplay(
    stripChapterBoilerplate(
      stripPolishLeadIn(
        stripBodyTocSection(
          stripVideoTocSection(
            stripSectionsForStyle(
              normalizeNoteTimestamps(normalizeFormulaBlockquotes(normalizeInlineMarkdownArtifacts(markdown || ''))),
              style,
            ),
          ),
        ),
      ),
    ),
  )
}

export function parseLeadingNumber(text: string): { num: string | null; label: string } {
  const match = /^(\d+(?:\.\d+)*)\.\s+(.+)$/.exec(text)
  if (match) return { num: match[1], label: match[2] }
  return { num: null, label: text }
}

function cleanLabel(rawText: string, depth: number): string {
  const normalized = normalizeHeadingText(rawText)
  const { num, label } = parseLeadingNumber(normalized)
  if (num) return label
  if (depth >= 3) {
    return normalized.replace(/^\d+(?:\.\d+)*\.?\s*/, '')
  }
  return normalized
}

const HIDDEN_HEADINGS = ['视频目录', '正文目录', '分章节内容']

const TOC_SKIP_KEYWORDS = [
  ...HIDDEN_HEADINGS,
  'AI 提炼重点',
  '对应原文实录',
]

function isStructuredSummarySection(title: string, label: string): boolean {
  return (
    title.includes('结构化笔记') ||
    title.includes('结构化总结') ||
    title.includes('概述总结') ||
    title.includes('核心结论') ||
    label.includes('结构化笔记') ||
    label.includes('结构化总结') ||
    label.includes('概述总结') ||
    label.includes('核心结论')
  )
}

function displaySectionLabel(label: string): string {
  return label
    .replace(/概述总结/g, '结构化笔记')
    .replace(/核心结论速览/g, '结构化笔记')
    .replace(/结构化总结/g, '结构化笔记')
}

function headingIncludes(text: string, keywords: string[]): boolean {
  return keywords.some((k) => text.includes(k))
}

function isChapterBlockStart(text: string): boolean {
  return text.includes('分章节内容')
}

function isSummarySubBlockStart(title: string, label: string, depth: number): boolean {
  return depth <= 2 && isStructuredSummarySection(title, label)
}

function isChapterBlockEnd(text: string): boolean {
  return (
    text.includes('工具与链接') ||
    text.includes('工具链接') ||
    text.includes('高阶参考') ||
    text.includes('补充最新版本') ||
    text.includes('延伸知识点') ||
    text.includes('新手避坑') ||
    text.includes('小白专属学习路径') ||
    text.includes('术语')
  )
}

function stripHeadingArtifacts(text: string): string {
  return text
    .replace(/\s*<!--\s*ts:\d{1,2}:\d{2}(?::\d{2})?\s*-->\s*/gi, ' ')
    .replace(/\*\*/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/(^|\s)```+\s*/g, ' ')
    .replace(/\s+```+$/g, ' ')
    .replace(/\s+`+$/g, ' ')
    .replace(/^`+\s+/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

export function normalizeHeadingText(text: string): string {
  return stripHeadingArtifacts(text)
}

function formatTimestampComment(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  }
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

interface HeadingWalkState {
  inChapterBlock: boolean
  chapterPrefix: string
  chapterNum: number
  mainNum: number
  inExtensionBlock: boolean
  extensionPrefix: string
  extensionNum: number
}

function createHeadingWalkState(): HeadingWalkState {
  return {
    inChapterBlock: false,
    chapterPrefix: '2',
    chapterNum: 0,
    mainNum: 0,
    inExtensionBlock: false,
    extensionPrefix: '',
    extensionNum: 0,
  }
}

function isExtensionSubheading(title: string, label: string): boolean {
  return (
    title.includes('前置基础') ||
    title.includes('后续进阶') ||
    label.includes('前置基础') ||
    label.includes('后续进阶') ||
    /^前置/.test(label) ||
    /^后续/.test(label)
  )
}

interface WalkEmit {
  title: string
  label: string
  timestamp?: number
  tocLevel: number
  outDepth: number
  displayNum: string
  inToc: boolean
}

function walkHeadingLine(
  depth: number,
  rawTitle: string,
  state: HeadingWalkState,
): { action: 'skip' } | { action: 'emit'; data: WalkEmit } {
  // Extract timestamp before normalizing — normalizeHeadingText strips <!-- ts:mm:ss -->
  const { seconds, rest: rawNoTs } = parseTimestampInTitle(rawTitle)
  const title = normalizeHeadingText(rawNoTs || rawTitle)

  if (headingIncludes(title, HIDDEN_HEADINGS)) {
    if (isChapterBlockStart(title)) {
      state.inChapterBlock = true
      state.chapterNum = 0
    }
    return { action: 'skip' }
  }

  if (state.inChapterBlock && depth <= 2 && isChapterBlockEnd(title)) {
    state.inChapterBlock = false
    state.chapterNum = 0
  }

  const displayTitle = title
  const label = displaySectionLabel(cleanLabel(displayTitle, depth))

  const isExtensionSection =
    title.includes('延伸知识点') || displayTitle.includes('延伸知识点')

  if (
    state.inExtensionBlock &&
    depth <= 2 &&
    !isExtensionSection &&
    !isExtensionSubheading(title, label)
  ) {
    state.inExtensionBlock = false
    state.extensionNum = 0
  }

  let outDepth = depth
  if (state.inChapterBlock && depth >= 3) {
    outDepth = 3
  } else if (state.inExtensionBlock && isExtensionSubheading(title, label)) {
    outDepth = 3
  } else if (depth >= 3 && !state.inChapterBlock) {
    outDepth = 3
  } else {
    outDepth = 2
  }

  let displayNum: string
  if (state.inChapterBlock && depth >= 3) {
    state.chapterNum += 1
    displayNum = `${state.chapterPrefix}.${state.chapterNum}`
  } else if (state.inExtensionBlock && isExtensionSubheading(title, label)) {
    state.extensionNum += 1
    displayNum = `${state.extensionPrefix}.${state.extensionNum}`
  } else {
    state.mainNum += 1
    state.chapterNum = 0
    displayNum = String(state.mainNum)
    if (isSummarySubBlockStart(title, label, depth)) {
      state.inChapterBlock = true
      state.chapterPrefix = displayNum
      state.chapterNum = 0
    }
    if (isExtensionSection) {
      state.inExtensionBlock = true
      state.extensionPrefix = displayNum
      state.extensionNum = 0
    }
  }

  const isNestedTocItem =
    displayNum.includes('.') ||
    (state.inExtensionBlock && isExtensionSubheading(title, label)) ||
    (state.inChapterBlock && depth >= 3) ||
    outDepth >= 3

  let tocLevel: number
  if (isStructuredSummarySection(displayTitle, label)) {
    tocLevel = 1
  } else if (isNestedTocItem) {
    tocLevel = 2
  } else {
    tocLevel = 1
  }

  const inToc =
    !headingIncludes(label, TOC_SKIP_KEYWORDS) &&
    !headingIncludes(displayTitle, TOC_SKIP_KEYWORDS)

  return {
    action: 'emit',
    data: {
      title: displaySectionLabel(displayTitle),
      label,
      timestamp: seconds ?? undefined,
      tocLevel,
      outDepth,
      displayNum,
      inToc,
    },
  }
}

export interface DocumentHeading {
  id: string
  /** 目录/锚点展示文案，含编号 */
  text: string
  label: string
  timestamp?: number
  inToc: boolean
  tocLevel: number
  depth: number
}

export function makeHeadingId(title: string, slugCount: Record<string, number>): string {
  const base = slugify(title)
  slugCount[base] = (slugCount[base] || 0) + 1
  return slugCount[base] > 1 ? `${base}-${slugCount[base]}` : base
}

/** 解析展示用 Markdown 中的全部标题（含不在目录中的），保证 id 与 DOM 顺序一致 */
export function parseAllHeadingsFromDisplay(markdown: string): DocumentHeading[] {
  const headings: DocumentHeading[] = []
  const slugCount: Record<string, number> = {}
  let inFence = false

  for (const line of markdown.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.startsWith('```')) {
      inFence = !inFence
      continue
    }
    if (inFence) continue

    const match = /^(#{1,6})\s+(.+)$/.exec(trimmed)
    if (!match) continue

    const depth = match[1].length
    const rawBody = match[2]
    const { seconds, rest: rawNoTs } = parseTimestampInTitle(rawBody)
    const normalizedText = normalizeHeadingText(rawNoTs || rawBody)
    const { num, label: numberedLabel } = parseLeadingNumber(normalizedText)
    const label = numberedLabel || cleanLabel(rawNoTs || rawBody, depth)
    const id = makeHeadingId(label, slugCount)
    const text = num ? `${num}. ${label}` : label

    const inToc = !headingIncludes(label, TOC_SKIP_KEYWORDS)

    let tocLevel = 1
    if (label.includes('视频基础信息')) {
      tocLevel = 1
    } else if (isStructuredSummarySection(label, label)) {
      tocLevel = 1
    } else if (num?.includes('.') || (num && parseInt(num, 10) >= 3)) {
      tocLevel = 2
    } else if (depth >= 3) {
      tocLevel = 2
    }

    headings.push({
      id,
      text,
      label,
      timestamp: seconds ?? undefined,
      inToc,
      tocLevel,
      depth,
    })
  }

  return headings
}

export function renumberHeadingsInMarkdown(markdown: string): {
  markdown: string
  headings: DocumentHeading[]
} {
  const state = createHeadingWalkState()
  const out: string[] = []
  const headings: DocumentHeading[] = []
  const slugCount: Record<string, number> = {}
  let inFence = false

  for (const line of markdown.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.startsWith('```')) {
      inFence = !inFence
      out.push(line)
      continue
    }
    if (inFence) {
      out.push(line)
      continue
    }

    const match = /^(#{1,6})\s+(.+)$/.exec(trimmed)
    if (!match) {
      out.push(line)
      continue
    }

    const depth = match[1].length
    const result = walkHeadingLine(depth, match[2], state)
    if (result.action === 'skip') continue

    const { label, timestamp, outDepth, displayNum, tocLevel, inToc } = result.data
    const id = makeHeadingId(label, slugCount)
    const hashes = '#'.repeat(outDepth)
    const tsSuffix = timestamp != null ? ` <!-- ts:${formatTimestampComment(timestamp)} -->` : ''

    headings.push({
      id,
      text: `${displayNum}. ${label}`,
      label,
      timestamp,
      inToc,
      tocLevel,
      depth: outDepth,
    })
    out.push(`${hashes} ${displayNum}. ${label}${tsSuffix}`)
  }

  return { markdown: out.join('\n'), headings }
}

export function prepareDisplayMarkdown(
  markdown: string,
  style: NoteStyle = 'beginner',
): {
  markdown: string
  headings: DocumentHeading[]
} {
  return renumberHeadingsInMarkdown(stripForDisplay(markdown, style))
}

export function getDisplayMarkdown(markdown: string, style: NoteStyle = 'beginner'): string {
  return prepareDisplayMarkdown(markdown, style).markdown
}

export interface TocItem {
  id: string
  text: string
  level: number
  timestamp?: number
}

export function extractTocFromHeadings(headings: DocumentHeading[]): TocItem[] {
  return headings
    .filter((h) => h.inToc)
    .map(({ id, text, tocLevel, timestamp }) => ({
      id,
      text,
      level: tocLevel,
      timestamp,
    }))
}

export function extractTocFromSource(source: string): TocItem[] {
  return extractTocFromHeadings(parseAllHeadingsFromDisplay(source))
}

export function findActiveChapterByTime(
  items: TocItem[],
  currentTime: number,
): string | undefined {
  const withTs = items
    .filter((i) => i.timestamp != null)
    .sort((a, b) => a.timestamp! - b.timestamp!)
  let active: string | undefined
  for (const item of withTs) {
    if (item.timestamp! <= currentTime + 0.5) active = item.id
    else break
  }
  return active
}

export function buildHeadingIdMap(markdown: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const h of prepareDisplayMarkdown(markdown).headings) {
    map.set(normalizeHeadingText(h.label), h.id)
    map.set(normalizeHeadingText(h.text), h.id)
  }
  return map
}

export function extractToc(markdown: string): TocItem[] {
  return extractTocFromHeadings(prepareDisplayMarkdown(markdown).headings)
}

export function generateBodyTocBlock(markdown: string): string {
  const headings = extractToc(markdown)
  if (headings.length === 0) return ''

  const lines = ['## 0. 正文目录', '']
  for (const item of headings) {
    lines.push(`- [${item.text}](#${item.id})`)
  }
  lines.push('')
  return lines.join('\n')
}

export function ensureBodyTocForExport(markdown: string): string {
  const body = getDisplayMarkdown(markdown)
  const block = generateBodyTocBlock(markdown)
  if (!block) return body
  return `${block}\n${body.replace(/^\n+/, '')}`
}

export function findHeadingElement(container: HTMLElement | null, id: string): HTMLElement | null {
  const escaped = typeof CSS !== 'undefined' && 'escape' in CSS ? CSS.escape(id) : id.replace(/"/g, '\\"')
  if (container) {
    const scoped = container.querySelector<HTMLElement>(`#${escaped}`)
    if (scoped) return scoped
  }
  return document.getElementById(id)
}

export function scrollToHeadingInContainer(container: HTMLElement | null, id: string): boolean {
  const el = findHeadingElement(container, id)
  if (!el) return false
  if (container && !container.contains(el)) return false

  const target =
    el.classList.contains('note-heading-block') ? el : el.closest('.note-heading-block') ?? el

  if (container) {
    // 与 .scroll-mt-24（96px）对齐，避免滚到目标上方仍露出上一节
    const scrollMargin = 96
    const top =
      target.getBoundingClientRect().top -
      container.getBoundingClientRect().top +
      container.scrollTop -
      scrollMargin
    container.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
  } else {
    target.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  return true
}

export function scrollToHeadingInContainerWithRetry(
  container: HTMLElement | null,
  id: string,
): void {
  const attempt = () => scrollToHeadingInContainer(container, id)
  if (attempt()) return
  requestAnimationFrame(attempt)
  window.setTimeout(attempt, 50)
  window.setTimeout(attempt, 150)
}

export function scrollToHeadingId(id: string): boolean {
  const container = document.querySelector<HTMLElement>('[data-note-scroll]')
  return scrollToHeadingInContainer(container, id)
}

export function safeDownloadFilename(title: string, ext: string): string {
  const name = (title || 'note').replace(/[<>:"/\\|?*]/g, '').trim().slice(0, 80) || 'note'
  return `${name}.${ext}`
}

export function getPlainText(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(getPlainText).join('')
  if (typeof node === 'object' && node !== null && 'props' in node) {
    const el = node as ReactElement<{ children?: ReactNode }>
    return getPlainText(el.props.children)
  }
  return ''
}
