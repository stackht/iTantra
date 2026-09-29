import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MockTranslationEngine,
  PHRASES,
  TranslationService,
  createTranslationService,
  phraseById,
  render,
} from '../src/index.ts';

const service = new TranslationService({ engine: new MockTranslationEngine(0) });
const HI = phraseById('need-help');
const REPLY = phraseById('coming-to-help');

describe('translation · Hindi → Marathi', () => {
  it('resolves the canonical demo sentence', async () => {
    const result = await service.translate(HI.hi, 'hi', 'mr');
    assert.equal(result.resolution, 'dataset');
    assert.equal(result.text, HI.mr);
    assert.equal(result.pivot, 'I need help.');
  });

  it('accepts common variants and punctuation', async () => {
    const result = await service.translate('मदद चाहिये।', 'hi', 'mr');
    assert.equal(result.resolution, 'dataset');
    assert.equal(result.text, HI.mr);
  });
});

describe('translation · Hindi → English', () => {
  it('produces the English pivot', async () => {
    const result = await service.translate(HI.hi, 'hi', 'en');
    assert.equal(result.text, 'I need help.');
  });
});

describe('translation · English → Hindi', () => {
  it('resolves the pivot sentence into Hindi', async () => {
    const result = await service.translate('I need help.', 'en', 'hi');
    assert.equal(result.resolution, 'dataset');
    assert.equal(result.text, HI.hi);
  });

  it('is case insensitive on the pivot side', async () => {
    const result = await service.translate('i need help', 'en', 'hi');
    assert.equal(result.text, HI.hi);
  });
});

describe('translation · Marathi → Hindi', () => {
  it('resolves the canonical Marathi sentence', async () => {
    const result = await service.translate(HI.mr, 'mr', 'hi');
    assert.equal(result.text, HI.hi);
  });

  it('resolves the scripted Device B reply', async () => {
    const result = await service.translate(REPLY.mr, 'mr', 'hi');
    assert.equal(result.text, REPLY.hi);
    assert.equal(result.pivot, 'I am coming to help you.');
  });
});

describe('translation · honest failure behaviour', () => {
  it('reports passthrough instead of inventing output', async () => {
    const result = await service.translate('The quick brown fox', 'en', 'hi');
    assert.equal(result.resolution, 'passthrough');
    assert.equal(result.text, 'The quick brown fox');
    assert.match(String(result.note), /TRANSLATION_PROVIDER/);
  });

  it('passes text through when source and target match', async () => {
    const result = await service.translate(HI.hi, 'hi', 'hi');
    assert.equal(result.resolution, 'identity');
    assert.equal(result.text, HI.hi);
  });

  it('keeps the curated dataset first when the provider name is unknown', async () => {
    const fallback = createTranslationService({ provider: 'not-configured' });
    const health = await fallback.health();
    assert.equal(health.ok, true);
    assert.equal(fallback.providerName, 'mock-dataset>mymemory');
    const result = await fallback.translate('मुझे मदद चाहिए', 'hi', 'en');
    assert.equal(result.resolution, 'dataset');
  });
});

describe('dataset integrity', () => {
  it('renders every language for every phrase', () => {
    for (const phrase of PHRASES) {
      for (const code of ['hi', 'mr', 'gu', 'bn', 'ta', 'te', 'kn', 'ml', 'or'] as const) {
        const text = render(phrase, code);
        assert.ok(text.length > 0, `${phrase.id}/${code} is empty`);
      }
    }
  });

  it('keeps Devanagari, Tamil and Malayalam sentences non-Latin where expected', () => {
    assert.match(HI.hi, /[\u0900-\u097F]/);
    assert.match(HI.ta, /[\u0B80-\u0BFF]/);
    assert.match(HI.ml, /[\u0D00-\u0D7F]/);
    assert.match(HI.te, /[\u0C00-\u0C7F]/);
  });
});
