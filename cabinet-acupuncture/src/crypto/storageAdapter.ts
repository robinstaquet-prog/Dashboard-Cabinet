function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
}

function fromBase64(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
}

// ── Encrypted data ────────────────────────────────────────────────────────────

export async function loadCiphertext(): Promise<string | null> {
  const res = await fetch('/api/storage')
  const json = await res.json()
  if (!json.exists) return null
  return json.data as string
}

export async function saveCiphertext(ciphertextB64: string): Promise<void> {
  await fetch('/api/storage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: ciphertextB64 }),
  })
}

// ── Salt ─────────────────────────────────────────────────────────────────────

export async function loadSalt(): Promise<Uint8Array | null> {
  const res = await fetch('/api/salt')
  const json = await res.json()
  if (!json.exists) return null
  return fromBase64(json.salt)
}

export async function saveSalt(salt: Uint8Array): Promise<void> {
  await fetch('/api/salt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ salt: toBase64(salt) }),
  })
}
