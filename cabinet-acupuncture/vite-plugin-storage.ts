import type { Plugin } from 'vite'
import fs from 'node:fs'
import path from 'node:path'
import { IncomingMessage, ServerResponse } from 'node:http'

const DATA_DIR = path.resolve(__dirname, '../data')
const ENC_FILE = path.join(DATA_DIR, 'cabinet-data.enc')
const SALT_FILE = path.join(DATA_DIR, 'cabinet-data.salt')
const CORPUS_DIR = path.resolve(__dirname, '../../Corpus IEATC')

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (chunk) => (body += chunk))
    req.on('end', () => resolve(body))
    req.on('error', reject)
  })
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
}

function loadCorpusSection(sections: string[]): Record<string, string> {
  const result: Record<string, string> = {}
  for (const section of sections) {
    const sectionPath = path.join(CORPUS_DIR, section)
    if (!fs.existsSync(sectionPath)) continue
    const files = fs.readdirSync(sectionPath).filter((f) => f.endsWith('.yaml'))
    for (const file of files) {
      const key = `${section}/${file}`
      result[key] = fs.readFileSync(path.join(sectionPath, file), 'utf-8')
    }
  }
  return result
}

function loadPhilosophie(): string {
  const p = path.join(CORPUS_DIR, '_SYSTEME', '00_philosophie_clinique.yaml')
  if (fs.existsSync(p)) return fs.readFileSync(p, 'utf-8')
  return ''
}

function loadArbresDecision(): string {
  const p = path.join(CORPUS_DIR, '_SYSTEME', '00_arbres_decision.yaml')
  if (fs.existsSync(p)) return fs.readFileSync(p, 'utf-8')
  return ''
}

export function storagePlugin(): Plugin {
  return {
    name: 'cabinet-storage',
    configureServer(server) {
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next) => {
        // Storage endpoints
        if (req.url === '/api/storage' && req.method === 'GET') {
          ensureDataDir()
          if (!fs.existsSync(ENC_FILE)) {
            res.writeHead(404, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ exists: false }))
            return
          }
          const data = fs.readFileSync(ENC_FILE, 'utf-8')
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ exists: true, data }))
          return
        }

        if (req.url === '/api/storage' && req.method === 'POST') {
          ensureDataDir()
          const body = await readBody(req)
          const { data } = JSON.parse(body)
          fs.writeFileSync(ENC_FILE, data, 'utf-8')
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true }))
          return
        }

        if (req.url === '/api/salt' && req.method === 'GET') {
          ensureDataDir()
          if (!fs.existsSync(SALT_FILE)) {
            res.writeHead(404, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ exists: false }))
            return
          }
          const salt = fs.readFileSync(SALT_FILE, 'utf-8')
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ exists: true, salt }))
          return
        }

        if (req.url === '/api/salt' && req.method === 'POST') {
          ensureDataDir()
          const body = await readBody(req)
          const { salt } = JSON.parse(body)
          fs.writeFileSync(SALT_FILE, salt, 'utf-8')
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true }))
          return
        }

        // Corpus endpoint
        if (req.url?.startsWith('/api/corpus') && req.method === 'GET') {
          const url = new URL(req.url, 'http://localhost')
          const sectionsParam = url.searchParams.get('sections') || ''
          const sections = sectionsParam ? sectionsParam.split(',').map((s) => s.trim()) : []
          const corpus = loadCorpusSection(sections)
          const philosophie = loadPhilosophie()
          const arbres = loadArbresDecision()
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ corpus, philosophie, arbres }))
          return
        }

        // Claude API proxy
        if (req.url === '/api/claude' && req.method === 'POST') {
          const apiKey = process.env.VITE_ANTHROPIC_API_KEY
          if (!apiKey) {
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Clé API Anthropic non configurée dans .env.local' }))
            return
          }
          const body = await readBody(req)
          const payload = JSON.parse(body)
          try {
            const response = await fetch('https://api.anthropic.com/v1/messages', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
              },
              body: JSON.stringify(payload),
            })
            const data = await response.json()
            res.writeHead(response.status, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify(data))
          } catch (err) {
            res.writeHead(502, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Erreur proxy Claude API' }))
          }
          return
        }

        next()
      })
    },
  }
}
