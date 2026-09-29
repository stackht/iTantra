import type { LanguageCode, TranslationResult } from '../types.ts';

/**
 * The single seam where a real translation backend plugs in.
 *
 * A production provider (IndicTrans/NLLB/Marian/Google-Translate/…, offline or
 * hosted) implements this exact interface; nothing else in the codebase needs to
 * change. Select it with `TRANSLATION_PROVIDER`.
 */
export interface TranslationEngine {
  /** Stable identifier reported in the UI, e.g. `mock-dataset`. */
  readonly name: string;
  /** True when the engine can resolve arbitrary input, false for dataset-only engines. */
  readonly coversOpenVocabulary: boolean;
  translate(text: string, sourceLanguage: LanguageCode, targetLanguage: LanguageCode): Promise<TranslationResult>;
  /** Optional health probe used for the status bar. */
  health(): Promise<{ ok: boolean; detail: string }>;
}
