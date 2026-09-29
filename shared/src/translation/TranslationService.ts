import type { LanguageCode, TranslationResult } from '../types.ts';
import { ChainedTranslationEngine } from './ChainedTranslationEngine.ts';
import { MockTranslationEngine } from './MockTranslationEngine.ts';
import { RemoteTranslationEngine } from './RemoteTranslationEngine.ts';
import type { TranslationEngine } from './TranslationEngine.ts';

export interface TranslationServiceOptions {
  /** `mock` = curated dataset only · `mymemory` = dataset → remote MT (default). */
  provider?: string;
  /** Injected engine replacing provider selection (tests). */
  engine?: TranslationEngine;
  /**
   * Engines slotted between the dataset and the remote service — the browser
   * inserts its on-device neural pack engine here.
   */
  extraEngines?: TranslationEngine[];
  /** Engines tried BEFORE the curated dataset — the product's own MT models. */
  leadingEngines?: TranslationEngine[];
  fetchImpl?: typeof fetch;
}

export interface PivotTranslation {
  /** English interlingua text (equals the input when the source is English). */
  pivot: string;
  pivotResult: TranslationResult;
  /** Text in the target language. */
  target: string;
  targetResult: TranslationResult;
  path: LanguageCode[];
}

const isResolved = (r: TranslationResult) => r.resolution !== 'passthrough' && r.resolution !== 'unavailable';

/**
 * Facade the app talks to. Owns provider selection and the pivot helper
 * (source → English → target) that both the pipeline and the product use.
 */
export class TranslationService {
  readonly engine: TranslationEngine;

  constructor(options: TranslationServiceOptions = {}) {
    this.engine = options.engine ?? new MockTranslationEngine();
  }

  get providerName(): string {
    return this.engine.name;
  }

  translate(text: string, from: LanguageCode, to: LanguageCode): Promise<TranslationResult> {
    return this.engine.translate(text, from, to);
  }

  /**
   * Two real hops through English, exactly like the product's EN-pivot packs.
   * If the first hop cannot be resolved, a direct source→target attempt is made
   * (the curated dataset can resolve whole phrases directly).
   */
  async translateViaPivot(text: string, from: LanguageCode, to: LanguageCode): Promise<PivotTranslation> {
    if (from === to) {
      const same = await this.translate(text, from, to);
      return { pivot: same.text, pivotResult: same, target: same.text, targetResult: same, path: [from] };
    }
    if (from === 'en') {
      const targetResult = await this.translate(text, 'en', to);
      const pivotResult: TranslationResult = { text: text.trim(), sourceLanguage: 'en', targetLanguage: 'en', engine: 'identity', resolution: 'identity' };
      return { pivot: text.trim(), pivotResult, target: targetResult.text, targetResult, path: ['en', to] };
    }
    const pivotResult = await this.translate(text, from, 'en');
    if (to === 'en') {
      return { pivot: pivotResult.text, pivotResult, target: pivotResult.text, targetResult: pivotResult, path: [from, 'en'] };
    }
    if (isResolved(pivotResult)) {
      const targetResult = await this.translate(pivotResult.text, 'en', to);
      return { pivot: pivotResult.text, pivotResult, target: targetResult.text, targetResult, path: [from, 'en', to] };
    }
    const direct = await this.translate(text, from, to);
    return { pivot: pivotResult.text, pivotResult, target: direct.text, targetResult: direct, path: [from, to] };
  }

  health(): Promise<{ ok: boolean; detail: string }> {
    return this.engine.health();
  }
}

/** Factory kept in one place so swapping providers is a one-line change. */
export function createTranslationService(options: TranslationServiceOptions = {}): TranslationService {
  if (options.engine) return new TranslationService(options);
  const provider = (options.provider ?? 'mymemory').toLowerCase();
  const dataset = new MockTranslationEngine();
  const extras = options.extraEngines ?? [];
  const leading = options.leadingEngines ?? [];
  const engines: TranslationEngine[] = [...leading, dataset, ...extras];
  switch (provider) {
    case 'mock':
    case 'dataset':
      break;
    case 'mymemory':
    case 'remote':
    case 'chain':
      engines.push(new RemoteTranslationEngine({ fetchImpl: options.fetchImpl }));
      break;
    default:
      // Unknown provider: keep whatever real engines we have; never fabricate.
      engines.push(new RemoteTranslationEngine({ fetchImpl: options.fetchImpl }));
      break;
  }
  return new TranslationService({ engine: engines.length === 1 ? engines[0] : new ChainedTranslationEngine(engines) });
}
