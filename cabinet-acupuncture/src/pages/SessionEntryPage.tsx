import React, { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAppStore } from '../store/AppContext'
import type { AcupuncturePoint, Session } from '../data/schema'

// Parse "36 E t" → { code: "36 E", technique: "t" }
// Parse "36 E t ch" → { code: "36 E", technique: "t ch" }
// Parse "36 E" → { code: "36 E", technique: null }
function parsePointInput(raw: string): AcupuncturePoint | null {
  const s = raw.trim()
  if (!s) return null

  let technique: AcupuncturePoint['technique'] = null
  let codePart = s

  if (/\bt\s+ch\b/i.test(s)) {
    technique = 't ch'
    codePart = s.replace(/\s+t\s+ch\s*$/i, '').trim()
  } else if (/\bt\b/i.test(s) && !s.toUpperCase().endsWith('T CH')) {
    const m = s.match(/^(.*?)\s+t$/i)
    if (m) { technique = 't'; codePart = m[1].trim() }
  } else if (/\bd\b/i.test(s)) {
    const m = s.match(/^(.*?)\s+d$/i)
    if (m) { technique = 'd'; codePart = m[1].trim() }
  }

  if (!codePart) return null
  return { code: codePart.toUpperCase(), nom: codePart.toUpperCase(), technique }
}

const TECHNIQUE_LABEL: Record<string, string> = { 't': 'Tonifié', 'd': 'Dispersé', 't ch': 'Tonifié chauffé' }
const TECHNIQUE_COLOR: Record<string, string> = {
  't': 'bg-blue-50 text-blue-700 border-blue-200',
  'd': 'bg-orange-50 text-orange-700 border-orange-200',
  't ch': 'bg-red-50 text-red-700 border-red-200',
}

function PointsInput({
  points,
  onChange,
}: {
  points: AcupuncturePoint[]
  onChange: (pts: AcupuncturePoint[]) => void
}) {
  const [input, setInput] = useState('')
  const [preview, setPreview] = useState<AcupuncturePoint | null>(null)

  function handleChange(val: string) {
    setInput(val)
    setPreview(val.trim() ? parsePointInput(val) : null)
  }

  function add() {
    const pt = parsePointInput(input)
    if (!pt) return
    onChange([...points, pt])
    setInput('')
    setPreview(null)
  }

  return (
    <div>
      <label className="block text-sm font-medium text-stone-700 mb-1">Points</label>
      <p className="text-xs text-stone-400 mb-2">
        Notation : <code className="bg-stone-100 px-1 rounded">36 E t</code> = tonifié ·
        <code className="bg-stone-100 px-1 rounded ml-1">36 E d</code> = dispersé ·
        <code className="bg-stone-100 px-1 rounded ml-1">36 E t ch</code> = tonifié chauffé
      </p>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {points.map((p, i) => (
          <span key={i} className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded border font-medium ${p.technique ? TECHNIQUE_COLOR[p.technique] : 'bg-teal-50 text-teal-700 border-teal-200'}`}>
            {p.code}
            {p.technique && <span className="opacity-75">· {TECHNIQUE_LABEL[p.technique]}</span>}
            <button type="button" onClick={() => onChange(points.filter((_, j) => j !== i))} className="ml-0.5 opacity-60 hover:opacity-100">×</button>
          </span>
        ))}
      </div>
      <div className="flex gap-2 items-center">
        <input
          type="text"
          value={input}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())}
          placeholder="ex: 36 E t ou 6 RP d ou 4 VG t ch"
          className="flex-1 border border-stone-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 font-mono"
        />
        <button type="button" onClick={add} disabled={!preview}
          className="px-3 py-2 text-sm rounded-lg bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-40 transition-colors">
          +
        </button>
      </div>
      {preview && (
        <p className="text-xs text-teal-600 mt-1">
          → Point <strong>{preview.code}</strong>{preview.technique ? ` · ${TECHNIQUE_LABEL[preview.technique]}` : ''}
        </p>
      )}
    </div>
  )
}

type SessionForm = Omit<Session, 'id'>

export default function SessionEntryPage() {
  const { id: patientId } = useParams<{ id: string }>()
  const { data, addSession } = useAppStore()
  const navigate = useNavigate()

  const patient = data.patients.find((p) => p.id === patientId)

  const [form, setForm] = useState<SessionForm>({
    date: new Date().toISOString().split('T')[0],
    remarques: '',
    poulsLangue: '',
    strategie: '',
    pointsNeedled: [],
    aFaireProchaineSéance: '',
    amelioration: null,
  })
  const [saving, setSaving] = useState(false)

  function set<K extends keyof SessionForm>(key: K, value: SessionForm[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!patientId) return
    setSaving(true)
    try {
      await addSession(patientId, form)
      navigate(`/patients/${patientId}`)
    } finally {
      setSaving(false)
    }
  }

  if (!patient) return <div className="p-6 text-stone-500 text-sm">Patient introuvable.</div>

  return (
    <div className="p-6 max-w-2xl">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate(-1)} className="text-stone-500 hover:text-stone-800 text-sm">← Retour</button>
        <h1 className="text-xl font-semibold text-stone-800">
          Nouvelle séance — {patient.prenom} {patient.nom}
        </h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <section className="bg-white rounded-xl border border-stone-200 p-5 space-y-4">

          <div>
            <label className="block text-sm font-medium text-stone-700 mb-1">Date *</label>
            <input required type="date" value={form.date}
              onChange={(e) => set('date', e.target.value)}
              className="border border-stone-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
          </div>

          <div>
            <label className="block text-sm font-medium text-stone-700 mb-1">Remarques</label>
            <textarea value={form.remarques} onChange={(e) => set('remarques', e.target.value)}
              rows={3} placeholder="Évolution, ce que dit le patient, observations cliniques…"
              className="w-full border border-stone-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 resize-none" />
          </div>

          <div>
            <label className="block text-sm font-medium text-stone-700 mb-1">Pouls / Langue</label>
            <textarea value={form.poulsLangue} onChange={(e) => set('poulsLangue', e.target.value)}
              rows={2} placeholder="ex: Pouls fin, profond à droite. Langue pâle, enduit blanc…"
              className="w-full border border-stone-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 resize-none" />
          </div>

          <div>
            <label className="block text-sm font-medium text-stone-700 mb-1">Stratégie</label>
            <textarea value={form.strategie} onChange={(e) => set('strategie', e.target.value)}
              rows={2} placeholder="ex: Tonifier le Yang du Rein, disperser le Foie…"
              className="w-full border border-stone-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 resize-none" />
          </div>

          <PointsInput points={form.pointsNeedled} onChange={(pts) => set('pointsNeedled', pts)} />

          <div>
            <label className="block text-sm font-medium text-stone-700 mb-1">À faire prochaine séance</label>
            <textarea value={form.aFaireProchaineSéance} onChange={(e) => set('aFaireProchaineSéance', e.target.value)}
              rows={2} placeholder="Points à essayer, axe thérapeutique à explorer…"
              className="w-full border border-stone-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 resize-none" />
          </div>

        </section>

        <div className="flex gap-3">
          <button type="button" onClick={() => navigate(-1)}
            className="px-4 py-2 border border-stone-300 text-stone-700 text-sm rounded-lg hover:bg-stone-50 transition-colors">
            Annuler
          </button>
          <button type="submit" disabled={saving}
            className="flex-1 bg-teal-600 hover:bg-teal-700 disabled:bg-teal-300 text-white font-medium py-2 rounded-lg text-sm transition-colors">
            {saving ? 'Enregistrement…' : 'Enregistrer la séance'}
          </button>
        </div>
      </form>
    </div>
  )
}
