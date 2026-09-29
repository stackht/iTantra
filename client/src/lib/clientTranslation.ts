import {
  createTranslationService,
  type LanguageCode,
  type PivotTranslation,
  type TranslationEngine,
  type TranslationResult,
} from '@itantra/shared';
import { TRANSLATION_PROVIDER, apiUrl } from './config.ts';
import { hubOnline } from './hub.ts';

/**
 * The product's Opus-MT packs, run on the hub (POST /api/mt), one direct hop at a
 * time. The service pivots through English exactly as the Android app does.
 */
class ProductMtEngine implements TranslationEngine {
  readonly name = 'itantra-opus-mt';
  readonly coversOpenVocabulary = true;

  async translate(text: string, sourceLanguage: LanguageCode, targetLanguage: LanguageCode): Promise<TranslationResult> {
    const trimmed = text.trim();
    if (sourceLanguage === targetLanguage) {
      return { text: trimmed, sourceLanguage, targetLanguage, engine: this.name, resolution: 'identity' };
    }
    if (!hubOnline()) {
      return { text: trimmed, sourceLanguage, targetLanguage, engine: this.name, resolution: 'unavailable', note: 'Hub offline — Opus-MT runs on the hub' };
    }
    try {
      const response = await fetch(apiUrl('/api/mt'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: trimmed, src: sourceLanguage, tgt: targetLanguage }),
      });
      const body = (await response.json()) as { ok?: boolean; text?: string; error?: string; pair?: string; ms?: number };
      if (response.ok && body.ok && body.text) {
        return {
          text: body.text,
          sourceLanguage,
          targetLanguage,
          engine: this.name,
          resolution: 'ondevice',
          note: `ITANTRA Opus-MT ${body.pair} (${body.ms} ms)`,
        };
      }
      return { text: trimmed, sourceLanguage, targetLanguage, engine: this.name, resolution: 'unavailable', note: body.error ?? 'Opus-MT failed' };
    } catch {
      return { text: trimmed, sourceLanguage, targetLanguage, engine: this.name, resolution: 'unavailable', note: 'Hub not reachable for Opus-MT' };
    }
  }

  async health(): Promise<{ ok: boolean; detail: string }> {
    return { ok: true, detail: 'hub /api/mt' };
  }
}

/**
 * The product's Marathi→English pack. The Android app converted it but does not host it
 * (its greedy decode sometimes invents text), so the hub only returns a result that
 * survives a round trip back to Marathi through the good en→mr pack.
 */
class GatedMarathiEngine implements TranslationEngine {
  readonly name = 'itantra-opus-mt-mr-en (round-trip checked)';
  readonly coversOpenVocabulary = true;

  async translate(text: string, sourceLanguage: LanguageCode, targetLanguage: LanguageCode): Promise<TranslationResult> {
    const trimmed = text.trim();
    if (sourceLanguage !== 'mr' || targetLanguage !== 'en' || !hubOnline()) {
      return { text: trimmed, sourceLanguage, targetLanguage, engine: this.name, resolution: 'unavailable', note: 'Only for Marathi→English on the hub' };
    }
    try {
      const response = await fetch(apiUrl('/api/mt'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: trimmed, src: 'mr', tgt: 'en', allowGated: true }),
      });
      const body = (await response.json()) as { ok?: boolean; text?: string; error?: string; overlap?: number };
      if (response.ok && body.ok && body.text) {
        return {
          text: body.text,
          sourceLanguage,
          targetLanguage,
          engine: this.name,
          resolution: 'ondevice',
          note: `ITANTRA Opus-MT mr-en, round-trip overlap ${body.overlap}`,
        };
      }
      return { text: trimmed, sourceLanguage, targetLanguage, engine: this.name, resolution: 'unavailable', note: body.error ?? 'mr-en rejected' };
    } catch {
      return { text: trimmed, sourceLanguage, targetLanguage, engine: this.name, resolution: 'unavailable', note: 'Hub not reachable' };
    }
  }

  async health(): Promise<{ ok: boolean; detail: string }> {
    return { ok: true, detail: 'hub /api/mt (gated)' };
  }
}

/**
 * Sending-device translation chain:
 *   1. ITANTRA Opus-MT packs (hi↔en, en→mr) on the hub
 *   2. curated demo dataset (whole phrases, including pairs the product has no pack for)
 *   3. the product's mr-en pack behind a round-trip check (Marathi→English only)
 *   4. remote MT as a clearly-labelled last resort
 */
export const clientTranslationService = createTranslationService({
  provider: TRANSLATION_PROVIDER,
  leadingEngines: [new ProductMtEngine()],
  extraEngines: [new GatedMarathiEngine()],
});

export interface DeviceTranslation extends PivotTranslation {
  pivotEngine: string;
  targetEngine: string;
  resolved: boolean;
}

/** Upper bound for sender-side MT; beyond it the packet leaves untranslated (never blocked). */
const DEVICE_MT_TIMEOUT_MS = 45000;

/**
 * Translation when the English pivot already exists — Whisper's own speech-to-English
 * output for Marathi voice input. Only the EN→target hop remains.
 */
export async function translateFromPivot(original: string, pivot: string, from: LanguageCode, to: LanguageCode): Promise<DeviceTranslation> {
  const pivotResult: TranslationResult = {
    text: pivot,
    sourceLanguage: from,
    targetLanguage: 'en',
    engine: 'whisper-speech-translate',
    resolution: 'ondevice',
    note: 'Whisper translated the speech to English',
  };
  if (to === 'en') {
    return { pivot, pivotResult, target: pivot, targetResult: pivotResult, path: [from, 'en'], pivotEngine: 'whisper (ondevice)', targetEngine: 'whisper (ondevice)', resolved: true };
  }
  if (to === from) {
    const same: TranslationResult = { text: original, sourceLanguage: from, targetLanguage: to, engine: 'identity', resolution: 'identity' };
    return { pivot, pivotResult, target: original, targetResult: same, path: [from], pivotEngine: 'whisper (ondevice)', targetEngine: 'identity', resolved: true };
  }
  const targetResult = await clientTranslationService.translate(pivot, 'en', to);
  return {
    pivot,
    pivotResult,
    target: targetResult.text,
    targetResult,
    path: [from, 'en', to],
    pivotEngine: 'whisper (ondevice)',
    targetEngine: `${targetResult.engine} (${targetResult.resolution})`,
    resolved: targetResult.resolution !== 'passthrough' && targetResult.resolution !== 'unavailable',
  };
}

export async function translateOnDevice(text: string, from: LanguageCode, to: LanguageCode): Promise<DeviceTranslation> {
  const passthrough: PivotTranslation = {
    pivot: text,
    pivotResult: { text, sourceLanguage: from, targetLanguage: 'en', engine: 'timeout', resolution: 'unavailable', note: 'Device MT timed out.' },
    target: text,
    targetResult: { text, sourceLanguage: from, targetLanguage: to, engine: 'timeout', resolution: 'unavailable', note: 'Device MT timed out.' },
    path: [from, to],
  };
  const result = await Promise.race<PivotTranslation>([
    clientTranslationService.translateViaPivot(text, from, to),
    new Promise<PivotTranslation>((resolve) => setTimeout(() => resolve(passthrough), DEVICE_MT_TIMEOUT_MS)),
  ]);
  const label = (r: PivotTranslation['targetResult']) => `${r.engine} (${r.resolution})`;
  return {
    ...result,
    pivotEngine: label(result.pivotResult),
    targetEngine: label(result.targetResult),
    resolved: result.targetResult.resolution !== 'passthrough' && result.targetResult.resolution !== 'unavailable',
  };
}
