import type { Patient, Session } from '../data/schema'

// Session-scoped map — never persisted to disk, reset on lock/unlock
const pseudoMap = new Map<string, string>()
let counter = 0

export function resetPseudoMap() {
  pseudoMap.clear()
  counter = 0
}

function idFromCounter(n: number): string {
  const letter = String.fromCharCode(65 + Math.floor(n / 100)) // A, B, C…
  const digits = String(n % 100).padStart(2, '0')
  return `${letter}${digits}`
}

export function getPseudoId(patientId: string): string {
  if (!pseudoMap.has(patientId)) {
    pseudoMap.set(patientId, idFromCounter(counter++))
  }
  return pseudoMap.get(patientId)!
}

export interface PseudoSession {
  numero: number
  remarques: string
  poulsLangue: string
  strategie: string
  pointsNeedled: string[]    // codes uniquement, ex: ["36 E", "3 F"]
  amelioration: number | null
}

export interface PseudoPatient {
  pseudoId: string           // ex: "A00"
  sexe: string               // "Femme" | "Homme" | "Autre"
  trancheAge: string         // ex: "50-55 ans"
  pathologies: string[]
  patternsIEATC: string[]
  constitution: string
  sessions: PseudoSession[]
}

function ageFromDOB(dob: string): number {
  const birth = new Date(dob)
  const now = new Date()
  let age = now.getFullYear() - birth.getFullYear()
  const monthDiff = now.getMonth() - birth.getMonth()
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birth.getDate())) age--
  return age
}

function trancheAge(age: number): string {
  const low = Math.floor(age / 5) * 5
  return `${low}-${low + 4} ans`
}

function sexeLabel(sexe: Patient['sexe']): string {
  if (sexe === 'F') return 'Femme'
  if (sexe === 'M') return 'Homme'
  return 'Autre'
}

export function pseudonymize(patient: Patient, sessions?: Session[]): PseudoPatient {
  const sid = getPseudoId(patient.id)
  const age = ageFromDOB(patient.dateNaissance)
  const src = sessions ?? patient.sessions

  const pseudoSessions: PseudoSession[] = src.map((s, i) => ({
    numero: i + 1,
    remarques: s.remarques,
    poulsLangue: s.poulsLangue,
    strategie: s.strategie,
    pointsNeedled: s.pointsNeedled.map((p) => p.code),
    amelioration: s.amelioration,
  }))

  return {
    pseudoId: sid,
    sexe: sexeLabel(patient.sexe),
    trancheAge: trancheAge(age),
    pathologies: patient.pathologies,
    patternsIEATC: patient.patternsMTC,
    constitution: patient.constitution,
    sessions: pseudoSessions,
  }
}
