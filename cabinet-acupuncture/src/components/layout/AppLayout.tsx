import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import { useEffect } from 'react'
import { useAppStore } from '../../store/AppContext'

export default function AppLayout() {
  const { lock } = useAppStore()

  // Ctrl+L to lock
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.ctrlKey && e.key === 'l') {
        e.preventDefault()
        lock()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lock])

  return (
    <div className="flex min-h-screen bg-stone-50">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  )
}
