import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** The Android product checkout. Every model the prototype runs comes from here. */
export const ANDROID_DIR = process.env.ITANTRA_ANDROID_DIR ?? 'D:\\Projects\\ITANTRA';

/** Local installs (voices, Whisper-small upgrade) — git-ignored. */
export const LOCAL_MODELS = resolve(here, '../../models');

export interface WhisperFiles {
  id: 'whisper-small' | 'whisper-base';
  label: string;
  encoder: string;
  decoder: string;
  tokens: string;
  source: string;
}

/**
 * Whisper for speech-to-text. Prefers the catalog's optional Whisper-small upgrade
 * (sherpa-onnx release, MIT) when installed, else the Whisper-base int8 the APK bundles.
 */
export function whisperFiles(): WhisperFiles | null {
  const small = join(LOCAL_MODELS, 'stt', 'whisper-small');
  const smallEnc = join(small, 'small-encoder.int8.onnx');
  if (existsSync(smallEnc)) {
    return {
      id: 'whisper-small',
      label: 'Whisper small multilingual (INT8)',
      encoder: smallEnc,
      decoder: join(small, 'small-decoder.int8.onnx'),
      tokens: join(small, 'small-tokens.txt'),
      source: 'ITANTRA catalog upgrade pack (sherpa-onnx asr-models release)',
    };
  }
  const base = join(ANDROID_DIR, 'app', 'src', 'main', 'assets', 'models', 'stt');
  const baseEnc = join(base, 'whisper-base-encoder.int8.onnx');
  if (existsSync(baseEnc)) {
    return {
      id: 'whisper-base',
      label: 'Whisper base multilingual (INT8)',
      encoder: baseEnc,
      decoder: join(base, 'whisper-base-decoder.int8.onnx'),
      tokens: join(base, 'whisper-base-tokens.txt'),
      source: 'bundled in the ITANTRA APK assets',
    };
  }
  return null;
}

/** Opus-MT packs converted by the product (model-conversion/converted_v2). */
export const MT_PACK_DIR = process.env.ITANTRA_MT_DIR ?? join(ANDROID_DIR, 'model-conversion', 'converted_v2');
