import { useEffect, useRef } from 'react'
import toast from 'react-hot-toast'
import { taskApi } from '@/services'
import { useAppStore } from '@/store/appStore'

export function useTaskPolling(
  taskId: string | null,
  enabled: boolean,
  interval = 3000,
  onUpdate?: () => void,
) {
  const updateTask = useAppStore((s) => s.updateTask)
  const timerRef = useRef<number | undefined>(undefined)
  const lastStatusRef = useRef<string | null>(null)

  useEffect(() => {
    lastStatusRef.current = null
  }, [taskId])

  useEffect(() => {
    if (!taskId || !enabled) return

    const poll = async () => {
      try {
        const status = await taskApi.status(taskId)
        const prev = lastStatusRef.current
        lastStatusRef.current = status.status

        if (status.status === 'PROCESSING' || status.status === 'PENDING') {
          updateTask({ id: taskId, ...status } as never)
          onUpdate?.()
        } else {
          onUpdate?.()
          if (timerRef.current) clearInterval(timerRef.current)

          if (prev && prev !== status.status) {
            if (status.status === 'COMPLETED') {
              toast.success('笔记生成成功')
            } else if (status.status === 'FAILED') {
              toast.error(status.error_message || '笔记生成失败')
            } else if (status.status === 'CANCELED') {
              toast.success('任务已停止')
            }
          }
        }
      } catch {
        /* ignore */
      }
    }

    poll()
    timerRef.current = window.setInterval(poll, interval)
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [taskId, enabled, interval, updateTask, onUpdate])
}
