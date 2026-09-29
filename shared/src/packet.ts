import { canonicalPayload, integrityTag } from './crypto/integrity.ts';
import type { LanguageCode, MessagePacket, Priority } from './types.ts';

export interface CreatePacketInput {
  sourceDevice: string;
  destinationDevice: string;
  sourceLanguage: LanguageCode;
  targetLanguage: LanguageCode;
  text: string;
  translatedText: string;
  pivotText?: string;
  timestamp?: number;
  priority?: Priority;
  hopCount?: number;
  id?: string;
}

/** Fields actually carried on the wire; the packet envelope is metadata for the UI. */
const PAYLOAD_FIELDS = ['text', 'translatedText', 'pivotText'] as const;

export function payloadByteLength(input: {
  text: string;
  translatedText: string;
  pivotText?: string;
}): number {
  const encoder = new TextEncoder();
  let total = 0;
  for (const field of PAYLOAD_FIELDS) {
    const value = input[field];
    if (value) total += encoder.encode(value).length;
  }
  return total;
}

let counter = 0;

/** Short human-readable packet id, e.g. `ITN-8F29`. Deterministic enough for a demo. */
export function generatePacketId(seed: number): string {
  counter = (counter + 1) % 0xffff;
  const mixed = ((seed ^ (counter * 2654435761)) >>> 0) & 0xffff;
  return `ITN-${mixed.toString(16).toUpperCase().padStart(4, '0')}`;
}

export async function createPacket(input: CreatePacketInput): Promise<MessagePacket> {
  const timestamp = input.timestamp ?? Date.now();
  const priority = input.priority ?? 'NORMAL';
  const pivotText = input.pivotText ?? '';

  const payload = canonicalPayload({
    sourceDevice: input.sourceDevice,
    destinationDevice: input.destinationDevice,
    sourceLanguage: input.sourceLanguage,
    targetLanguage: input.targetLanguage,
    text: input.text,
    translatedText: input.translatedText,
    timestamp,
    priority,
  });

  return {
    id: input.id ?? generatePacketId(timestamp),
    sourceDevice: input.sourceDevice,
    destinationDevice: input.destinationDevice,
    sourceLanguage: input.sourceLanguage,
    targetLanguage: input.targetLanguage,
    text: input.text,
    translatedText: input.translatedText,
    pivotText,
    timestamp,
    priority,
    hopCount: input.hopCount ?? 0,
    payloadBytes: payloadByteLength(input),
    authTag: await integrityTag(payload),
  };
}

export interface PacketValidation {
  valid: boolean;
  errors: string[];
}

export function validatePacket(packet: MessagePacket): PacketValidation {
  const errors: string[] = [];
  if (!/^ITN-[0-9A-F]{4}$/.test(packet.id)) errors.push('id must match ITN-XXXX');
  if (!packet.sourceDevice) errors.push('sourceDevice is required');
  if (!packet.destinationDevice) errors.push('destinationDevice is required');
  if (packet.sourceDevice === packet.destinationDevice) errors.push('source and destination must differ');
  if (!packet.text.trim()) errors.push('text is empty');
  if (!packet.translatedText.trim()) errors.push('translatedText is empty');
  if (!Number.isFinite(packet.timestamp)) errors.push('timestamp must be a number');
  if (!['NORMAL', 'HIGH', 'SOS'].includes(packet.priority)) errors.push('priority is invalid');
  if (packet.payloadBytes <= 0) errors.push('payloadBytes must be positive');
  if (!/^[0-9a-f]{64}$|^unavailable$/.test(packet.authTag)) errors.push('authTag must be a hex sha-256 or "unavailable"');
  return { valid: errors.length === 0, errors };
}

/** Recomputes the tag and compares — used by the System page integrity demo. */
export async function verifyPacket(packet: MessagePacket): Promise<boolean> {
  if (packet.authTag === 'unavailable') return false;
  const payload = canonicalPayload({
    sourceDevice: packet.sourceDevice,
    destinationDevice: packet.destinationDevice,
    sourceLanguage: packet.sourceLanguage,
    targetLanguage: packet.targetLanguage,
    text: packet.text,
    translatedText: packet.translatedText,
    timestamp: packet.timestamp,
    priority: packet.priority,
  });
  const expected = await integrityTag(payload);
  return expected === packet.authTag;
}
