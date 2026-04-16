import { NavLink } from 'react-router-dom'
import { useAppStore } from '../../store/AppContext'

const navItems = [
  { to: '/patients', label: 'Dossiers', icon: '👤' },
  { to: '/statistiques', label: 'Statistiques', icon: '📊' },
  { to: '/numerisation', label: 'Numérisation', icon: '📷' },
]

export default function Sidebar() {
  const { data, lock } = useAppStore()

  return (
    <aside className="w-56 min-h-screen bg-stone-900 text-stone-100 flex flex-col">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-stone-700">
        <div className="text-xs font-medium text-stone-400 uppercase tracking-widest">Cabinet</div>
        <div className="text-sm font-semibold mt-0.5 truncate">{data.settings.cabinetNom}</div>
        <div className="text-xs text-stone-500 mt-0.5 truncate">{data.settings.praticienNom}</div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                isActive
                  ? 'bg-teal-600 text-white'
                  : 'text-stone-300 hover:bg-stone-800 hover:text-white'
              }`
            }
          >
            <span>{item.icon}</span>
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>

      {/* Lock button */}
      <div className="px-3 py-4 border-t border-stone-700">
        <button
          onClick={lock}
          className="flex items-center gap-3 w-full px-3 py-2 rounded-lg text-sm text-stone-400 hover:bg-stone-800 hover:text-white transition-colors"
          title="Verrouiller (Ctrl+L)"
        >
          <span>🔒</span>
          <span>Verrouiller</span>
        </button>
      </div>
    </aside>
  )
}
