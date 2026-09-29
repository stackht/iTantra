import type { LanguageCode, TranslationResult } from '../types.ts';
import type { TranslationEngine } from './TranslationEngine.ts';

/**
 * Hosted machine translation over HTTPS (MyMemory: free, keyless, ~5k chars/day per IP).
 *
 * This is the open-vocabulary fallback when no on-device pack is installed. It is
 * clearly *not* the product's offline Opus-MT runtime; results are labelled
 * `remote` so the UI can say so. Failures (offline, quota, timeout) are reported
 * as `unavailable` rather than guessed.
 */
export interface RemoteEngineOptions {
  endpoint?: string;
  timeoutMs?: number;
  /** Injected for tests / environments without a global fetch. */
  fetchImpl?: typeof fetch;
}

interface MyMemoryResponse {
  responseStatus?: number | string;
  responseData?: { translatedText?: string; match?: number };
}

export class RemoteTranslationEngine implements TranslationEngine {
  readonly name = 'mymemory';
  readonly coversOpenVocabulary = true;
  private readonly endpoint: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch | null;
  private readonly cache = new Map<string, string>();

  constructor(options: RemoteEngineOptions = {}) {
    this.endpoint = options.endpoint ?? 'https://api.mymemory.translated.net/get';
    this.timeoutMs = options.timeoutMs ?? 8000;
    // Browsers require fetch to be invoked on the global object, never as a method of this class.
    const impl = options.fetchImpl ?? (typeof fetch === 'function' ? fetch : null);
    this.fetchImpl = impl ? (impl.bind(globalThis) as typeof fetch) : null;
  }

  async translate(text: string, sourceLanguage: LanguageCode, targetLanguage: LanguageCode): Promise<TranslationResult> {
    const trimmed = text.trim();
    if (sourceLanguage === targetLanguage) {
      return { text: trimmed, sourceLanguage, targetLanguage, engine: this.name, resolution: 'identity' };
    }
    if (!this.fetchImpl || !trimmed) {
      return this.unavailable(trimmed, sourceLanguage, targetLanguage, 'No network client available.');
    }
    const key = `${sourceLanguage}>${targetLanguage}:${trimmed}`;
    const cached = this.cache.get(key);
    if (cached) {
      return { text: cached, sourceLanguage, targetLanguage, engine: this.name, resolution: 'remote', note: 'Remote MT (cached).' };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const url = `${this.endpoint}?q=${encodeURIComponent(trimmed)}&langpair=${sourceLanguage}|${targetLanguage}`;
      const response = await this.fetchImpl(url, { signal: controller.signal });
      if (!response.ok) {
        return this.unavailable(trimmed, sourceLanguage, targetLanguage, `Remote MT HTTP ${response.status}.`);
      }
      const body = (await response.json()) as MyMemoryResponse;
      const translated = body.responseData?.translatedText?.trim() ?? '';
      const status = Number(body.responseStatus ?? 0);
      if (status !== 200 || !translated || /MYMEMORY WARNING/i.test(translated)) {
        return this.unavailable(trimmed, sourceLanguage, targetLanguage, `Remote MT refused (status ${status || 'unknown'}).`);
      }
      this.cache.set(key, translated);
      return {
        text: translated,
        sourceLanguage,
        targetLanguage,
        engine: this.name,
        resolution: 'remote',
        note: 'Remote MT service (internet) — not the offline on-device model.',
      };
    } catch (error) {
      const reason = error instanceof Error && error.name === 'AbortError' ? 'Remote MT timed out.' : 'Remote MT unreachable.';
      return this.unavailable(trimmed, sourceLanguage, targetLanguage, reason);
    } finally {
      clearTimeout(timer);
    }
  }

  async health(): Promise<{ ok: boolean; detail: string }> {
    return { ok: this.fetchImpl !== null, detail: this.fetchImpl ? 'MyMemory endpoint configured' : 'fetch unavailable' };
  }

  private unavailable(text: string, sourceLanguage: LanguageCode, targetLanguage: LanguageCode, note: string): TranslationResult {
    return { text, sourceLanguage, targetLanguage, engine: this.name, resolution: 'unavailable', note };
  }
}
