import type { AppData } from './schema'

export const CURRENT_VERSION = 1

export const emptyStore: AppData = {
  version: CURRENT_VERSION,
  patients: [],
  settings: {
    praticienNom: '',
    cabinetNom: 'Cabinet d\'Acupuncture',
  },
}
