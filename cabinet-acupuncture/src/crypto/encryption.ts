import type { AppData } from '../data/schema'

const IV_BYTES = 12

function toBase64(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
}

function fromBase64(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
}

export async function encryptStore(data: AppData, key: CryptoKey): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const plaintext = new TextEncoder().encode(JSON.stringify(data))
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext)

  // Layout: iv[12] || ciphertext[n]
  const combined = new Uint8Array(IV_BYTES + ciphertext.byteLength)
  combined.set(iv, 0)
  combined.set(new Uint8Array(ciphertext), IV_BYTES)
  return toBase64(combined.buffer)
}

export async function decryptStore(ciphertextB64: string, key: CryptoKey): Promise<AppData> {
  const combined = fromBase64(ciphertextB64)
  const iv = combined.slice(0, IV_BYTES)
  const ciphertext = combined.slice(IV_BYTES)

  // Will throw DOMException if key is wrong (AES-GCM auth tag mismatch)
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext)
  return JSON.parse(new TextDecoder().decode(plaintext)) as AppData
}
