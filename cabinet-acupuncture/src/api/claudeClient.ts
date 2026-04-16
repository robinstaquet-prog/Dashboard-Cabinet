import type { PseudoPatient } from '../pseudonymize/pseudonymize'

export type AIMode =
  | 'evaluation-energetique'
  | 'suggestions-points'
  | 'hypothese-diagnostique'
  | 'resume-suivi'

const MODE_LABELS: Record<AIMode, string> = {
  'evaluation-energetique': 'Évaluation énergétique',
  'suggestions-points': 'Suggestions de points',
  'hypothese-diagnostique': 'Hypothèse diagnostique',
  'resume-suivi': 'Résumé de suivi',
}

// Sections du corpus à charger selon le mode
const MODE_CORPUS_SECTIONS: Record<AIMode, string[]> = {
  'evaluation-energetique': ['THEORIE', 'DIAGNOSTIC', 'ZANG_FU'],
  'suggestions-points': ['POINTS', 'CLINIQUE', 'THEORIE'],
  'hypothese-diagnostique': ['DIAGNOSTIC', 'CLINIQUE', 'ZANG_FU', 'THEORIE'],
  'resume-suivi': ['CLINIQUE', 'DIAGNOSTIC'],
}

async function loadCorpusForMode(mode: AIMode): Promise<{ philosophie: string; corpus: Record<string, string> }> {
  const sections = MODE_CORPUS_SECTIONS[mode]
  const res = await fetch(`/api/corpus?sections=${sections.join(',')}`)
  const json = await res.json()
  return { philosophie: json.philosophie as string, corpus: json.corpus as Record<string, string> }
}

function buildSystemPrompt(philosophie: string, corpus: Record<string, string>, mode: AIMode): string {
  const corpusText = Object.entries(corpus)
    .map(([path, content]) => `### ${path}\n${content}`)
    .join('\n\n')

  return `Tu es un assistant clinique pour une acupunctrice praticienne de la méthode IEATC (Institut Européen d'Acupuncture et de Thérapies Complémentaires), selon l'enseignement de Thierry Bollet et la référence doctrinale de Charles Laville Méry (CLM).

IMPORTANT — RÈGLES ABSOLUES :
- Tu raisonnes EXCLUSIVEMENT selon la pensée IEATC, pas selon la MTC classique.
- Si une information est absente du corpus IEATC fourni, tu le signales explicitement : "non documenté dans le corpus IEATC disponible".
- Si tu utilises un concept de MTC classique non confirmé IEATC, tu le signales : "concept MTC non confirmé IEATC".
- Tu ne tranches JAMAIS seul sur les contradictions entre sources IEATC.
- Toutes les données patient sont pseudonymisées. Tu ne cherches pas à identifier le patient réel.
- Tes réponses sont des outils d'aide à la réflexion clinique — la décision thérapeutique appartient à la praticienne.
- Réponds en français.

MODE ACTUEL : ${MODE_LABELS[mode]}

--- PHILOSOPHIE CLINIQUE IEATC ---
${philosophie}

--- CORPUS IEATC (sections pertinentes) ---
${corpusText}`
}

function formatPatientContext(pseudo: PseudoPatient): string {
  const sessionsText = pseudo.sessions
    .map(
      (s) =>
        `Séance ${s.numero} :
  - Remarques : ${s.remarques || 'non renseignées'}
  - Pouls / Langue : ${s.poulsLangue || 'non renseignés'}
  - Stratégie : ${s.strategie || 'non renseignée'}
  - Points utilisés : ${s.pointsNeedled.join(', ') || 'non renseignés'}
  - Amélioration : ${s.amelioration !== null ? `${s.amelioration}/10` : 'non évaluée'}`,
    )
    .join('\n\n')

  return `PATIENT ${pseudo.pseudoId} — ${pseudo.sexe}, ${pseudo.trancheAge}

Pathologies : ${pseudo.pathologies.join(', ') || 'non renseignées'}
Patterns IEATC : ${pseudo.patternsIEATC.join(', ') || 'non renseignés'}
Constitution : ${pseudo.constitution || 'non renseignée'}

HISTORIQUE DES SÉANCES (${pseudo.sessions.length}) :
${sessionsText || 'Aucune séance enregistrée.'}`
}

export async function queryClaudeAI(
  pseudo: PseudoPatient,
  mode: AIMode,
  additionalContext?: string,
): Promise<string> {
  const { philosophie, corpus } = await loadCorpusForMode(mode)
  const systemPrompt = buildSystemPrompt(philosophie, corpus, mode)
  const patientContext = formatPatientContext(pseudo)

  const userMessage = additionalContext
    ? `${patientContext}\n\nContexte supplémentaire de la praticienne :\n${additionalContext}`
    : patientContext

  const payload = {
    model: 'claude-sonnet-4-5-20251001',
    max_tokens: 2048,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  }

  const res = await fetch('/api/claude', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as { error?: string }).error || `Erreur API Claude (${res.status})`)
  }

  const data = await res.json() as { content: Array<{ type: string; text: string }> }
  const text = data.content.find((b) => b.type === 'text')?.text
  if (!text) throw new Error('Réponse Claude vide ou inattendue.')
  return text
}
