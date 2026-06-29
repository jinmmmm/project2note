import { Outlet, useLocation } from 'react-router-dom'
import Sidebar from './Sidebar'
import ErrorBoundary from '@/components/ErrorBoundary'
import { useUIStore } from '@/store/uiStore'

export default function AppLayout() {
  const section = useUIStore((s) => s.sidebarSection)
  const location = useLocation()
  const isSettings = location.pathname === '/settings'
  const hideSidebar = isSettings
  const hideMain = !isSettings && section === 'collections'

  return (
    <div className="flex h-screen overflow-hidden bg-slate-100">
      {!hideSidebar && <Sidebar />}
      {!hideMain && (
        <main className="min-w-0 flex-1 overflow-hidden">
          <ErrorBoundary>
            <Outlet />
          </ErrorBoundary>
        </main>
      )}
    </div>
  )
}
