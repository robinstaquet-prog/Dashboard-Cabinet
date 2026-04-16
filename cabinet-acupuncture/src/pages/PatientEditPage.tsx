import React, { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAppStore } from '../store/AppContext'
import type { Patient } from '../data/schema'

type FormData = Omit<Patient, 'id' | 'createdAt' | 'updatedAt' | 'sessions' | 'notesAnamnese'>

function TagInput({
  label,
  values,
  onChange,
  placeholder,
}: {
  label: string
  values: string[]
  onChange: (v: string[]) => void
  placeholder?: string
}) {
  const [input, setInput] = useState('')

  function add() {
    const v = input.trim()
    if (v && !values.includes(v)) onChange([...values, v])
    setInput('')
  }

  return (
    <div>
      <label className="block text-sm font-medium text-stone-700 mb-1">{label}</label>
      <div className="flex gap-2 mb-2 flex-wrap">
        {values.map((v) => (
          <span
            key={v}
            className="inline-flex items-center gap-1 bg-teal-100 text-teal-800 text-xs px-2 py-1 rounded-full"
          >
            {v}
            <button
              type="button"
              onClick={() => onChange(values.filter((x) => x !== v))}
              className="text-teal-500 hover:text-teal-800"
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())}
          placeholder={placeholder}
          className="flex-1 border border-stone-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
        />
        <button
          type="button"
          onClick={add}
          className="px-3 py-2 bg-stone-100 hover:bg-stone-200 text-stone-700 text-sm rounded-lg transition-colors"
        >
          Ajouter
        </button>
      </div>
    </div>
  )
}

export default function PatientEditPage() {
  const { id } = useParams<{ id: string }>()
  const { data, updatePatient } = useAppStore()
  const navigate = useNavigate()

  const patient = data.patients.find((p) => p.id === id)

  const [form, setForm] = useState<FormData>(patient ? {
    nom: patient.nom,
    prenom: patient.prenom,
    dateNaissance: patient.dateNaissance,
    sexe: patient.sexe,
    adresse: patient.adresse,
    telephone: patient.telephone,
    email: patient.email,
    pathologies: patient.pathologies,
    patternsMTC: patient.patternsMTC,
    constitution: patient.constitution,
    anamnese: patient.anamnese,
  } : {
    nom: '', prenom: '', dateNaissance: '', sexe: 'autre',
    adresse: '', telephone: '', email: '',
    pathologies: [], patternsMTC: [], constitution: '', anamnese: '',
  })

  const [saving, setSaving] = useState(false)

  if (!patient) {
    return <div className="p-6 text-stone-500 text-sm">Patient introuvable.</div>
  }

  function set<K extends keyof FormData>(key: K, value: FormData[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!id) return
    setSaving(true)
    try {
      await updatePatient(id, form)
      navigate(`/patients/${id}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-6 max-w-2xl">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate(`/patients/${id}`)} className="text-stone-500 hover:text-stone-800 text-sm">
          ← Retour
        </button>
        <h1 className="text-xl font-semibold text-stone-800">
          Modifier — {patient.prenom} {patient.nom}
        </h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Identité */}
        <section className="bg-white rounded-xl border border-stone-200 p-5 space-y-4">
          <h2 className="font-medium text-stone-700 text-sm uppercase tracking-wide">Identité</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1">Prénom *</label>
              <input
                required
                type="text"
                value={form.prenom}
                onChange={(e) => set('prenom', e.target.value)}
                className="w-full border border-stone-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1">Nom *</label>
              <input
                required
                type="text"
                value={form.nom}
                onChange={(e) => set('nom', e.target.value)}
                className="w-full border border-stone-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1">Date de naissance</label>
              <input
                type="date"
                value={form.dateNaissance}
                onChange={(e) => set('dateNaissance', e.target.value)}
                className="w-full border border-stone-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1">Sexe</label>
              <select
                value={form.sexe}
                onChange={(e) => set('sexe', e.target.value as Patient['sexe'])}
                className="w-full border border-stone-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 bg-white"
              >
                <option value="F">Féminin</option>
                <option value="M">Masculin</option>
                <option value="autre">Autre</option>
              </select>
            </div>
          </div>
        </section>

        {/* Coordonnées */}
        <section className="bg-white rounded-xl border border-stone-200 p-5 space-y-4">
          <h2 className="font-medium text-stone-700 text-sm uppercase tracking-wide">Coordonnées</h2>
          <div>
            <label className="block text-sm font-medium text-stone-700 mb-1">Adresse</label>
            <input
              type="text"
              value={form.adresse}
              onChange={(e) => set('adresse', e.target.value)}
              className="w-full border border-stone-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1">Téléphone</label>
              <input
                type="tel"
                value={form.telephone}
                onChange={(e) => set('telephone', e.target.value)}
                className="w-full border border-stone-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1">Email</label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => set('email', e.target.value)}
                className="w-full border border-stone-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>
          </div>
        </section>

        {/* Clinique */}
        <section className="bg-white rounded-xl border border-stone-200 p-5 space-y-4">
          <h2 className="font-medium text-stone-700 text-sm uppercase tracking-wide">Données cliniques</h2>
          <TagInput
            label="Pathologies / Motifs"
            values={form.pathologies}
            onChange={(v) => set('pathologies', v)}
            placeholder="Ex: lombalgie, insomnie…"
          />
          <TagInput
            label="Patterns MTC / IEATC"
            values={form.patternsMTC}
            onChange={(v) => set('patternsMTC', v)}
            placeholder="Ex: Vide de Yang du Rein, Plénitude de Foie…"
          />
          <div>
            <label className="block text-sm font-medium text-stone-700 mb-1">Constitution énergétique</label>
            <textarea
              value={form.constitution}
              onChange={(e) => set('constitution', e.target.value)}
              rows={3}
              className="w-full border border-stone-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 resize-none"
              placeholder="Description de la constitution selon l'approche IEATC…"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-stone-700 mb-1">Interrogatoire &amp; Anamnèse</label>
            <p className="text-xs text-stone-400 mb-1">Histoire personnelle, antécédents, traitements, systèmes (digestif, sommeil, cardio…)</p>
            <textarea
              value={form.anamnese}
              onChange={(e) => set('anamnese', e.target.value)}
              rows={10}
              className="w-full border border-stone-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 resize-none font-mono text-xs leading-relaxed"
              placeholder="Motif de consultation :&#10;Symptôme :&#10;Histoire personnelle :&#10;Antécédents :&#10;Traitements en cours :&#10;Sommeil :&#10;Système digestif :&#10;…"
            />
          </div>
        </section>

        {/* Actions */}
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => navigate(`/patients/${id}`)}
            className="px-4 py-2 border border-stone-300 text-stone-700 text-sm rounded-lg hover:bg-stone-50 transition-colors"
          >
            Annuler
          </button>
          <button
            type="submit"
            disabled={saving}
            className="flex-1 bg-teal-600 hover:bg-teal-700 disabled:bg-teal-300 text-white font-medium py-2 rounded-lg text-sm transition-colors"
          >
            {saving ? 'Enregistrement…' : 'Enregistrer les modifications'}
          </button>
        </div>
      </form>
    </div>
  )
}
