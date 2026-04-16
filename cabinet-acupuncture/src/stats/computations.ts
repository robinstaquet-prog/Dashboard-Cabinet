import type { AppData, Session } from '../data/schema'

function filterByPeriod(sessions: Session[], from: Date | null, to: Date | null): Session[] {
  return sessions.filter((s) => {
    const d = new Date(s.date)
    if (from && d < from) return false
    if (to && d > to) return false
    return true
  })
}

function allSessions(data: AppData, from: Date | null = null, to: Date | null = null): Session[] {
  return data.patients
    .flatMap((p) => filterByPeriod(p.sessions, from, to))
}

export interface PointCount {
  code: string
  nom: string
  count: number
}

export function topPoints(data: AppData, n = 10, from: Date | null = null, to: Date | null = null): PointCount[] {
  const map = new Map<string, PointCount>()
  for (const s of allSessions(data, from, to)) {
    for (const p of s.pointsNeedled) {
      const existing = map.get(p.code)
      if (existing) existing.count++
      else map.set(p.code, { code: p.code, nom: p.nom, count: 1 })
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count).slice(0, n)
}

export interface SymptomCount {
  symptom: string
  count: number
}

export function symptomFrequency(data: AppData, _from: Date | null = null, _to: Date | null = null): SymptomCount[] {
  const map = new Map<string, number>()
  // Count from pathologies
  for (const p of data.patients) {
    for (const path of p.pathologies) {
      map.set(path, (map.get(path) ?? 0) + 1)
    }
  }
  return [...map.entries()]
    .map(([symptom, count]) => ({ symptom, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 15)
}

export interface ImprovementEntry {
  date: string
  value: number
}

export function improvementOverTime(data: AppData, from: Date | null = null, to: Date | null = null): ImprovementEntry[] {
  return allSessions(data, from, to)
    .filter((s) => s.amelioration !== null)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    .map((s) => ({ date: s.date.split('T')[0], value: s.amelioration! }))
}

export interface PathologyStat {
  pathologie: string
  avgSessions: number
  avgAmelioration: number | null
  patientCount: number
}

export function statsByPathology(data: AppData): PathologyStat[] {
  const map = new Map<string, { sessions: number[]; ameliorations: number[]; patients: Set<string> }>()

  for (const p of data.patients) {
    for (const path of p.pathologies) {
      if (!map.has(path)) map.set(path, { sessions: [], ameliorations: [], patients: new Set() })
      const entry = map.get(path)!
      entry.sessions.push(p.sessions.length)
      entry.patients.add(p.id)
      for (const s of p.sessions) {
        if (s.amelioration !== null) entry.ameliorations.push(s.amelioration)
      }
    }
  }

  return [...map.entries()]
    .map(([pathologie, { sessions, ameliorations, patients }]) => ({
      pathologie,
      patientCount: patients.size,
      avgSessions: sessions.reduce((a, b) => a + b, 0) / sessions.length,
      avgAmelioration:
        ameliorations.length > 0
          ? ameliorations.reduce((a, b) => a + b, 0) / ameliorations.length
          : null,
    }))
    .sort((a, b) => b.patientCount - a.patientCount)
}

export interface SymptomImprovement {
  symptom: string
  avgAmelioration: number
  count: number
}

export function improvementBySymptom(data: AppData): SymptomImprovement[] {
  const map = new Map<string, number[]>()
  for (const p of data.patients) {
    const ameliorations = p.sessions
      .filter((s) => s.amelioration !== null)
      .map((s) => s.amelioration!)
    if (ameliorations.length === 0) continue
    const avg = ameliorations.reduce((a, b) => a + b, 0) / ameliorations.length
    for (const path of p.pathologies) {
      if (!map.has(path)) map.set(path, [])
      map.get(path)!.push(avg)
    }
  }
  return [...map.entries()]
    .map(([symptom, vals]) => ({
      symptom,
      avgAmelioration: Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10,
      count: vals.length,
    }))
    .filter((r) => r.count > 0)
    .sort((a, b) => b.avgAmelioration - a.avgAmelioration)
}

export interface KPIs {
  totalPatients: number
  totalSessions: number
  avgSessionsPerPatient: number
  avgAmelioration: number | null
}

export function computeKPIs(data: AppData): KPIs {
  const allS = allSessions(data)
  const ameliorations = allS.filter((s) => s.amelioration !== null).map((s) => s.amelioration!)
  return {
    totalPatients: data.patients.length,
    totalSessions: allS.length,
    avgSessionsPerPatient:
      data.patients.length > 0 ? allS.length / data.patients.length : 0,
    avgAmelioration: ameliorations.length > 0
      ? ameliorations.reduce((a, b) => a + b, 0) / ameliorations.length
      : null,
  }
}
