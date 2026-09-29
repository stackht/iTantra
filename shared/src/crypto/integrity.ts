/**
 * Prototype packet integrity tag.
 *
 * Uses Web Crypto SHA-256 over a canonical payload string. This demonstrates the
 * shape of authenticated packets (payload + integrity tag, tamper evident); it is
 * NOT the production cipher used by the Android SIH build.
 */

export function canonicalPayload(fields: {
  sourceDevice: string;
  destinationDevice: string;
  sourceLanguage: string;
  targetLanguage: string;
  text: string;
  translatedText: string;
  timestamp: number;
  priority: string;
}): string {
  return [
    fields.sourceDevice,
    fields.destinationDevice,
    fields.sourceLanguage,
    fields.targetLanguage,
    fields.text,
    fields.translatedText,
    String(fields.timestamp),
    fields.priority,
  ].join('|');
}

export async function integrityTag(payload: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    // ponytail: hashlib-only environments get a non-cryptographic marker; browsers and Node >=18 always have Web Crypto.
    return 'unavailable';
  }
  const bytes = new TextEncoder().encode(payload);
  const digest = await subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function verifyTag(payload: string, tag: string): Promise<boolean> {
  const expected = await integrityTag(payload);
  return expected.length === tag.length && expected === tag;
}
