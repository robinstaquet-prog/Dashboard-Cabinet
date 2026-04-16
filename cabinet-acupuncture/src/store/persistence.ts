import type { AppData } from '../data/schema'
import { encryptStore, saveCiphertext } from '../crypto'

export async function persistStore(data: AppData, key: CryptoKey): Promise<void> {
  const ciphertextB64 = await encryptStore(data, key)
  await saveCiphertext(ciphertextB64)
}
