import type { LanguageCode, TranslationResult } from '../types.ts';
import type { TranslationEngine } from './TranslationEngine.ts';

const RESOLVED = new Set<TranslationResult['resolution']>(['dataset', 'ondevice', 'remote', 'identity']);

/**
 * Tries engines in order and returns the first genuine translation.
 *
 * Typical browser chain: curated dataset → Chrome on-device pack → remote MT.
 * Typical hub chain: curated dataset → remote MT.
 * If nothing resolves, the input is passed through unchanged with every
 * engine's reason attached — never a fabricated translation.
 */
export class ChainedTranslationEngine implements TranslationEngine {
  readonly name: string;
  readonly coversOpenVocabulary: boolean;
  private readonly engines: TranslationEngine[];

  constructor(engines: TranslationEngine[]) {
    if (engines.length === 0) throw new Error('ChainedTranslationEngine needs at least one engine');
    this.engines = engines;
    this.name = engines.map((e) => e.name).join('>');
    this.coversOpenVocabulary = engines.some((e) => e.coversOpenVocabulary);
  }

  async translate(text: string, sourceLanguage: LanguageCode, targetLanguage: LanguageCode): Promise<TranslationResult> {
    const notes: string[] = [];
    for (const engine of this.engines) {
      const result = await engine.translate(text, sourceLanguage, targetLanguage);
      if (RESOLVED.has(result.resolution)) return result;
      if (result.note) notes.push(`${engine.name}: ${result.note}`);
    }
    return {
      text: text.trim(),
      sourceLanguage,
      targetLanguage,
      engine: this.name,
      resolution: 'passthrough',
      note: `Not translated — ${notes.join(' · ') || 'no engine could resolve this input.'}`,
    };
  }

  async health(): Promise<{ ok: boolean; detail: string }> {
    const reports = await Promise.all(this.engines.map(async (e) => ({ name: e.name, ...(await e.health()) })));
    return { ok: reports.some((r) => r.ok), detail: reports.map((r) => `${r.name}:${r.ok ? 'ok' : 'down'}`).join(' ') };
  }
}
