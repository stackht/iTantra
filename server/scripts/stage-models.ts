import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { ANDROID_DIR, LOCAL_MODELS } from '../src/models/paths.ts';

/**
 * npm run models:stage
 *
 * Collects exactly the model files the hub uses into deploy/models/, in the same layout
 * the hub expects, so the Docker image can bake them in:
 *
 *   deploy/models/local/    -> /app/server/models        (Whisper-small, Piper voices)
 *   deploy/models/android/  -> /opt/itantra/android       (ITANTRA_ANDROID_DIR subset:
 *                                                          Opus-MT packs, spellcheck dictionaries)
 */
const root = resolve(LOCAL_MODELS, '..', '..');
const out = join(root, 'deploy', 'models');
const local = join(out, 'local');
const android = join(out, 'android');

function copy(from: string, to: string, label: string): void {
  if (!existsSync(from)) throw new Error(`Missing ${label}: ${from}`);
  mkdirSync(join(to, '..'), { recursive: true });
  cpSync(from, to, { recursive: true });
}

function size(path: string): number {
  const s = statSync(path);
  if (s.isFile()) return s.size;
  return readdirSync(path).reduce((n, f) => n + size(join(path, f)), 0);
}

rmSync(out, { recursive: true, force: true });

// Whisper-small int8 (catalog upgrade pack) — the STT model.
const whisper = join(LOCAL_MODELS, 'stt', 'whisper-small');
for (const f of ['small-encoder.int8.onnx', 'small-decoder.int8.onnx', 'small-tokens.txt']) {
  copy(join(whisper, f), join(local, 'stt', 'whisper-small', f), `Whisper-small ${f} (run npm run stt:install)`);
}

// Piper voices for the three prototype languages, with portable manifests.
for (const lang of ['en', 'hi', 'mr']) {
  const src = join(LOCAL_MODELS, 'tts', lang);
  const dst = join(local, 'tts', lang);
  copy(src, dst, `${lang} voice (run npm run voices:install -- ${lang})`);
  const manifestPath = join(dst, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, string>;
  for (const key of ['model', 'tokens', 'dataDir']) {
    const value = manifest[key];
    const parts = value.split(/[\\/]+/);
    const at = parts.lastIndexOf(lang);
    manifest[key] = at >= 0 ? parts.slice(at + 1).join('/') : relative(src, value).replace(/\\/g, '/');
  }
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
}

// Opus-MT packs from the Android project's conversion output.
const mt = join(ANDROID_DIR, 'model-conversion', 'converted_v2');
for (const pair of ['hi-en', 'en-hi', 'en-mr']) {
  copy(join(mt, pair), join(android, 'model-conversion', 'converted_v2', pair), `Opus-MT ${pair}`);
}
// mr-en: tokenizer/config from the pack folder, weights from the fp32 conversion (gated use).
for (const f of ['config.json', 'tokenizer']) {
  copy(join(mt, 'mr-en', f), join(android, 'model-conversion', 'converted_v2', 'mr-en', f), `Opus-MT mr-en ${f}`);
}
for (const f of ['encoder_model.onnx', 'decoder_model.onnx']) {
  copy(join(mt, 'mr-en-fp32', 'models', f), join(android, 'model-conversion', 'converted_v2', 'mr-en-fp32', 'models', f), `Opus-MT mr-en ${f}`);
}

// Spellcheck dictionaries used to clean Whisper transcripts.
for (const lang of ['hi', 'mr']) {
  const f = join('app', 'src', 'main', 'assets', 'spellcheck', `${lang}.bloom`);
  copy(join(ANDROID_DIR, f), join(android, f), `${lang} spellcheck dictionary`);
}

console.log(`Staged models into ${out}`);
for (const part of [join(local, 'stt'), join(local, 'tts'), join(android, 'model-conversion'), join(android, 'app')]) {
  console.log(`  ${relative(out, part).padEnd(24)} ${(size(part) / 1e6).toFixed(0)} MB`);
}
console.log(`  total                    ${(size(out) / 1e6).toFixed(0)} MB`);
