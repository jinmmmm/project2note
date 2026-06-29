import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import AppLayout from '@/components/layout/AppLayout'
import RequireAuth from '@/components/auth/RequireAuth'
import AuthPage from '@/pages/Auth'
import WelcomePage from '@/pages/Workspace/Welcome'
import NoteDetailPage from '@/pages/NoteDetail'
import SettingsPage from '@/pages/Settings'
import ChatPage from '@/pages/Chat'
import SharePublicPage from '@/pages/SharePublic'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/auth" element={<AuthPage />} />
        <Route element={<RequireAuth />}>
          <Route element={<AppLayout />}>
            <Route path="/" element={<WelcomePage />} />
            <Route path="/task/:taskId" element={<NoteDetailPage />} />
            <Route path="/chat" element={<ChatPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>
        </Route>
        <Route path="/share/:token" element={<SharePublicPage />} />
      </Routes>
      <Toaster position="top-center" />
    </BrowserRouter>
  )
}
