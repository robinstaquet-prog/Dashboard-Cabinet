import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useAppStore } from '../store/AppContext'
import type { Patient } from '../data/schema'

function PatientRow({ patient }: { patient: Patient }) {
  const lastSession = patient.sessions.at(-1)
  return (
    <Link
      to={`/patients/${patient.id}`}
      className="flex items-center gap-4 px-6 py-4 hover:bg-stone-50 border-b border-stone-100 last:border-0 transition-colors"
    >
      <div className="w-9 h-9 rounded-full bg-teal-100 text-teal-700 flex items-center justify-center font-semibold text-sm shrink-0">
        {patient.prenom[0]}{patient.nom[0]}
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-medium text-stone-800 text-sm">
          {patient.prenom} {patient.nom}
        </div>
        <div className="text-xs text-stone-400 mt-0.5 truncate">
          {patient.pathologies.slice(0, 3).join(' · ') || 'Aucune pathologie renseignée'}
        </div>
      </div>
      <div className="text-right shrink-0">
        <div className="text-xs text-stone-500">
          {lastSession
            ? new Date(lastSession.date).toLocaleDateString('fr-CH')
            : 'Aucune séance'}
        </div>
        <div className="text-xs text-stone-400 mt-0.5">
          {patient.sessions.length} séance{patient.sessions.length !== 1 ? 's' : ''}
        </div>
      </div>
    </Link>
  )
}

export default function PatientsListPage() {
  const { data, deduplicatePatients } = useAppStore()
  const [search, setSearch] = useState('')
  const [deduping, setDeduping] = useState(false)

  const duplicateCount = useMemo(() => {
    const groups = new Map<string, number>()
    for (const p of data.patients) {
      const key = `${p.prenom} ${p.nom}`.toLowerCase().replace(/_\d+$/, '').trim()
      groups.set(key, (groups.get(key) ?? 0) + 1)
    }
    return [...groups.values()].filter((c) => c > 1).reduce((a, b) => a + b - 1, 0)
  }, [data.patients])
  const [filterPathologie, setFilterPathologie] = useState('')
  const [filterPattern, setFilterPattern] = useState('')

  const allPathologies = useMemo(() => {
    const set = new Set<string>()
    data.patients.forEach((p) => p.pathologies.forEach((v) => set.add(v)))
    return [...set].sort()
  }, [data.patients])

  const allPatterns = useMemo(() => {
    const set = new Set<string>()
    data.patients.forEach((p) => p.patternsMTC.forEach((v) => set.add(v)))
    return [...set].sort()
  }, [data.patients])

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return data.patients.filter((p) => {
      const matchSearch =
        !q ||
        `${p.prenom} ${p.nom}`.toLowerCase().includes(q) ||
        p.pathologies.some((v) => v.toLowerCase().includes(q)) ||
        p.patternsMTC.some((v) => v.toLowerCase().includes(q))
      const matchPath = !filterPathologie || p.pathologies.includes(filterPathologie)
      const matchPattern = !filterPattern || p.patternsMTC.includes(filterPattern)
      return matchSearch && matchPath && matchPattern
    })
  }, [data.patients, search, filterPathologie, filterPattern])

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-stone-800">Dossiers patients</h1>
        <div className="flex gap-2">
          {duplicateCount > 0 && (
            <button
              disabled={deduping}
              onClick={async () => {
                setDeduping(true)
                await deduplicatePatients()
                setDeduping(false)
              }}
              className="text-sm px-3 py-2 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-40 transition-colors"
            >
              {deduping ? '…' : `Supprimer ${duplicateCount} doublon${duplicateCount > 1 ? 's' : ''}`}
            </button>
          )}
          <Link
            to="/patients/nouveau"
            className="bg-teal-600 hover:bg-teal-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            + Nouveau patient
          </Link>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-4">
        <input
          type="text"
          placeholder="Rechercher (nom, pathologie, pattern)…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 border border-stone-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
        />
        <select
          value={filterPathologie}
          onChange={(e) => setFilterPathologie(e.target.value)}
          className="border border-stone-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 bg-white"
        >
          <option value="">Toutes pathologies</option>
          {allPathologies.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
        <select
          value={filterPattern}
          onChange={(e) => setFilterPattern(e.target.value)}
          className="border border-stone-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 bg-white"
        >
          <option value="">Tous patterns</option>
          {allPatterns.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
      </div>

      {/* List */}
      <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="py-16 text-center text-stone-400 text-sm">
            {data.patients.length === 0
              ? 'Aucun patient enregistré. Créez votre premier dossier.'
              : 'Aucun résultat pour cette recherche.'}
          </div>
        ) : (
          filtered.map((p) => <PatientRow key={p.id} patient={p} />)
        )}
      </div>

      <div className="text-xs text-stone-400 mt-3">
        {filtered.length} patient{filtered.length !== 1 ? 's' : ''} affiché{filtered.length !== 1 ? 's' : ''}
        {filtered.length !== data.patients.length && ` sur ${data.patients.length}`}
      </div>
    </div>
  )
}
