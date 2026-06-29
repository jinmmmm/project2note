import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Transformer } from 'markmap-lib'
import { Markmap } from 'markmap-view'
import {
  Brain,
  RefreshCw,
  Sparkles,
  Plus,
  Trash2,
  CornerDownRight,
  Palette,
  Download,
  Maximize2,
  Minimize2,
  Bold,
  Italic,
  Undo2,
  Redo2,
  Edit3,
  Eye,
  ChevronRight,
} from 'lucide-react'
import { taskApi, type MindmapData, type MindmapMode, type MindmapNode } from '@/services'
import { useLlmConfig } from '@/hooks/useLlmConfig'
import toast from 'react-hot-toast'
import {
  buildOriginTree,
  cloneTree,
  downloadSvgAsPng,
  downloadText,
  findNode,
  flattenTree,
  treeToMarkdownOutline,
  treeToOpml,
  treeToOutline,
  getModeEntry,
  normalizeMindmapData,
  setModeEntry,
  truncateLabel,
} from '@/lib/mindmap'

interface Props {
  taskId: string
  noteMarkdown: string
  videoTitle?: string
  mindmapData: MindmapData | null | undefined
  onSeek: (seconds: number) => void
  onScrollToHeading: (id: string) => void
}

// Branch palette: each top-level branch gets one stable hue, applied to its line + circle.
const BRANCH_COLORS = ['#e37d7d', '#e3b07d', '#b0c97d', '#7de3b0', '#7de3e3', '#9494ff', '#d75696']

// Highlighter palette for node text background (荧光笔效果).
const COLORS = ['#ffe08a', '#ffc1cc', '#b5f5c8', '#a8e0ff', '#d8bdff', '#ffd29c']

function createBranchColorFn(root: MindmapNode, colorByBranchLabel: Map<string, string>) {
  const colorByNodeLabel = new Map<string, string>()
  root.children?.forEach((branch) => {
    const color = colorByBranchLabel.get(branch.label) || BRANCH_COLORS[0]
    walkMindmapNode(branch, (node) => colorByNodeLabel.set(node.label, color))
  })

  return (node: any): string => {
    const label = decodeMarkmapContent(node?.content || '')
    const primary = colorByNodeLabel.get(label) || BRANCH_COLORS[0]
    const depth = Math.max(0, (node?.state?.depth || 1) - 2)
    const lighten = Math.min(depth * 0.1, 0.4)
    return lightenHex(primary, lighten)
  }
}

function walkMindmapNode(node: MindmapNode, visit: (node: MindmapNode) => void) {
  visit(node)
  node.children?.forEach((child) => walkMindmapNode(child, visit))
}

function decodeMarkmapContent(content: string): string {
  if (typeof document === 'undefined') return content.replace(/<[^>]+>/g, '').trim()
  const decoder = document.createElement('div')
  decoder.innerHTML = content
  return (decoder.textContent || '').trim()
}

function lightenHex(hex: string, amount: number): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  const lr = Math.round(r + (255 - r) * amount)
  const lg = Math.round(g + (255 - g) * amount)
  const lb = Math.round(b + (255 - b) * amount)
  return '#' + [lr, lg, lb].map(v => v.toString(16).padStart(2, '0')).join('')
}

export default function MindmapPanel({
  taskId,
  noteMarkdown,
  videoTitle,
  mindmapData,
  onSeek,
  onScrollToHeading,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const markmapRef = useRef<Markmap | null>(null)
  const aiRequestRef = useRef(false)
  const branchColorRef = useRef<Map<string, string>>(new Map())
  const transformer = useMemo(() => new Transformer(), [])
  const { requestPayload } = useLlmConfig()

  const originTree = useMemo(
    () => buildOriginTree(noteMarkdown, videoTitle || '视频笔记'),
    [noteMarkdown, videoTitle],
  )
  const initialData = useMemo(
    () => normalizeMindmapData(mindmapData, originTree),
    [mindmapData, originTree],
  )
  const isShort = noteMarkdown.trim().length < 200
  const preferredMode: MindmapMode = 'origin'
  const originEntry = getModeEntry(initialData, 'origin')
  const preferredTree = originEntry.edited && originEntry.tree ? originEntry.tree : originTree
  const [data, setData] = useState<MindmapData>(initialData)
  const [mode, setMode] = useState<MindmapMode>(preferredMode)
  const [tree, setTree] = useState<MindmapNode>(preferredTree)
  const [undoStack, setUndoStack] = useState<MindmapNode[]>([])
  const [redoStack, setRedoStack] = useState<MindmapNode[]>([])
  const [edited, setEdited] = useState(!!originEntry.edited)
  const [fullscreen, setFullscreen] = useState(false)
  const [selected, setSelected] = useState<MindmapNode | null>(null)
  const [editingMode, setEditingMode] = useState(false)
  const [hasUnsaved, setHasUnsaved] = useState(false)
  const [loadingAi, setLoadingAi] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [regenPromptOpen, setRegenPromptOpen] = useState(false)
  const [regenInstruction, setRegenInstruction] = useState('')

  const displayTree = useMemo(() => boldRoot(tree), [tree])

  useEffect(() => {
    const next = new Map(branchColorRef.current)
    tree.children?.forEach((child) => {
      if (!next.has(child.label)) {
        next.set(child.label, BRANCH_COLORS[next.size % BRANCH_COLORS.length])
      }
    })
    for (const label of next.keys()) {
      if (!tree.children?.some((child) => child.label === label)) next.delete(label)
    }
    branchColorRef.current = next
  }, [tree])

  // origin 树随笔记变化重建（仅未编辑时）
  useEffect(() => {
    if (mode === 'origin' && !edited) {
      setTree(buildOriginTree(noteMarkdown, videoTitle || '视频笔记'))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteMarkdown, mode, edited])

  // 渲染 markmap
  useEffect(() => {
    if (!svgRef.current) return
    const md = treeToOutline(displayTree)
    const { root } = transformer.transform(md)
    foldFromDepth(root, 3)
    const color = createBranchColorFn(displayTree, branchColorRef.current)
    const opts = {
      duration: 0,
      initialExpandLevel: 3,
      color,
    }
    if (!markmapRef.current) {
      markmapRef.current = Markmap.create(svgRef.current, opts as any, root)
    } else {
      markmapRef.current.setData(root, opts as any)
    }
  }, [displayTree, transformer])

  const persist = useCallback(
    async (nextTree: MindmapNode, nextMode: MindmapMode, nextEdited: boolean) => {
      const nextData: MindmapData = setModeEntry(
        { ...data, active_mode: nextMode, sync_enabled: false },
        nextMode,
        { tree: nextTree, edited: nextEdited },
      )
      setData(nextData)
      try {
        await taskApi.saveMindmap(taskId, nextData)
      } catch {
        toast.error('导图保存失败')
      }
    },
    [data, taskId],
  )

  const handleNodeClick = useCallback(
    (node: MindmapNode) => {
      if (editingMode) {
        setSelected(node)
      }
      if (node.headingId) onScrollToHeading(node.headingId)
      if (typeof node.timestamp === 'number') onSeek(node.timestamp)
    },
    [onScrollToHeading, onSeek, editingMode],
  )

  // 接管 markmap 节点点击 — use markmap's internal root for accurate lookup
  useEffect(() => {
    const mm = markmapRef.current
    const svg = svgRef.current
    if (!mm || !svg) return
    const onClick = (e: MouseEvent) => {
      const target = e.target as Element
      const g = target.closest('g.markmap-node') as SVGGElement | null
      if (!g) return
      const dataPath = g.getAttribute('data-path')
      if (!dataPath) return
      // Walk the markmap internal root to find the node with this path
      const mmRoot = mm.state?.data
      if (!mmRoot) return
      const mmNode = findMarkmapNodeByPath(mmRoot, dataPath)
      if (!mmNode) return
      // Decode HTML entities + strip tags: markmap stores content as entity-encoded HTML
      // (e.g. &#x5b89;&#x88c5; for 安装), so regex tag-stripping alone leaves entities that
      // never match the tree node's plain-text label.
      const rawContent = mmNode.content || ''
      const decoder = document.createElement('div')
      decoder.innerHTML = rawContent
      const pureLabel = (decoder.textContent || '').trim()
      if (!pureLabel) return
      // Disambiguate duplicate labels by depth (markmap depth is 1-based, tree is 0-based)
      const treeDepth = mmNode.state?.depth ? mmNode.state.depth - 1 : undefined
      const found = treeDepth != null
        ? (findNodeByLabelAndDepth(tree, pureLabel, treeDepth) ?? findNodeByLabel(tree, pureLabel))
        : findNodeByLabel(tree, pureLabel)
      if (found) handleNodeClick(found)
    }
    svg.addEventListener('click', onClick)
    return () => svg.removeEventListener('click', onClick)
  }, [tree, handleNodeClick])

  // ---- 编辑操作 ----
  const markEdited = (next: MindmapNode) => {
    setUndoStack((items) => [...items.slice(-19), cloneTree(tree)])
    setRedoStack([])
    setTree(next)
    setHasUnsaved(true)
  }

  const saveChanges = useCallback(async () => {
    setEdited(true)
    setHasUnsaved(false)
    await persist(tree, mode, true)
    toast.success('已保存')
  }, [tree, mode, persist])

  const restoreTree = (next: MindmapNode) => {
    setTree(next)
    setHasUnsaved(true)
  }

  const undo = () => {
    const prev = undoStack[undoStack.length - 1]
    if (!prev) return
    setUndoStack((items) => items.slice(0, -1))
    setRedoStack((items) => [...items, cloneTree(tree)])
    restoreTree(prev)
  }

  const redo = () => {
    const next = redoStack[redoStack.length - 1]
    if (!next) return
    setRedoStack((items) => items.slice(0, -1))
    setUndoStack((items) => [...items, cloneTree(tree)])
    restoreTree(next)
  }

  const addChild = (parent: MindmapNode) => {
    const next = cloneTree(tree)
    const path = getNodePath(tree, parent)
    if (!path) return
    const p = findNodeByPath(next, path)
    if (!p) return
    p.children = p.children || []
    p.children.push({ label: '新节点' })
    markEdited(next)
    setSelected(p.children[p.children.length - 1])
  }

  const removeNode = (node: MindmapNode) => {
    const next = cloneTree(tree)
    const path = getNodePath(tree, node)
    if (!path) return
    const target = findNodeByPath(next, path)
    if (!target || target === next) {
      toast.error('根节点不可删除')
      return
    }
    const loc = findNode(next, target)
    if (!loc?.parent) return
    loc.parent.children!.splice(loc.index, 1)
    if (loc.parent.children!.length === 0) delete loc.parent.children
    markEdited(next)
    setSelected(null)
  }

  const renameNode = (node: MindmapNode, label: string) => {
    const next = cloneTree(tree)
    const path = getNodePath(tree, node)
    if (!path) return
    const n = findNodeByPath(next, path)
    if (!n) return
    n.label = label
    markEdited(next)
    setSelected(n)
  }

  const moveNode = (node: MindmapNode, newParent: MindmapNode) => {
    if (node === newParent) return
    const next = cloneTree(tree)
    const nodePath = getNodePath(tree, node)
    const parentPath = getNodePath(tree, newParent)
    if (!nodePath || !parentPath) return
    const clonedNode = findNodeByPath(next, nodePath)
    const target = findNodeByPath(next, parentPath)
    if (!clonedNode || !target) return
    const src = findNode(next, clonedNode)
    if (!src?.parent) return
    if (isDescendant(clonedNode, target)) {
      toast.error('不能移动到自身子节点下')
      return
    }
    src.parent.children!.splice(src.index, 1)
    if (src.parent.children!.length === 0) delete src.parent.children
    target.children = target.children || []
    target.children.push(clonedNode)
    markEdited(next)
  }

  const setColor = (node: MindmapNode, color: string | undefined) => {
    const next = cloneTree(tree)
    const path = getNodePath(tree, node)
    if (!path) return
    const n = findNodeByPath(next, path)
    if (!n) return
    if (color) n.color = color
    else delete n.color
    markEdited(next)
    setSelected(n)
  }

  const toggleBold = (node: MindmapNode) => {
    const next = cloneTree(tree)
    const path = getNodePath(tree, node)
    if (!path) return
    const n = findNodeByPath(next, path)
    if (!n) return
    n.bold = !n.bold
    markEdited(next)
    setSelected(n)
  }

  const toggleItalic = (node: MindmapNode) => {
    const next = cloneTree(tree)
    const path = getNodePath(tree, node)
    if (!path) return
    const n = findNodeByPath(next, path)
    if (!n) return
    n.italic = !n.italic
    markEdited(next)
    setSelected(n)
  }

  // ---- 模式切换 ----
  const switchMode = (m: MindmapMode) => {
    if (m === mode) return
    if (m === 'ai_refactor' && isShort) {
      toast.error('笔记过短，使用跟随笔记')
      return
    }
    const entry = getModeEntry(data, m)
    if (entry.tree) {
      setMode(m)
      setTree(entry.tree)
      setEdited(!!entry.edited)
      setUndoStack([])
      setRedoStack([])
      const nextData = { ...data, active_mode: m }
      setData(nextData)
      taskApi.saveMindmap(taskId, nextData).catch(() => undefined)
      return
    }
    if (m === 'origin') {
      const t = originTree
      setMode('origin')
      setTree(t)
      setEdited(false)
      setUndoStack([])
      setRedoStack([])
      persist(t, 'origin', false)
    } else {
      // No saved AI tree yet — switch into ai_refactor mode immediately so the
      // toolbar shows the spinning "生成中" button and a loading placeholder
      // while generation runs, instead of looking like the click did nothing.
      setMode('ai_refactor')
      setTree(originTree)
      setEdited(false)
      setUndoStack([])
      setRedoStack([])
      setSelected(null)
      runAiRefactor(false)
    }
  }

  const resetOriginToNote = () => {
    if (!window.confirm('按当前笔记内容重建跟随笔记导图，已有的手动编辑将被覆盖，确定？')) return
    const t = buildOriginTree(noteMarkdown, videoTitle || '视频笔记')
    setMode('origin')
    setTree(t)
    setEdited(false)
    setUndoStack([])
    setRedoStack([])
    setSelected(null)
    persist(t, 'origin', false)
    toast.success('已按笔记重建')
  }

  const runAiRefactor = async (force = false, instruction = '') => {
    if (noteMarkdown.trim().length < 200) {
      toast.error('笔记过短，使用跟随笔记')
      const t = originTree
      setMode('origin')
      setTree(t)
      setEdited(false)
      setUndoStack([])
      setRedoStack([])
      persist(t, 'origin', false)
      return
    }
    const aiEntry = getModeEntry(data, 'ai_refactor')
    if (aiEntry.edited && !force) {
      if (!window.confirm('结构优化导图已被编辑，确定重新生成覆盖？')) return
    }
    aiRequestRef.current = true
    setLoadingAi(true)
    try {
      const res = await taskApi.generateMindmap(taskId, undefined, force, instruction, requestPayload)
      const nextData = setModeEntry(
        { ...data, active_mode: 'ai_refactor', sync_enabled: false },
        'ai_refactor',
        { tree: res.tree, edited: false },
      )
      setData(nextData)
      setTree(res.tree)
      setMode('ai_refactor')
      setEdited(false)
      toast.success('结构优化完成')
    } catch (e: any) {
      toast.error(e?.message || '结构优化失败，已切换为跟随笔记')
      const t = originTree
      setTree(t)
      setMode('origin')
      setEdited(false)
      persist(t, 'origin', false)
    } finally {
      aiRequestRef.current = false
      setLoadingAi(false)
    }
  }

  const regenerateWithInstruction = () => {
    setRegenPromptOpen(true)
  }

  const submitRegenerate = () => {
    const instruction = regenInstruction.trim()
    setRegenPromptOpen(false)
    runAiRefactor(true, instruction)
  }

  useEffect(() => {
    if (isShort) return
    if (mode !== 'ai_refactor') return
    if (getModeEntry(data, 'ai_refactor').tree) return
    if (loadingAi || aiRequestRef.current) return
    runAiRefactor(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isShort, mode, data])

  // ---- 导出 ----
  const exportPng = () => {
    const svg = svgRef.current
    if (!svg) return
    // Export uses the SVG clone with transform removed — the PNG always
    // contains the full mindmap regardless of current zoom/viewport.
    downloadSvgAsPng(svg, `${videoTitle || '思维导图'}.png`)
    setExportOpen(false)
  }
  const exportMd = () => {
    downloadText(`${videoTitle || '思维导图'}.md`, treeToMarkdownOutline(tree), 'text/markdown')
    setExportOpen(false)
  }
  const exportOpml = () => {
    downloadText(`${videoTitle || '思维导图'}.opml`, treeToOpml(tree, videoTitle), 'text/xml')
    setExportOpen(false)
  }

  const flat = useMemo(() => flattenTree(tree), [tree])

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 工具栏 */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-3 py-2 text-xs">
        <div className="flex rounded-lg border border-slate-200 p-0.5">
          <button
            onClick={() => switchMode('origin')}
            className={`flex items-center gap-1 rounded-md px-2.5 py-1 ${mode === 'origin' ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
          >
            <Brain size={13} /> 跟随笔记
          </button>
          <button
            onClick={() => switchMode('ai_refactor')}
            disabled={isShort || loadingAi}
            title={isShort ? '笔记过短，使用跟随笔记' : 'AI 结构优化'}
            className={`flex items-center gap-1 rounded-md px-2.5 py-1 disabled:opacity-40 ${mode === 'ai_refactor' ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
          >
            <Sparkles size={13} className={loadingAi ? 'animate-spin' : ''} />
            {loadingAi && mode === 'ai_refactor' ? '生成中' : '结构优化'}
          </button>
        </div>

        {mode === 'origin' && (
          <button
            onClick={resetOriginToNote}
            title="按当前笔记内容重建跟随笔记导图"
            className="flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1 text-slate-600 hover:bg-slate-100"
          >
            <RefreshCw size={13} /> 重建
          </button>
        )}

        {mode === 'ai_refactor' && (
          <button
            onClick={regenerateWithInstruction}
            disabled={loadingAi || isShort}
            className="flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1 text-slate-600 hover:bg-slate-100 disabled:opacity-40"
          >
            <RefreshCw size={13} className={loadingAi ? 'animate-spin' : ''} />
            {loadingAi ? '生成中' : '重新生成'}
          </button>
        )}

        <div className="mx-1 h-4 w-px bg-slate-200" />

        <div className="relative">
          <button
            onClick={() => setExportOpen((v) => !v)}
            className="flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1 text-slate-600 hover:bg-slate-100"
          >
            <Download size={13} /> 导出
          </button>
          {exportOpen && (
            <div className="absolute left-0 top-full z-20 mt-1 w-32 rounded-md border border-slate-200 bg-white py-1 shadow-lg">
              <button onClick={exportPng} className="block w-full px-3 py-1.5 text-left hover:bg-slate-50">PNG 图片</button>
              <button onClick={exportMd} className="block w-full px-3 py-1.5 text-left hover:bg-slate-50">Markdown</button>
              <button onClick={exportOpml} className="block w-full px-3 py-1.5 text-left hover:bg-slate-50">OPML</button>
            </div>
          )}
        </div>

        <button
          onClick={() => setFullscreen((v) => !v)}
          className="flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1 text-slate-600 hover:bg-slate-100"
        >
          {fullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
        </button>

        <div className="mx-1 h-4 w-px bg-slate-200" />

        <button
          onClick={() => setEditingMode((v) => !v)}
          className={`flex items-center gap-1 rounded-md border px-2.5 py-1 ${editingMode ? 'border-slate-700 bg-slate-100 text-slate-900' : 'border-slate-200 text-slate-600 hover:bg-slate-100'}`}
        >
          {editingMode ? <Eye size={13} /> : <Edit3 size={13} />}
          {editingMode ? '查看' : '编辑'}
        </button>

        {hasUnsaved && <span className="ml-auto text-[10px] text-amber-500">未保存</span>}
        {!hasUnsaved && edited && <span className="ml-auto text-[10px] text-slate-400">已保存</span>}
      </div>

      <div className="border-b border-slate-100 px-4 py-1.5 text-[11px] text-slate-400">
        默认展开到二层，带圆点的分支可继续点击展开/收起。
      </div>

      {/* 主体 */}
      <div className={`flex min-h-0 flex-1 ${fullscreen ? 'fixed inset-0 z-50 bg-white p-4' : ''}`}>
        {fullscreen && (
          <div className="mb-2 flex justify-end">
            <button
              onClick={() => setFullscreen(false)}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
            >
              退出全屏
            </button>
          </div>
        )}
        <div className="relative min-h-0 flex-1 overflow-hidden p-2">
          <svg ref={svgRef} className="h-full w-full" />
          {loadingAi && mode === 'ai_refactor' && !getModeEntry(data, 'ai_refactor').tree && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-white/80 backdrop-blur-sm">
              <RefreshCw size={28} className="animate-spin text-slate-500" />
              <p className="text-sm text-slate-500">正在生成结构优化导图…</p>
              <p className="text-[11px] text-slate-400">首次生成需要调用 AI，请稍候</p>
            </div>
          )}
        </div>

        {editingMode && (
          <div className="shrink-0 w-[240px] overflow-y-auto border-l border-slate-200 bg-white p-3">
            {selected ? (
            <>
            <div className="mb-3 flex items-center justify-between">
              <p className="text-xs font-medium text-slate-500">编辑节点</p>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={saveChanges}
                  disabled={!hasUnsaved}
                  className={`rounded px-2 py-1 text-xs ${hasUnsaved ? 'bg-slate-800 text-white hover:bg-slate-700' : 'bg-slate-100 text-slate-400'}`}
                >
                  保存
                </button>
                <button
                  onClick={() => setSelected(null)}
                  className="rounded px-2 py-1 text-xs text-slate-400 hover:bg-slate-50"
                >
                  关闭
                </button>
              </div>
            </div>
            <EditSidebar
              node={selected}
              flat={flat}
              root={tree}
              canUndo={undoStack.length > 0}
              canRedo={redoStack.length > 0}
              onUndo={undo}
              onRedo={redo}
              onAddChild={addChild}
              onRemove={removeNode}
              onRename={renameNode}
              onMove={moveNode}
              onSetColor={setColor}
              onToggleBold={toggleBold}
              onToggleItalic={toggleItalic}
            />
            </>
            ) : (
              <p className="text-[11px] text-slate-400 py-4 text-center">点击节点开始编辑</p>
            )}
          </div>
        )}
      </div>

      {regenPromptOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/30 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-xl">
            <div className="mb-3">
              <p className="text-sm font-semibold text-slate-800">按要求重新生成导图</p>
              <p className="mt-1 text-xs text-slate-500">
                写下本次调整要求。留空则按默认结构优化规则生成。
              </p>
            </div>
            <textarea
              value={regenInstruction}
              onChange={(e) => setRegenInstruction(e.target.value)}
              placeholder="例如：突出实践步骤；减少术语；按时间线整理；合并重复节点；更适合零基础理解。"
              className="h-28 w-full resize-none rounded-lg border border-slate-200 p-3 text-sm outline-none focus:border-blue-400"
              autoFocus
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setRegenPromptOpen(false)}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
              >
                取消
              </button>
              <button
                onClick={submitRegenerate}
                disabled={loadingAi}
                className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {loadingAi ? '生成中' : '重新生成'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function EditSidebar({
  node,
  flat,
  root,
  onAddChild,
  onRemove,
  onRename,
  onMove,
  onSetColor,
  onToggleBold,
  onToggleItalic,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
}: {
  node: MindmapNode
  flat: { node: MindmapNode; parent: MindmapNode | null; path: string }[]
  root: MindmapNode
  onAddChild: (n: MindmapNode) => void
  onRemove: (n: MindmapNode) => void
  onRename: (n: MindmapNode, label: string) => void
  onMove: (n: MindmapNode, parent: MindmapNode) => void
  onSetColor: (n: MindmapNode, c: string | undefined) => void
  onToggleBold: (n: MindmapNode) => void
  onToggleItalic: (n: MindmapNode) => void
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
}) {
  const [label, setLabel] = useState(node.label)
  useEffect(() => setLabel(node.label), [node])
  const possibleParents = flat.filter(
    (f) => f.node !== node && !isDescendant(node, f.node),
  )

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 rounded-lg bg-slate-50 p-1">
        <button
          onClick={onUndo}
          disabled={!canUndo}
          className="flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1 text-xs text-slate-600 hover:bg-white disabled:opacity-40"
          title="回退一步"
        >
          <Undo2 size={13} /> 回退
        </button>
        <button
          onClick={onRedo}
          disabled={!canRedo}
          className="flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1 text-xs text-slate-600 hover:bg-white disabled:opacity-40"
          title="前进一步"
        >
          <Redo2 size={13} /> 前进
        </button>
      </div>
      <div>
        <label className="mb-1 block text-[11px] text-slate-500">节点文字</label>
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          className="w-full rounded border border-slate-200 px-2 py-1 text-xs"
        />
      </div>

      <div>
        <label className="mb-1 block text-[11px] text-slate-500">荧光标色</label>
        <div className="flex flex-wrap gap-1">
          {COLORS.map((c) => (
            <button
              key={c}
              onClick={() => onSetColor(node, c)}
              className="h-5 w-5 rounded-full border-2"
              style={{ background: c, borderColor: node.color === c ? '#0f172a' : 'transparent' }}
            />
          ))}
          {node.color && (
            <button onClick={() => onSetColor(node, undefined)} className="text-[10px] text-slate-400">清除</button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => onToggleBold(node)}
          className={`flex items-center justify-center gap-1 rounded border px-2 py-1.5 text-xs ${node.bold ? 'border-slate-700 bg-slate-100 text-slate-900' : 'border-slate-200 text-slate-600'}`}
        >
          <Bold size={13} /> 加粗
        </button>
        <button
          onClick={() => onToggleItalic(node)}
          className={`flex items-center justify-center gap-1 rounded border px-2 py-1.5 text-xs ${node.italic ? 'border-slate-700 bg-slate-100 text-slate-900' : 'border-slate-200 text-slate-600'}`}
        >
          <Italic size={13} /> 斜体
        </button>
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => onAddChild(node)}
          className="flex flex-1 items-center justify-center gap-1 rounded border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
        >
          <Plus size={14} /> 子节点
        </button>
        {node !== root && (
          <button
            onClick={() => onRemove(node)}
            className="flex min-w-20 items-center justify-center gap-1 rounded border border-red-200 px-3 py-2 text-sm text-red-500 hover:bg-red-50"
          >
            <Trash2 size={14} /> 删除
          </button>
        )}
      </div>

      <div>
        <label className="mb-1 block text-[11px] text-slate-500">移动到父节点</label>
        <CascadingParentPicker node={node} root={root} flat={flat} onMove={onMove} />
      </div>

      {node.headingId && (
        <p className="flex items-center gap-1 text-[10px] text-slate-400">
          <CornerDownRight size={10} /> 已绑定笔记标题
        </p>
      )}
      {typeof node.timestamp === 'number' && (
        <p className="text-[10px] text-slate-400">视频时间 {Math.floor(node.timestamp / 60)}:{String(Math.floor(node.timestamp % 60)).padStart(2, '0')}</p>
      )}
    </div>
  )
}

// ---- Cascading parent picker ----
function CascadingParentPicker({
  node,
  root,
  flat,
  onMove,
}: {
  node: MindmapNode
  root: MindmapNode
  flat: { node: MindmapNode; parent: MindmapNode | null; path: string }[]
  onMove: (n: MindmapNode, parent: MindmapNode) => void
}) {
  // Build tree of possible parents (exclude self + descendants)
  const [breadcrumb, setBreadcrumb] = useState<{ node: MindmapNode; label: string }[]>([
    { node: root, label: root.label },
  ])

  const currentParent = breadcrumb[breadcrumb.length - 1].node
  const children = (currentParent.children || []).filter(
    (c) => c !== node && !isDescendant(node, c),
  )

  const goDeeper = (child: MindmapNode) => {
    setBreadcrumb((prev) => [...prev, { node: child, label: child.label }])
  }

  const goBack = (index: number) => {
    setBreadcrumb((prev) => prev.slice(0, index + 1))
  }

  const confirmMove = () => {
    if (node === root && currentParent === root) return
    onMove(node, currentParent)
    setBreadcrumb([{ node: root, label: root.label }])
  }

  return (
    <div className="space-y-1.5">
      {/* Breadcrumb path */}
      <div className="flex flex-wrap items-center gap-0.5 text-[11px]">
        {breadcrumb.map((item, i) => (
          <span key={i} className="flex items-center gap-0.5">
            {i > 0 && <span className="text-slate-300">/</span>}
            <button
              onClick={() => goBack(i)}
              className={`rounded px-1 ${i === breadcrumb.length - 1 ? 'bg-slate-700 text-white' : 'text-slate-500 hover:bg-slate-100'}`}
            >
              {truncateLabel(item.label, 16)}
            </button>
          </span>
        ))}
      </div>

      {/* Children list */}
      {children.length > 0 ? (
        <div className="max-h-[160px] overflow-y-auto rounded border border-slate-200 bg-white">
          {children.map((child, i) => (
            <button
              key={i}
              onClick={() => goDeeper(child)}
              className="flex w-full items-center justify-between px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
            >
              <span>{truncateLabel(child.label, 20)}</span>
              {(child.children || []).length > 0 && (
                <ChevronRight size={12} className="text-slate-400" />
              )}
            </button>
          ))}
        </div>
      ) : (
        <p className="text-[11px] text-slate-400 py-1">此节点没有子节点可选</p>
      )}

      {/* Confirm button */}
      <button
        onClick={confirmMove}
        disabled={currentParent === node}
        className="w-full rounded border border-slate-200 px-2 py-1.5 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-40"
        title="移动到当前选中的父节点"
      >
        移动到：{truncateLabel(currentParent.label, 20)}
      </button>
    </div>
  )
}

// ---- helpers ----
function boldRoot(root: MindmapNode): MindmapNode {
  const next = cloneTree(root)
  next.bold = true
  return next
}

function foldFromDepth(node: any, maxExpandedDepth: number, depth = 0) {
  if (!node) return
  if (depth >= maxExpandedDepth && node.children?.length) {
    node.payload = { ...(node.payload || {}), fold: 1 }
  }
  for (const child of node.children || []) foldFromDepth(child, maxExpandedDepth, depth + 1)
}

function findMarkmapNodeByPath(root: any, path: string): any {
  if (!root?.state) return null
  if (root.state.path === path) return root
  for (const c of root.children || []) {
    const r = findMarkmapNodeByPath(c, path)
    if (r) return r
  }
  return null
}

function findNodeByLabel(root: MindmapNode, label: string): MindmapNode | null {
  const norm = normalizeLabel(label)
  const walk = (node: MindmapNode): MindmapNode | null => {
    if (normalizeLabel(node.label) === norm) return node
    for (const c of node.children || []) {
      const r = walk(c)
      if (r) return r
    }
    return null
  }
  return walk(root)
}

function findNodeByLabelAndDepth(root: MindmapNode, label: string, depth: number): MindmapNode | null {
  const norm = normalizeLabel(label)
  const walk = (node: MindmapNode, d: number): MindmapNode | null => {
    if (normalizeLabel(node.label) === norm && d === depth) return node
    for (const c of node.children || []) {
      const r = walk(c, d + 1)
      if (r) return r
    }
    return null
  }
  return walk(root, 0)
}

function normalizeLabel(label: string): string {
  return (label || '').replace(/`([^`]+)`/g, '$1').replace(/\s+/g, ' ').trim()
}

function findNodeByPath(root: MindmapNode, indices: number[]): MindmapNode | null {
  if (indices.length === 0) return root
  let current: MindmapNode = root
  for (const idx of indices) {
    const children = current.children
    if (!children || idx >= children.length) return null
    current = children[idx]
  }
  return current
}

function getNodePath(root: MindmapNode, target: MindmapNode): number[] | null {
  if (root === target) return []
  for (let i = 0; i < (root.children?.length || 0); i++) {
    const child = root.children![i]
    if (child === target) return [i]
    const sub = getNodePath(child, target)
    if (sub) return [i, ...sub]
  }
  return null
}

function isDescendant(ancestor: MindmapNode, candidate: MindmapNode): boolean {
  const walk = (n: MindmapNode): boolean => {
    for (const c of n.children || []) {
      if (c === candidate) return true
      if (walk(c)) return true
    }
    return false
  }
  return walk(ancestor)
}
