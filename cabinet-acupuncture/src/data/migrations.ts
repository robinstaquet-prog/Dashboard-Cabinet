import type { AppData } from './schema'
import { emptyStore, CURRENT_VERSION } from './emptyStore'

export function migrateStore(raw: unknown): AppData {
  if (!raw || typeof raw !== 'object') return { ...emptyStore }
  const data = raw as Record<string, unknown>

  // v0 → v1 : initial structure
  if (!data.version || data.version === 0) {
    data.version = 1
  }

  if ((data.version as number) > CURRENT_VERSION) {
    throw new Error(`Version du fichier (${data.version}) supérieure à la version de l'application (${CURRENT_VERSION}). Mettez à jour l'application.`)
  }

  return data as unknown as AppData
}
