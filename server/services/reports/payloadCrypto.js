/**
 * payloadCrypto.js — Encryption wrapper for PHI-bearing report_run_items columns.
 *
 * Always JSON.stringify before encrypt; always JSON.parse after decrypt.
 *
 * If ENCRYPTION_KEY is not configured, encryptJson throws rather than
 * silently storing plaintext. We do NOT degrade to cleartext for PHI columns.
 *
 * HIPAA note: These helpers exist because data_snapshot, ai_output, and
 * rendered_payload may contain client business names, review excerpts, and
 * AI-generated narratives derived from client data. AES-256-GCM required.
 */

import { encrypt, decrypt, isEncryptionEnabled } from '../security/encryption.js';

/**
 * Encrypt a JSON-serialisable object for storage in a TEXT column.
 *
 * @param {object|null} obj
 * @returns {string|null} base64 iv:authTag:ciphertext, or null if obj is null
 * @throws if encryption key is not configured or encrypt() returns null
 */
export function encryptJson(obj) {
  if (obj == null) return null;
  if (!isEncryptionEnabled()) {
    throw new Error('ENCRYPTION_KEY not configured; cannot persist report payloads.');
  }
  const ciphertext = encrypt(JSON.stringify(obj));
  if (!ciphertext) {
    throw new Error('Encryption failed (encrypt() returned null).');
  }
  return ciphertext;
}

/**
 * Decrypt a TEXT column value back to a parsed JS object.
 *
 * @param {string|null} ciphertext
 * @returns {object|null} parsed JSON, or null on failure / null input
 */
export function decryptJson(ciphertext) {
  if (ciphertext == null) return null;
  const plaintext = decrypt(ciphertext);
  if (plaintext == null) return null;
  try {
    return JSON.parse(plaintext);
  } catch (err) {
    console.error('[reports.payloadCrypto] decrypted text was not JSON:', err.message);
    return null;
  }
}
