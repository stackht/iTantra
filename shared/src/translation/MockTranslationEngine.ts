import { PHRASES, type PhraseEntry } from '../data/phrases.ts';
import type { LanguageCode, TranslationResult } from '../types.ts';
import type { TranslationEngine } from './TranslationEngine.ts';

const TRAILING_PUNCTUATION = /[।?!.,;:।।\s]+$/u;

/** NFC + whitespace collapse + trailing punctuation trim, so demo typing is forgiving. */
export function normalizeText(input: string): string {
  return input.normalize('NFC').replace(/\s+/gu, ' ').replace(TRAILING_PUNCTUATION, '').trim();
}

/** Case-folded form used for matching. Safe across scripts: Indic scripts have no case. */
function fold(input: string): string {
  return normalizeText(input).toLowerCase();
}

interface MatchResult {
  entry: PhraseEntry;
  /** true when the input was a prefix/substring of a dataset phrase rather than an exact hit. */
  partial: boolean;
}

function candidateStrings(entry: PhraseEntry, language: LanguageCode): string[] {
  const base = language === 'en' ? entry.pivot : entry[language as Exclude<LanguageCode, 'en'>];
  return [base, ...(entry.variants?.[language] ?? [])];
}

export function matchPhrase(text: string, language: LanguageCode): MatchResult | null {
  const needle = fold(text);
  if (!needle) return null;

  for (const entry of PHRASES) {
    if (candidateStrings(entry, language).some((candidate) => fold(candidate) === needle)) {
      return { entry, partial: false };
    }
  }
  // Lenient pass: a short utterance that contains a dataset phrase ("मदद चाहिए बस").
  for (const entry of PHRASES) {
    for (const candidate of candidateStrings(entry, language)) {
      const normalized = fold(candidate);
      if (normalized.length >= 4 && needle.includes(normalized)) {
        return { entry, partial: true };
      }
    }
  }
  return null;
}

export function render(entry: PhraseEntry, language: LanguageCode): string {
  return language === 'en' ? entry.pivot : entry[language as Exclude<LanguageCode, 'en'>];
}

/**
 * Offline, deterministic engine backed by the curated parallel dataset.
 *
 * Honesty contract:
 *  - it resolves only sentences present in the dataset;
 *  - anything else is reported as `passthrough` with a visible note instead of
 *    inventing a translation.
 */
export class MockTranslationEngine implements TranslationEngine {
  readonly name = 'mock-dataset';
  readonly coversOpenVocabulary = false;
  /** Simulated compute time, kept short so the demo pipeline stays snappy. */
  private readonly latencyMs: number;

  constructor(latencyMs = 90) {
    this.latencyMs = latencyMs;
  }

  async translate(
    text: string,
    sourceLanguage: LanguageCode,
    targetLanguage: LanguageCode,
  ): Promise<TranslationResult> {
    if (this.latencyMs > 0) await delay(this.latencyMs);
    const trimmed = text.trim();

    if (sourceLanguage === targetLanguage) {
      return {
        text: trimmed,
        sourceLanguage,
        targetLanguage,
        engine: this.name,
        resolution: 'identity',
        note: 'Source and target language are identical — text passed through unchanged.',
      };
    }

    const match = matchPhrase(trimmed, sourceLanguage);
    if (!match) {
      return {
        text: trimmed,
        sourceLanguage,
        targetLanguage,
        engine: this.name,
        resolution: 'passthrough',
        note: 'Not in the demo dataset. Configure a translation provider (TRANSLATION_PROVIDER) for open vocabulary input.',
      };
    }

    const note = match.partial
      ? 'Matched a demo phrase contained in the input (curated dataset, not machine translation).'
      : undefined;

    return {
      text: render(match.entry, targetLanguage),
      pivot: match.entry.pivot,
      sourceLanguage,
      targetLanguage,
      engine: this.name,
      resolution: 'dataset',
      ...(note ? { note } : {}),
    };
  }

  async health(): Promise<{ ok: boolean; detail: string }> {
    return { ok: true, detail: `${PHRASES.length} curated sentences loaded` };
  }
}

/**
 * Reports unavailable instead of guessing. Selected when a configured provider
 * cannot be reached, so the UI can degrade to the demo dataset with a warning.
 */
export class UnavailableTranslationEngine implements TranslationEngine {
  readonly name = 'unavailable';
  readonly coversOpenVocabulary = false;

  async translate(text: string, sourceLanguage: LanguageCode, targetLanguage: LanguageCode): Promise<TranslationResult> {
    return {
      text: text.trim(),
      sourceLanguage,
      targetLanguage,
      engine: this.name,
      resolution: 'unavailable',
      note: 'Translation engine unavailable. Configure TRANSLATION_PROVIDER.',
    };
  }

  async health() {
    return { ok: false, detail: 'No provider configured' };
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
