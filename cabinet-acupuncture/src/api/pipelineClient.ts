/**
 * Client HTTP pour le pipeline de numérisation (FastAPI localhost:8000).
 * Toutes les fonctions lèvent une Error si le serveur répond en erreur.
 */

// Même origine quand servi par uvicorn (port 8000) → URL relative, pas de CORS.
// Dev Vite (port 5173) → URL absolue, CORS autorisé côté FastAPI.
const BASE = window.location.port === '8000' ? '' : 'http://127.0.0.1:8000'

async function call<T>(path: string, method: 'GET' | 'POST' | 'DELETE' = 'GET', body?: unknown): Promise<T> {
  let res: Response
  const options: RequestInit = { method }
  if (body !== undefined) {
    options.body = JSON.stringify(body)
    options.headers = { 'Content-Type': 'application/json' }
  }
  try {
    res = await fetch(`${BASE}${path}`, options)
  } catch {
    throw new Error('Serveur pipeline injoignable (127.0.0.1:8000). Est-il démarré ?')
  }
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(errBody.detail ?? res.statusText)
  }
  return res.json() as Promise<T>
}

// ── Types ──────────────────────────────────────────────────────────────────

export interface HealthResponse {
  status: string
  downloads_folder: string
  data_dir: string
  archive_retention_days: number
}

export interface BatchInfo {
  prenom_nom: string
  pages: number
  files: string[]
}

export interface ScanResponse {
  batches: BatchInfo[]
  too_recent: string[]
  too_old: string[]
  ignored_count: number
}

export interface BatchResult {
  prenom_nom: string
  code: string
  code_created: boolean
  photos_archived: number
  photos_deleted: number
}

export interface RunResponse {
  processed: BatchResult[]
  errors: Array<{ prenom_nom: string; error: string }>
  scan_summary: {
    batches_detected: number
    too_recent: number
    too_old: number
    ignored: number
  }
}

export interface ArchiveFile {
  name: string
  age_days: number
}

export interface ArchiveStatusResponse {
  total_files: number
  retention_days: number
  files: ArchiveFile[]
}

export interface CleanupResponse {
  deleted_count: number
  deleted_files: string[]
}

// ── API calls ──────────────────────────────────────────────────────────────

export interface DeleteBatchResponse {
  deleted: string[]
}

// ── Types patients pipeline ────────────────────────────────────────────────

export interface PipelinePatient {
  code: string
  prenom_nom: string
  date_naissance: string | null
  has_docx: boolean
  has_json: boolean
}

export interface PipelineSeance {
  numero: number
  date: string | null
  bilan_ttt: string | null           // ancien champ, conservé pour compatibilité
  remarques: string | null
  pouls_langue: string | null
  strategie: string | null
  points_utilises: Array<string | { code: string; technique: string | null }>
  amelioration: number | null
  a_faire_prochaine_seance: string | null
}

export interface PipelinePatientData {
  identite: {
    prenom_nom: string | null
    date_naissance: string | null
    profession: string | null
    telephone: string | null
    mail: string | null
    adresse: string | null
  } | null
  motif_consultation: string | null
  symptome: {
    manifestation: string | null
    depuis: string | null
    aggravation_amelioration: string | null
  } | null
  histoire_personnelle: string | null
  antecedents_personnels_familiaux: string | null
  traitements_en_cours: string | null
  stress_fatigue_psychique: string | null
  systeme_digestif: string | null
  sommeil: string | null
  cardio_vasculaire: { observations: string | null; anticoagulants: string | null } | null
  cycle_menstruel: string | null
  pouls_langue: string | null
  notes_en_cours_de_suivi: string[]
  seances: PipelineSeance[]
}

export const pipelineClient = {
  health: ()                    => call<HealthResponse>('/health'),
  scan: ()                      => call<ScanResponse>('/pipeline/scan'),
  run: ()                       => call<RunResponse>('/pipeline/run', 'POST'),
  deleteBatch: (prenomNom: string) => call<DeleteBatchResponse>(
    `/pipeline/batch?prenom_nom=${encodeURIComponent(prenomNom)}`,
    'DELETE',
  ),
  archiveStatus: ()  => call<ArchiveStatusResponse>('/archive/status'),
  archiveCleanup: () => call<CleanupResponse>('/archive/cleanup', 'POST'),
  listPatients: ()              => call<PipelinePatient[]>('/api/patients'),
  getPatientJson: (code: string) => call<PipelinePatientData>(`/api/patients/${code}/json`),
  getPatientDocxUrl: (code: string) => `${BASE}/api/patients/${code}/docx`,
  getPatientOdtUrl:  (code: string) => `${BASE}/api/patients/${code}/odt`,
  hasOdt: (p: PipelinePatient) => p.has_docx, // même flag — l'ODT est généré en parallèle
  /** Régénère les fiches DOCX/ODT depuis les données du dashboard, sans IA. */
  regenerateFromDashboard: (code: string, patient: object) =>
    call<{ ok: boolean; code: string }>(`/api/patients/${code}/regenerate`, 'POST', { patient }),
  /** Déchiffre la fiche ODT et l'ouvre dans LibreOffice (côté serveur local). */
  openOdt: (code: string) =>
    call<{ ok: boolean }>(`/api/patients/${code}/open-odt`, 'POST'),
}
