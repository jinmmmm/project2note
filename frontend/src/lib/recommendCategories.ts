import type { RecommendationItem } from '@/services'

export const KNOWN_TYPE_LABELS: Record<string, string> = {
  prerequisite: '前置基础',
  advanced: '后续进阶',
  related: '相关延伸',
}

export const PREFERRED_TYPE_ORDER = ['prerequisite', 'advanced', 'related']

export function getCategoryLabel(item: Pick<RecommendationItem, 'type' | 'category_label'>): string {
  if (item.category_label?.trim()) return item.category_label.trim()
  const type = item.type || 'related'
  return KNOWN_TYPE_LABELS[type] || type
}

export function getRecNavLabel(item: Pick<RecommendationItem, 'topic' | 'type' | 'category_label'>): string {
  const topic = item.topic?.trim() || ''
  const label = getCategoryLabel(item)
  const bracketPrefix = `[${label}]`
  if (topic.startsWith(bracketPrefix)) {
    return topic.slice(bracketPrefix.length).trim() || topic
  }
  return topic
}

export function groupRecommendations(items: RecommendationItem[]) {
  const map = new Map<string, { type: string; label: string; items: { rec: RecommendationItem; index: number }[] }>()
  items.forEach((rec, index) => {
    const type = rec.type || 'related'
    if (!map.has(type)) {
      map.set(type, { type, label: getCategoryLabel(rec), items: [] })
    }
    map.get(type)!.items.push({ rec, index })
  })
  const preferred = PREFERRED_TYPE_ORDER.filter((t) => map.has(t)).map((t) => map.get(t)!)
  const rest = [...map.values()].filter((g) => !PREFERRED_TYPE_ORDER.includes(g.type))
  return [...preferred, ...rest]
}
