import React, { createContext, useContext, useReducer, useCallback } from 'react'
import { v4 as uuidv4 } from 'uuid'
import type { AppData, Patient, Session, AnamnesisNote } from '../data/schema'
import type { PipelinePatientData } from '../api/pipelineClient'
import { pipelineClient } from '../api/pipelineClient'
import { persistStore } from './persistence'

// ── Types ─────────────────────────────────────────────────────────────────────

interface AppContextValue {
  data: AppData
  cryptoKey: CryptoKey
  addPatient: (patient: Omit<Patient, 'id' | 'createdAt' | 'updatedAt' | 'sessions'>) => Promise<void>
  updatePatient: (id: string, patch: Partial<Patient>) => Promise<void>
  deletePatient: (id: string) => Promise<void>
  addSession: (patientId: string, session: Omit<Session, 'id'>) => Promise<void>
  updateSession: (patientId: string, sessionId: string, patch: Partial<Session>) => Promise<void>
  addAnamnesisNote: (patientId: string, note: Omit<AnamnesisNote, 'id'>) => Promise<number>
  deduplicatePatients: () => Promise<number>
  importPipelinePatient: (json: PipelinePatientData, code?: string) => Promise<string>
  lock: () => void
}

// ── Context ───────────────────────────────────────────────────────────────────

const AppContext = createContext<AppContextValue | null>(null)

export function useAppStore(): AppContextValue {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useAppStore must be used inside AppProvider')
  return ctx
}

// ── Reducer ───────────────────────────────────────────────────────────────────

type Action =
  | { type: 'ADD_PATIENT'; patient: Patient }
  | { type: 'UPDATE_PATIENT'; id: string; patch: Partial<Patient> }
  | { type: 'DELETE_PATIENT'; id: string }
  | { type: 'DELETE_MANY'; ids: string[] }
  | { type: 'ADD_SESSION'; patientId: string; session: Session }
  | { type: 'UPDATE_SESSION'; patientId: string; sessionId: string; patch: Partial<Session> }
  | { type: 'ADD_ANAMNESIS_NOTE'; patientId: string; note: AnamnesisNote }

function reducer(state: AppData, action: Action): AppData {
  switch (action.type) {
    case 'ADD_PATIENT':
      return { ...state, patients: [...state.patients, action.patient] }

    case 'UPDATE_PATIENT':
      return {
        ...state,
        patients: state.patients.map((p) =>
          p.id === action.id ? { ...p, ...action.patch, updatedAt: new Date().toISOString() } : p,
        ),
      }

    case 'DELETE_PATIENT':
      return { ...state, patients: state.patients.filter((p) => p.id !== action.id) }

    case 'DELETE_MANY':
      return { ...state, patients: state.patients.filter((p) => !action.ids.includes(p.id)) }

    case 'ADD_SESSION':
      return {
        ...state,
        patients: state.patients.map((p) =>
          p.id === action.patientId
            ? { ...p, sessions: [...p.sessions, action.session], updatedAt: new Date().toISOString() }
            : p,
        ),
      }

    case 'UPDATE_SESSION':
      return {
        ...state,
        patients: state.patients.map((p) =>
          p.id === action.patientId
            ? {
                ...p,
                updatedAt: new Date().toISOString(),
                sessions: p.sessions.map((s) =>
                  s.id === action.sessionId ? { ...s, ...action.patch } : s,
                ),
              }
            : p,
        ),
      }

    case 'ADD_ANAMNESIS_NOTE':
      return {
        ...state,
        patients: state.patients.map((p) =>
          p.id === action.patientId
            ? {
                ...p,
                updatedAt: new Date().toISOString(),
                notesAnamnese: [...(p.notesAnamnese ?? []), action.note],
              }
            : p,
        ),
      }

    default:
      return state
  }
}

// ── Provider ──────────────────────────────────────────────────────────────────

interface AppProviderProps {
  children: React.ReactNode
  initialData: AppData
  cryptoKey: CryptoKey
  onLock: () => void
}

export function AppProvider({ children, initialData, cryptoKey, onLock }: AppProviderProps) {
  const [data, dispatch] = useReducer(reducer, initialData)

  const persist = useCallback(
    async (nextData: AppData) => {
      await persistStore(nextData, cryptoKey)
    },
    [cryptoKey],
  )

  // Régénère les fiches DOCX/ODT après une modification, sans bloquer l'UI.
  // Silencieux si le pipeline est hors ligne.
  function triggerRegen(nextData: AppData, patientId: string) {
    const p = nextData.patients.find((pt) => pt.id === patientId)
    if (p?.pipelineCode) {
      pipelineClient.regenerateFromDashboard(p.pipelineCode, p).catch(() => {})
    }
  }

  const addPatient = useCallback(
    async (patientData: Omit<Patient, 'id' | 'createdAt' | 'updatedAt' | 'sessions'>) => {
      const now = new Date().toISOString()
      const patient: Patient = { ...patientData, id: uuidv4(), sessions: [], createdAt: now, updatedAt: now }
      dispatch({ type: 'ADD_PATIENT', patient })
      const next = reducer(data, { type: 'ADD_PATIENT', patient })
      await persist(next)
    },
    [data, persist],
  )

  const updatePatient = useCallback(
    async (id: string, patch: Partial<Patient>) => {
      dispatch({ type: 'UPDATE_PATIENT', id, patch })
      const next = reducer(data, { type: 'UPDATE_PATIENT', id, patch })
      await persist(next)
      triggerRegen(next, id)
    },
    [data, persist],
  )

  const deletePatient = useCallback(
    async (id: string) => {
      dispatch({ type: 'DELETE_PATIENT', id })
      const next = reducer(data, { type: 'DELETE_PATIENT', id })
      await persist(next)
    },
    [data, persist],
  )

  const addSession = useCallback(
    async (patientId: string, sessionData: Omit<Session, 'id'>) => {
      const session: Session = { ...sessionData, id: uuidv4() }
      dispatch({ type: 'ADD_SESSION', patientId, session })
      const next = reducer(data, { type: 'ADD_SESSION', patientId, session })
      await persist(next)
      triggerRegen(next, patientId)
    },
    [data, persist],
  )

  const updateSession = useCallback(
    async (patientId: string, sessionId: string, patch: Partial<Session>) => {
      dispatch({ type: 'UPDATE_SESSION', patientId, sessionId, patch })
      const next = reducer(data, { type: 'UPDATE_SESSION', patientId, sessionId, patch })
      await persist(next)
      triggerRegen(next, patientId)
    },
    [data, persist],
  )

  const addAnamnesisNote = useCallback(
    async (patientId: string, noteData: Omit<AnamnesisNote, 'id'>): Promise<number> => {
      const note: AnamnesisNote = { ...noteData, id: uuidv4() }
      dispatch({ type: 'ADD_ANAMNESIS_NOTE', patientId, note })
      const next = reducer(data, { type: 'ADD_ANAMNESIS_NOTE', patientId, note })
      await persist(next)
      triggerRegen(next, patientId)
      return 1
    },
    [data, persist],
  )

  // Fusionne les patients ayant le même nom (garde celui avec le plus de séances)
  const deduplicatePatients = useCallback(async (): Promise<number> => {
    const groups = new Map<string, Patient[]>()
    for (const p of data.patients) {
      // normalise: "Bernard Hofmann_10" → "bernard hofmann"
      const key = `${p.prenom} ${p.nom}`.toLowerCase().replace(/_\d+$/, '').trim()
      groups.set(key, [...(groups.get(key) ?? []), p])
    }
    const toDelete: string[] = []
    for (const group of groups.values()) {
      if (group.length <= 1) continue
      // garde celui avec le plus de séances (ou le plus ancien)
      const sorted = [...group].sort((a, b) => b.sessions.length - a.sessions.length || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
      toDelete.push(...sorted.slice(1).map((p) => p.id))
    }
    if (toDelete.length === 0) return 0
    dispatch({ type: 'DELETE_MANY', ids: toDelete })
    const next = reducer(data, { type: 'DELETE_MANY', ids: toDelete })
    await persist(next)
    return toDelete.length
  }, [data, persist])

  const importPipelinePatient = useCallback(
    async (json: PipelinePatientData, code?: string): Promise<string> => {
      const now = new Date().toISOString()
      const identite = json.identite ?? {} as NonNullable<PipelinePatientData['identite']>

      // Nettoie le nom : retire le suffixe _10 / _2 etc. éventuel (artefact Tailscale)
      const rawName = (identite.prenom_nom ?? '').trim()
      const fullName = rawName.replace(/_\d+$/, '').trim()

      // mapping séance pipeline → Session dashboard
      const mapSession = (s: any): Omit<Session, 'id'> => ({
        date: s.date ? (() => { try { return new Date(s.date).toISOString() } catch { return now } })() : now,
        remarques: s.bilan_ttt ?? s.remarques ?? '',
        poulsLangue: s.pouls_langue ?? '',
        strategie: s.strategie ?? '',
        pointsNeedled: (s.points_utilises ?? []).map((p: any) =>
          typeof p === 'string'
            ? { code: p, nom: p, technique: null }
            : { code: p.code ?? p, nom: p.code ?? p, technique: p.technique ?? null }
        ),
        aFaireProchaineSéance: s.a_faire_prochaine_seance ?? '',
        amelioration: s.amelioration ?? null,
      })

      const newSessions = (json.seances ?? []).filter((s: any) => s.date || s.remarques || s.bilan_ttt)

      // Construit l'anamnèse complète depuis tous les champs de l'interrogatoire
      const symptomeLines = [
        json.symptome?.manifestation && `Manifestation : ${json.symptome.manifestation}`,
        json.symptome?.depuis && `Depuis : ${json.symptome.depuis}`,
        json.symptome?.aggravation_amelioration && `Aggravation / Amélioration : ${json.symptome.aggravation_amelioration}`,
      ].filter(Boolean) as string[]

      const systemesLines = [
        json.stress_fatigue_psychique && `Stress / Fatigue psychique : ${json.stress_fatigue_psychique}`,
        json.systeme_digestif && `Système digestif : ${json.systeme_digestif}`,
        json.sommeil && `Sommeil : ${json.sommeil}`,
        json.cardio_vasculaire?.observations && `Cardio-vasculaire : ${json.cardio_vasculaire.observations}`,
        json.cardio_vasculaire?.anticoagulants && `Anticoagulants : ${json.cardio_vasculaire.anticoagulants}`,
        json.cycle_menstruel && `Cycle menstruel : ${json.cycle_menstruel}`,
      ].filter(Boolean) as string[]

      const anamneseParts = [
        json.motif_consultation && `Motif de consultation :\n${json.motif_consultation}`,
        symptomeLines.length > 0 && `Symptôme :\n${symptomeLines.join('\n')}`,
        json.histoire_personnelle && `Histoire personnelle :\n${json.histoire_personnelle}`,
        json.antecedents_personnels_familiaux && `Antécédents personnels / familiaux :\n${json.antecedents_personnels_familiaux}`,
        json.traitements_en_cours && `Traitements en cours :\n${json.traitements_en_cours}`,
        systemesLines.length > 0 && `Bilan des systèmes :\n${systemesLines.join('\n')}`,
        json.pouls_langue && `Pouls / Langue (initial) :\n${json.pouls_langue}`,
      ].filter(Boolean) as string[]

      const anamnese = anamneseParts.join('\n\n')

      const pathologies: string[] = []
      if (json.motif_consultation) pathologies.push(json.motif_consultation)
      if (json.symptome?.manifestation) pathologies.push(json.symptome.manifestation)

      // Cherche un patient existant avec ce nom (insensible à la casse, ignore le suffixe _N)
      const existing = data.patients.find((p) => {
        const dashboardName = `${p.prenom} ${p.nom}`.toLowerCase().replace(/_\d+$/, '').trim()
        return dashboardName === fullName.toLowerCase()
      })

      if (existing) {
        let current = data

        // Met à jour le nom si il contenait un suffixe _N
        const currentName = `${existing.prenom} ${existing.nom}`
        if (currentName !== fullName && fullName) {
          const parts = fullName.split(/\s+/)
          const patch = { prenom: parts[0] ?? existing.prenom, nom: parts.slice(1).join(' ') || existing.nom }
          dispatch({ type: 'UPDATE_PATIENT', id: existing.id, patch })
          current = reducer(current, { type: 'UPDATE_PATIENT', id: existing.id, patch })
        }

        // Complète l'anamnèse si elle était vide
        if (!existing.anamnese && anamnese) {
          const patch = { anamnese, pathologies: existing.pathologies.length ? existing.pathologies : pathologies }
          dispatch({ type: 'UPDATE_PATIENT', id: existing.id, patch })
          current = reducer(current, { type: 'UPDATE_PATIENT', id: existing.id, patch })
        }

        // Stocke le code pipeline s'il n'était pas encore enregistré
        if (code && !existing.pipelineCode) {
          dispatch({ type: 'UPDATE_PATIENT', id: existing.id, patch: { pipelineCode: code } })
          current = reducer(current, { type: 'UPDATE_PATIENT', id: existing.id, patch: { pipelineCode: code } })
        }

        // Ajouter seulement les séances nouvelles (par date)
        const existingDates = new Set(existing.sessions.map(s => s.date.split('T')[0]))
        for (const s of newSessions) {
          const sessionDate = s.date ? (() => { try { return new Date(s.date).toISOString().split('T')[0] } catch { return '' } })() : ''
          if (sessionDate && existingDates.has(sessionDate)) continue
          const session: Session = { ...mapSession(s), id: uuidv4() }
          dispatch({ type: 'ADD_SESSION', patientId: existing.id, session })
          current = reducer(current, { type: 'ADD_SESSION', patientId: existing.id, session })
        }
        if (current !== data) await persist(current)
        return existing.id
      }

      const parts = fullName.split(/\s+/)
      const prenom = parts[0] ?? ''
      const nom = parts.slice(1).join(' ')

      const sessions: Session[] = newSessions.map((s: any) => ({ ...mapSession(s), id: uuidv4() }))

      const patient: Patient = {
        id: uuidv4(),
        nom,
        prenom,
        dateNaissance: identite.date_naissance ?? '',
        sexe: 'autre',
        adresse: identite.adresse ?? '',
        telephone: identite.telephone ?? '',
        email: identite.mail ?? '',
        pathologies,
        patternsMTC: [],
        constitution: '',
        anamnese,
        notesAnamnese: [],
        sessions,
        createdAt: now,
        updatedAt: now,
        ...(code ? { pipelineCode: code } : {}),
      }

      dispatch({ type: 'ADD_PATIENT', patient })
      const next = reducer(data, { type: 'ADD_PATIENT', patient })
      await persist(next)
      return patient.id
    },
    [data, persist],
  )

  return (
    <AppContext.Provider
      value={{ data, cryptoKey, addPatient, updatePatient, deletePatient, addSession, updateSession, addAnamnesisNote, deduplicatePatients, importPipelinePatient, lock: onLock }}
    >
      {children}
    </AppContext.Provider>
  )
}
