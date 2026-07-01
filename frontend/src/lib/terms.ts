export interface TermEntry {
  term: string
  definition: string
}

export type NoteStyle = 'beginner' | 'professional'

const TERM_DEFS_RE = /<!--\s*term-defs\s*([\s\S]*?)-->/i
const LEGACY_GLOSSARY_RE = /<!--\s*glossary\s*([\s\S]*?)-->/i
const GLOSSARY_VISIBLE_RE =
  /#{1,6}\s*(?:\d+\.\s*)?术语(?:速查|解释|释义)\s*\n([\s\S]*?)(?=\n#{1,6}\s|\n<!--\s*(?:term-defs|glossary)|$)/i

/** 小白术语释义展示：去掉「比喻：」标签，保留通俗内容 */
export function formatTermDefinitionForDisplay(definition: string, style: NoteStyle): string {
  if (style !== 'beginner') return definition
  let text = definition.trim()
  text = text.replace(/^(?:比喻|比喩)[：:]\s*/, '')
  text = text.replace(/[。；]\s*(?:比喻|比喩)[：:]\s*/g, '，就像')
  return text.replace(/\s{2,}/g, ' ').trim()
}

export function termLinkHref(term: string): string {
  return `term://${encodeURIComponent(term)}`
}

export function parseTermLinkHref(href: string): string | null {
  if (!href.startsWith('term://')) return null
  return decodeURIComponent(href.slice('term://'.length))
}

function parseDefLines(text: string, entries: TermEntry[], seen: Set<string>) {
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const cleaned = trimmed.replace(/^[-*•]\s*/, '')
    const match = /^(.+?)\s*[—\-–:：]\s*(.+)$/.exec(cleaned)
    if (!match) continue
    const term = match[1].replace(/\*\*/g, '').replace(/==/g, '').trim()
    const definition = match[2].replace(/\*\*/g, '').replace(/==/g, '').trim()
    if (term && definition && !seen.has(term.toLowerCase())) {
      seen.add(term.toLowerCase())
      entries.push({ term, definition })
    }
  }
}

/** 从隐藏 term-defs 块解析术语释义（兼容旧 glossary 与可见术语章节） */
export function extractTermDefs(markdown: string): TermEntry[] {
  const entries: TermEntry[] = []
  const seen = new Set<string>()

  const termDefsMatch = TERM_DEFS_RE.exec(markdown)
  if (termDefsMatch) {
    parseDefLines(termDefsMatch[1], entries, seen)
  }

  const legacyMatch = LEGACY_GLOSSARY_RE.exec(markdown)
  if (legacyMatch) {
    parseDefLines(legacyMatch[1], entries, seen)
  }

  const visibleMatch = GLOSSARY_VISIBLE_RE.exec(markdown)
  if (visibleMatch) {
    parseDefLines(visibleMatch[1], entries, seen)
  }

  return entries.sort((a, b) => b.term.length - a.term.length)
}

function lookupDef(entries: TermEntry[], text: string): TermEntry | undefined {
  const exact = entries.find((e) => e.term === text)
  if (exact) return exact
  const lower = text.toLowerCase()
  return entries.find((e) => e.term.toLowerCase() === lower)
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function isFormulaLine(line: string): boolean {
  return /^>\s+\*\*[^*\n]+\s*=\s*[^*\n]+\*\*\s*$/.test(line) ||
    /^\*\*[^*\n]+\s*=\s*[^*\n]+\*\*\s*$/.test(line)
}

function isAlreadyLinked(line: string, term: string): boolean {
  const enc = encodeURIComponent(term)
  return (
    line.includes(`](term://${enc})`) ||
    line.includes(`](term://${term})`) ||
    line.includes(`[${term}](term://`)
  )
}

/** 全文每个术语首次出现加 term:// 链接（恢复旧版悬浮释义行为） */
export function linkifyTermsFromDefs(markdown: string, entries: TermEntry[]): string {
  if (entries.length === 0) return markdown

  const linked = new Set<string>()
  const lines = markdown.split('\n')
  let inFence = false
  const out: string[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith('```')) {
      inFence = !inFence
      out.push(line)
      continue
    }
    if (
      inFence ||
      isFormulaLine(trimmed) ||
      /^#{1,6}\s/.test(trimmed) ||
      trimmed.startsWith('|') ||
      trimmed.includes('<!-- term-defs') ||
      trimmed.includes('<!-- glossary')
    ) {
      out.push(line)
      continue
    }

    let processed = line
    for (const { term } of entries) {
      const key = term.toLowerCase()
      if (linked.has(key)) continue
      if (isAlreadyLinked(processed, term)) {
        linked.add(key)
        continue
      }

      const escaped = escapeRegExp(term)
      const patterns = [
        // **Term（alias）** or **Term** — consume alias inside bold markers
        new RegExp(`(?<!\\[)\\*\\*${escaped}(?:[（(][^）)\\n]{1,40}[）)])?\\*\\*(?!\\])`, 'i'),
        // bare Term or **Term** without alias
        new RegExp(`(?<!\\[)(?:\\*\\*)?${escaped}(?:\\*\\*)?(?!\\])`, 'i'),
        new RegExp(`==\\s*${escaped}\\s*==`, 'i'),
      ]
      let matched = false
      for (const re of patterns) {
        if (!re.test(processed)) continue
        processed = processed.replace(re, () => {
          linked.add(key)
          matched = true
          return `[${term}](${termLinkHref(term)})`
        })
        if (matched) break
      }
    }
    out.push(processed)
  }

  return out.join('\n')
}

/** 将 == / ** 标记转为 term:// 链接；每个术语全文仅首次出现保留 ? 悬浮释义 */
export function preprocessTermMarks(
  markdown: string,
  entries: TermEntry[],
  _style: NoteStyle,
): string {
  const linked = new Set<string>()
  const lines = markdown.split('\n')
  let inFence = false
  const out: string[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith('```')) {
      inFence = !inFence
      out.push(line)
      continue
    }
    if (
      inFence ||
      isFormulaLine(trimmed) ||
      trimmed.startsWith('|') ||
      trimmed.includes('<!-- term-defs') ||
      trimmed.includes('<!-- glossary')
    ) {
      out.push(line)
      continue
    }

    let processed = line

    processed = processed.replace(/==(.+?)==/g, (_match, inner: string) => {
      const text = inner.trim()
      const def = lookupDef(entries, text)
      if (!def) return text
      const key = def.term.toLowerCase()
      if (linked.has(key) || isAlreadyLinked(processed, def.term)) {
        return text
      }
      linked.add(key)
      return `[${text}](${termLinkHref(def.term)})`
    })

    for (const entry of entries) {
      const key = entry.term.toLowerCase()
      const escaped = escapeRegExp(entry.term)
      // Matches **Term** or **Term（alias）** (alias inside bold markers)
      const reWithOptAlias = new RegExp(
        `\\*\\*(${escaped}(?:[（(][^）)\\n]{1,40}[）)])??)\\*\\*`,
        'i',
      )
      const reWithOptAliasGlobal = new RegExp(
        `\\*\\*(${escaped}(?:[（(][^）)\\n]{1,40}[）)])??)\\*\\*`,
        'gi',
      )
      if (linked.has(key)) {
        processed = processed.replace(reWithOptAliasGlobal, '$1')
        continue
      }
      if (isAlreadyLinked(processed, entry.term)) {
        linked.add(key)
        continue
      }

      if (!reWithOptAlias.test(processed)) continue
      processed = processed.replace(reWithOptAlias, () => {
        linked.add(key)
        return `[${entry.term}](${termLinkHref(entry.term)})`
      })
    }

    out.push(processed)
  }

  return out.join('\n')
}

/** 去掉 term-defs / glossary 隐藏块与可见术语章节（展示用） */
export function stripTermDefsFromDisplay(markdown: string): string {
  let result = markdown
    .replace(/<!--\s*term-defs[\s\S]*?-->\s*/gi, '')
    .replace(/<!--\s*glossary[\s\S]*?-->\s*/gi, '')

  const lines = result.split('\n')
  const out: string[] = []
  let skipping = false

  for (const line of lines) {
    const trimmed = line.trim()
    if (/^#{1,6}\s*(?:\d+\.\s*)?术语(?:速查|解释|释义)/.test(trimmed)) {
      skipping = true
      continue
    }
    if (skipping && /^#{1,6}\s+/.test(trimmed)) {
      skipping = false
    }
    if (!skipping) out.push(line)
  }

  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

/** @deprecated */
export const extractGlossary = extractTermDefs
/** @deprecated */
export const stripGlossaryFromDisplay = stripTermDefsFromDisplay
/** @deprecated */
export function normalizeGlossaryInMarkdown(markdown: string): string {
  return markdown
}
/** @deprecated */
export function linkifyTerms(markdown: string, glossary: TermEntry[]): string {
  return linkifyTermsFromDefs(markdown, glossary)
}
