import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ChainedTranslationEngine,
  MockTranslationEngine,
  RemoteTranslationEngine,
  TranslationService,
  createTranslationService,
  type LanguageCode,
  type TranslationEngine,
  type TranslationResult,
} from '../src/index.ts';

function fakeFetch(map: Record<string, string>, status = 200): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    const q = url.searchParams.get('q') ?? '';
    const pair = url.searchParams.get('langpair') ?? '';
    const translated = map[`${pair}:${q}`] ?? '';
    return new Response(JSON.stringify({ responseStatus: status, responseData: { translatedText: translated, match: 0.9 } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
}

const unavailable: TranslationEngine = {
  name: 'stub-down',
  coversOpenVocabulary: false,
  async translate(text: string, sourceLanguage: LanguageCode, targetLanguage: LanguageCode): Promise<TranslationResult> {
    return { text, sourceLanguage, targetLanguage, engine: 'stub-down', resolution: 'unavailable', note: 'stub is down' };
  },
  async health() {
    return { ok: false, detail: 'down' };
  },
};

describe('remote translation engine', () => {
  it('returns a remote resolution for a real service reply', async () => {
    const engine = new RemoteTranslationEngine({
      fetchImpl: fakeFetch({ 'hi|en:मुझे भूख लगी है': 'I am hungry' }),
    });
    const result = await engine.translate('मुझे भूख लगी है', 'hi', 'en');
    assert.equal(result.resolution, 'remote');
    assert.equal(result.text, 'I am hungry');
  });

  it('reports unavailable instead of guessing when the service refuses', async () => {
    const engine = new RemoteTranslationEngine({ fetchImpl: fakeFetch({}, 429) });
    const result = await engine.translate('कुछ भी', 'hi', 'en');
    assert.equal(result.resolution, 'unavailable');
    assert.equal(result.text, 'कुछ भी');
  });

  it('reports unavailable when the network throws', async () => {
    const engine = new RemoteTranslationEngine({
      fetchImpl: (async () => {
        throw new Error('offline');
      }) as typeof fetch,
    });
    const result = await engine.translate('कुछ भी', 'hi', 'en');
    assert.equal(result.resolution, 'unavailable');
  });
});

describe('chained translation engine', () => {
  it('prefers the curated dataset for demo phrases', async () => {
    const chain = new ChainedTranslationEngine([new MockTranslationEngine(0), unavailable]);
    const result = await chain.translate('मुझे मदद चाहिए', 'hi', 'en');
    assert.equal(result.resolution, 'dataset');
    assert.equal(result.text, 'I need help.');
  });

  it('falls through to the next engine for open vocabulary', async () => {
    const remote = new RemoteTranslationEngine({ fetchImpl: fakeFetch({ 'hi|en:मौसम अच्छा है': 'The weather is nice' }) });
    const chain = new ChainedTranslationEngine([new MockTranslationEngine(0), unavailable, remote]);
    const result = await chain.translate('मौसम अच्छा है', 'hi', 'en');
    assert.equal(result.resolution, 'remote');
    assert.equal(result.text, 'The weather is nice');
  });

  it('passes through with every engine reason when nothing resolves', async () => {
    const chain = new ChainedTranslationEngine([new MockTranslationEngine(0), unavailable]);
    const result = await chain.translate('अनजाना वाक्य', 'hi', 'en');
    assert.equal(result.resolution, 'passthrough');
    assert.equal(result.text, 'अनजाना वाक्य');
    assert.match(result.note ?? '', /stub is down/);
  });
});

describe('pivot translation', () => {
  it('runs two real hops through English for hi → mr', async () => {
    const remote = new RemoteTranslationEngine({
      fetchImpl: fakeFetch({ 'hi|en:मौसम अच्छा है': 'The weather is nice', 'en|mr:The weather is nice': 'हवामान छान आहे' }),
    });
    const service = new TranslationService({ engine: new ChainedTranslationEngine([new MockTranslationEngine(0), remote]) });
    const result = await service.translateViaPivot('मौसम अच्छा है', 'hi', 'mr');
    assert.deepEqual(result.path, ['hi', 'en', 'mr']);
    assert.equal(result.pivot, 'The weather is nice');
    assert.equal(result.target, 'हवामान छान आहे');
    assert.equal(result.targetResult.resolution, 'remote');
  });

  it('keeps English input as the pivot', async () => {
    const service = createTranslationService({ provider: 'mock', engine: new MockTranslationEngine(0) });
    const result = await service.translateViaPivot('I need help.', 'en', 'mr');
    assert.deepEqual(result.path, ['en', 'mr']);
    assert.equal(result.target, 'मला मदत हवी आहे');
  });

  it('mock provider stays dataset-only', async () => {
    const service = createTranslationService({ provider: 'mock' });
    assert.equal(service.providerName, 'mock-dataset');
  });

  it('default provider chains dataset and remote', async () => {
    const service = createTranslationService({ fetchImpl: fakeFetch({}) });
    assert.equal(service.providerName, 'mock-dataset>mymemory');
  });
});
