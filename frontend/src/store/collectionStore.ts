import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface Collection {
  id: string
  name: string
  description: string
  tags: string[]
  coverImage: string
}

interface CollectionState {
  collections: Collection[]
  taskCollectionMap: Record<string, string>
  collectionTaskOrder: Record<string, string[]>
  activeCollectionId: string | null
  addCollection: (name: string, description?: string, tags?: string[], coverImage?: string) => Collection
  renameCollection: (id: string, name: string) => void
  updateCollectionMeta: (id: string, meta: { description?: string; tags?: string[]; coverImage?: string }) => void
  reorderCollections: (sourceId: string, targetId: string) => void
  setCollectionTaskOrder: (collectionId: string, taskIds: string[]) => void
  reorderTasksInCollection: (collectionId: string, sourceTaskId: string, targetTaskId: string) => void
  removeCollection: (id: string) => void
  setActiveCollection: (id: string | null) => void
  assignTask: (taskId: string, collectionId: string | null) => void
}

export const useCollectionStore = create<CollectionState>()(
  persist(
    (set) => ({
      collections: [],
      taskCollectionMap: {},
      collectionTaskOrder: {},
      activeCollectionId: null,
      addCollection: (name, description = '', tags = [], coverImage = '') => {
        const newCollection = { id: crypto.randomUUID(), name, description, tags, coverImage }
        set((s) => ({ collections: [...s.collections, newCollection] }))
        return newCollection
      },
      renameCollection: (id, name) =>
        set((s) => ({
          collections: s.collections.map((c) => (c.id === id ? { ...c, name } : c)),
        })),
      updateCollectionMeta: (id, meta) =>
        set((s) => ({
          collections: s.collections.map((c) =>
            c.id === id ? { ...c, ...meta } : c,
          ),
        })),
      reorderCollections: (sourceId, targetId) =>
        set((s) => {
          const sourceIndex = s.collections.findIndex((c) => c.id === sourceId)
          const targetIndex = s.collections.findIndex((c) => c.id === targetId)
          if (sourceIndex === -1 || targetIndex === -1 || sourceIndex === targetIndex) return s

          const collections = [...s.collections]
          const [source] = collections.splice(sourceIndex, 1)
          collections.splice(targetIndex, 0, source)
          return { collections }
        }),
      setCollectionTaskOrder: (collectionId, taskIds) =>
        set((s) => ({
          collectionTaskOrder: {
            ...s.collectionTaskOrder,
            [collectionId]: taskIds,
          },
        })),
      reorderTasksInCollection: (collectionId, sourceTaskId, targetTaskId) =>
        set((s) => {
          if (sourceTaskId === targetTaskId) return s
          const currentOrder = s.collectionTaskOrder[collectionId] || []
          const sourceIndex = currentOrder.indexOf(sourceTaskId)
          const targetIndex = currentOrder.indexOf(targetTaskId)
          if (sourceIndex === -1 || targetIndex === -1) return s

          const order = [...currentOrder]
          const [source] = order.splice(sourceIndex, 1)
          order.splice(targetIndex, 0, source)
          return {
            collectionTaskOrder: {
              ...s.collectionTaskOrder,
              [collectionId]: order,
            },
          }
        }),
      removeCollection: (id) =>
        set((s) => {
          const taskCollectionMap = { ...s.taskCollectionMap }
          const collectionTaskOrder = { ...s.collectionTaskOrder }
          delete collectionTaskOrder[id]
          Object.keys(taskCollectionMap).forEach((tid) => {
            if (taskCollectionMap[tid] === id) delete taskCollectionMap[tid]
          })
          return {
            collections: s.collections.filter((c) => c.id !== id),
            taskCollectionMap,
            collectionTaskOrder,
            activeCollectionId: s.activeCollectionId === id ? null : s.activeCollectionId,
          }
        }),
      setActiveCollection: (id) => set({ activeCollectionId: id }),
      assignTask: (taskId, collectionId) =>
        set((s) => {
          const taskCollectionMap = { ...s.taskCollectionMap }
          const collectionTaskOrder = Object.fromEntries(
            Object.entries(s.collectionTaskOrder).map(([id, order]) => [
              id,
              order.filter((tid) => tid !== taskId),
            ]),
          ) as Record<string, string[]>

          if (collectionId) {
            taskCollectionMap[taskId] = collectionId
            collectionTaskOrder[collectionId] = [...(collectionTaskOrder[collectionId] || []), taskId]
          } else {
            delete taskCollectionMap[taskId]
          }
          return { taskCollectionMap, collectionTaskOrder }
        }),
    }),
    { name: 'project2note-collections',
      version: 2,
      migrate: (persisted: any) => ({
        ...persisted,
        collections: (persisted.collections || []).map((c: any) => ({
          ...c,
          description: c.description ?? '',
          tags: c.tags ?? [],
          coverImage: c.coverImage ?? '',
        })),
      }),
    },
  ),
)
