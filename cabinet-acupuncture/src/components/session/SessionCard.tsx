import { useState } from 'react'
import type { Session } from '../../data/schema'

interface SessionCardProps {
  session: Session
  numero: number
}

const TECHNIQUE_LABEL: Record<string, string> = {
  't': 'T',
  'd': 'D',
  't ch': 'T°',
}

const TECHNIQUE_COLOR: Record<string, string> = {
  't': 'bg-blue-50 text-blue-700 border-blue-200',
  'd': 'bg-orange-50 text-orange-700 border-orange-200',
  't ch': 'bg-red-50 text-red-700 border-red-200',
}

export default function SessionCard({ session, numero }: SessionCardProps) {
  const [open, setOpen] = useState(false)

  // Résumé pour la ligne fermée
  const summary = session.remarques || session.strategie || (session.pointsNeedled.length > 0 ? `${session.pointsNeedled.length} point(s)` : 'Séance sans notes')

  return (
    <div className="border border-stone-200 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-4 px-4 py-3 bg-white hover:bg-stone-50 transition-colors text-left"
      >
        <div className="w-7 h-7 rounded-full bg-stone-100 text-stone-600 flex items-center justify-center text-xs font-semibold shrink-0">
          {numero}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-stone-800">
            {new Date(session.date).toLocaleDateString('fr-CH', {
              weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
            })}
          </div>
          <div className="text-xs text-stone-500 truncate mt-0.5">{summary}</div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {session.amelioration !== null && (
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
              session.amelioration >= 7 ? 'bg-green-100 text-green-700'
              : session.amelioration >= 4 ? 'bg-amber-100 text-amber-700'
              : 'bg-red-100 text-red-700'
            }`}>
              {session.amelioration}/10
            </span>
          )}
          <span className="text-stone-400 text-sm">{open ? '▲' : '▼'}</span>
        </div>
      </button>

      {open && (
        <div className="px-4 pb-4 pt-2 bg-stone-50 border-t border-stone-200 space-y-3">
          {session.remarques && (
            <div>
              <div className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-0.5">Remarques</div>
              <div className="text-sm text-stone-700 whitespace-pre-wrap">{session.remarques}</div>
            </div>
          )}
          {session.poulsLangue && (
            <div>
              <div className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-0.5">Pouls / Langue</div>
              <div className="text-sm text-stone-700">{session.poulsLangue}</div>
            </div>
          )}
          {session.strategie && (
            <div>
              <div className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-0.5">Stratégie</div>
              <div className="text-sm text-stone-700">{session.strategie}</div>
            </div>
          )}
          {session.pointsNeedled.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-1">Points</div>
              <div className="flex flex-wrap gap-1.5">
                {session.pointsNeedled.map((p, i) => (
                  <span key={i} className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded border font-medium ${p.technique ? TECHNIQUE_COLOR[p.technique] : 'bg-teal-50 text-teal-700 border-teal-200'}`}>
                    {p.code}
                    {p.technique && (
                      <span className="opacity-75">· {TECHNIQUE_LABEL[p.technique]}</span>
                    )}
                  </span>
                ))}
              </div>
            </div>
          )}
          {session.aFaireProchaineSéance && (
            <div className="bg-amber-50 border border-amber-200 rounded px-3 py-2">
              <div className="text-xs font-semibold text-amber-700 uppercase tracking-wide mb-0.5">À faire prochaine séance</div>
              <div className="text-sm text-amber-900">{session.aFaireProchaineSéance}</div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
