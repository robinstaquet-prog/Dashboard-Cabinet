import { useMemo } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  LineChart, Line, CartesianGrid, Cell,
} from 'recharts'
import { useAppStore } from '../store/AppContext'
import { topPoints, symptomFrequency, improvementOverTime, statsByPathology, computeKPIs, improvementBySymptom } from '../stats/computations'

function KPICard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-white rounded-xl border border-stone-200 p-5">
      <div className="text-xs font-medium text-stone-500 uppercase tracking-wide mb-1">{label}</div>
      <div className="text-2xl font-semibold text-stone-800">{value}</div>
      {sub && <div className="text-xs text-stone-400 mt-0.5">{sub}</div>}
    </div>
  )
}

export default function StatisticsPage() {
  const { data } = useAppStore()

  const kpis = useMemo(() => computeKPIs(data), [data])
  const points = useMemo(() => topPoints(data, 10), [data])
  const symptoms = useMemo(() => symptomFrequency(data), [data])
  const improvement = useMemo(() => improvementOverTime(data), [data])
  const byPathology = useMemo(() => statsByPathology(data), [data])
  const bySymptomImprovement = useMemo(() => improvementBySymptom(data), [data])

  if (data.patients.length === 0) {
    return (
      <div className="p-6">
        <h1 className="text-xl font-semibold text-stone-800 mb-4">Statistiques du cabinet</h1>
        <div className="bg-white rounded-xl border border-stone-200 py-16 text-center text-stone-400 text-sm">
          Aucune donnée disponible. Créez des dossiers patients pour voir les statistiques.
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-xl font-semibold text-stone-800">Statistiques du cabinet</h1>

      {/* KPIs */}
      <div className="grid grid-cols-4 gap-4">
        <KPICard label="Patients" value={kpis.totalPatients} />
        <KPICard label="Séances totales" value={kpis.totalSessions} />
        <KPICard
          label="Séances / patient"
          value={kpis.avgSessionsPerPatient.toFixed(1)}
        />
        <KPICard
          label="Amélioration moy."
          value={kpis.avgAmelioration !== null ? `${kpis.avgAmelioration.toFixed(1)}/10` : '—'}
        />
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* Top points */}
        {points.length > 0 && (
          <div className="bg-white rounded-xl border border-stone-200 p-5">
            <h2 className="font-medium text-stone-700 text-sm mb-4">Points les plus utilisés</h2>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={points} layout="vertical" margin={{ left: 10, right: 20 }}>
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis dataKey="code" type="category" tick={{ fontSize: 11 }} width={45} />
                <Tooltip
                  formatter={(v) => [`${v} utilisations`, 'Fréquence']}
                  labelFormatter={(label) => {
                    const p = points.find((x) => x.code === String(label))
                    return p ? `${p.code} — ${p.nom}` : String(label)
                  }}
                />
                <Bar dataKey="count" fill="#0d9488" radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Symptom frequency */}
        {symptoms.length > 0 && (
          <div className="bg-white rounded-xl border border-stone-200 p-5">
            <h2 className="font-medium text-stone-700 text-sm mb-4">Pathologies les plus fréquentes</h2>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={symptoms} layout="vertical" margin={{ left: 10, right: 20 }}>
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis dataKey="symptom" type="category" tick={{ fontSize: 11 }} width={80} />
                <Tooltip formatter={(v) => [`${v} patients`, 'Fréquence']} />
                <Bar dataKey="count" fill="#7c3aed" radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Improvement over time */}
      {improvement.length > 1 && (
        <div className="bg-white rounded-xl border border-stone-200 p-5">
          <h2 className="font-medium text-stone-700 text-sm mb-4">Amélioration dans le temps</h2>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={improvement}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f0ee" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis domain={[0, 10]} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v) => [`${v}/10`, 'Amélioration']} />
              <Line
                type="monotone"
                dataKey="value"
                stroke="#0d9488"
                strokeWidth={2}
                dot={{ r: 3 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Amélioration par symptôme */}
      {bySymptomImprovement.length > 0 && (
        <div className="bg-white rounded-xl border border-stone-200 p-5">
          <h2 className="font-medium text-stone-700 text-sm mb-4">Amélioration moyenne par symptôme</h2>
          <ResponsiveContainer width="100%" height={Math.max(160, bySymptomImprovement.length * 32)}>
            <BarChart data={bySymptomImprovement} layout="vertical" margin={{ left: 10, right: 40 }}>
              <XAxis type="number" domain={[0, 10]} tick={{ fontSize: 11 }} />
              <YAxis dataKey="symptom" type="category" tick={{ fontSize: 11 }} width={100} />
              <Tooltip formatter={(v, _n, props) => [`${v}/10 (${props.payload?.count} patient${props.payload?.count > 1 ? 's' : ''})`, 'Amélioration moy.']} />
              <Bar dataKey="avgAmelioration" radius={[0, 3, 3, 0]}>
                {bySymptomImprovement.map((entry) => (
                  <Cell
                    key={entry.symptom}
                    fill={entry.avgAmelioration >= 7 ? '#059669' : entry.avgAmelioration >= 4 ? '#d97706' : '#dc2626'}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <p className="text-xs text-stone-400 mt-2">Vert ≥ 7 · Orange ≥ 4 · Rouge &lt; 4</p>
        </div>
      )}

      {/* By pathology table */}
      {byPathology.length > 0 && (
        <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-stone-100">
            <h2 className="font-medium text-stone-700 text-sm">Détail par pathologie</h2>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-stone-100">
                <th className="text-left px-5 py-3 text-xs font-medium text-stone-500 uppercase tracking-wide">Pathologie</th>
                <th className="text-right px-5 py-3 text-xs font-medium text-stone-500 uppercase tracking-wide">Patients</th>
                <th className="text-right px-5 py-3 text-xs font-medium text-stone-500 uppercase tracking-wide">Séances moy.</th>
                <th className="text-right px-5 py-3 text-xs font-medium text-stone-500 uppercase tracking-wide">Amélioration moy.</th>
              </tr>
            </thead>
            <tbody>
              {byPathology.map((row) => (
                <tr key={row.pathologie} className="border-b border-stone-50 hover:bg-stone-50">
                  <td className="px-5 py-3 text-stone-800">{row.pathologie}</td>
                  <td className="px-5 py-3 text-right text-stone-600">{row.patientCount}</td>
                  <td className="px-5 py-3 text-right text-stone-600">{row.avgSessions.toFixed(1)}</td>
                  <td className="px-5 py-3 text-right text-stone-600">
                    {row.avgAmelioration !== null ? `${row.avgAmelioration.toFixed(1)}/10` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
