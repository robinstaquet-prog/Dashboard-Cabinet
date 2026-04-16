import { useMemo, useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, CartesianGrid } from 'recharts'
import { useAppStore } from '../store/AppContext'
import SessionCard from '../components/session/SessionCard'
import AIPanel from '../components/ai/AIPanel'
import { pipelineClient } from '../api/pipelineClient'

export default function PatientFilePage() {
  const { id } = useParams<{ id: string }>()
  const { data, deletePatient, updatePatient, addAnamnesisNote } = useAppStore()

  const navigate = useNavigate()

  const [noteText, setNoteText] = useState('')
  const [noteSubmitting, setNoteSubmitting] = useState(false)
  const [editingName, setEditingName] = useState(false)
  const [editPrenom, setEditPrenom] = useState('')
  const [editNom, setEditNom] = useState('')

  // Pipeline — code et ouverture ODT
  const [pipelineCode, setPipelineCode] = useState<string | null>(null)
  const [odtStatus, setOdtStatus] = useState<null | 'loading' | 'error'>(null)
  const [odtError, setOdtError] = useState('')

  const patient = data.patients.find((p) => p.id === id)

  // Récupère le code pipeline : d'abord depuis le dossier, sinon par recherche par nom
  useEffect(() => {
    if (!patient) return
    if (patient.pipelineCode) {
      setPipelineCode(patient.pipelineCode)
      return
    }
    const dashboardName = `${patient.prenom} ${patient.nom}`.toLowerCase()
    pipelineClient.listPatients().then((list) => {
      const match = list.find(
        (p) => p.prenom_nom.replace(/_\d+$/, '').toLowerCase() === dashboardName,
      )
      if (match) {
        setPipelineCode(match.code)
        // Mémorise le code dans le dossier pour les prochaines fois
        updatePatient(patient.id, { pipelineCode: match.code })
      }
    }).catch(() => {})
  }, [patient?.id, patient?.pipelineCode]) // eslint-disable-line react-hooks/exhaustive-deps

  const effectiveCode = patient?.pipelineCode ?? pipelineCode

  async function handleOpenOdt() {
    if (!effectiveCode || !patient) return
    setOdtStatus('loading')
    setOdtError('')
    try {
      // Régénère d'abord pour s'assurer que l'ODT est à jour
      await pipelineClient.regenerateFromDashboard(effectiveCode, patient)
      await pipelineClient.openOdt(effectiveCode)
      setOdtStatus(null)
    } catch (e) {
      setOdtStatus('error')
      setOdtError((e as Error).message)
      setTimeout(() => { setOdtStatus(null); setOdtError('') }, 6000)
    }
  }

  if (!patient) {
    return (
      <div className="p-6 text-stone-500 text-sm">
        Patient introuvable. <Link to="/patients" className="text-teal-600 underline">Retour à la liste</Link>
      </div>
    )
  }

  const age = Math.floor(
    (Date.now() - new Date(patient.dateNaissance).getTime()) / (365.25 * 24 * 60 * 60 * 1000),
  )

  async function handleDelete() {
    if (!window.confirm(`Supprimer définitivement le dossier de ${patient!.prenom} ${patient!.nom} ?`)) return
    await deletePatient(patient!.id)
    navigate('/patients')
  }

  function startEditName() {
    setEditPrenom(patient!.prenom)
    setEditNom(patient!.nom)
    setEditingName(true)
  }

  async function saveEditName() {
    if (!id || !editPrenom.trim()) return
    await updatePatient(id, { prenom: editPrenom.trim(), nom: editNom.trim() })
    setEditingName(false)
  }

  const sortedSessions = [...patient.sessions].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
  )

  // Stats patient
  const topPoints = useMemo(() => {
    const map = new Map<string, number>()
    for (const s of patient.sessions) {
      for (const p of s.pointsNeedled) {
        map.set(p.code, (map.get(p.code) ?? 0) + 1)
      }
    }
    return [...map.entries()]
      .map(([code, count]) => ({ code, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8)
  }, [patient.sessions])

  const improvementData = useMemo(() =>
    [...patient.sessions]
      .filter((s) => s.amelioration !== null)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
      .map((s, i) => ({ label: `S${i + 1}`, value: s.amelioration! })),
    [patient.sessions]
  )

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Left column — patient file */}
      <div className="flex-1 overflow-auto p-6 min-w-0">
        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <button
              onClick={() => navigate('/patients')}
              className="text-stone-500 hover:text-stone-800 text-sm mb-2"
            >
              ← Dossiers
            </button>
            {editingName ? (
              <div className="flex items-center gap-2 mt-1">
                <input
                  value={editPrenom}
                  onChange={(e) => setEditPrenom(e.target.value)}
                  placeholder="Prénom"
                  className="border border-stone-300 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 w-28"
                />
                <input
                  value={editNom}
                  onChange={(e) => setEditNom(e.target.value)}
                  placeholder="Nom"
                  className="border border-stone-300 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 w-32"
                />
                <button onClick={saveEditName} className="text-xs px-2.5 py-1 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors">Enregistrer</button>
                <button onClick={() => setEditingName(false)} className="text-xs px-2.5 py-1 border border-stone-300 text-stone-600 rounded-lg hover:bg-stone-50 transition-colors">Annuler</button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-semibold text-stone-800">
                  {patient.prenom} {patient.nom}
                </h1>
                <button onClick={startEditName} className="text-xs text-stone-400 hover:text-stone-600 mt-1 transition-colors" title="Modifier le nom">✏️</button>
              </div>
            )}
            <div className="text-stone-500 text-sm mt-1">
              {age} ans ·{' '}
              {patient.sexe === 'F' ? 'Femme' : patient.sexe === 'M' ? 'Homme' : 'Autre'} ·{' '}
              Né(e) le {new Date(patient.dateNaissance).toLocaleDateString('fr-CH')}
            </div>
          </div>
          <div className="flex gap-2 shrink-0 flex-wrap justify-end">
            <Link
              to={`/patients/${id}/nouvelle-seance`}
              className="bg-teal-600 hover:bg-teal-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            >
              + Nouvelle séance
            </Link>
            <Link
              to={`/patients/${id}/modifier`}
              className="border border-stone-300 text-stone-700 hover:bg-stone-50 text-sm px-3 py-2 rounded-lg transition-colors"
            >
              Modifier
            </Link>
            {effectiveCode && (
              <button
                onClick={handleOpenOdt}
                disabled={odtStatus === 'loading'}
                title="Ouvrir la fiche dans LibreOffice (pipeline requis)"
                className={`text-sm px-3 py-2 rounded-lg border transition-colors disabled:opacity-40 ${
                  odtStatus === 'error'
                    ? 'border-red-300 text-red-600 bg-red-50'
                    : 'border-teal-300 text-teal-700 hover:bg-teal-50'
                }`}
              >
                {odtStatus === 'loading' ? '↺ Ouverture…' : odtStatus === 'error' ? '✗ Erreur' : '↗ Ouvrir fiche ODT'}
              </button>
            )}
            <button
              onClick={handleDelete}
              className="border border-red-200 text-red-600 hover:bg-red-50 text-sm px-3 py-2 rounded-lg transition-colors"
            >
              Supprimer
            </button>
          </div>
          {odtError && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mt-2">
              {odtError}
            </p>
          )}
        </div>

        {/* Patient info cards */}
        <div className="grid grid-cols-2 gap-4 mb-6">
          {/* Coordonnées */}
          <div className="bg-white rounded-xl border border-stone-200 p-4">
            <h3 className="text-xs font-medium text-stone-500 uppercase tracking-wide mb-3">Coordonnées</h3>
            <div className="space-y-1 text-sm text-stone-700">
              {patient.adresse && <div>{patient.adresse}</div>}
              {patient.telephone && <div>{patient.telephone}</div>}
              {patient.email && <div className="text-teal-600">{patient.email}</div>}
              {!patient.adresse && !patient.telephone && !patient.email && (
                <div className="text-stone-400">Non renseignées</div>
              )}
            </div>
          </div>

          {/* Clinique */}
          <div className="bg-white rounded-xl border border-stone-200 p-4">
            <h3 className="text-xs font-medium text-stone-500 uppercase tracking-wide mb-3">Pathologies & Patterns</h3>
            <div className="flex flex-wrap gap-1 mb-2">
              {patient.pathologies.map((p) => (
                <span key={p} className="bg-red-50 text-red-700 border border-red-200 text-xs px-2 py-0.5 rounded">
                  {p}
                </span>
              ))}
              {patient.pathologies.length === 0 && <span className="text-stone-400 text-xs">Aucune</span>}
            </div>
            <div className="flex flex-wrap gap-1">
              {patient.patternsMTC.map((p) => (
                <span key={p} className="bg-purple-50 text-purple-700 border border-purple-200 text-xs px-2 py-0.5 rounded">
                  {p}
                </span>
              ))}
              {patient.patternsMTC.length === 0 && <span className="text-stone-400 text-xs">Aucun</span>}
            </div>
          </div>
        </div>

        {/* Interrogatoire / Anamnèse */}
        <div className="bg-white rounded-xl border border-stone-200 overflow-hidden mb-6">
          <div className="px-5 py-3 border-b border-stone-100 bg-stone-50">
            <h3 className="text-xs font-semibold text-stone-700 uppercase tracking-wide">Interrogatoire &amp; Anamnèse</h3>
          </div>
          <div className="p-4">
            {patient.anamnese ? (
              <p className="text-sm text-stone-700 whitespace-pre-wrap leading-relaxed">{patient.anamnese}</p>
            ) : (
              <p className="text-xs text-stone-400 italic">Aucune donnée d'interrogatoire. Re-importez ce patient depuis la page Numérisation pour récupérer les infos de la fiche.</p>
            )}
            {patient.constitution && (
              <div className="mt-3 pt-3 border-t border-stone-100">
                <p className="text-xs font-medium text-stone-500 uppercase tracking-wide mb-1">Constitution énergétique</p>
                <p className="text-sm text-stone-700 whitespace-pre-wrap">{patient.constitution}</p>
              </div>
            )}
          </div>
        </div>

        {/* Notes d'anamnèse découvertes en cours de suivi */}
        <div className="bg-white rounded-xl border border-stone-200 overflow-hidden mb-6">
          <div className="px-5 py-3 border-b border-stone-100 bg-stone-50 flex items-center justify-between">
            <h3 className="text-xs font-semibold text-stone-700 uppercase tracking-wide">
              Informations découvertes en cours de suivi
            </h3>
            <span className="text-xs text-stone-400">{(patient.notesAnamnese ?? []).length} note{(patient.notesAnamnese ?? []).length !== 1 ? 's' : ''}</span>
          </div>
          <div className="p-4 space-y-2">
            {(patient.notesAnamnese ?? []).length === 0 && (
              <p className="text-xs text-stone-400 italic">Aucune note. Utilisez le champ ci-dessous pour noter ce qu'un patient révèle au fil des séances.</p>
            )}
            {(patient.notesAnamnese ?? []).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()).map((n) => (
              <div key={n.id} className="flex gap-3 px-3 py-2.5 bg-amber-50 border border-amber-100 rounded-lg">
                <div className="shrink-0 text-right">
                  <div className="text-xs font-semibold text-amber-700">Séance {n.seanceNum}</div>
                  <div className="text-xs text-amber-500">{new Date(n.date).toLocaleDateString('fr-CH')}</div>
                </div>
                <p className="text-sm text-stone-700">{n.note}</p>
              </div>
            ))}

            {/* Formulaire ajout */}
            <div className="flex gap-2 mt-3 pt-3 border-t border-stone-100">
              <div className="flex-1">
                <textarea
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  placeholder={`Séance ${patient.sessions.length + 1} — ex: "Migraines fréquentes depuis l'enfance"`}
                  rows={2}
                  className="w-full text-sm border border-stone-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none"
                />
              </div>
              <button
                disabled={!noteText.trim() || noteSubmitting}
                onClick={async () => {
                  if (!noteText.trim() || !id) return
                  setNoteSubmitting(true)
                  await addAnamnesisNote(id, {
                    date: new Date().toISOString(),
                    seanceNum: patient.sessions.length + 1,
                    note: noteText.trim(),
                  })
                  setNoteText('')
                  setNoteSubmitting(false)
                }}
                className="shrink-0 self-end px-3 py-2 text-sm rounded-lg bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-40 transition-colors font-medium"
              >
                Ajouter
              </button>
            </div>
          </div>
        </div>

        {/* Stats patient */}
        {(topPoints.length > 0 || improvementData.length > 0) && (
          <div className="grid grid-cols-2 gap-4 mb-6">
            {topPoints.length > 0 && (
              <div className="bg-white rounded-xl border border-stone-200 p-4">
                <h3 className="text-xs font-medium text-stone-500 uppercase tracking-wide mb-3">Points utilisés</h3>
                <ResponsiveContainer width="100%" height={160}>
                  <BarChart data={topPoints} layout="vertical" margin={{ left: 0, right: 16 }}>
                    <XAxis type="number" tick={{ fontSize: 10 }} />
                    <YAxis dataKey="code" type="category" tick={{ fontSize: 10 }} width={36} />
                    <Tooltip formatter={(v) => [`${v}x`, 'Utilisé']} />
                    <Bar dataKey="count" fill="#0d9488" radius={[0, 3, 3, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
            {improvementData.length > 0 && (
              <div className="bg-white rounded-xl border border-stone-200 p-4">
                <h3 className="text-xs font-medium text-stone-500 uppercase tracking-wide mb-3">Amélioration par séance</h3>
                <ResponsiveContainer width="100%" height={160}>
                  <LineChart data={improvementData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f0ee" />
                    <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                    <YAxis domain={[0, 10]} tick={{ fontSize: 10 }} />
                    <Tooltip formatter={(v) => [`${v}/10`, 'Amélioration']} />
                    <Line type="monotone" dataKey="value" stroke="#0d9488" strokeWidth={2} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        )}

        {/* Session timeline */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-medium text-stone-800">
              Séances ({patient.sessions.length})
            </h3>
          </div>
          {sortedSessions.length === 0 ? (
            <div className="bg-white rounded-xl border border-stone-200 py-10 text-center text-stone-400 text-sm">
              Aucune séance enregistrée.{' '}
              <Link to={`/patients/${id}/nouvelle-seance`} className="text-teal-600 underline">
                Enregistrer la première séance
              </Link>
            </div>
          ) : (
            <div className="space-y-2">
              {sortedSessions.map((s, i) => (
                <SessionCard key={s.id} session={s} numero={sortedSessions.length - i} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Right column — AI panel */}
      <div className="w-80 shrink-0 border-l border-stone-200 bg-white p-4 overflow-auto flex flex-col">
        <h3 className="font-medium text-stone-800 mb-4 text-sm uppercase tracking-wide">
          Assistant IEATC
        </h3>
        <AIPanel patient={patient} />
      </div>
    </div>
  )
}
