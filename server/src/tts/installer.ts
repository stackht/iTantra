import { execFile } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { copyFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { LanguageCode } from '@itantra/shared';
import { ALL_LANGUAGES, VOICE_PACKS, type VoicePack } from './catalog.ts';

const execFileAsync = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));

/** Where installed voices live: server/models/tts/<lang>/ (git-ignored). */
export const MODELS_DIR = resolve(here, '../../models/tts');
/** Android product checkout, used as a local pack source before downloading. */
export const ANDROID_DIR = process.env.ITANTRA_ANDROID_DIR ?? 'D:\\Projects\\ITANTRA';

export interface VoiceManifest {
  lang: LanguageCode;
  id: string;
  label: string;
  license: string;
  model: string;
  tokens: string;
  dataDir: string;
  sampleRate?: number;
  installedAt: number;
  source: string;
}

export type VoiceStatus = 'none' | 'available' | 'installing' | 'ready' | 'error';

export interface VoiceState {
  lang: LanguageCode;
  status: VoiceStatus;
  progress: number;
  label: string | null;
  license: string | null;
  detail: string;
  sizeBytes: number | null;
}

const progress = new Map<LanguageCode, { progress: number; detail: string; error?: string }>();

function manifestPath(lang: LanguageCode): string {
  return join(MODELS_DIR, lang, 'manifest.json');
}

export function readManifest(lang: LanguageCode): VoiceManifest | null {
  try {
    const path = manifestPath(lang);
    if (!existsSync(path)) return null;
    const manifest = JSON.parse(readFileSync(path, 'utf8')) as VoiceManifest;
    return existsSync(manifest.model) && existsSync(manifest.tokens) ? manifest : null;
  } catch {
    return null;
  }
}

export function voiceStates(): Record<LanguageCode, VoiceState> {
  const out = {} as Record<LanguageCode, VoiceState>;
  for (const lang of ALL_LANGUAGES) {
    const pack = VOICE_PACKS[lang];
    const manifest = readManifest(lang);
    const running = progress.get(lang);
    if (running && !running.error && running.progress < 1) {
      out[lang] = { lang, status: 'installing', progress: running.progress, label: pack?.label ?? null, license: pack?.license ?? null, detail: running.detail, sizeBytes: pack?.sizeBytes ?? null };
    } else if (manifest) {
      out[lang] = { lang, status: 'ready', progress: 1, label: manifest.label, license: manifest.license, detail: `Installed · ${manifest.source}`, sizeBytes: pack?.sizeBytes ?? null };
    } else if (running?.error) {
      out[lang] = { lang, status: 'error', progress: 0, label: pack?.label ?? null, license: pack?.license ?? null, detail: running.error, sizeBytes: pack?.sizeBytes ?? null };
    } else if (pack) {
      const local = localPackPath(pack);
      out[lang] = { lang, status: 'available', progress: 0, label: pack.label, license: pack.license, detail: local ? 'Pack found in the Android repo checkout' : 'Downloadable from the public release', sizeBytes: pack.sizeBytes };
    } else {
      out[lang] = { lang, status: 'none', progress: 0, label: null, license: null, detail: 'No open-licensed offline voice for this language yet', sizeBytes: null };
    }
  }
  return out;
}

function localPackPath(pack: VoicePack): string | null {
  const candidate = join(ANDROID_DIR, 'model-conversion', 'converted', 'open-tts', pack.localFile);
  return existsSync(candidate) ? candidate : null;
}

function tarBinary(): string {
  // Git Bash's GNU tar cannot read bzip2 on Windows; the OS ships bsdtar which can.
  return process.platform === 'win32' ? 'C:\\Windows\\System32\\tar.exe' : 'tar';
}

function findFile(dir: string, predicate: (name: string) => boolean): string | null {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isFile() && predicate(entry.name)) return full;
    if (entry.isDirectory()) {
      const nested = findFile(full, predicate);
      if (nested) return nested;
    }
  }
  return null;
}

function findDir(dir: string, name: string): string | null {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const full = join(dir, entry.name);
    if (entry.name === name) return full;
    const nested = findDir(full, name);
    if (nested) return nested;
  }
  return null;
}

async function download(url: string, target: string, expected: number, onProgress: (fraction: number) => void): Promise<void> {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok || !response.body) throw new Error(`Download failed: HTTP ${response.status}`);
  const total = Number(response.headers.get('content-length') ?? expected) || expected;
  let received = 0;
  const counter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      received += chunk.byteLength;
      onProgress(Math.min(0.95, received / total));
      controller.enqueue(chunk);
    },
  });
  await pipeline(Readable.fromWeb(response.body.pipeThrough(counter) as import('node:stream/web').ReadableStream), createWriteStream(target));
}

/**
 * Installs one language's voice: copy from the Android checkout or download,
 * extract with bsdtar, locate model/tokens/espeak data, write a manifest.
 */
export async function installVoice(lang: LanguageCode, log: (line: string) => void = () => {}): Promise<VoiceManifest> {
  const pack = VOICE_PACKS[lang];
  if (!pack) throw new Error(`No open voice pack for ${lang}`);
  if (readManifest(lang)) return readManifest(lang)!;
  if (progress.get(lang) && !progress.get(lang)!.error && progress.get(lang)!.progress < 1) throw new Error('Already installing');

  const target = join(MODELS_DIR, lang);
  const archive = join(MODELS_DIR, `${pack.id}.tar.bz2`);
  const set = (fraction: number, detail: string) => progress.set(lang, { progress: fraction, detail });
  try {
    mkdirSync(MODELS_DIR, { recursive: true });
    rmSync(target, { recursive: true, force: true });
    mkdirSync(target, { recursive: true });

    let source: string;
    const local = localPackPath(pack);
    if (local) {
      set(0.05, 'Copying pack from the Android repo checkout…');
      log(`[voices] ${lang}: copying ${local}`);
      await copyFile(local, archive);
      source = `Android repo: ${pack.localFile}`;
      set(0.6, 'Copied. Extracting…');
    } else {
      set(0.02, 'Downloading from the public release…');
      log(`[voices] ${lang}: downloading ${pack.url}`);
      await download(pack.url, archive, pack.sizeBytes, (f) => set(0.02 + f * 0.6, `Downloading… ${Math.round(f * 100)}%`));
      source = `download: ${pack.url}`;
      set(0.65, 'Downloaded. Extracting…');
    }

    await execFileAsync(tarBinary(), ['-xf', archive, '-C', target, '--strip-components=1']);
    rmSync(archive, { force: true });
    set(0.9, 'Locating model files…');

    const model = findFile(target, (n) => n.endsWith('.onnx'));
    const tokens = findFile(target, (n) => n === 'tokens.txt');
    const dataDir = findDir(target, 'espeak-ng-data');
    if (!model || !tokens || !dataDir) throw new Error('Pack is missing model.onnx, tokens.txt or espeak-ng-data');

    const manifest: VoiceManifest = {
      lang,
      id: pack.id,
      label: pack.label,
      license: pack.license,
      model,
      tokens,
      dataDir,
      installedAt: Date.now(),
      source,
    };
    writeFileSync(manifestPath(lang), JSON.stringify(manifest, null, 2));
    set(1, 'Installed');
    log(`[voices] ${lang}: installed ${pack.label} (${(statSync(model).size / 1e6).toFixed(1)} MB)`);
    return manifest;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    progress.set(lang, { progress: 0, detail: message, error: message });
    rmSync(target, { recursive: true, force: true });
    rmSync(archive, { force: true });
    log(`[voices] ${lang}: FAILED — ${message}`);
    throw error;
  }
}
