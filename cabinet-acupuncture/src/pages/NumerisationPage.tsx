import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { pipelineClient } from '../api/pipelineClient'
import type {
  HealthResponse,
  ScanResponse,
  RunResponse,
  ArchiveStatusResponse,
  CleanupResponse,
  PipelinePatient,
} from '../api/pipelineClient'
import { useAppStore } from '../store/AppContext'

// ── Petits composants utilitaires ─────────────────────────────────────────

function StatusDot({ online }: { online: boolean | null }) {
  if (online === null)
    return <span className="w-2 h-2 rounded-full bg-stone-300 inline-block" />
  return (
    <span
      className={`w-2 h-2 rounded-full inline-block ${online ? 'bg-emerald-500' : 'bg-red-400'}`}
    />
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-white rounded-xl border border-stone-200 overflow-hidden">
      <div className="px-5 py-3 border-b border-stone-100 bg-stone-50">
        <h2 className="text-sm font-semibold text-stone-700">{title}</h2>
      </div>
      <div className="p-5">{children}</div>
    </section>
  )
}

function Spinner() {
  return (
    <svg
      className="animate-spin h-4 w-4 text-teal-600 inline-block"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8v8H4z"
      />
    </svg>
  )
}

// ── Page principale ────────────────────────────────────────────────────────

export default function NumerisationPage() {
  const { data, importPipelinePatient, deduplicatePatients } = useAppStore()
  const navigate = useNavigate()

  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [serverOnline, setServerOnline] = useState<boolean | null>(null)
  const [healthError, setHealthError] = useState('')

  const [scan, setScan] = useState<ScanResponse | null>(null)
  const [scanLoading, setScanLoading] = useState(false)
  const [scanError, setScanError] = useState('')

  const [runLoading, setRunLoading] = useState(false)
  const [runResult, setRunResult] = useState<RunResponse | null>(null)
  const [runError, setRunError] = useState('')

  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)  // prenom_nom en attente
  const [deleteLoading, setDeleteLoading] = useState<string | null>(null)  // prenom_nom en cours

  const [archive, setArchive] = useState<ArchiveStatusResponse | null>(null)
  const [archiveLoading, setArchiveLoading] = useState(false)

  const [cleanupResult, setCleanupResult] = useState<CleanupResponse | null>(null)
  const [cleanupLoading, setCleanupLoading] = useState(false)
  const [cleanupError, setCleanupError] = useState('')

  const [pipelinePatients, setPipelinePatients] = useState<PipelinePatient[]>([])
  const [importingCode, setImportingCode] = useState<string | null>(null)
  const [importError, setImportError] = useState('')

  // — Vérification serveur au montage ——————————————————————————————————————
  const checkHealth = useCallback(async () => {
    setHealthError('')
    try {
      const h = await pipelineClient.health()
      setHealth(h)
      setServerOnline(true)
    } catch (e) {
      setServerOnline(false)
      setHealthError((e as Error).message)
    }
  }, [])

  useEffect(() => { checkHealth() }, [checkHealth])

  // — Scan ——————————————————————————————————————————————————————————————————
  const doScan = useCallback(async () => {
    setScanError('')
    setScanLoading(true)
    setRunResult(null)
    try {
      setScan(await pipelineClient.scan())
    } catch (e) {
      setScanError((e as Error).message)
    } finally {
      setScanLoading(false)
    }
  }, [])

  // — Suppression d'un batch ———————————————————————————————————————————————
  const doDeleteBatch = useCallback(async (prenomNom: string) => {
    setConfirmDelete(null)
    setDeleteLoading(prenomNom)
    try {
      await pipelineClient.deleteBatch(prenomNom)
      await doScan()
    } catch (e) {
      setScanError((e as Error).message)
    } finally {
      setDeleteLoading(null)
    }
  }, [doScan])

  // — Archive ———————————————————————————————————————————————————————————————
  const loadArchive = useCallback(async () => {
    setArchiveLoading(true)
    try {
      setArchive(await pipelineClient.archiveStatus())
    } catch {
      // silencieux si le serveur est offline
    } finally {
      setArchiveLoading(false)
    }
  }, [])

  const loadPipelinePatients = useCallback(async () => {
    try {
      setPipelinePatients(await pipelineClient.listPatients())
    } catch {
      // silencieux si offline
    }
  }, [])

  useEffect(() => { if (serverOnline) { doScan(); loadArchive(); loadPipelinePatients() } }, [serverOnline]) // eslint-disable-line react-hooks/exhaustive-deps

  const doImport = useCallback(async (code: string) => {
    setImportError('')
    setImportingCode(code)
    try {
      const json = await pipelineClient.getPatientJson(code)
      const patientId = await importPipelinePatient(json, code)
      navigate(`/patients/${patientId}`)
    } catch (e) {
      setImportError((e as Error).message)
      setImportingCode(null)
    }
  }, [importPipelinePatient, navigate])

  // — Run + auto-import (défini après loadArchive et loadPipelinePatients) ——
  const doRun = useCallback(async () => {
    setRunError('')
    setRunLoading(true)
    setRunResult(null)
    try {
      const result = await pipelineClient.run()
      setRunResult(result)
      setScan(null)
      loadArchive()

      for (const batch of result.processed) {
        if (!batch.code) continue
        try {
          const json = await pipelineClient.getPatientJson(batch.code)
          await importPipelinePatient(json, batch.code)
        } catch {
          // import silencieux
        }
      }
      // Fusionne les doublons créés par les envois multiples du même patient
      await deduplicatePatients()
      loadPipelinePatients()
    } catch (e) {
      setRunError((e as Error).message)
    } finally {
      setRunLoading(false)
    }
  }, [importPipelinePatient, loadArchive, loadPipelinePatients])

  const doCleanup = useCallback(async () => {
    setCleanupError('')
    setCleanupLoading(true)
    setCleanupResult(null)
    try {
      const r = await pipelineClient.archiveCleanup()
      setCleanupResult(r)
      await loadArchive()
    } catch (e) {
      setCleanupError((e as Error).message)
    } finally {
      setCleanupLoading(false)
    }
  }, [loadArchive])

  // ── Rendu ────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 space-y-5 max-w-3xl">

      {/* ── En-tête ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-stone-800">Numérisation</h1>
          <p className="text-xs text-stone-400 mt-0.5">
            Photos de fiches reçues via Tailscale → extraction OCR → dossiers chiffrés
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-stone-500">
          <StatusDot online={serverOnline} />
          {serverOnline === null && 'Vérification…'}
          {serverOnline === true && 'Pipeline connecté'}
          {serverOnline === false && 'Pipeline hors ligne'}
          <button
            onClick={checkHealth}
            className="ml-1 text-teal-600 hover:underline"
          >
            Relancer
          </button>
        </div>
      </div>

      {/* ── Alerte serveur offline ── */}
      {serverOnline === false && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
          <p className="font-medium">Serveur pipeline injoignable</p>
          <p className="mt-1 text-xs font-mono">{healthError}</p>
          <p className="mt-2 text-xs text-red-600">
            Démarrer le serveur :{' '}
            <code className="bg-red-100 px-1 rounded">
              cd pipeline &amp;&amp; uvicorn backend.main:app --host 127.0.0.1 --port 8000
            </code>
          </p>
        </div>
      )}

      {/* ── Config active ── */}
      {health && (
        <div className="flex gap-4 text-xs text-stone-500 bg-stone-50 border border-stone-200 rounded-lg px-4 py-2.5">
          <span>
            <span className="text-stone-400">Téléchargements :</span>{' '}
            <span className="font-mono text-stone-600">{health.downloads_folder}</span>
          </span>
          <span>
            <span className="text-stone-400">Rétention :</span>{' '}
            <span className="font-semibold text-stone-600">
              {health.archive_retention_days === 0
                ? 'suppression immédiate'
                : `${health.archive_retention_days} jours`}
            </span>
          </span>
        </div>
      )}

      {/* ── Section Scan ── */}
      <Section title="Fiches détectées">
        <div className="space-y-4">

          {/* Boutons */}
          <div className="flex gap-2">
            <button
              onClick={doScan}
              disabled={!serverOnline || scanLoading}
              className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border border-stone-300 text-stone-700 hover:bg-stone-50 disabled:opacity-40 transition-colors"
            >
              {scanLoading ? <Spinner /> : <span>↺</span>}
              Rafraîchir
            </button>
            <button
              onClick={doRun}
              disabled={!serverOnline || runLoading || !scan || scan.batches.length === 0}
              className="flex items-center gap-1.5 text-sm px-4 py-1.5 rounded-lg bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-40 transition-colors font-medium"
            >
              {runLoading ? <Spinner /> : null}
              {runLoading ? 'Traitement en cours…' : 'Traiter les fiches'}
            </button>
          </div>

          {/* Erreur scan */}
          {scanError && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
              {scanError}
            </p>
          )}

          {/* Résultats scan */}
          {scan && (
            <>
              {scan.batches.length === 0 ? (
                <p className="text-sm text-stone-400 py-4 text-center">
                  Aucune fiche détectée dans Téléchargements.
                </p>
              ) : (
                <div className="space-y-2">
                  {scan.batches.map((b) => (
                    <div
                      key={b.prenom_nom}
                      className="flex items-center justify-between px-4 py-3 bg-teal-50 border border-teal-100 rounded-lg"
                    >
                      <div>
                        <span className="font-medium text-sm text-stone-800">{b.prenom_nom}</span>
                        <div className="text-xs text-stone-500 mt-0.5">
                          {b.files.join(' · ')}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-teal-700 bg-teal-100 px-2 py-0.5 rounded-full">
                          {b.pages} page{b.pages > 1 ? 's' : ''}
                        </span>
                        {deleteLoading === b.prenom_nom ? (
                          <Spinner />
                        ) : confirmDelete === b.prenom_nom ? (
                          <span className="flex items-center gap-1.5 text-xs">
                            <span className="text-stone-500">Supprimer ?</span>
                            <button
                              onClick={() => doDeleteBatch(b.prenom_nom)}
                              className="px-2 py-0.5 rounded bg-red-500 text-white hover:bg-red-600 font-medium transition-colors"
                            >
                              Oui
                            </button>
                            <button
                              onClick={() => setConfirmDelete(null)}
                              className="px-2 py-0.5 rounded border border-stone-300 text-stone-600 hover:bg-stone-100 transition-colors"
                            >
                              Non
                            </button>
                          </span>
                        ) : (
                          <button
                            onClick={() => setConfirmDelete(b.prenom_nom)}
                            title="Supprimer ces photos"
                            className="text-stone-300 hover:text-red-400 transition-colors text-base leading-none"
                          >
                            ×
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Estimation coût API */}
              {(() => {
                const totalPages = scan.batches.reduce((s, b) => s + b.pages, 0)
                const nbBatches  = scan.batches.length
                // Claude Opus 4.6 : ~$0.13 fixe/patient (prompt+output JSON) + ~$0.024/page (image input)
                const estimCHF   = (nbBatches * 0.13 + totalPages * 0.024).toFixed(2)
                return (
                  <div className="flex items-center gap-2 mt-1 px-3 py-2 bg-stone-50 border border-stone-200 rounded-lg text-xs text-stone-500">
                    <span className="text-stone-400">Coût API estimé</span>
                    <span className="font-semibold text-stone-700">~ CHF {estimCHF}</span>
                    <span className="text-stone-300">·</span>
                    <span>{totalPages} page{totalPages > 1 ? 's' : ''} · {nbBatches} patient{nbBatches > 1 ? 's' : ''}</span>
                    <span className="text-stone-300">·</span>
                    <span className="font-mono text-stone-400">Claude Opus 4.6</span>
                  </div>
                )
              })()}

              {/* Avertissements */}
              {(scan.too_recent.length > 0 || scan.too_old.length > 0) && (
                <div className="space-y-1.5 mt-1">
                  {scan.too_recent.length > 0 && (
                    <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-3 py-1.5">
                      <strong>{scan.too_recent.length} photo(s)</strong> trop récentes (transfert en cours ?) :{' '}
                      {scan.too_recent.join(', ')}
                    </p>
                  )}
                  {scan.too_old.length > 0 && (
                    <p className="text-xs text-orange-600 bg-orange-50 border border-orange-200 rounded px-3 py-1.5">
                      <strong>{scan.too_old.length} photo(s)</strong> trop anciennes (ignorées) :{' '}
                      {scan.too_old.join(', ')}
                    </p>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </Section>

      {/* ── Résultats traitement ── */}
      {(runResult || runError) && (
        <Section title="Résultat du traitement">
          {runError && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
              {runError}
            </p>
          )}
          {runResult && (
            <div className="space-y-3">
              {runResult.processed.length === 0 && runResult.errors.length === 0 && (
                <p className="text-sm text-stone-400">Aucune fiche traitée.</p>
              )}

              {/* Succès */}
              {runResult.processed.map((b) => (
                <div
                  key={b.code}
                  className="flex items-center justify-between px-4 py-3 bg-emerald-50 border border-emerald-100 rounded-lg"
                >
                  <div>
                    <span className="font-medium text-sm text-stone-800">{b.prenom_nom}</span>
                    <div className="text-xs text-stone-500 mt-0.5">
                      Code {b.code}
                      {b.code_created && (
                        <span className="ml-1.5 bg-teal-100 text-teal-700 px-1.5 py-0.5 rounded-full">
                          nouveau
                        </span>
                      )}
                      {b.photos_deleted > 0 && (
                        <span className="ml-1.5 text-stone-400">
                          · {b.photos_deleted} photo(s) supprimée(s) (nLPD)
                        </span>
                      )}
                      {b.photos_archived > 0 && (
                        <span className="ml-1.5 text-stone-400">
                          · {b.photos_archived} photo(s) archivée(s)
                        </span>
                      )}
                    </div>
                  </div>
                  <span className="text-emerald-600 text-lg">✓</span>
                </div>
              ))}

              {/* Erreurs */}
              {runResult.errors.map((e) => (
                <div
                  key={e.prenom_nom}
                  className="px-4 py-3 bg-red-50 border border-red-200 rounded-lg"
                >
                  <span className="font-medium text-sm text-red-700">{e.prenom_nom}</span>
                  <p className="text-xs text-red-500 mt-0.5">{e.error}</p>
                </div>
              ))}
            </div>
          )}
        </Section>
      )}

      {/* ── Fiches traitées ── */}
      {pipelinePatients.length > 0 && (
        <Section title="Fiches traitées">
          <div className="space-y-2">
            {importError && (
              <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
                {importError}
              </p>
            )}
            {pipelinePatients.map((p) => {
              const alreadyImported = data.patients.some(
                (dp) => `${dp.prenom} ${dp.nom}`.toLowerCase() === p.prenom_nom.toLowerCase()
              )
              return (
                <div
                  key={p.code}
                  className="flex items-center justify-between px-4 py-3 bg-white border border-stone-200 rounded-lg"
                >
                  <div>
                    <span className="font-medium text-sm text-stone-800">{p.prenom_nom}</span>
                    <div className="text-xs text-stone-400 mt-0.5">
                      {p.code}
                      {p.date_naissance && ` · ${p.date_naissance}`}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {alreadyImported ? (
                      <span className="text-xs text-emerald-600 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                        Importé
                      </span>
                    ) : p.has_json ? (
                      <button
                        onClick={() => doImport(p.code)}
                        disabled={importingCode === p.code}
                        className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-40 transition-colors font-medium"
                      >
                        {importingCode === p.code ? <Spinner /> : null}
                        Importer dans les dossiers
                      </button>
                    ) : (
                      <span className="text-xs text-stone-400">Pas de JSON (ancienne version)</span>
                    )}
                    {p.has_docx && (
                      <div className="flex gap-1">
                        <a
                          href={pipelineClient.getPatientOdtUrl(p.code)}
                          download
                          className="text-xs px-2.5 py-1.5 rounded-lg border border-teal-300 text-teal-700 hover:bg-teal-50 transition-colors font-medium"
                          title="Télécharger au format LibreOffice"
                        >
                          ↓ ODT
                        </a>
                        <a
                          href={pipelineClient.getPatientDocxUrl(p.code)}
                          download
                          className="text-xs px-2.5 py-1.5 rounded-lg border border-stone-300 text-stone-600 hover:bg-stone-50 transition-colors"
                          title="Télécharger au format Word"
                        >
                          ↓ DOCX
                        </a>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </Section>
      )}

      {/* ── Archives nLPD ── */}
      <Section title="Archives nLPD">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-stone-500">
              {archiveLoading ? (
                <span className="flex items-center gap-1"><Spinner /> Chargement…</span>
              ) : archive ? (
                archive.total_files === 0 ? (
                  'Aucune photo archivée.'
                ) : (
                  <>
                    <strong className="text-stone-700">{archive.total_files}</strong> photo(s) —
                    suppression automatique après{' '}
                    <strong className="text-stone-700">{archive.retention_days} jours</strong>
                  </>
                )
              ) : (
                'Non chargé'
              )}
            </p>
            <div className="flex gap-2">
              <button
                onClick={loadArchive}
                disabled={!serverOnline || archiveLoading}
                className="text-xs px-2.5 py-1 rounded border border-stone-300 text-stone-600 hover:bg-stone-50 disabled:opacity-40 transition-colors"
              >
                Rafraîchir
              </button>
              <button
                onClick={doCleanup}
                disabled={!serverOnline || cleanupLoading || !archive || archive.total_files === 0}
                className="text-xs px-2.5 py-1 rounded border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-40 transition-colors"
              >
                {cleanupLoading ? <Spinner /> : 'Purger maintenant'}
              </button>
            </div>
          </div>

          {cleanupError && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-1.5">
              {cleanupError}
            </p>
          )}

          {cleanupResult && cleanupResult.deleted_count > 0 && (
            <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-3 py-1.5">
              {cleanupResult.deleted_count} photo(s) supprimée(s) de manière sécurisée.
            </p>
          )}

          {/* Liste des archives */}
          {archive && archive.files.length > 0 && (
            <div className="divide-y divide-stone-100 border border-stone-100 rounded-lg overflow-hidden">
              {archive.files.map((f) => (
                <div
                  key={f.name}
                  className="flex items-center justify-between px-3 py-2 text-xs"
                >
                  <span className="text-stone-700 font-mono">{f.name}</span>
                  <span
                    className={`px-2 py-0.5 rounded-full font-medium ${
                      f.age_days >= archive.retention_days
                        ? 'bg-red-100 text-red-600'
                        : f.age_days >= archive.retention_days * 0.7
                        ? 'bg-amber-100 text-amber-600'
                        : 'bg-stone-100 text-stone-500'
                    }`}
                  >
                    {f.age_days}j
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </Section>

    </div>
  )
}
