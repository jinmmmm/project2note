import { useNavigate } from 'react-router-dom'
import CreateTaskPanel from '@/components/CreateTaskPanel'
import { taskApi } from '@/services'
import { useAppStore } from '@/store/appStore'
import { useUIStore } from '@/store/uiStore'

export default function WelcomePage() {
  const navigate = useNavigate()
  const sidebarSection = useUIStore((s) => s.sidebarSection)
  const workbenchTaskId = useUIStore((s) => s.workbenchTaskId)
  const setSidebarSection = useUIStore((s) => s.setSidebarSection)
  const setWorkbenchTaskId = useUIStore((s) => s.setWorkbenchTaskId)
  const resetTaskListFilters = useUIStore((s) => s.resetTaskListFilters)
  const setTasks = useAppStore((s) => s.setTasks)
  const removeTask = useAppStore((s) => s.removeTask)

  if (sidebarSection !== 'workbench') {
    return (
      <div className="flex h-full items-center justify-center bg-white text-sm text-slate-400">
        在左侧任务列表中选择笔记查看
      </div>
    )
  }

  return (
    <CreateTaskPanel
      embedded
      resumeTaskId={workbenchTaskId}
      onClose={() => setWorkbenchTaskId(null)}
      onDeleted={(taskId) => {
        removeTask(taskId)
        setWorkbenchTaskId(null)
        taskApi.list().then(setTasks).catch(() => {})
      }}
      onCreated={async (id) => {
        setWorkbenchTaskId(null)
        resetTaskListFilters()
        setSidebarSection('tasks')
        navigate(`/task/${id}`)
        try {
          const tasks = await taskApi.list()
          setTasks(tasks)
        } catch {
          /* 列表刷新失败不阻断跳转 */
        }
      }}
    />
  )
}
