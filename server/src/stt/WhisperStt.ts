import type { LanguageCode } from '@itantra/shared';
import { whisperFiles, type WhisperFiles } from '../models/paths.ts';
import { callWorker } from '../models/worker.ts';

/**
 * Speech-to-text with the product's Whisper model, decoding forced to the speaker's
 * selected language exactly as the Android SttEngine does. Inference runs in the
 * Python model worker (byte-correct decode; see models/whisper_onnx.py for why the
 * sherpa-onnx decoder is not used for this step).
 */

/** Whisper has no Odia token (the product crashes the process if given one) — refuse it. */
const WHISPER_UNSUPPORTED = new Set<LanguageCode>(['or']);

/** Languages whose pivot comes from Whisper's speech-to-English task instead of text MT. */
const SPEECH_PIVOT = new Set<LanguageCode>(['mr']);

/** Unicode blocks each language is written in (mirrors the product's LanguageScript). */
const SCRIPT_RANGES: Partial<Record<LanguageCode, [number, number][]>> = {
  hi: [[0x0900, 0x097f]],
  mr: [[0x0900, 0x097f]],
  gu: [[0x0a80, 0x0aff]],
  kn: [[0x0c80, 0x0cff]],
  ml: [[0x0d00, 0x0d7f]],
  ta: [[0x0b80, 0x0bff]],
  te: [[0x0c00, 0x0c7f]],
  or: [[0x0b00, 0x0b7f]],
  bn: [[0x0980, 0x09ff]],
};

export type ScriptVerdict = 'native' | 'latin' | 'foreign' | 'empty';

export function scriptOf(text: string, lang: LanguageCode): ScriptVerdict {
  const letters = [...text].filter((ch) => /\p{L}/u.test(ch));
  if (letters.length === 0) return 'empty';
  if (lang === 'en') return letters.every((ch) => ch.codePointAt(0)! < 0x250) ? 'native' : 'foreign';
  const ranges = SCRIPT_RANGES[lang] ?? [];
  const native = letters.filter((ch) => ranges.some(([a, b]) => ch.codePointAt(0)! >= a && ch.codePointAt(0)! <= b)).length;
  if (native / letters.length >= 0.5) return 'native';
  const latin = letters.filter((ch) => ch.codePointAt(0)! < 0x250).length;
  return latin / letters.length >= 0.8 ? 'latin' : 'foreign';
}

export function sttStatus(): { runtime: boolean; model: WhisperFiles | null } {
  return { runtime: true, model: whisperFiles() };
}

export interface SttResult {
  text: string;
  /** Language the text is actually in (Whisper's translate fallback answers in English). */
  language: LanguageCode;
  script: ScriptVerdict;
  model: string;
  decodeMs: number;
  audioMs: number;
  peak: number;
  note?: string;
  /**
   * English from Whisper's own speech-to-English task, for languages whose text
   * translation pack is weak or missing (Marathi). Used as the translation pivot.
   */
  english?: string;
  /** Whisper slips fixed with the product's spellcheck dictionary, as [heard, corrected]. */
  corrections?: [string, string][];
}

async function run(samples: Float32Array, lang: LanguageCode, task: 'transcribe' | 'translate') {
  const pcm = Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength).toString('base64');
  const reply = await callWorker({ op: 'transcribe', lang, task, pcm }, 120_000);
  if (!reply.ok) throw new Error(String(reply.error ?? 'Whisper failed'));
  const corrections = (Array.isArray(reply.corrections) ? reply.corrections : []) as [string, string][];
  return { text: String(reply.text ?? '').trim(), ms: Number(reply.ms ?? 0), model: String(reply.model ?? ''), corrections };
}

/** Transcribe 16 kHz mono float PCM spoken in `lang`. */
export async function transcribe(samples: Float32Array, lang: LanguageCode): Promise<SttResult> {
  if (WHISPER_UNSUPPORTED.has(lang)) throw new Error('Whisper has no Odia support — type the message instead.');
  const files = whisperFiles();
  if (!files) throw new Error('No Whisper model found in the ITANTRA checkout.');
  let peak = 0;
  for (let i = 0; i < samples.length; i += 1) peak = Math.max(peak, Math.abs(samples[i]));
  const audioMs = Math.round((samples.length / 16000) * 1000);
  if (peak < 0.0005) {
    return { text: '', language: lang, script: 'empty', model: files.label, decodeMs: 0, audioMs, peak, note: 'The microphone sent digital silence — it is muted or its Windows input volume is at 0.' };
  }
  // Normalise quiet microphones to a healthy level; Whisper is sensitive to very low gain.
  const gain = Math.min(50, 0.6 / peak);
  const input = gain > 1.05 ? samples.map((s) => s * gain) : samples;

  const first = await run(input, lang, 'transcribe');
  // Marathi has no dependable mr→en text pack in the product, but Whisper translates Marathi
  // speech to English far better than text MT does, so use that as the pivot.
  const speechEnglish = SPEECH_PIVOT.has(lang) ? (await run(input, lang, 'translate')).text : '';
  const script = scriptOf(first.text, lang);
  if (script === 'native' || script === 'empty' || lang === 'en') {
    const fixes = first.corrections.map(([a, b]) => `${a}→${b}`).join(', ');
    return {
      ...(speechEnglish && scriptOf(speechEnglish, 'en') === 'native' ? { english: speechEnglish } : {}),
      text: first.text,
      language: lang,
      script,
      model: files.label,
      decodeMs: first.ms,
      audioMs,
      peak,
      ...(fixes ? { corrections: first.corrections, note: `Spelling corrected with the ITANTRA ${lang} dictionary: ${fixes}` } : {}),
    };
  }
  // Wrong script (Urdu script for Hindi on whisper-base, romanised Marathi, ...). Fall back to
  // Whisper's own speech-to-English task on the same audio: real English the pivot can use.
  const english = await run(input, lang, 'translate');
  if (english.text && scriptOf(english.text, 'en') === 'native') {
    return {
      text: english.text,
      language: 'en',
      script: 'latin',
      model: files.label,
      decodeMs: first.ms + english.ms,
      audioMs,
      peak,
      note: `Whisper could not write ${lang} in its own script ("${first.text}"), so it translated the speech to English: "${english.text}".`,
    };
  }
  return {
    text: '',
    language: lang,
    script,
    model: files.label,
    decodeMs: first.ms + english.ms,
    audioMs,
    peak,
    note: `Whisper heard "${first.text}" but not in ${lang} script — please repeat slowly and clearly.`,
  };
}
