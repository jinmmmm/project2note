/** 解析 [mm:ss] 或 [h:mm:ss] 为秒数 */
export function parseTimestampLabel(label: string): number | null {
  const match = /^\[(\d{1,2}):(\d{2})(?::(\d{2}))?\]$/.exec(label.trim())
  if (!match) return null
  if (match[3] !== undefined) {
    return parseInt(match[1], 10) * 3600 + parseInt(match[2], 10) * 60 + parseInt(match[3], 10)
  }
  return parseInt(match[1], 10) * 60 + parseInt(match[2], 10)
}

/** 从标题文本开头提取 [mm:ss] 前缀（兼容旧笔记） */
export function parseTimestampPrefix(text: string): { seconds: number | null; rest: string } {
  const match = /^\[(\d{1,2}):(\d{2})(?::(\d{2}))?\]\s*/.exec(text)
  if (!match) return { seconds: null, rest: text }
  const label = `[${match[1]}:${match[2]}${match[3] !== undefined ? `:${match[3]}` : ''}]`
  return { seconds: parseTimestampLabel(label), rest: text.slice(match[0].length) }
}

/** 从标题文本末尾提取 [mm:ss] 后缀（推荐格式） */
export function parseTimestampSuffix(text: string): { seconds: number | null; rest: string } {
  const match = /\s*\[(\d{1,2}):(\d{2})(?::(\d{2}))?\]\s*$/.exec(text)
  if (!match) return { seconds: null, rest: text }
  const label = `[${match[1]}:${match[2]}${match[3] !== undefined ? `:${match[3]}` : ''}]`
  return { seconds: parseTimestampLabel(label), rest: text.slice(0, match.index).trimEnd() }
}

/** 从标题 HTML 注释提取时间戳：`<!-- ts:mm:ss -->`（兼容缺失 `-->` 的旧数据） */
export function parseTimestampComment(text: string): { seconds: number | null; rest: string } {
  const match = /\s*<!--\s*ts:(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*-->|[^\n]*)\s*/i.exec(text)
  if (!match) return { seconds: null, rest: text }
  const label =
    match[3] !== undefined
      ? `[${match[1]}:${match[2]}:${match[3]}]`
      : `[${match[1]}:${match[2]}]`
  const seconds = parseTimestampLabel(label)
  const rest = (text.slice(0, match.index) + text.slice(match.index + match[0].length)).trim()
  return { seconds, rest }
}

/** 从标题提取时间戳，优先 HTML 注释，再后缀/前缀 [mm:ss] */
export function parseTimestampInTitle(text: string): { seconds: number | null; rest: string } {
  const comment = parseTimestampComment(text)
  if (comment.seconds != null) return comment
  const suffix = parseTimestampSuffix(text)
  if (suffix.seconds != null) return suffix
  return parseTimestampPrefix(text)
}

/** 将标题行内 [mm:ss] 转为 <!-- ts:... -->，并从 ### 正文提升首个时间戳（展示/目录用） */
export function normalizeNoteTimestamps(markdown: string): string {
  if (!markdown) return markdown

  const tsBracketRe = /\[(\d{1,2}):(\d{2})(?::(\d{2}))?\]/g
  const tsCommentRe = /<!--\s*ts:(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*-->|[^\n]*)/i
  const headingRe = /^(#{1,6})\s+(.+)$/

  const toComment = (a: string, b: string, c?: string) =>
    c !== undefined ? `<!-- ts:${a}:${b}:${c} -->` : `<!-- ts:${a}:${b} -->`

  const hasComment = (text: string) => tsCommentRe.test(text)

  const firstTsInText = (text: string): string | null => {
    const cm = tsCommentRe.exec(text)
    if (cm) return toComment(cm[1], cm[2], cm[3])
    const bm = tsBracketRe.exec(text)
    if (bm) return toComment(bm[1], bm[2], bm[3])
    return null
  }

  const normalizeHeadingLine = (line: string): string => {
    const m = headingRe.exec(line)
    if (!m) return line
    const [, hashes, rawBody] = m
    let body = rawBody.trim()
    const existing = tsCommentRe.exec(body)
    if (existing) {
      const title = body
        .replace(tsCommentRe, '')
        .replace(tsBracketRe, '')
        .replace(/\s{2,}/g, ' ')
        .trim()
      return `${hashes} ${title} ${toComment(existing[1], existing[2], existing[3])}`
    }
    const prefix = /^\[(\d{1,2}):(\d{2})(?::(\d{2}))?\]\s+/.exec(body)
    if (prefix) {
      const title = body.slice(prefix[0].length).trim()
      return `${hashes} ${title} ${toComment(prefix[1], prefix[2], prefix[3])}`
    }
    const suffix = /\s*\[(\d{1,2}):(\d{2})(?::(\d{2}))?\]\s*$/.exec(body)
    if (suffix) {
      const title = body.slice(0, suffix.index).trim()
      return `${hashes} ${title} ${toComment(suffix[1], suffix[2], suffix[3])}`
    }
    return line
  }

  const normalized = markdown.split('\n').map(normalizeHeadingLine).join('\n')

  const lines = normalized.split('\n')
  const out: string[] = []
  let inSection2 = false
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()
    if (/^##\s+(?:\d+\.\s*)?结构化笔记/.test(trimmed)) {
      inSection2 = true
      out.push(line)
      i += 1
      continue
    }
    if (inSection2 && /^##\s+/.test(trimmed)) inSection2 = false

    const hm = headingRe.exec(line)
    if (!inSection2 || !hm || hm[1].length < 3) {
      out.push(line)
      i += 1
      continue
    }

    const depth = hm[1].length
    const body = hm[2].trim()
    if (hasComment(body)) {
      out.push(line)
      i += 1
      continue
    }

    const sectionBody: string[] = []
    i += 1
    while (i < lines.length) {
      const nxt = lines[i]
      const nm = headingRe.exec(nxt)
      if (nm && nm[1].length <= depth) break
      sectionBody.push(nxt)
      i += 1
    }

    const ts = firstTsInText(sectionBody.join('\n'))
    out.push(ts ? `${hm[1]} ${body} ${ts}` : line)
    out.push(...sectionBody)
  }

  return out.join('\n')
}

export function formatTimestamp(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  }
  return `${m}:${s.toString().padStart(2, '0')}`
}

/** 将正文中的 [mm:ss] 转为可点击的 timestamp: 链接（跳过标题行，标题由组件单独渲染） */
export function linkifyTimestamps(markdown: string): string {
  return markdown
    .split('\n')
    .map((line) => {
      if (/^#{1,6}\s/.test(line.trim())) return line
      return line.replace(
        /\[(\d{1,2}):(\d{2})(?::(\d{2}))?\]/g,
        (full, a, b, c) => {
          const seconds =
            c !== undefined
              ? parseInt(a, 10) * 3600 + parseInt(b, 10) * 60 + parseInt(c, 10)
              : parseInt(a, 10) * 60 + parseInt(b, 10)
          const label = full.slice(1, -1)
          return `[${label}](timestamp:${seconds})`
        },
      )
    })
    .join('\n')
}
