import { createRequire } from 'node:module';
import { delimiter, join } from 'node:path';
import type { LanguageCode } from '@itantra/shared';
import { readManifest, type VoiceManifest } from './installer.ts';

/**
 * Real neural text-to-speech on the hub using sherpa-onnx (the runtime the
 * Android product ships) and the installed Piper/VITS voice packs. Output is
 * 16-bit PCM WAV the browser can play directly.
 */

interface GeneratedAudio {
  samples: Float32Array;
  sampleRate: number;
}

interface OfflineTtsLike {
  numSpeakers: number;
  sampleRate: number;
  generate(input: { text: string; sid: number; speed: number }): GeneratedAudio;
}

interface SherpaModule {
  OfflineTts: new (config: unknown) => OfflineTtsLike;
}

const require = createRequire(import.meta.url);
let sherpa: SherpaModule | null | undefined;

function loadSherpa(): SherpaModule | null {
  if (sherpa !== undefined) return sherpa;
  try {
    if (process.platform === 'win32') {
      // The native addon dlopens onnxruntime.dll from its sibling package; make it findable.
      const winPkg = require.resolve('sherpa-onnx-win-x64/package.json');
      process.env.PATH = `${join(winPkg, '..')}${delimiter}${process.env.PATH ?? ''}`;
    }
    sherpa = require('sherpa-onnx-node') as SherpaModule;
  } catch (error) {
    console.error('[tts] sherpa-onnx-node unavailable:', error instanceof Error ? error.message : error);
    sherpa = null;
  }
  return sherpa;
}

const engines = new Map<LanguageCode, OfflineTtsLike>();
const wavCache = new Map<string, Buffer>();
const WAV_CACHE_LIMIT = 64;

export function neuralRuntimeAvailable(): boolean {
  return loadSherpa() !== null;
}

function engineFor(lang: LanguageCode, manifest: VoiceManifest): OfflineTtsLike | null {
  const cached = engines.get(lang);
  if (cached) return cached;
  const mod = loadSherpa();
  if (!mod) return null;
  const engine = new mod.OfflineTts({
    model: {
      vits: { model: manifest.model, tokens: manifest.tokens, dataDir: manifest.dataDir },
      numThreads: 2,
      debug: false,
      provider: 'cpu',
    },
    maxNumSentences: 1,
  });
  engines.set(lang, engine);
  return engine;
}

/** Drops a loaded engine (after a re-install). */
export function unloadVoice(lang: LanguageCode): void {
  engines.delete(lang);
  for (const key of [...wavCache.keys()]) if (key.startsWith(`${lang}:`)) wavCache.delete(key);
}

export function voiceReady(lang: LanguageCode): boolean {
  return neuralRuntimeAvailable() && readManifest(lang) !== null;
}

export interface SynthesisResult {
  wav: Buffer;
  sampleRate: number;
  durationMs: number;
  synthesisMs: number;
  cached: boolean;
  voice: string;
}

export function synthesize(lang: LanguageCode, text: string, speed = 1.0): SynthesisResult {
  const manifest = readManifest(lang);
  if (!manifest) throw new Error(`No installed voice for ${lang}`);
  const engine = engineFor(lang, manifest);
  if (!engine) throw new Error('Neural TTS runtime unavailable on this hub');
  const key = `${lang}:${speed}:${text}`;
  const cached = wavCache.get(key);
  if (cached) {
    return { wav: cached, sampleRate: engine.sampleRate, durationMs: wavDurationMs(cached), synthesisMs: 0, cached: true, voice: manifest.label };
  }
  const started = Date.now();
  const audio = engine.generate({ text, sid: 0, speed });
  const synthesisMs = Date.now() - started;
  const wav = encodeWav(audio.samples, audio.sampleRate);
  if (wavCache.size >= WAV_CACHE_LIMIT) wavCache.delete(wavCache.keys().next().value as string);
  wavCache.set(key, wav);
  return {
    wav,
    sampleRate: audio.sampleRate,
    durationMs: Math.round((audio.samples.length / audio.sampleRate) * 1000),
    synthesisMs,
    cached: false,
    voice: manifest.label,
  };
}

function encodeWav(samples: Float32Array, sampleRate: number): Buffer {
  const dataBytes = samples.length * 2;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < samples.length; i += 1) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    buffer.writeInt16LE(Math.round(s < 0 ? s * 0x8000 : s * 0x7fff), 44 + i * 2);
  }
  return buffer;
}

function wavDurationMs(wav: Buffer): number {
  const sampleRate = wav.readUInt32LE(24);
  const dataBytes = wav.readUInt32LE(40);
  return Math.round((dataBytes / 2 / sampleRate) * 1000);
}
