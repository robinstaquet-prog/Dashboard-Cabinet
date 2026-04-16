export type PointTechnique = 't' | 'd' | 't ch'

export interface AcupuncturePoint {
  code: string           // ex: "36 E", "6 RP", "3 F"
  nom: string            // nom chinois si connu, sinon = code
  technique: PointTechnique | null
}

export interface AnamnesisNote {
  id: string
  date: string          // ISO 8601
  seanceNum: number
  note: string
}

export interface Session {
  id: string
  date: string                    // ISO 8601
  remarques: string               // observations cliniques, évolution
  poulsLangue: string             // pouls + langue combinés
  strategie: string               // stratégie thérapeutique
  pointsNeedled: AcupuncturePoint[]
  aFaireProchaineSéance: string   // instructions pour la prochaine séance
  amelioration: number | null     // 0–10 pour les stats
}

export interface Patient {
  id: string
  nom: string
  prenom: string
  dateNaissance: string
  sexe: 'F' | 'M' | 'autre'
  adresse: string
  telephone: string
  email: string
  pathologies: string[]
  patternsMTC: string[]
  constitution: string
  anamnese: string
  notesAnamnese: AnamnesisNote[]
  sessions: Session[]
  createdAt: string
  updatedAt: string
  pipelineCode?: string   // code P0001…P9999 du pipeline de numérisation
}

export interface AppSettings {
  praticienNom: string
  cabinetNom: string
}

export interface AppData {
  version: number
  patients: Patient[]
  settings: AppSettings
}
