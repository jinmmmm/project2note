import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, FolderOpen, Search } from 'lucide-react'
import { useAppStore } from '@/store/appStore'
import { useCollectionStore } from '@/store/collectionStore'
import { useChatStore } from '@/store/chatStore'
import { cn } from '@/lib/utils'

interface Props {
  compact?: boolean
}

export default function ChatNotePicker({ compact = false }: Props) {
  const tasks = useAppStore((s) => s.tasks)
  const collections = useCollectionStore((s) => s.collections)
  const taskCollectionMap = useCollectionStore((s) => s.taskCollectionMap)
  const activeSession = useChatStore((s) => s.getActiveSession())
  const toggleActiveTask = useChatStore((s) => s.toggleActiveTask)

  const [expandedCollections, setExpandedCollections] = useState<Set<string>>(new Set())
  const [uncategorizedExpanded, setUncategorizedExpanded] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [pickerExpanded, setPickerExpanded] = useState(false)

  const mode = activeSession?.mode ?? 'notes'
  const selectedTaskIds = activeSession?.selectedTaskIds ?? []

  const completedTasks = useMemo(
    () => tasks.filter((t) => t.status === 'COMPLETED'),
    [tasks],
  )

  const collectionGroups = useMemo(
    () => collections.map((collection) => ({
      collection,
      tasks: completedTasks.filter((task) => taskCollectionMap[task.id] === collection.id),
    })),
    [collections, completedTasks, taskCollectionMap],
  )

  const uncategorizedTasks = useMemo(
    () => completedTasks.filter((task) => !taskCollectionMap[task.id]),
    [completedTasks, taskCollectionMap],
  )

  const selectedSet = useMemo(() => new Set(selectedTaskIds), [selectedTaskIds])

  useEffect(() => {
    if (selectedTaskIds.length === 0) return
    setExpandedCollections((prev) => {
      const next = new Set(prev)
      for (const taskId of selectedTaskIds) {
        const collectionId = taskCollectionMap[taskId]
        if (collectionId) next.add(collectionId)
      }
      return next
    })
    if (selectedTaskIds.some((taskId) => !taskCollectionMap[taskId])) {
      setUncategorizedExpanded(true)
    }
  }, [selectedTaskIds, taskCollectionMap])

  const q = searchQuery.trim().toLowerCase()
  const searchResults = useMemo(() => {
    if (!q) return []
    return completedTasks.filter((task) => (task.title || '').toLowerCase().includes(q))
  }, [completedTasks, q])

  const toggleCollectionExpanded = (id: string) => {
    setExpandedCollections((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const expandAll = () => {
    setExpandedCollections(new Set(collections.map((c) => c.id)))
    setUncategorizedExpanded(true)
  }

  const collapseAll = () => {
    setExpandedCollections(new Set())
    setUncategorizedExpanded(false)
  }

  const taskRow = (task: (typeof completedTasks)[number], showCollection = false) => (
    <label
      key={task.id}
      className={cn(
        'flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 text-xs transition-colors',
        selectedSet.has(task.id)
          ? 'bg-blue-50 text-blue-700'
          : 'bg-white text-slate-700 hover:bg-slate-100',
        mode === 'free' && 'cursor-not-allowed opacity-60',
      )}
    >
      <input
        type="checkbox"
        checked={selectedSet.has(task.id)}
        onChange={() => toggleActiveTask(task.id)}
        disabled={mode === 'free'}
        className="mt-0.5 shrink-0"
      />
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 leading-relaxed">{task.title || '未命名笔记'}</span>
        {showCollection && (
          <span className="mt-0.5 block text-[10px] text-slate-400">
            {collections.find((c) => c.id === taskCollectionMap[task.id])?.name || '未分类'}
          </span>
        )}
      </span>
    </label>
  )

  const groupHeader = ({
    id,
    name,
    count,
    selectedCount,
    expanded,
    onToggle,
  }: {
    id: string
    name: string
    count: number
    selectedCount: number
    expanded: boolean
    onToggle: () => void
  }) => (
    <button
      key={id}
      type="button"
      onClick={onToggle}
      className={cn(
        'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors',
        expanded ? 'bg-blue-50 text-blue-700' : 'bg-white text-slate-700 hover:bg-slate-100',
      )}
    >
      {expanded ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
      <FolderOpen className="h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0 flex-1 truncate font-medium" title={name}>{name}</span>
      <span className="shrink-0 text-[10px] text-slate-400">{count} 篇</span>
      {selectedCount > 0 && (
        <span className="shrink-0 rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">
          已选 {selectedCount}
        </span>
      )}
    </button>
  )

  const expandedCount = expandedCollections.size + (uncategorizedExpanded ? 1 : 0)

  return (
    <div className={cn('rounded-lg border border-slate-200 bg-slate-50/80', compact ? 'p-2' : 'p-3')}>
      <button
        type="button"
        onClick={() => setPickerExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-slate-700">
          {pickerExpanded ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
          <span>选择参考笔记</span>
          <span className="truncate text-[10px] font-normal text-slate-400">
            {pickerExpanded ? '点击收起' : '点击展开'}
          </span>
        </span>
        <span className="shrink-0 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] text-blue-700">
          已选 {selectedTaskIds.length} 篇
        </span>
      </button>

      {pickerExpanded && (
        <>
          <div className="mb-2 mt-2 flex items-center gap-1.5">
        <div className="relative min-w-0 flex-1">
          <Search className="absolute left-2 top-2 h-3 w-3 text-slate-400" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索全部已完成笔记..."
            className="w-full rounded border border-slate-200 py-1.5 pl-7 pr-2 text-[10px]"
          />
        </div>
        <button
          type="button"
          onClick={expandedCount > 0 ? collapseAll : expandAll}
          className="shrink-0 rounded border border-slate-200 bg-white px-2 py-1.5 text-[10px] text-slate-600 hover:bg-slate-100"
        >
          {expandedCount > 0 ? '全部收起' : '全部展开'}
        </button>
      </div>

      {q ? (
        <div className="max-h-44 space-y-1 overflow-y-auto">
          {searchResults.length === 0 && (
            <p className="py-3 text-center text-xs text-slate-400">无匹配笔记</p>
          )}
          {searchResults.map((task) => taskRow(task, true))}
        </div>
      ) : (
        <div className="max-h-44 space-y-1 overflow-y-auto">
          {collectionGroups.length === 0 && uncategorizedTasks.length === 0 && (
            <p className="py-3 text-center text-xs text-slate-400">暂无已完成笔记</p>
          )}

          {collectionGroups.map(({ collection, tasks: groupTasks }) => {
            const selectedCount = groupTasks.filter((task) => selectedSet.has(task.id)).length
            const expanded = expandedCollections.has(collection.id)
            return (
              <div key={collection.id} className="space-y-1">
                {groupHeader({
                  id: collection.id,
                  name: collection.name,
                  count: groupTasks.length,
                  selectedCount,
                  expanded,
                  onToggle: () => toggleCollectionExpanded(collection.id),
                })}
                {expanded && (
                  <div className="space-y-1 pl-4">
                    {groupTasks.length === 0 ? (
                      <p className="py-2 text-center text-[10px] text-slate-400">该合集暂无已完成笔记</p>
                    ) : (
                      groupTasks.map((task) => taskRow(task))
                    )}
                  </div>
                )}
              </div>
            )
          })}

          <div className="space-y-1">
            {groupHeader({
              id: 'uncategorized',
              name: '未分类',
              count: uncategorizedTasks.length,
              selectedCount: uncategorizedTasks.filter((task) => selectedSet.has(task.id)).length,
              expanded: uncategorizedExpanded,
              onToggle: () => setUncategorizedExpanded((v) => !v),
            })}
            {uncategorizedExpanded && (
              <div className="space-y-1 pl-4">
                {uncategorizedTasks.length === 0 ? (
                  <p className="py-2 text-center text-[10px] text-slate-400">暂无未分类笔记</p>
                ) : (
                  uncategorizedTasks.map((task) => taskRow(task))
                )}
              </div>
            )}
          </div>
        </div>
      )}
        </>
      )}
    </div>
  )
}
