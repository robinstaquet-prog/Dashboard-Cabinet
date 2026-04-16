import { useState } from 'react'
import type { Patient } from '../../data/schema'
import { pseudonymize } from '../../pseudonymize/pseudonymize'
import { queryClaudeAI, type AIMode } from '../../api/claudeClient'

const MODES: { id: AIMode; label: string; description: string }[] = [
  {
    id: 'evaluation-energetique',
    label: 'Évaluation énergétique',
    description: 'Bilan global selon la pensée IEATC',
  },
  {
    id: 'suggestions-points',
    label: 'Suggestions de points',
    description: 'Points recommandés et justification',
  },
  {
    id: 'hypothese-diagnostique',
    label: 'Hypothèse diagnostique',
    description: 'Analyse différentielle IEATC',
  },
  {
    id: 'resume-suivi',
    label: 'Résumé de suivi',
    description: 'Évolution sur les séances',
  },
]

interface AIPanelProps {
  patient: Patient
}

export default function AIPanel({ patient }: AIPanelProps) {
  const [mode, setMode] = useState<AIMode>('evaluation-energetique')
  const [context, setContext] = useState('')
  const [response, setResponse] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const pseudo = pseudonymize(patient)

  async function handleQuery() {
    setLoading(true)
    setError(null)
    setResponse(null)
    try {
      const text = await queryClaudeAI(pseudo, mode, context || undefined)
      setResponse(text)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Pseudo badge */}
      <div className="bg-stone-100 rounded-lg px-3 py-2 mb-4 text-xs text-stone-500">
        <span className="font-medium text-stone-700">Patient #{pseudo.pseudoId}</span>
        {' '}— {pseudo.sexe}, {pseudo.trancheAge}
        <span className="ml-2 text-stone-400">(données pseudonymisées)</span>
      </div>

      {/* Mode selector */}
      <div className="space-y-1 mb-4">
        {MODES.map((m) => (
          <button
            key={m.id}
            onClick={() => { setMode(m.id); setResponse(null) }}
            className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
              mode === m.id
                ? 'bg-teal-50 border border-teal-200 text-teal-800'
                : 'hover:bg-stone-50 text-stone-600 border border-transparent'
            }`}
          >
            <div className="font-medium">{m.label}</div>
            <div className="text-xs text-stone-400">{m.description}</div>
          </button>
        ))}
      </div>

      {/* Additional context */}
      <div className="mb-4">
        <label className="block text-xs font-medium text-stone-500 mb-1">
          Contexte supplémentaire (optionnel)
        </label>
        <textarea
          value={context}
          onChange={(e) => setContext(e.target.value)}
          rows={2}
          placeholder="Question spécifique, observation du jour…"
          className="w-full border border-stone-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 resize-none"
        />
      </div>

      {/* Query button */}
      <button
        onClick={handleQuery}
        disabled={loading}
        className="w-full bg-teal-600 hover:bg-teal-700 disabled:bg-teal-300 text-white font-medium py-2 rounded-lg text-sm transition-colors mb-4"
      >
        {loading ? 'Analyse en cours…' : 'Interroger Claude (IEATC)'}
      </button>

      {/* Response */}
      {loading && (
        <div className="flex-1 flex items-center justify-center text-stone-400 text-sm">
          <div className="text-center">
            <div className="text-2xl mb-2">⟳</div>
            Consultation du corpus IEATC…
          </div>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {response && !loading && (
        <div className="flex-1 overflow-auto">
          <div className="text-xs font-medium text-stone-500 uppercase tracking-wide mb-2">
            Réponse — lecture seule
          </div>
          <div className="bg-stone-50 rounded-lg border border-stone-200 px-4 py-3 text-sm text-stone-700 whitespace-pre-wrap leading-relaxed">
            {response}
          </div>
          <p className="text-xs text-stone-400 mt-2">
            Aide à la réflexion clinique uniquement · La décision thérapeutique vous appartient
          </p>
        </div>
      )}
    </div>
  )
}
