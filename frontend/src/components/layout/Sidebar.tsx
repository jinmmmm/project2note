import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import {
  Check, ChevronDown, ChevronRight, FolderOpen, FolderOutput, GripVertical, LayoutGrid, ListTodo, MessageSquare, Pencil, Plus, RotateCcw, Search, Settings, Trash2, Upload, User, X,
} from 'lucide-react'
import { taskApi, settingsApi, uploadApi } from '@/services'
import type { Task } from '@/services'
import { useAppStore } from '@/store/appStore'
import { useCollectionStore, type Collection } from '@/store/collectionStore'
import { useUIStore, type SidebarSection } from '@/store/uiStore'
import ResizeHandle from '@/components/layout/ResizeHandle'
import ChatSessionList from '@/components/chat/ChatSessionList'
import { useHorizontalResize } from '@/hooks/useHorizontalResize'
import { cn } from '@/lib/utils'

const NAV_RAIL_WIDTH = 72

const STATUS_LABEL: Record<string, string> = {
  PENDING: '排队',
  PROCESSING: '处理中',
  COMPLETED: '已完成',
  FAILED: '失败',
  CANCELED: '已停止',
}

interface Props {
  onRefresh?: () => void
}

export default function Sidebar({ onRefresh }: Props) {
  const navigate = useNavigate()
  const { taskId: activeTaskId } = useParams()
  const {
    tasks,
    setTasks,
    setProviders,
    llmDefaults,
    setLlmDefaults,
    userLLMConfig,
    removeTask,
    tasksLoading,
    tasksError,
    setTasksLoading,
    setTasksError,
  } = useAppStore()
  const section = useUIStore((s) => s.sidebarSection)
  const setSidebarSection = useUIStore((s) => s.setSidebarSection)
  const statusFilter = useUIStore((s) => s.taskStatusFilter)
  const setStatusFilter = useUIStore((s) => s.setTaskStatusFilter)
  const panelWidth = useUIStore((s) => s.sidebarPanelWidth)
  const setPanelWidth = useUIStore((s) => s.setSidebarPanelWidth)
  const setWorkbenchTaskId = useUIStore((s) => s.setWorkbenchTaskId)
  const workbenchTaskId = useUIStore((s) => s.workbenchTaskId)
  const {
    collections,
    taskCollectionMap,
    collectionTaskOrder,
    activeCollectionId,
    addCollection,
    renameCollection,
    reorderCollections,
    setCollectionTaskOrder,
    reorderTasksInCollection,
    setActiveCollection,
    assignTask,
    removeCollection,
    updateCollectionMeta,
  } = useCollectionStore()

  const [search, setSearch] = useState('')
  const [newCollectionName, setNewCollectionName] = useState('')
  const [newCollectionDesc, setNewCollectionDesc] = useState('')
  const [newCollectionTags, setNewCollectionTags] = useState('')
  const [newCollectionCover, setNewCollectionCover] = useState('')
  const [showNewCollection, setShowNewCollection] = useState(false)
  const [editingCollectionId, setEditingCollectionId] = useState<string | null>(null)
  const [editingCollectionName, setEditingCollectionName] = useState('')
  const [editingCollectionDesc, setEditingCollectionDesc] = useState('')
  const [editingCollectionTags, setEditingCollectionTags] = useState('')
  const [editingCollectionCover, setEditingCollectionCover] = useState('')
  const [editingMode, setEditingMode] = useState<'name' | 'full'>('name')
  const [draggedCollectionId, setDraggedCollectionId] = useState<string | null>(null)
  const [dragOverCollectionId, setDragOverCollectionId] = useState<string | null>(null)
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null)
  const [dragOverTaskId, setDragOverTaskId] = useState<string | null>(null)
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({})

  const isResumeTask = (task: Task) => task.status === 'FAILED' || task.status === 'CANCELED'

  const groupedTaskList = () => {
    // Build parent → children map
    const parentMap: Record<string, Task[]> = {}
    const parentIds = new Set<string>()
    const standaloneTasks: Task[] = []

    for (const task of filteredTasks) {
      if (task.parent_task_id) {
        parentMap[task.parent_task_id] = [...(parentMap[task.parent_task_id] || []), task]
        parentIds.add(task.parent_task_id)
      } else if (parentIds.has(task.id)) {
        // This is a parent Task — will be shown as group header, skip standalone list
      } else {
        standaloneTasks.push(task)
      }
    }

    const renderGroup = (parentId: string) => {
      const expanded = expandedGroups[parentId] ?? false
      // Use full tasks list to find parent (it may be filtered out by status filter)
      const parent = tasks.find((t) => t.id === parentId)
      const children = (parentMap[parentId] || []).sort((a, b) => (a.page_index ?? 999) - (b.page_index ?? 999))
      const visibleInGroup = parent ? [parent, ...children] : children
      const completedAll = visibleInGroup.filter((t) => t.status === 'COMPLETED').length
      const totalAll = visibleInGroup.length
      const hasProcessing = visibleInGroup.some((t) => t.status === 'PROCESSING' || t.status === 'PENDING')
      const hasFailed = visibleInGroup.some((t) => t.status === 'FAILED')
      const groupTitle = parent?.title || parentId
      // All tasks in group (including filtered-out parent) for deletion
      const allInGroup = parent ? [parent, ...children] : children

      const handleGroupDelete = async (e: React.MouseEvent) => {
        e.preventDefault()
        e.stopPropagation()
        const total = allInGroup.length
        if (total === 0) return
        if (!window.confirm(`确定删除合集「${groupTitle}」？包含 ${total} 个子任务，此操作不可恢复。`)) return
        try {
          // If parent exists, delete it (backend cascades to children)
          // If parent is missing (orphaned group), delete each child individually
          if (parent) {
            await taskApi.delete(parent.id)
          } else {
            for (const t of children) {
              await taskApi.delete(t.id)
            }
          }
          for (const t of allInGroup) {
            removeTask(t.id)
            assignTask(t.id, null)
          }
          toast.success('合集已删除')
          if (allInGroup.some((t) => t.id === activeTaskId)) {
            setWorkbenchTaskId(null)
            setSidebarSection('workbench')
            navigate('/')
          }
          await loadTasks()
        } catch (err) {
          toast.error((err as Error).message)
        }
      }

      const handleGroupRetry = async (e: React.MouseEvent) => {
        e.preventDefault()
        e.stopPropagation()
        if (!window.confirm(`确定重新生成合集「${groupTitle}」的全部 ${allInGroup.length} 个子任务？`)) return
        try {
          for (const t of allInGroup) {
            await taskApi.retry(t.id)
          }
          toast.success(`已重新提交 ${allInGroup.length} 个子任务`)
          await loadTasks()
        } catch (err) {
          toast.error((err as Error).message)
        }
      }

      return (
        <div key={`group-${parentId}`} className="group border-b border-slate-50">
          <div
            className={cn(
              'flex items-center gap-2 px-3 py-3 hover:bg-slate-50 transition-colors',
              allInGroup.some((t) => t.id === activeTaskId) && 'bg-blue-50/80',
            )}
          >
            <button
              type="button"
              onClick={() => setExpandedGroups({ ...expandedGroups, [parentId]: !expanded })}
              className="flex items-center gap-2 min-w-0 flex-1 text-left"
            >
              {expanded ? <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" /> : <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-800">{groupTitle}</p>
                <div className="mt-1 flex items-center gap-2">
                  <span className="text-[10px] text-slate-400">{completedAll}/{totalAll} 完成</span>
                  {hasProcessing && <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] text-blue-700">处理中</span>}
                  {hasFailed && <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] text-red-700">失败</span>}
                </div>
              </div>
            </button>
            <button
              type="button"
              onClick={handleGroupRetry}
              className="rounded p-1 text-slate-300 opacity-0 transition-opacity hover:bg-blue-50 hover:text-blue-500 group-hover:opacity-100"
              title="重新生成全部"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={handleGroupDelete}
              className="rounded p-1 text-slate-300 opacity-0 transition-opacity hover:bg-red-50 hover:text-red-500 group-hover:opacity-100"
              title="删除合集"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
          {expanded && (
            <div className="border-l-2 border-l-blue-200 ml-3">
              {parent && renderTaskItem(parent)}
              {children.map((child) => renderTaskItem(child))}
            </div>
          )}
        </div>
      )
    }

    return (
      <>
        {Array.from(parentIds).map((parentId) => renderGroup(parentId))}
        {standaloneTasks.map((task) => renderTaskItem(task))}
      </>
    )
  }

  const { onMouseDown: onPanelResize } = useHorizontalResize({
    defaultWidth: 228,
    minWidth: 160,
    maxWidth: 420,
    width: panelWidth,
    onWidthChange: setPanelWidth,
  })


  const loadTasks = async () => {
    setTasksLoading(true)
    let tasksOk = false
    try {
      const t = await taskApi.list()
      setTasks(t)
      setTasksError(null)
      tasksOk = true
    } catch (err) {
      // 失败时不覆盖现有列表，仅记错；首次加载（列表为空）才显示错误态
      if (tasks.length === 0) {
        setTasksError((err as Error).message || '加载任务列表失败')
      }
    } finally {
      setTasksLoading(false)
    }
    // 设置接口独立加载，失败不影响任务列表
    try {
      const p = await settingsApi.listProviders()
      setProviders(p)
    } catch {
      /* 设置加载失败不阻塞列表 */
    }
    try {
      const llm = await settingsApi.getLlmDefault()
      setLlmDefaults(llm)
    } catch {
      /* 设置加载失败不阻塞列表 */
    }
    if (tasksOk) onRefresh?.()
  }

  useEffect(() => {
    loadTasks().catch(() => {})
    const timer = window.setInterval(() => {
      loadTasks().catch(() => {})
    }, 5000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    if (editingCollectionId && !collections.some((c) => c.id === editingCollectionId)) {
      setEditingCollectionId(null)
      setEditingCollectionName('')
      setEditingCollectionDesc('')
      setEditingCollectionTags('')
      setEditingCollectionCover('')
    }
  }, [collections, editingCollectionId])

  const filteredTasks = tasks.filter((task) => {
    const q = search.trim().toLowerCase()
    const matchSearch = !q || (task.title || '').toLowerCase().includes(q)
    const matchStatus =
      !statusFilter
      || task.status === statusFilter
      || (statusFilter === 'PROCESSING' && task.status === 'PENDING')

    if (section === 'collections') {
      if (activeCollectionId) {
        // Merge both collection_id from DB and taskCollectionMap from localStorage
        return matchSearch && matchStatus && (
          task.collection_id === activeCollectionId || taskCollectionMap[task.id] === activeCollectionId
        )
      }
      return matchSearch && matchStatus && (Boolean(task.collection_id) || Boolean(taskCollectionMap[task.id]))
    }

    if (section === 'tasks') {
      return matchSearch && matchStatus
    }

    return matchSearch
  })

  const orderedFilteredTasks = activeCollectionId
    ? [...filteredTasks].sort((a, b) => {
      const order = collectionTaskOrder[activeCollectionId] || []
      const aIndex = order.indexOf(a.id)
      const bIndex = order.indexOf(b.id)
      if (aIndex === -1 && bIndex === -1) return 0
      if (aIndex === -1) return 1
      if (bIndex === -1) return -1
      return aIndex - bIndex
    })
    : filteredTasks

  useEffect(() => {
    if (!activeCollectionId) return
    const currentOrder = collectionTaskOrder[activeCollectionId] || []
    const assignedTaskIds = Object.keys(taskCollectionMap).filter(
      (taskId) => taskCollectionMap[taskId] === activeCollectionId,
    )
    const taskIdsInApiOrder = tasks
      .filter((task) => assignedTaskIds.includes(task.id))
      .map((task) => task.id)
    const collectionTaskIds = [
      ...taskIdsInApiOrder,
      ...assignedTaskIds.filter((taskId) => !taskIdsInApiOrder.includes(taskId)),
    ]
    const nextOrder = [
      ...currentOrder.filter((taskId) => collectionTaskIds.includes(taskId)),
      ...collectionTaskIds.filter((taskId) => !currentOrder.includes(taskId)),
    ]
    if (nextOrder.length !== currentOrder.length || nextOrder.some((taskId, i) => taskId !== currentOrder[i])) {
      setCollectionTaskOrder(activeCollectionId, nextOrder)
    }
  }, [activeCollectionId, collectionTaskOrder, setCollectionTaskOrder, taskCollectionMap, tasks])

  const handleRetry = async (e: React.MouseEvent, task: Task) => {
    e.preventDefault()
    e.stopPropagation()
    try {
      await taskApi.retry(task.id)
      toast.success('任务已重新提交')
      await loadTasks()
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  const handleDelete = async (e: React.MouseEvent, task: Task) => {
    e.preventDefault()
    e.stopPropagation()
    if (!window.confirm(`确定删除「${task.title || '未命名任务'}」？此操作不可恢复。`)) return
    try {
      await taskApi.delete(task.id)
      removeTask(task.id)
      assignTask(task.id, null)
      toast.success('已删除')
      if (activeTaskId === task.id) {
        setWorkbenchTaskId(null)
        setSidebarSection('workbench')
        navigate('/')
      }
      await loadTasks()
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  const handleAddCollection = () => {
    const name = newCollectionName.trim()
    if (!name) return
    const desc = newCollectionDesc.trim()
    const tags = newCollectionTags.trim()
      ? newCollectionTags.trim().split(/[,，]/).map((t) => t.trim()).filter(Boolean)
      : []
    const coverImage = newCollectionCover.trim()
    addCollection(name, desc, tags, coverImage)
    setNewCollectionName('')
    setNewCollectionDesc('')
    setNewCollectionTags('')
    setNewCollectionCover('')
    setShowNewCollection(false)
    toast.success(`合集「${name}」已创建`)
  }

  const startRenameCollection = (collection: Collection) => {
    setEditingCollectionId(collection.id)
    setEditingCollectionName(collection.name)
    setEditingCollectionDesc(collection.description)
    setEditingCollectionTags(collection.tags.join(', '))
    setEditingCollectionCover(collection.coverImage)
    setEditingMode('name')
  }

  const startFullEditCollection = (collection: Collection) => {
    setEditingCollectionId(collection.id)
    setEditingCollectionName(collection.name)
    setEditingCollectionDesc(collection.description)
    setEditingCollectionTags(collection.tags.join(', '))
    setEditingCollectionCover(collection.coverImage)
    setEditingMode('full')
  }

  const cancelRenameCollection = () => {
    setEditingCollectionId(null)
    setEditingCollectionName('')
    setEditingCollectionDesc('')
    setEditingCollectionTags('')
    setEditingCollectionCover('')
    setEditingMode('name')
  }

  const commitRenameCollection = () => {
    if (!editingCollectionId) return
    const name = editingCollectionName.trim()
    if (!name) {
      toast.error('合集名称不能为空')
      return
    }

    const collection = collections.find((c) => c.id === editingCollectionId)
    if (!collection) {
      cancelRenameCollection()
      return
    }

    const desc = editingCollectionDesc.trim()
    const coverImage = editingCollectionCover.trim()
    const tags = editingCollectionTags.trim()
      ? editingCollectionTags.trim().split(/[,，]/).map((t) => t.trim()).filter(Boolean)
      : []

    if (editingMode === 'full') {
      renameCollection(editingCollectionId, name)
      updateCollectionMeta(editingCollectionId, { description: desc, tags, coverImage })
      toast.success('合集已更新')
    } else if (collection.name !== name) {
      renameCollection(editingCollectionId, name)
      toast.success('合集已重命名')
    }

    cancelRenameCollection()
  }

  const handleRemoveCollection = (collection: { id: string; name: string }) => {
    if (!window.confirm(`删除合集「${collection.name}」？笔记不会被删除，仅移出合集。`)) return
    if (editingCollectionId === collection.id) cancelRenameCollection()
    removeCollection(collection.id)
  }
  const handleCollectionDragStart = (e: React.DragEvent, id: string) => {
    setDraggedCollectionId(id)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', id)
  }

  const handleCollectionDragOver = (e: React.DragEvent, id: string) => {
    if (draggedCollectionId === id) return
    e.preventDefault()
    setDragOverCollectionId(id)
  }

  const handleCollectionDrop = (e: React.DragEvent, id: string) => {
    e.preventDefault()
    if (draggedCollectionId && draggedCollectionId !== id) {
      reorderCollections(draggedCollectionId, id)
    }
    setDraggedCollectionId(null)
    setDragOverCollectionId(null)
  }

  const handleCollectionDragEnd = () => {
    setDraggedCollectionId(null)
    setDragOverCollectionId(null)
  }

  const handleTaskDragStart = (e: React.DragEvent, taskId: string) => {
    e.stopPropagation()
    setDraggedTaskId(taskId)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', taskId)
  }

  const handleTaskDragOver = (e: React.DragEvent, taskId: string) => {
    if (!activeCollectionId || draggedTaskId === taskId) return
    e.preventDefault()
    setDragOverTaskId(taskId)
  }

  const handleTaskDrop = (e: React.DragEvent, taskId: string) => {
    if (!activeCollectionId) return
    e.preventDefault()
    if (draggedTaskId && draggedTaskId !== taskId) {
      reorderTasksInCollection(activeCollectionId, draggedTaskId, taskId)
    }
    setDraggedTaskId(null)
    setDragOverTaskId(null)
  }

  const handleTaskDragEnd = () => {
    setDraggedTaskId(null)
    setDragOverTaskId(null)
  }

  const handleRemoveFromCollection = async (e: React.MouseEvent, task: Task) => {
    e.preventDefault()
    e.stopPropagation()
    try {
      await taskApi.updateCollectionId(task.id, null)
      assignTask(task.id, null)
      await loadTasks()
      toast.success('已移出合集')
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  const getTaskCollectionId = (task: Task) => task.collection_id || taskCollectionMap[task.id] || ''

  const collectionTaskCount = (collectionId: string) =>
    tasks.filter((t) => getTaskCollectionId(t) === collectionId).length

  const collectionMatchesSearch = (collection: Collection) => {
    const q = search.trim().toLowerCase()
    if (!q) return true
    return collection.name.toLowerCase().includes(q)
      || collection.description.toLowerCase().includes(q)
      || collection.coverImage.toLowerCase().includes(q)
      || collection.tags.some((t) => t.toLowerCase().includes(q))
  }

  const filteredCollections = collections.filter(collectionMatchesSearch)

  const renderTaskItem = (
    task: Task,
    options?: { showRemoveFromCollection?: boolean; enableCollectionSorting?: boolean },
  ) => {
    const isResumeTask = task.status === 'FAILED' || task.status === 'CANCELED'

    return (
    <Link
      key={task.id}
      to={isResumeTask ? '/' : `/task/${task.id}`}
      onDragOver={options?.enableCollectionSorting ? (e) => handleTaskDragOver(e, task.id) : undefined}
      onDrop={options?.enableCollectionSorting ? (e) => handleTaskDrop(e, task.id) : undefined}
      onClick={() => {
        if (isResumeTask) {
          setWorkbenchTaskId(task.id)
          setSidebarSection('workbench')
        } else {
          setSidebarSection('tasks')
        }
        setActiveCollection(null)
      }}
      className={cn(
        'group flex items-start gap-2 border-b border-slate-50 px-3 py-3 transition-colors hover:bg-slate-50',
        (activeTaskId === task.id || (isResumeTask && workbenchTaskId === task.id && section === 'workbench'))
          && 'border-l-2 border-l-blue-600 bg-blue-50/80',
        draggedTaskId === task.id && 'opacity-50',
        dragOverTaskId === task.id && draggedTaskId !== task.id && 'bg-blue-50 ring-1 ring-blue-300',
      )}
    >
      {options?.enableCollectionSorting && (
        <button
          type="button"
          draggable
          onDragStart={(e) => handleTaskDragStart(e, task.id)}
          onDragEnd={handleTaskDragEnd}
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
          }}
          className="mt-0.5 shrink-0 cursor-grab rounded p-1 text-slate-300 hover:bg-slate-100 hover:text-slate-500 active:cursor-grabbing"
          title="拖动排序"
        >
          <GripVertical className="h-4 w-4" />
        </button>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-slate-800">
          {task.title || '处理中...'}
        </p>
        {task.error_message && (
          <p className="mt-0.5 truncate text-[10px] text-red-500">{task.error_message}</p>
        )}
        <div className="mt-1 flex items-center gap-2">
          <span className="text-[10px] text-slate-400">{task.created_at?.slice(0, 10)}</span>
          <span
            className={cn(
              'rounded px-1.5 py-0.5 text-[10px]',
              task.status === 'COMPLETED' && 'bg-green-100 text-green-700',
              task.status === 'FAILED' && 'bg-red-100 text-red-700',
              task.status === 'CANCELED' && 'bg-gray-100 text-gray-700',
              task.status === 'PROCESSING' && 'bg-blue-100 text-blue-700',
              task.status === 'PENDING' && 'bg-yellow-100 text-yellow-700',
            )}
          >
            {STATUS_LABEL[task.status] || task.status}
          </span>
        </div>
        {section === 'tasks' && collections.length > 0 && (
          <select
            value={getTaskCollectionId(task)}
            onClick={(e) => e.preventDefault()}
            onChange={async (e) => {
              e.preventDefault()
              const nextCollectionId = e.target.value || null
              try {
                await taskApi.updateCollectionId(task.id, nextCollectionId)
                assignTask(task.id, nextCollectionId)
                await loadTasks()
              } catch (err) {
                toast.error((err as Error).message)
              }
            }}
            className="mt-1.5 w-full rounded border border-slate-200 py-1 text-xs text-slate-500"
          >
            <option value="">未分类</option>
            {collections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
      </div>
      <div className="flex shrink-0 flex-col gap-0.5">
        {options?.showRemoveFromCollection && getTaskCollectionId(task) && (
          <button
            type="button"
            onClick={(e) => handleRemoveFromCollection(e, task)}
            className="rounded p-1 text-slate-300 opacity-0 transition-opacity hover:bg-amber-50 hover:text-amber-600 group-hover:opacity-100"
            title="移出合集"
          >
            <FolderOutput className="h-3.5 w-3.5" />
          </button>
        )}
        {(task.status === 'FAILED' || task.status === 'CANCELED') && (
          <button
            type="button"
            onClick={(e) => handleRetry(e, task)}
            className="rounded p-1 text-slate-300 opacity-0 transition-opacity hover:bg-blue-50 hover:text-blue-500 group-hover:opacity-100"
            title="重新生成"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
        )}
        <button
          type="button"
          onClick={(e) => handleDelete(e, task)}
          className="rounded p-1 text-slate-300 opacity-0 transition-opacity hover:bg-red-50 hover:text-red-500 group-hover:opacity-100"
          title="删除"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </Link>
    )
  }

  const navItems: {
    id: SidebarSection
    label: string
    icon: typeof LayoutGrid
    onClick: () => void
  }[] = [
    {
      id: 'workbench',
      label: '工作台',
      icon: LayoutGrid,
      onClick: () => {
        setWorkbenchTaskId(null)
        setSidebarSection('workbench')
        setActiveCollection(null)
        navigate('/')
      },
    },
    {
      id: 'tasks',
      label: '任务列表',
      icon: ListTodo,
      onClick: () => {
        setSidebarSection('tasks')
        setActiveCollection(null)
        navigate('/')
      },
    },
    {
      id: 'collections',
      label: '合集',
      icon: FolderOpen,
      onClick: () => {
        setSidebarSection('collections')
        navigate('/')
      },
    },
    {
      id: 'chat',
      label: '跨笔记问答',
      icon: MessageSquare,
      onClick: () => {
        setSidebarSection('chat')
        setActiveCollection(null)
        navigate('/chat')
      },
    },
  ]

  const isCollectionsFull = section === 'collections'
  const showPanel = (section !== 'workbench' && !activeTaskId) || isCollectionsFull
  const sidebarWidth = NAV_RAIL_WIDTH + (showPanel ? panelWidth + 4 : 0)

  const panelTitle =
    section === 'workbench'
      ? '工作台'
      : section === 'collections'
        ? '合集'
        : section === 'chat'
          ? '跨笔记问答'
          : '任务列表'

  const activeModelName = userLLMConfig.mode === 'custom'
    ? userLLMConfig.note_model_name.trim() || '未配置模型'
    : llmDefaults?.model_name || '默认模型'

  return (
    <>
      <div
        className={cn(
          'flex h-full bg-white',
          isCollectionsFull ? 'min-w-0 flex-1' : 'shrink-0',
        )}
        style={isCollectionsFull ? undefined : { width: sidebarWidth }}
      >
      <div className="relative flex h-full w-[4.5rem] shrink-0 flex-col items-center border-r border-slate-100 bg-slate-50 py-4">
        <div className="mb-5 flex h-9 w-9 items-center justify-center rounded-xl bg-blue-600 text-[11px] font-bold text-white">
          Note
        </div>
        <nav className="flex flex-1 flex-col items-center gap-1">
          {navItems.map(({ id, label, icon: Icon, onClick }) => (
            <button
              key={id}
              type="button"
              onClick={onClick}
              title={label}
              className={cn(
                'flex w-full flex-col items-center gap-0.5 rounded-lg px-1 py-2 transition-colors',
                section === id
                  ? 'bg-blue-50 text-blue-600'
                  : 'text-slate-400 hover:bg-slate-100 hover:text-slate-600',
              )}
            >
              <Icon className="h-5 w-5 shrink-0" />
              <span className="text-[10px] leading-tight">{label}</span>
            </button>
          ))}
        </nav>
        <div className="mt-auto w-full px-1">
          <Link
            to="/settings"
            title="设置"
            className="flex w-full flex-col items-center gap-1 rounded-lg px-1 py-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
          >
            <div className="relative flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-white">
              <User className="h-4 w-4" />
              <Settings className="absolute -right-1 -top-1 h-3.5 w-3.5 rounded-full bg-white p-0.5 text-slate-500 shadow" />
            </div>
            <span className="text-[10px] leading-tight">设置</span>
            <span className={cn(
              'rounded-full px-1.5 py-0.5 text-[9px] leading-none',
              userLLMConfig.mode === 'custom' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-500',
            )}>
              {userLLMConfig.mode === 'custom' ? '自定义' : '默认'}
            </span>
          </Link>
        </div>
      </div>

      {showPanel && (
      <div
        className={cn('flex h-full min-w-0 flex-col', isCollectionsFull && 'flex-1')}
        style={isCollectionsFull ? { minWidth: panelWidth } : { width: panelWidth }}
      >
        <div className="border-b border-slate-100 px-4 py-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-800">{panelTitle}</h2>
          </div>

          {section === 'chat' && (
            <p className="mt-2 text-sm leading-relaxed text-slate-500">
              管理对话记录；右侧可跨笔记问答或自由提问
            </p>
          )}

          {section !== 'chat' && (
            <div className="relative mt-2">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={section === 'collections' ? '搜索合集名称、描述、标签...' : '搜索笔记...'}
                className="w-full rounded-lg border border-slate-200 py-2 pl-8 pr-2 text-sm"
              />
            </div>
          )}
        </div>

        {section === 'collections' && (
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-3">
            {activeCollectionId ? (
              <>
                <button
                  type="button"
                  onClick={() => setActiveCollection(null)}
                  className="mb-3 flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
                >
                  <X className="h-4 w-4" />
                  返回全部合集
                </button>
                {(() => {
                  const c = collections.find((col) => col.id === activeCollectionId)
                  if (!c) return null
                  return (
                    <div className={cn(
                      'mb-4 rounded-xl border bg-blue-50 p-4 ring-2 ring-blue-500',
                    )}>
                      <div className="flex items-center justify-between">
                        <h3 className="text-base font-semibold text-slate-800">{c.name}</h3>
                        <div className="flex gap-1">
                          <button
                            type="button"
                            onClick={() => startFullEditCollection(c)}
                            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                            title="编辑合集"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRemoveCollection(c)}
                            className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                            title="删除合集"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                      {c.description && (
                        <p className="mt-1 text-sm text-slate-500">{c.description}</p>
                      )}
                      {c.tags.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {c.tags.map((tag) => (
                            <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-600" key={tag}>
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                      <span className="mt-2 block text-xs text-slate-400">{collectionTaskCount(c.id)} 篇笔记</span>
                    </div>
                  )
                })()}
                <div className="min-h-0 flex-1 overflow-y-auto">
                  {orderedFilteredTasks.length === 0 && (
                    <p className="p-4 text-center text-xs text-slate-400">该合集暂无笔记</p>
                  )}
                  {orderedFilteredTasks.map((task) =>
                    renderTaskItem(task, {
                      showRemoveFromCollection: Boolean(taskCollectionMap[task.id]),
                      enableCollectionSorting: Boolean(activeCollectionId),
                    }),
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                  {filteredCollections.map((c) => (
                    <div
                      key={c.id}
                      onDragOver={(e) => handleCollectionDragOver(e, c.id)}
                      onDrop={(e) => handleCollectionDrop(e, c.id)}
                      onClick={() => setActiveCollection(c.id)}
                      className={cn(
                        'group relative aspect-square cursor-pointer overflow-hidden rounded-2xl border bg-white shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md',
                        draggedCollectionId === c.id && 'opacity-50',
                        dragOverCollectionId === c.id && draggedCollectionId !== c.id && 'ring-2 ring-blue-300',
                      )}
                    >
                      {c.coverImage ? (
                        <img src={c.coverImage} alt="" className="absolute inset-0 h-full w-full object-cover" />
                      ) : (
                        <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-blue-50 via-indigo-50 to-slate-100">
                          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/80 text-slate-500 shadow-sm">
                            <FolderOpen className="h-9 w-9" />
                          </div>
                        </div>
                      )}
                      <div className={cn(
                        'absolute inset-x-0 bottom-0 p-3',
                        c.coverImage
                          ? 'bg-gradient-to-t from-slate-950/80 via-slate-900/45 to-transparent pt-12 text-white'
                          : 'bg-white/85 text-slate-800 backdrop-blur-sm',
                      )}>
                        <h3 className="truncate text-sm font-semibold">{c.name}</h3>
                        {c.description && (
                          <p className={cn('mt-1 line-clamp-2 text-xs', c.coverImage ? 'text-white/80' : 'text-slate-500')}>
                            {c.description}
                          </p>
                        )}
                        {c.tags.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {c.tags.slice(0, 3).map((tag) => (
                              <span
                                className={cn(
                                  'rounded-full px-1.5 py-0.5 text-[10px]',
                                  c.coverImage ? 'bg-white/20 text-white' : 'bg-blue-50 text-blue-600',
                                )}
                                key={tag}
                              >
                                {tag}
                              </span>
                            ))}
                          </div>
                        )}
                        <span className={cn('mt-2 block text-[10px]', c.coverImage ? 'text-white/70' : 'text-slate-400')}>
                          {collectionTaskCount(c.id)} 篇笔记
                        </span>
                      </div>
                      <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                        <button
                          type="button"
                          draggable
                          onDragStart={(e) => { e.stopPropagation(); handleCollectionDragStart(e, c.id) }}
                          onDragEnd={handleCollectionDragEnd}
                          onClick={(e) => { e.stopPropagation() }}
                          className="rounded-lg bg-white/85 p-1 text-slate-500 shadow-sm backdrop-blur hover:bg-white hover:text-slate-700 active:cursor-grabbing"
                          title="拖动排序"
                        >
                          <GripVertical className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); startFullEditCollection(c) }}
                          className="rounded-lg bg-white/85 p-1 text-slate-500 shadow-sm backdrop-blur hover:bg-white hover:text-slate-700"
                          title="编辑"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); handleRemoveCollection(c) }}
                          className="rounded-lg bg-white/85 p-1 text-slate-500 shadow-sm backdrop-blur hover:bg-white hover:text-red-600"
                          title="删除"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                  {showNewCollection ? (
                    <div className="rounded-2xl border bg-white p-4 shadow-sm">
                      <input
                        value={newCollectionName}
                        onChange={(e) => setNewCollectionName(e.target.value)}
                        placeholder="合集名称"
                        className="w-full rounded border border-slate-200 px-2 py-1.5 text-sm"
                        onKeyDown={(e) => e.key === 'Enter' && handleAddCollection()}
                        autoFocus
                      />
                      <input
                        value={newCollectionDesc}
                        onChange={(e) => setNewCollectionDesc(e.target.value)}
                        placeholder="描述 (可选)"
                        className="mt-1.5 w-full rounded border border-slate-200 px-2 py-1.5 text-xs"
                      />
                      <div className="mt-1.5">
                        <input
                          value={newCollectionCover}
                          onChange={(e) => setNewCollectionCover(e.target.value)}
                          placeholder="图片 URL"
                          className="w-full rounded border border-slate-200 px-2 py-1.5 text-xs"
                        />
                        <div className="mt-1 flex items-center gap-1">
                          <input
                            ref={(el) => { (window as unknown as Record<string, HTMLInputElement | null>)['_newCoverInput'] = el }}
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={async (e) => {
                              const f = e.target.files?.[0]
                              if (!f) return
                              try {
                                const res = await uploadApi.uploadCover(f)
                                setNewCollectionCover(res.url)
                              } catch { toast.error('上传失败') }
                            }}
                          />
                          <button
                            type="button"
                            onClick={() => (window as unknown as Record<string, HTMLInputElement | null>)['_newCoverInput']?.click()}
                            className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-500 hover:bg-slate-50"
                          >
                            <Upload className="mr-1 inline h-3 w-3" />上传本地图片
                          </button>
                        </div>
                      </div>
                      <input
                        value={newCollectionTags}
                        onChange={(e) => setNewCollectionTags(e.target.value)}
                        placeholder="标签，逗号分隔 (可选)"
                        className="mt-1.5 w-full rounded border border-slate-200 px-2 py-1.5 text-xs"
                      />
                      <div className="mt-2 flex gap-1">
                        <button
                          type="button"
                          onClick={handleAddCollection}
                          className="flex-1 rounded bg-blue-600 py-1 text-xs text-white hover:bg-blue-700"
                        >
                          创建
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setShowNewCollection(false)
                            setNewCollectionName('')
                            setNewCollectionDesc('')
                            setNewCollectionTags('')
                            setNewCollectionCover('')
                          }}
                          className="rounded px-2 py-1 text-xs text-slate-400 hover:bg-slate-100"
                        >
                          取消
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setShowNewCollection(true)}
                      className="flex aspect-square flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-500 transition-colors hover:border-blue-300 hover:bg-blue-50/40 hover:text-blue-600"
                    >
                      <Plus className="mb-2 h-7 w-7" />
                      新建合集
                    </button>
                  )}
                </div>
                {filteredCollections.length === 0 && !showNewCollection && (
                  <p className="mt-4 text-center text-xs text-slate-400">
                    {search ? '未找到匹配的合集' : '暂无合集，点击上方按钮创建'}
                  </p>
                )}
              </>
            )}
          </div>
        )}

        {section === 'tasks' && (
          <div className="flex flex-wrap gap-1 border-b border-slate-100 px-3 py-2.5">
            {['', 'PROCESSING', 'COMPLETED', 'FAILED'].map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatusFilter(s)}
                className={cn(
                  'rounded px-2.5 py-1 text-xs',
                  statusFilter === s ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100',
                )}
              >
                {s === '' ? '全部' : STATUS_LABEL[s]}
              </button>
            ))}
          </div>
        )}

        {section === 'tasks' && (
          <div className="flex-1 overflow-y-auto">
            {tasksLoading && filteredTasks.length === 0 && (
              <p className="p-6 text-center text-xs text-slate-400">加载中…</p>
            )}
            {!tasksLoading && tasksError && filteredTasks.length === 0 && (
              <div className="p-6 text-center text-xs text-slate-500">
                <p>加载失败：{tasksError}</p>
                <button
                  type="button"
                  onClick={() => loadTasks()}
                  className="mt-2 rounded bg-slate-800 px-2.5 py-1 text-white"
                >
                  重试
                </button>
              </div>
            )}
            {!tasksLoading && !tasksError && filteredTasks.length === 0 && (
              <p className="p-6 text-center text-xs text-slate-400">
                {statusFilter
                  ? `「${STATUS_LABEL[statusFilter] || statusFilter}」筛选下暂无笔记，可点「全部」查看`
                  : '暂无笔记'}
              </p>
            )}
            {groupedTaskList()}
          </div>
        )}

        {section === 'chat' && <ChatSessionList />}
      </div>
      )}
      {showPanel && <ResizeHandle onMouseDown={onPanelResize} />}
      </div>
      {editingMode === 'full' && editingCollectionId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-xl rounded-2xl bg-white p-6 shadow-xl">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-xl font-semibold text-slate-900">编辑合集</h2>
              <button
                type="button"
                onClick={cancelRenameCollection}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                title="关闭"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4">
              <label className="block">
                <span className="text-sm font-medium text-slate-800"><span className="text-red-500">*</span> 合集名</span>
                <input
                  value={editingCollectionName}
                  onChange={(e) => setEditingCollectionName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && commitRenameCollection()}
                  className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  autoFocus
                />
              </label>

              <label className="block">
                <span className="text-sm font-medium text-slate-800">描述</span>
                <textarea
                  value={editingCollectionDesc}
                  onChange={(e) => setEditingCollectionDesc(e.target.value)}
                  placeholder="选填"
                  className="mt-2 min-h-20 w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />
              </label>

              <label className="block">
                <span className="text-sm font-medium text-slate-800">封面图</span>
                <input
                  value={editingCollectionCover}
                  onChange={(e) => setEditingCollectionCover(e.target.value)}
                  placeholder="图片 URL"
                  className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />
                <div className="mt-1">
                  <input
                    ref={(el) => { (window as unknown as Record<string, HTMLInputElement | null>)['_editCoverInput'] = el }}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={async (e) => {
                      const f = e.target.files?.[0]
                      if (!f) return
                      try {
                        const res = await uploadApi.uploadCover(f)
                        setEditingCollectionCover(res.url)
                      } catch { toast.error('上传失败') }
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => (window as unknown as Record<string, HTMLInputElement | null>)['_editCoverInput']?.click()}
                    className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-500 hover:bg-slate-50"
                  >
                    <Upload className="mr-1 inline h-3 w-3" />上传本地图片
                  </button>
                </div>
              </label>

              <div className="flex items-center gap-3">
                <div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br from-blue-50 via-indigo-50 to-slate-100 text-slate-400">
                  {editingCollectionCover.trim() ? (
                    <img src={editingCollectionCover.trim()} alt="封面预览" className="h-full w-full object-cover" />
                  ) : (
                    <FolderOpen className="h-10 w-10" />
                  )}
                </div>
                <p className="text-xs leading-relaxed text-slate-500">
                  封面会展示在合集正方形卡片上；留空时显示默认文件夹占位图。
                </p>
              </div>

              <label className="block">
                <span className="text-sm font-medium text-slate-800">标签</span>
                <input
                  value={editingCollectionTags}
                  onChange={(e) => setEditingCollectionTags(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && commitRenameCollection()}
                  placeholder="回车添加标签, 如:学习、AI、B站"
                  className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />
              </label>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={cancelRenameCollection}
                className="rounded-lg border border-slate-200 px-5 py-2 text-sm text-slate-700 hover:bg-slate-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={commitRenameCollection}
                className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
