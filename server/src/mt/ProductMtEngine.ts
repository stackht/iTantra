import type { LanguageCode, TranslationEngine, TranslationResult } from '@itantra/shared';
import { translateDirect } from './OpusMt.ts';

/**
 * TranslationEngine for the hub's own simulation: the product's Opus-MT packs,
 * one direct hop at a time (the TranslationService does the EN pivot).
 */
export class ProductMtEngine implements TranslationEngine {
  readonly name = 'itantra-opus-mt';
  readonly coversOpenVocabulary = true;

  async translate(text: string, sourceLanguage: LanguageCode, targetLanguage: LanguageCode): Promise<TranslationResult> {
    const trimmed = text.trim();
    if (sourceLanguage === targetLanguage) {
      return { text: trimmed, sourceLanguage, targetLanguage, engine: this.name, resolution: 'identity' };
    }
    const reply = await translateDirect(trimmed, sourceLanguage, targetLanguage);
    if (reply.ok && reply.text) {
      return { text: reply.text, sourceLanguage, targetLanguage, engine: this.name, resolution: 'ondevice', note: `Opus-MT ${reply.pair} (${reply.ms} ms)` };
    }
    return { text: trimmed, sourceLanguage, targetLanguage, engine: this.name, resolution: 'unavailable', note: reply.error ?? 'Opus-MT failed' };
  }

  async health(): Promise<{ ok: boolean; detail: string }> {
    return { ok: true, detail: 'Opus-MT worker' };
  }
}
