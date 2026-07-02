import { useState, useEffect, useCallback, useRef } from 'react'
import { Loader2, ChevronLeft, ChevronRight, Check, RotateCcw, Plus, MoreVertical, Pencil, Trash2, X, RefreshCw } from 'lucide-react'
import toast from 'react-hot-toast'
import { cardsApi, type KnowledgeCardData } from '@/services'
import type { NoteStyle } from '@/lib/terms'

interface Props {
  taskId: string
  style: NoteStyle
}

export default function KnowledgeCardPanel({ taskId, style }: Props) {
  const [cards, setCards] = useState<KnowledgeCardData[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [personalNotesDraft, setPersonalNotesDraft] = useState('')
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; cardId: string } | null>(null)
  const [editingCard, setEditingCard] = useState<KnowledgeCardData | null>(null)
  const [editForm, setEditForm] = useState({ front_title: '', front_subtitle: '', back_content: '', back_pitfalls: '' })
  const notesBlurRef = useRef(false)

  const currentCard = cards[currentIndex] as KnowledgeCardData | undefined
  const masteredCount = cards.filter((c) => c.review_status === 'mastered').length
  const totalCount = cards.length

  const fetchCards = useCallback(async () => {
    setLoading(true)
    try {
      const data = await cardsApi.list(taskId)
      setCards(data)
      if (currentIndex >= data.length) setCurrentIndex(Math.max(0, data.length - 1))
    } catch {
      toast.error('加载知识卡片失败')
    } finally {
      setLoading(false)
    }
  }, [taskId])

  useEffect(() => {
    fetchCards()
  }, [fetchCards])

  useEffect(() => {
    setCurrentIndex(0)
    setFlipped(false)
  }, [style])

  useEffect(() => {
    if (currentCard) setPersonalNotesDraft(currentCard.personal_notes || '')
  }, [currentCard])

  const handleGenerate = async () => {
    setGenerating(true)
    try {
      const data = await cardsApi.generate(taskId, style, true)
      setCards(data)
      setCurrentIndex(0)
      setFlipped(false)
      toast.success('知识卡片生成完成')
    } catch (e: any) {
      toast.error(e?.response?.data?.message || '知识卡片生成失败')
    } finally {
      setGenerating(false)
    }
  }

  const handleFlip = () => setFlipped((f) => !f)
  const handlePrev = () => { setCurrentIndex((i) => Math.max(0, i - 1)); setFlipped(false) }
  const handleNext = () => { setCurrentIndex((i) => Math.min(cards.length - 1, i + 1)); setFlipped(false) }

  const handleReview = async (status: KnowledgeCardData['review_status']) => {
    if (!currentCard) return
    try {
      const updated = await cardsApi.updateReview(taskId, currentCard.id, status)
      setCards((prev) => prev.map((c) => (c.id === updated.id ? updated : c)))
    } catch {
      toast.error('更新复习状态失败')
    }
  }

  const handleDelete = async (cardId: string) => {
    try {
      await cardsApi.delete(taskId, cardId)
      setCards((prev) => prev.filter((c) => c.id !== cardId))
      setCurrentIndex((i) => Math.min(i, Math.max(0, cards.length - 2)))
      setContextMenu(null)
      toast.success('卡片已删除')
    } catch {
      toast.error('删除失败')
    }
  }

  const handlePersonalNotesBlur = async () => {
    if (!currentCard || personalNotesDraft === (currentCard.personal_notes || '')) return
    try {
      const updated = await cardsApi.update(taskId, currentCard.id, { personal_notes: personalNotesDraft })
      setCards((prev) => prev.map((c) => (c.id === updated.id ? updated : c)))
    } catch {
      toast.error('保存备注失败')
    }
  }

  const handleContextMenu = (e: React.MouseEvent, cardId: string) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, cardId })
  }

  const openEditDialog = (card: KnowledgeCardData) => {
    setEditingCard(card)
    setEditForm({
      front_title: card.front_title,
      front_subtitle: card.front_subtitle || '',
      back_content: card.back_content,
      back_pitfalls: card.back_pitfalls || '',
    })
    setContextMenu(null)
  }

  const handleEditSave = async () => {
    if (!editingCard) return
    try {
      const updated = await cardsApi.update(taskId, editingCard.id, editForm)
      setCards((prev) => prev.map((c) => (c.id === updated.id ? updated : c)))
      setEditingCard(null)
      toast.success('卡片已更新')
    } catch {
      toast.error('更新失败')
    }
  }

  const handleAddCard = async () => {
    try {
      const card = await cardsApi.create(taskId, {
        front_title: '新卡片',
        front_subtitle: '',
        back_content: '',
      })
      setCards((prev) => [...prev, card])
      setCurrentIndex(cards.length)
      setFlipped(false)
    } catch {
      toast.error('新增卡片失败')
    }
  }

  // Close context menu on click outside
  useEffect(() => {
    if (!contextMenu) return
    const close = () => setContextMenu(null)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [contextMenu])

  // Keyboard navigation
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (editingCard) return
      if (e.key === 'ArrowLeft') handlePrev()
      else if (e.key === 'ArrowRight') handleNext()
      else if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); handleFlip() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    )
  }

  if (!cards.length) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <p className="text-sm text-slate-500">暂无知识卡片</p>
        <button
          onClick={handleGenerate}
          disabled={generating}
          className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          {generating ? '生成中...' : '生成知识卡片'}
        </button>
      </div>
    )
  }

  const isBeginner = style === 'beginner'

  return (
    <div className="flex h-full flex-col">
      {/* Top bar */}
      <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-5 py-3">
        <div className="flex items-center gap-2 text-sm text-slate-600">
          <span className="font-medium">知识卡片</span>
          <span className="text-slate-400">|</span>
          <span>{masteredCount}/{totalCount} 已掌握</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            重新生成
          </button>
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-1 shrink-0 bg-slate-100">
        <div
          className="h-full bg-blue-500 transition-all duration-300"
          style={{ width: totalCount ? `${(masteredCount / totalCount) * 100}%` : '0%' }}
        />
      </div>

      {/* Card area */}
      <div className="flex flex-1 items-center justify-center gap-4 px-6 py-4">
        <button
          onClick={handlePrev}
          disabled={currentIndex === 0}
          className="shrink-0 rounded-full border border-slate-200 p-2 text-slate-400 hover:bg-slate-50 hover:text-slate-600 disabled:opacity-30"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>

        {/* Flip card */}
        {currentCard && (
          <div
            className="perspective-[1000px] relative h-[340px] w-full max-w-[520px] cursor-pointer"
            onClick={handleFlip}
            onContextMenu={(e) => handleContextMenu(e, currentCard.id)}
          >
            <div
              className={`transform-style-preserve-3d relative h-full w-full transition-transform duration-500 ${flipped ? 'rotate-y-180' : ''}`}
            >
              {/* Front */}
              <div className="backface-hidden absolute inset-0 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                {currentCard.review_status === 'mastered' && (
                  <div className="absolute inset-0 rounded-2xl bg-slate-200/40" />
                )}
                {currentCard.review_status === 'mastered' && (
                  <div className="absolute right-3 top-3 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-green-500 text-white">
                    <Check className="h-3.5 w-3.5" />
                  </div>
                )}
                <div className="relative z-[1] flex h-full flex-col justify-center">
                  <h3 className="mb-3 text-lg font-semibold text-slate-800">{currentCard.front_title}</h3>
                  {currentCard.front_subtitle && (
                    <p className="text-sm text-slate-500">
                      {isBeginner ? currentCard.front_subtitle : (
                        <>
                          <span className="text-xs text-blue-500">{currentCard.front_subtitle}</span>
                        </>
                      )}
                    </p>
                  )}
                  {!currentCard.front_subtitle && !isBeginner && (
                    <span className="text-xs text-slate-400">专业版卡片</span>
                  )}
                </div>
                <p className="absolute bottom-4 left-6 text-xs text-slate-300">点击翻转查看背面</p>
              </div>

              {/* Back */}
              <div className="backface-hidden rotate-y-180 absolute inset-0 rounded-2xl border border-slate-200 bg-slate-50 p-6 shadow-sm">
                {currentCard.review_status === 'mastered' && (
                  <div className="absolute inset-0 rounded-2xl bg-slate-200/40" />
                )}
                <div className="relative z-[1] flex h-full flex-col">
                  <h4 className="mb-2 text-sm font-semibold text-slate-700">{currentCard.front_title}</h4>
                  <p className="mb-3 flex-1 overflow-y-auto text-sm text-slate-600 whitespace-pre-wrap">
                    {currentCard.back_content}
                  </p>
                  {isBeginner && currentCard.back_pitfalls && (
                    <div className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
                      <span className="font-medium">避坑提醒：</span>{currentCard.back_pitfalls}
                    </div>
                  )}
                  <textarea
                    className="resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600 placeholder:text-slate-300 focus:outline-none focus:ring-1 focus:ring-blue-300"
                    rows={2}
                    placeholder="个人备注..."
                    value={personalNotesDraft}
                    onChange={(e) => setPersonalNotesDraft(e.target.value)}
                    onBlur={handlePersonalNotesBlur}
                    onClick={(e) => e.stopPropagation()}
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        <button
          onClick={handleNext}
          disabled={currentIndex === cards.length - 1}
          className="shrink-0 rounded-full border border-slate-200 p-2 text-slate-400 hover:bg-slate-50 hover:text-slate-600 disabled:opacity-30"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>

      {/* Bottom: review buttons + thumbnail strip */}
      <div className="shrink-0 border-t border-slate-100 px-5 py-3">
        <div className="mb-3 flex items-center justify-center gap-3">
          <button
            onClick={() => handleReview('needs_review')}
            className={`flex items-center gap-1.5 rounded-lg border px-4 py-2 text-xs ${
              currentCard?.review_status === 'needs_review'
                ? 'border-amber-300 bg-amber-50 text-amber-700'
                : 'border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            待复习
          </button>
          <button
            onClick={() => handleReview('mastered')}
            className={`flex items-center gap-1.5 rounded-lg border px-4 py-2 text-xs ${
              currentCard?.review_status === 'mastered'
                ? 'border-green-300 bg-green-50 text-green-700'
                : 'border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            <Check className="h-3.5 w-3.5" />
            已掌握
          </button>
          <button
            onClick={() => { if (currentCard) handleReview('none') }}
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-400 hover:bg-slate-50"
          >
            重置
          </button>
        </div>

        {/* Thumbnail strip */}
        <div className="flex items-center justify-center gap-1.5 overflow-x-auto pb-1">
          {cards.map((card, i) => (
            <button
              key={card.id}
              onClick={() => { setCurrentIndex(i); setFlipped(false) }}
              className={`shrink-0 rounded-md border px-2.5 py-1 text-xs transition-colors ${
                i === currentIndex
                  ? 'border-blue-300 bg-blue-50 text-blue-700 font-medium'
                  : card.review_status === 'mastered'
                    ? 'border-green-200 bg-green-50 text-green-600'
                    : card.review_status === 'needs_review'
                      ? 'border-amber-200 bg-amber-50 text-amber-600'
                      : 'border-slate-200 text-slate-500 hover:bg-slate-50'
              }`}
              title={card.front_title}
            >
              {card.front_title.length > 6 ? card.front_title.slice(0, 6) + '…' : card.front_title}
            </button>
          ))}
        </div>
      </div>

      {/* Floating add button */}
      <button
        onClick={handleAddCard}
        className="absolute bottom-20 right-6 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-blue-600 text-white shadow-lg hover:bg-blue-700"
      >
        <Plus className="h-5 w-5" />
      </button>

      {/* Context menu */}
      {contextMenu && (
        <div
          className="fixed z-50 rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            onClick={() => {
              const card = cards.find((c) => c.id === contextMenu.cardId)
              if (card) openEditDialog(card)
            }}
            className="flex w-full items-center gap-2 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
          >
            <Pencil className="h-3.5 w-3.5" />
            编辑内容
          </button>
          <button
            onClick={() => handleDelete(contextMenu.cardId)}
            className="flex w-full items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50"
          >
            <Trash2 className="h-3.5 w-3.5" />
            删除卡片
          </button>
        </div>
      )}

      {/* Edit dialog */}
      {editingCard && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <h3 className="font-medium text-slate-800">编辑卡片</h3>
              <button onClick={() => setEditingCard(null)} className="rounded p-1 text-slate-400 hover:bg-slate-100">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3 p-5">
              <div>
                <label className="mb-1 block text-xs text-slate-500">标题</label>
                <input
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-300 focus:outline-none"
                  value={editForm.front_title}
                  onChange={(e) => setEditForm((f) => ({ ...f, front_title: e.target.value }))}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-500">{isBeginner ? '一句话结论' : '层级/标签'}</label>
                <input
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-300 focus:outline-none"
                  value={editForm.front_subtitle}
                  onChange={(e) => setEditForm((f) => ({ ...f, front_subtitle: e.target.value }))}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-500">{isBeginner ? '通俗解释' : '精准知识点'}</label>
                <textarea
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-300 focus:outline-none"
                  rows={4}
                  value={editForm.back_content}
                  onChange={(e) => setEditForm((f) => ({ ...f, back_content: e.target.value }))}
                />
              </div>
              {isBeginner && (
                <div>
                  <label className="mb-1 block text-xs text-slate-500">避坑提醒</label>
                  <textarea
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-300 focus:outline-none"
                    rows={2}
                    value={editForm.back_pitfalls}
                    onChange={(e) => setEditForm((f) => ({ ...f, back_pitfalls: e.target.value }))}
                  />
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-4">
              <button
                onClick={() => setEditingCard(null)}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
              >
                取消
              </button>
              <button
                onClick={handleEditSave}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
