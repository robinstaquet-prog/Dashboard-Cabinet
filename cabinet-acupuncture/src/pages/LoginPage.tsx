import React, { useState } from 'react'
import { generateSalt, deriveKey, loadSalt, saveSalt, loadCiphertext, saveCiphertext } from '../crypto'
import { encryptStore, decryptStore } from '../crypto'
import type { AppData } from '../data/schema'
import { emptyStore } from '../data/emptyStore'
import { migrateStore } from '../data/migrations'

interface LoginPageProps {
  onUnlock: (data: AppData, key: CryptoKey) => void
}

type Mode = 'detecting' | 'unlock' | 'first-run' | 'error'

export default function LoginPage({ onUnlock }: LoginPageProps) {
  const [mode, setMode] = useState<Mode>('detecting')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [praticien, setPraticien] = useState('')
  const [cabinet, setCabinet] = useState('Cabinet d\'Acupuncture')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // Detect first run on mount
  React.useEffect(() => {
    loadCiphertext().then((ct) => {
      setMode(ct === null ? 'first-run' : 'unlock')
    })
  }, [])

  async function handleUnlock(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const salt = await loadSalt()
      if (!salt) throw new Error('Fichier salt introuvable.')
      const key = await deriveKey(password, salt)
      const ciphertext = await loadCiphertext()
      if (!ciphertext) throw new Error('Fichier de données introuvable.')
      const raw = await decryptStore(ciphertext, key)
      const data = migrateStore(raw)
      onUnlock(data, key)
    } catch {
      setError('Mot de passe incorrect ou fichier corrompu.')
    } finally {
      setLoading(false)
    }
  }

  async function handleInit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (password.length < 8) {
      setError('Le mot de passe doit contenir au moins 8 caractères.')
      return
    }
    if (password !== confirm) {
      setError('Les mots de passe ne correspondent pas.')
      return
    }
    if (!praticien.trim()) {
      setError('Veuillez renseigner votre nom.')
      return
    }
    setLoading(true)
    try {
      const salt = generateSalt()
      await saveSalt(salt)
      const key = await deriveKey(password, salt)
      const initialData: AppData = {
        ...emptyStore,
        settings: { praticienNom: praticien.trim(), cabinetNom: cabinet.trim() },
      }
      const ciphertextB64 = await encryptStore(initialData, key)
      await saveCiphertext(ciphertextB64)
      onUnlock(initialData, key)
    } catch (err) {
      setError('Erreur lors de l\'initialisation. Vérifiez la console.')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  if (mode === 'detecting') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-stone-50">
        <div className="text-stone-400 text-sm">Chargement…</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-stone-50">
      <div className="bg-white rounded-2xl shadow-sm border border-stone-200 w-full max-w-md p-8">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="text-3xl mb-2">⚕</div>
          <h1 className="text-xl font-semibold text-stone-800">
            {mode === 'first-run' ? 'Initialisation du cabinet' : 'Cabinet d\'Acupuncture'}
          </h1>
          <p className="text-sm text-stone-500 mt-1">
            {mode === 'first-run'
              ? 'Créez votre mot de passe pour sécuriser vos données'
              : 'Entrez votre mot de passe pour accéder au tableau de bord'}
          </p>
        </div>

        {/* Unlock form */}
        {mode === 'unlock' && (
          <form onSubmit={handleUnlock} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1">
                Mot de passe
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoFocus
                required
                className="w-full border border-stone-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                placeholder="••••••••"
              />
            </div>
            {error && <p className="text-red-600 text-sm">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-teal-600 hover:bg-teal-700 disabled:bg-teal-300 text-white font-medium py-2 rounded-lg text-sm transition-colors"
            >
              {loading ? 'Déverrouillage…' : 'Déverrouiller'}
            </button>
          </form>
        )}

        {/* First-run wizard */}
        {mode === 'first-run' && (
          <form onSubmit={handleInit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1">
                Votre nom (praticien)
              </label>
              <input
                type="text"
                value={praticien}
                onChange={(e) => setPraticien(e.target.value)}
                autoFocus
                required
                className="w-full border border-stone-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                placeholder="Dr. Marie Dupont"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1">
                Nom du cabinet
              </label>
              <input
                type="text"
                value={cabinet}
                onChange={(e) => setCabinet(e.target.value)}
                className="w-full border border-stone-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1">
                Mot de passe (min. 8 caractères)
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full border border-stone-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                placeholder="••••••••"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1">
                Confirmer le mot de passe
              </label>
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                className="w-full border border-stone-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                placeholder="••••••••"
              />
            </div>
            {error && <p className="text-red-600 text-sm">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-teal-600 hover:bg-teal-700 disabled:bg-teal-300 text-white font-medium py-2 rounded-lg text-sm transition-colors"
            >
              {loading ? 'Initialisation…' : 'Initialiser le cabinet'}
            </button>
          </form>
        )}

        <p className="text-center text-xs text-stone-400 mt-6">
          Données chiffrées localement · Aucune connexion externe
        </p>
      </div>
    </div>
  )
}
