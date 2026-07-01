import { parseAllHeadingsFromDisplay, type DocumentHeading } from './markdown'
import type { MindmapData, MindmapMode, MindmapModeData, MindmapNode } from '@/services'

const TEMPLATE_HEADINGS = new Set(['视频基础信息', '结构化笔记', '工具与链接补充', '补充最新版本', '延伸知识点'])

function cleanRootLabel(title: string): string {
  let s = title
    .replace(/\.?(mp4|mov|avi|mkv|flv|webm|m4v)$/i, '')
    .replace(/第\s*\d+\s*集[·\s]*/g, '')
    .replace(/^.+?[-–]\s*\d+\.\s*/, '')
    .replace(/^\d+[.\s]+/, '')
    .trim()
  return truncateLabel(cleanLabel(s), 32)
}

export function normalizeMindmapData(data: any, fallbackTree: MindmapNode): MindmapData {
  if (data?.modes) {
    const modes = data.schema_version === 2 ? data.modes || {} : { origin: data.modes?.origin }
    return {
      schema_version: 2,
      active_mode: data.schema_version === 2 ? data.active_mode || 'ai_refactor' : 'ai_refactor',
      sync_enabled: !!data.sync_enabled,
      modes,
    }
  }
  if (data?.tree) {
    const mode = data.mode || 'origin'
    if (mode === 'ai_refactor') {
      return {
        schema_version: 2,
        active_mode: 'ai_refactor',
        sync_enabled: !!data.sync_enabled,
        modes: {},
      }
    }
    return {
      schema_version: 2,
      active_mode: mode,
      sync_enabled: !!data.sync_enabled,
      modes: {
        [mode]: {
          tree: data.tree,
          edited: !!data.edited,
          updated_at: data.updated_at,
        },
      },
    }
  }
  return {
    schema_version: 2,
    active_mode: 'ai_refactor',
    sync_enabled: false,
    modes: {
      origin: { tree: fallbackTree, edited: false },
    },
  }
}

export function getModeEntry(data: MindmapData, mode: MindmapMode): MindmapModeData {
  return data.modes?.[mode] || {}
}

export function setModeEntry(
  data: MindmapData,
  mode: MindmapMode,
  entry: MindmapModeData,
): MindmapData {
  return {
    schema_version: 2,
    ...data,
    active_mode: mode,
    modes: {
      ...(data.modes || {}),
      [mode]: entry,
    },
  }
}

export function buildOriginTree(markdown: string, fallbackRoot = '视频笔记'): MindmapNode {
  const headings = parseAllHeadingsFromDisplay(markdown)
  if (headings.length === 0) return { label: fallbackRoot }

  const headingRanges = buildHeadingRanges(markdown, headings)
  const structuredIndex = headings.findIndex((h) => h.label === '结构化笔记')
  const structuredHeading = structuredIndex >= 0 ? headings[structuredIndex] : undefined
  const structuredEnd = structuredHeading
    ? headings.findIndex((h, i) => i > structuredIndex && h.depth <= structuredHeading.depth)
    : -1
  const sourceHeadings = structuredHeading
    ? headings
        .slice(structuredIndex + 1, structuredEnd > -1 ? structuredEnd : headings.length)
        .filter((h) => !TEMPLATE_HEADINGS.has(h.label))
    : headings.filter((h) => !TEMPLATE_HEADINGS.has(h.label))

  const root: MindmapNode = {
    label: cleanRootLabel(fallbackRoot),
    headingId: structuredHeading?.id || headings[0].id,
    timestamp: structuredHeading?.timestamp ?? headings[0].timestamp,
  }
  const baseDepth = structuredHeading?.depth ?? Math.max(1, Math.min(...sourceHeadings.map((h) => h.depth)) - 1)
  const stack: { node: MindmapNode; depth: number }[] = [{ node: root, depth: baseDepth }]

  for (const h of sourceHeadings) {
    const treeLevel = h.depth - baseDepth
    const headingMaxLen = treeLevel <= 1 ? 24 : 18
    const node: MindmapNode = {
      ...headingToNode(h.label, headingMaxLen),
      headingId: h.id,
      timestamp: h.timestamp,
    }
    while (stack.length > 1 && stack[stack.length - 1].depth >= h.depth) stack.pop()
    const parent = stack[stack.length - 1].node
    parent.children = parent.children || []
    parent.children.push(node)
    stack.push({ node, depth: h.depth })

    const body = headingRanges.get(h.id) || []
    const bodyNodes = extractKeyPointNodes(body).slice(0, 8)
    if (bodyNodes.length) {
      node.children = [...(node.children || []), ...bodyNodes]
    }
  }

  if (!root.children?.length && structuredHeading) {
    root.children = extractKeyPointNodes(headingRanges.get(structuredHeading.id) || []).slice(0, 8)
  }

  return dedupeTree(root)
}

function buildHeadingRanges(markdown: string, headings: DocumentHeading[]) {
  const lines = markdown.split('\n')
  const headingLineIndexes: { heading: DocumentHeading; index: number }[] = []
  let headingIdx = 0
  let inFence = false
  lines.forEach((line, index) => {
    const trimmed = line.trim()
    if (trimmed.startsWith('```')) {
      inFence = !inFence
      return
    }
    if (inFence) return
    if (/^#{1,6}\s+/.test(trimmed) && headings[headingIdx]) {
      headingLineIndexes.push({ heading: headings[headingIdx], index })
      headingIdx++
    }
  })

  const ranges = new Map<string, string[]>()
  for (let i = 0; i < headingLineIndexes.length; i++) {
    const current = headingLineIndexes[i]
    const end = headingLineIndexes.find((h, j) => j > i && h.heading.depth <= current.heading.depth)?.index ?? lines.length
    ranges.set(current.heading.id, lines.slice(current.index + 1, end))
  }
  return ranges
}

function isKeywordBullet(rawBulletText: string): boolean {
  const t = rawBulletText.trim()
  if (/^\*\*/.test(t)) {
    const boldContent = t.replace(/^\*\*([\s\S]+)\*\*$/, '$1').trim()
    if (boldContent.length > 20 && /^(视频|我们|如果|当我|你可|这里|然后|首先|其次|最后|注意|重要|本节|本课|今天|下面|以下|接下来|这是|整体|总体|通过|利用|基于|结合|目前|当前|实际|关于|以下|根据|针对|依据|对于|随着)/.test(boldContent)) return false
    return true
  }
  if (/^Step\s*\d+/i.test(t)) return true
  if (/^[a-z][a-z_]*$/.test(t) && /^(description|body|schema|response|request|result|output|input|status|error|message|content|config|params|args|meta|info|context|callback|handler|method|endpoint|token|auth|item|default|custom|base|payload|query|data|type|name|value|key|flag|mode|state|props|options|settings|list|index|count|size|page|code|text|tag|ref|id|uid|uuid|hash|path|url|host|port|format|version|date|time|sort|order|filter|limit|offset|field|column|table|row|cell|node|edge|graph|root|parent|child|depth|level)$/.test(t)) return false
  if (t.length > 25) return false
  if (/^(如果|当我|视频|我们|你可|这里|然后|首先|其次|最后|注意|重要|本节|本课|今天|下面|以下|接下来|这是|整体|总体|通过|利用|基于|结合|目前|当前|实际|关于|根据|针对|依据|对于|随着)/.test(t)) return false
  return true
}

function extractKeyPointNodes(lines: string[]): MindmapNode[] {
  const roots: { node: MindmapNode; indent: number }[] = []
  const stack: { node: MindmapNode; indent: number }[] = []
  let inFence = false
  const shortParagraphs: MindmapNode[] = []

  for (const line of lines) {
    const raw = line.replace(/\t/g, '  ')
    const trimmed = raw.trim()
    if (!trimmed) continue
    if (trimmed.startsWith('```')) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    if (/^#{1,6}\s+/.test(trimmed)) break
    if (/^<!--|-->$/.test(trimmed)) continue
    if (/^\|/.test(trimmed)) continue

    const list = /^(\s*)([-*+] |\d+[.)]\s+)(.+)$/.exec(raw)
    if (list) {
      if (!isKeywordBullet(list[3])) continue
      const indent = list[1].length
      const node = lineToNode(list[3])
      if (!node) continue
      while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop()
      if (stack.length) {
        const parent = stack[stack.length - 1].node
        parent.children = parent.children || []
        parent.children.push(node)
      } else {
        roots.push({ node, indent })
      }
      stack.push({ node, indent })
      continue
    }

    const node = lineToNode(trimmed)
    if (node && shortParagraphs.length < 5 && isUsefulShortLine(trimmed)) {
      shortParagraphs.push(node)
    }
  }

  const nodes = roots.map((r) => r.node)
  if (nodes.length) return dedupeNodes(nodes)
  return dedupeNodes(shortParagraphs)
}

function lineToNode(text: string): MindmapNode | null {
  // Prefer the leading bold span (author's intended heading) as a concise label.
  // Strip list markers first so the bold span can sit at the start.
  const stripped = text.replace(/^\s*(?:\d+(?:\.\d+)*[、.)]\s+|[-*+•·]\s+)/, '')
  const boldLead = /^\s*\*\*([^*]+)\*\*/.exec(stripped)
  if (boldLead) {
    // Strip inline code backticks from the bold label so tree nodes and
    // markmap rendering agree (tree stores plain text, markmap wraps
    // backticks in <code> tags which breaks label matching).
    const raw = boldLead[1].replace(/`([^`]+)`/g, '$1')
    const boldStep = /^Step\s*\d+[：:]\s*(.{2,})$/i.exec(raw)
    if (boldStep) {
      const label = truncateLabel(cleanLabel(boldStep[1]), 18)
      return label ? { label } : null
    }
    const boldChineseStep = /^第\s*[一二三四五六七八九十\d]+\s*[个阶段步章层类节期轮]+[：:]\s*(.{2,})$/.exec(raw)
    if (boldChineseStep) {
      const label = truncateLabel(cleanLabel(boldChineseStep[1]), 18)
      return label ? { label } : null
    }
    const label = truncateLabel(cleanLabel(raw), 24)
    if (label) return { label }
  }

  let value = stripped
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<!--\s*ts:[^>]+-->/g, '')
    .trim()
  if (!value || value.length < 2) return null

  // Step N: 描述 → use content after colon as label, works for plain and bold variants
  const stepValue = /^Step\s*\d+[：:]\s*(.{2,})$/i.exec(value)
  if (stepValue) {
    const label = truncateLabel(cleanLabel(stepValue[1]), 24)
    return label ? { label } : null
  }

  // 第N阶段/步/章: xxx → extract content after colon
  const chineseStep = /^第\s*[一二三四五六七八九十\d]+\s*[个阶段步章层类节期轮]+[：:]\s*(.{2,})$/.exec(value)
  if (chineseStep) {
    const label = truncateLabel(cleanLabel(chineseStep[1]), 24)
    return label ? { label } : null
  }

  if (/^https?:\/\//i.test(value)) return { label: '参考链接', children: [{ label: value }] }
  if (/^(npm|pnpm|yarn|pip|brew|git|python|node|uv|npx)\s/.test(value)) return { label: '执行命令', children: [{ label: value }] }

  // Term-definition split on colon or em-dash (not comma — comma is often part of the label).
  const term = /^(.{2,24}?)\s*[：:—]\s*(.{2,})$/.exec(value)
  if (term) {
    return {
      label: truncateLabel(cleanLabel(term[1]), 24),
      children: [compactTextNode(term[2])],
    }
  }

  const label = truncateLabel(cleanLabel(value), 24)
  if (!label) return null
  return { label }
}

function compactTextNode(value: string): MindmapNode {
  const label = truncateLabel(cleanLabel(value), 24)
  return { label }
}

const HEADING_STRIP_PREFIXES = /^(如何|怎么|怎样|关于|浅谈|详解|深入|简单地?|快速|一起)/
const HEADING_STRIP_SUFFIXES = /(的方法|的技巧|详解|介绍|指南|总结|分享|实践|讲解|原理|系统)$/

function summarizeHeading(label: string, maxLen = 14): string {
  let s = cleanLabel(label)
  const colonIdx = s.search(/[：:]/)
  if (colonIdx > 0 && colonIdx <= 10) {
    s = s.slice(0, colonIdx).trim()
  }
  s = s.replace(HEADING_STRIP_PREFIXES, '').replace(HEADING_STRIP_SUFFIXES, '').trim()
  return truncateLabel(s || cleanLabel(label), maxLen)
}

function headingToNode(label: string, maxLen = 14): MindmapNode {
  return { label: summarizeHeading(label, maxLen) }
}

// Truncate at a word/phrase boundary so we never cut mid-word or leave dangling
// brackets. Adds an ellipsis when truncated.
const BRACKET_PAIRS: Record<string, string> = { '(': ')', '（': '）', '[': ']', '【': '】', '「': '」' }

export function truncateLabel(value: string, max = 32): string {
  if (value.length <= max) return value
  let cut = value.slice(0, max)
  // Back up to the last space or punctuation to avoid breaking a word/bracket.
  const m = cut.match(/.*[\s，、（）()【】「」—\-]/)
  if (m && m[0].length >= 12) cut = m[0].replace(/[\s，、（）()【】「」—\-]+$/, '')
  // Balance trailing unclosed brackets.
  const stack: string[] = []
  for (const ch of cut) {
    if (BRACKET_PAIRS[ch]) stack.push(BRACKET_PAIRS[ch])
    else if (stack.length && stack[stack.length - 1] === ch) stack.pop()
  }
  cut += stack.reverse().join('')
  return cut + '…'
}

function cleanLabel(value: string) {
  let s = value
    .replace(/（[^）]{0,80}）/g, '')        // 去中文括号注释
    .replace(/\([^)]{0,80}\)/g, '')          // 去英文括号注释
    .replace(/”[^”]{0,30}”/g, '') // 去中文弯引号内容，如”毒蛇产品经理5.0”
    .replace(/\s+/g, ' ')
    .replace(/[。；;，,：:]$/g, '')
    .trim()
  // 如果还是很长，先尝试在逗号处截断（去掉括注性描述）
  if (s.length > 20) {
    const commaIdx = s.search(/[，；]/)
    if (commaIdx >= 4) s = s.slice(0, commaIdx).trim()
  }
  // 如果仍然很长，且含”并/及/以及”这类并列连接，只取第一个动作短语
  if (s.length > 16) {
    const m = s.match(/^(.{6,16})[，,]?(?:并|及|以及|而非|，|,)/)
    if (m) s = m[1].replace(/[，,]$/, '').trim()
  }
  return s
}

function isUsefulShortLine(text: string) {
  if (text.length > 90) return false
  if (/^第\s*\d+\s*节|目录|总结如下/.test(text)) return false
  if (/^(视频|我们|如果|当我|你可|这里|然后|首先|其次|最后|注意|重要|本节|本课|今天|下面|以下|接下来|这是|整体|总体|通过|利用|基于|结合|目前|当前|实际|关于|根据|针对|依据|对于|随着)/.test(text)) return false
  return /[：:是为可将把需能由与及]|步骤|组件|阶段|命令|安装|注意|核心|包括|用于/.test(text)
}

export function treeToOutline(node: MindmapNode): string {
  const textStyle = nodeStyle(node)
  const lines: string[] = [`# <span style="${textStyle}">${node.label}</span>`]
  const walk = (children: MindmapNode[] | undefined, depth: number) => {
    if (!children) return
    const indent = '  '.repeat(depth)
    for (const c of children) {
      const textStyle = nodeStyle(c)
      const label = renderNodeLabel(c)
      const styledLabel = `<span style="${textStyle}">${label}</span>`
      lines.push(`${indent}- ${styledLabel}`)
      const displayChildren = c.children || (c.detail ? [{ label: c.detail }] : undefined)
      walk(displayChildren, depth + 1)
    }
  }
  walk(node.children, 0)
  return lines.join('\n')
}

function nodeStyle(node: MindmapNode): string {
  let style = `color:#1A1A1A;font-weight:${node.bold ? 800 : 400};${node.italic ? 'font-style:italic;' : ''}`
  if (node.color) {
    style += `background-color:${hexToRgba(node.color, 0.5)};padding:0 2px;border-radius:2px;`
  }
  return style
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function renderNodeLabel(node: MindmapNode, root = false) {
  return node.label
}

export function treeToMarkdownOutline(node: MindmapNode): string {
  const lines: string[] = [`# ${node.label}`]
  const walk = (children: MindmapNode[] | undefined, depth: number) => {
    if (!children) return
    const indent = '  '.repeat(depth)
    for (const c of children) {
      lines.push(`${indent}- ${renderNodeLabel(c)}`)
      const displayChildren = c.children || (c.detail ? [{ label: c.detail }] : undefined)
      walk(displayChildren, depth + 1)
    }
  }
  walk(node.children, 0)
  return lines.join('\n')
}

export function treeToOpml(node: MindmapNode, title = '思维导图'): string {
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const walk = (n: MindmapNode): string => {
    const displayChildren = n.children || (n.detail ? [{ label: n.detail }] : undefined)
    const children = (displayChildren || []).map(walk).join('')
    return `<outline text="${esc(renderNodeLabel(n))}">${children}</outline>`
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
<head><title>${esc(title)}</title></head>
<body>
${walk(node)}
</body>
</opml>`
}

export function cloneTree(node: MindmapNode): MindmapNode {
  return JSON.parse(JSON.stringify(node)) as MindmapNode
}

export function flattenTree(
  root: MindmapNode,
): { node: MindmapNode; parent: MindmapNode | null; path: string }[] {
  const out: { node: MindmapNode; parent: MindmapNode | null; path: string }[] = []
  const walk = (node: MindmapNode, parent: MindmapNode | null, path: string) => {
    out.push({ node, parent, path: path || node.label })
    for (const c of node.children || []) {
      walk(c, node, `${path}${path ? ' / ' : ''}${node.label}`)
    }
  }
  walk(root, null, '')
  return out
}

export function findNode(
  root: MindmapNode,
  target: MindmapNode,
): { parent: MindmapNode | null; index: number } | null {
  const walk = (node: MindmapNode): { parent: MindmapNode | null; index: number } | null => {
    const kids = node.children || []
    for (let i = 0; i < kids.length; i++) {
      if (kids[i] === target) return { parent: node, index: i }
      const r = walk(kids[i])
      if (r) return r
    }
    return null
  }
  return walk(root)
}

export function dedupeTree(node: MindmapNode): MindmapNode {
  return {
    ...node,
    children: node.children ? dedupeNodes(node.children).map(dedupeTree) : undefined,
  }
}

function dedupeNodes(nodes: MindmapNode[]) {
  const byKey = new Map<string, MindmapNode>()
  for (const node of nodes) {
    const key = normalizeKey(node.label)
    const existing = byKey.get(key)
    if (!existing) {
      byKey.set(key, { ...node, children: node.children ? [...node.children] : undefined })
      continue
    }
    existing.children = dedupeNodes([...(existing.children || []), ...(node.children || [])])
    existing.detail = existing.detail || node.detail
    existing.headingId = existing.headingId || node.headingId
    existing.timestamp = existing.timestamp ?? node.timestamp
  }
  return [...byKey.values()].filter((n) => n.label)
}

function normalizeKey(label: string) {
  return label.replace(/[\s\d.、:：，,（）()【】\[\]「」]/g, '').toLowerCase()
}

export function syncOutlineToMarkdown(
  markdown: string,
  tree: MindmapNode,
  headings: DocumentHeading[],
): string {
  const labelDepth = new Map<string, number>()
  const walk = (node: MindmapNode, depth: number) => {
    labelDepth.set(node.label, depth)
    for (const c of node.children || []) walk(c, depth + 1)
  }
  walk(tree, 1)

  const lines = markdown.split('\n')
  const out: string[] = []
  let inFence = false
  for (const line of lines) {
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
    const h = headings.find((hd) => hd.label && line.includes(hd.label))
    if (!h) {
      out.push(line)
      continue
    }
    const newDepth = labelDepth.get(h.label)
    if (!newDepth) {
      out.push(line)
      continue
    }
    out.push(`${'#'.repeat(newDepth)} ${h.label}`)
  }
  return out.join('\n')
}

export function downloadText(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export async function downloadSvgAsPng(svg: SVGSVGElement, filename: string, scale = 4) {
  // 1. Expand all folded nodes in the live SVG so the clone captures full content
  svg.querySelectorAll('.markmap-fold').forEach(el => el.classList.remove('markmap-fold'))

  // 2. Clone SVG and strip zoom transform — content is now in its natural coordinate system
  const clone = svg.cloneNode(true) as SVGSVGElement
  const rootG = clone.querySelector('g') as SVGGElement | null
  if (rootG) rootG.removeAttribute('transform')
  clone.querySelectorAll('.markmap-fold').forEach(el => el.classList.remove('markmap-fold'))
  clone.querySelectorAll('g.markmap-node').forEach(g => {
    const circle = g.querySelector(':scope > circle')
    if (circle) circle.setAttribute('fill', 'var(--markmap-circle-open-bg)')
  })

  // 3. Clean container-dependent CSS
  clone.removeAttribute('class')
  clone.style.cssText = ''

  // 4. Measure content bounds (render off-screen to get accurate getBBox)
  clone.style.position = 'absolute'
  clone.style.left = '-9999px'
  clone.style.top = '-9999px'
  document.body.appendChild(clone)
  const bbox = (clone.querySelector('g') as SVGGElement).getBBox()
  document.body.removeChild(clone)
  clone.style.cssText = ''

  // 5. After translate(pad-bbox.x, pad-bbox.y), content spans from (pad, pad)
  //    to (pad+bbox.width, pad+bbox.height). ViewBox = content + padding on each side.
  const pad = 40
  const w = Math.ceil(bbox.width + 2 * pad)
  const h = Math.ceil(bbox.height + 2 * pad)

  // 6. Set viewBox (padded area) and width/height (hi-res pixel size for rasterization)
  clone.setAttribute('viewBox', `0 0 ${w} ${h}`)
  clone.setAttribute('width', String(w * scale))
  clone.setAttribute('height', String(h * scale))
  if (rootG) rootG.setAttribute('transform', `translate(${pad - bbox.x}, ${pad - bbox.y})`)

  // 7. Render SVG → canvas → PNG
  const xml = new XMLSerializer().serializeToString(clone)
  const canvas = document.createElement('canvas')
  canvas.width = w * scale
  canvas.height = h * scale
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const img = new Image()
  img.onload = () => {
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    canvas.toBlob((blob) => {
      if (!blob) return
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    }, 'image/png')
  }
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml)
}
