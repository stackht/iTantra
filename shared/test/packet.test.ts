import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { canonicalPayload, createPacket, generatePacketId, payloadByteLength, validatePacket, verifyPacket } from '../src/index.ts';

const base = {
  sourceDevice: 'DEV-A',
  destinationDevice: 'DEV-B',
  sourceLanguage: 'hi' as const,
  targetLanguage: 'mr' as const,
  text: 'मुझे मदद चाहिए',
  translatedText: 'I need help.',
  pivotText: 'I need help.',
  timestamp: 1_700_000_000_000,
};

describe('packet creation', () => {
  it('creates a valid packet', async () => {
    const packet = await createPacket(base);
    const result = validatePacket(packet);
    assert.deepEqual(result.errors, []);
    assert.equal(result.valid, true);
    assert.equal(packet.sourceLanguage, 'hi');
    assert.equal(packet.targetLanguage, 'mr');
    assert.equal(packet.priority, 'NORMAL');
  });

  it('computes payload bytes from real UTF-8 lengths', async () => {
    const expected =
      new TextEncoder().encode(base.text).length +
      new TextEncoder().encode(base.translatedText).length +
      new TextEncoder().encode(base.pivotText).length;
    const packet = await createPacket(base);
    assert.equal(packet.payloadBytes, expected);
    assert.equal(payloadByteLength(base), expected);
  });

  it('counts multi-byte scripts correctly', () => {
    const devanagari = payloadByteLength({ text: 'मदद', translatedText: 'help' });
    assert.ok(devanagari > 7, 'UTF-8 multi-byte characters must count more than one byte each');
  });

  it('generates well-formed ids', () => {
    assert.match(generatePacketId(0), /^ITN-[0-9A-F]{4}$/);
    assert.match(generatePacketId(Date.now()), /^ITN-[0-9A-F]{4}$/);
  });

  it('produces a 64 hex character SHA-256 tag', async () => {
    const packet = await createPacket(base);
    assert.match(packet.authTag, /^[0-9a-f]{64}$/);
  });

  it('verifies an untouched packet and rejects a tampered one', async () => {
    const packet = await createPacket(base);
    assert.equal(await verifyPacket(packet), true);

    const tampered = { ...packet, text: 'मुझे मदद नहीं चाहिए' };
    assert.equal(await verifyPacket(tampered), false);
  });

  it('is deterministic for identical payloads', async () => {
    const a = await createPacket(base);
    const b = await createPacket(base);
    assert.equal(a.authTag, b.authTag);
  });
});

describe('packet validation', () => {
  it('rejects empty text', async () => {
    const packet = await createPacket({ ...base, text: '   ' });
    assert.equal(validatePacket(packet).valid, false);
    assert.ok(validatePacket(packet).errors.includes('text is empty'));
  });

  it('rejects identical source and destination', async () => {
    const packet = await createPacket({ ...base, destinationDevice: 'DEV-A' });
    assert.ok(validatePacket(packet).errors.includes('source and destination must differ'));
  });

  it('rejects an invalid priority', async () => {
    const packet = { ...(await createPacket(base)), priority: 'URGENT' as never };
    assert.ok(validatePacket(packet).errors.includes('priority is invalid'));
  });

  it('accepts the "unavailable" tag when Web Crypto is missing', async () => {
    const packet = { ...(await createPacket(base)), authTag: 'unavailable' };
    assert.equal(validatePacket(packet).valid, true);
  });
});

describe('canonical payload', () => {
  it('is order-stable and field-delimited', () => {
    const payload = canonicalPayload({ ...base, priority: 'NORMAL' });
    assert.equal(payload.split('|').length, 8);
    assert.equal(canonicalPayload({ ...base, priority: 'SOS' }).endsWith('|SOS'), true);
  });
});
