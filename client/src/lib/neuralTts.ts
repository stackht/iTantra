import type { LanguageCode } from '@itantra/shared';
import { apiUrl } from './config.ts';

/**
 * Client for the hub's neural voice API (sherpa-onnx Piper/VITS voices — the
 * runtime and packs of the Android product). Everything degrades to the browser
 * voice when the hub is away or a language has no installed voice.
 */

export type NeuralVoiceStatus = 'none' | 'available' | 'installing' | 'ready' | 'error' | 'offline';

export interface NeuralVoiceState {
  lang: LanguageCode;
  status: NeuralVoiceStatus;
  progress: number;
  label: string | null;
  license: string | null;
  detail: string;
  sizeBytes: number | null;
}

const ready = new Set<LanguageCode>();

/** Synchronous readiness for the speaker path (kept in step by the store). */
export function neuralVoiceReady(lang: LanguageCode): boolean {
  return ready.has(lang);
}

export function rememberReadiness(states: Record<string, NeuralVoiceState>): void {
  ready.clear();
  for (const state of Object.values(states)) if (state.status === 'ready') ready.add(state.lang);
}

export async function fetchNeuralVoices(): Promise<{ runtime: boolean; voices: Record<string, NeuralVoiceState> } | null> {
  try {
    const response = await fetch(apiUrl('/api/tts/voices'), { cache: 'no-store' });
    if (!response.ok) return null;
    const body = (await response.json()) as { runtime: boolean; voices: Record<string, NeuralVoiceState> };
    rememberReadiness(body.voices);
    return body;
  } catch {
    ready.clear();
    return null;
  }
}

export async function requestVoiceInstall(lang: LanguageCode): Promise<boolean> {
  try {
    const response = await fetch(apiUrl('/api/tts/install'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lang }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export interface NeuralAudio {
  url: string;
  voice: string;
  synthesisMs: number;
  durationMs: number;
}

/** Fetches a WAV for the text; the caller owns (and revokes) the object URL. */
export async function synthesizeNeural(text: string, lang: LanguageCode): Promise<NeuralAudio | null> {
  try {
    const response = await fetch(apiUrl(`/api/tts?lang=${lang}&text=${encodeURIComponent(text)}`));
    if (!response.ok) return null;
    const blob = await response.blob();
    return {
      url: URL.createObjectURL(blob),
      voice: decodeURIComponent(response.headers.get('x-itantra-voice') ?? 'neural voice'),
      synthesisMs: Number(response.headers.get('x-itantra-synthesis-ms') ?? 0),
      durationMs: Number(response.headers.get('x-itantra-duration-ms') ?? 0),
    };
  } catch {
    return null;
  }
}
