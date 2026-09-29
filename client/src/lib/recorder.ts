/**
 * Microphone capture for push-to-talk, feeding the hub's Whisper (the product's STT
 * model). No browser speech service is involved: raw PCM is captured with an
 * AudioWorklet, down-sampled to 16 kHz mono and POSTed to /api/stt.
 *
 * The level meter is the honest diagnostic: if it does not move while you speak,
 * the browser is listening to the wrong input device or the OS has it muted.
 */

const WORKLET = `
class Capture extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch && ch.length) this.port.postMessage(ch.slice(0));
    return true;
  }
}
registerProcessor('itantra-capture', Capture);
`;

import { hubOnline } from './hub.ts';
import { apiUrl } from './config.ts';

export const TARGET_RATE = 16000;

export interface RecorderCallbacks {
  /** 0..1 RMS level, ~30 times per second. */
  onLevel?: (level: number) => void;
  /** Auto-stop fired (silence after speech, or max length). */
  onAutoStop?: () => void;
}

export interface Recording {
  samples: Float32Array;
  durationMs: number;
  peak: number;
  deviceLabel: string;
}

export const microphoneAllowedHere = (): boolean => typeof window !== 'undefined' && window.isSecureContext;
export const captureSupported = (): boolean =>
  typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia) && typeof AudioContext !== 'undefined';

function downsample(input: Float32Array, fromRate: number): Float32Array {
  if (fromRate === TARGET_RATE) return input;
  const ratio = fromRate / TARGET_RATE;
  const out = new Float32Array(Math.floor(input.length / ratio));
  // Box-filter average per output sample: cheap anti-aliasing adequate for speech.
  for (let i = 0; i < out.length; i += 1) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j += 1) sum += input[j];
    out[i] = sum / Math.max(1, end - start);
  }
  return out;
}

export class MicRecorder {
  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private chunks: Float32Array[] = [];
  private startedAt = 0;
  private heardSpeechAt = 0;
  private lastLoudAt = 0;
  private autoStop = false;
  private readonly callbacks: RecorderCallbacks;

  constructor(callbacks: RecorderCallbacks = {}) {
    this.callbacks = callbacks;
  }

  get recording(): boolean {
    return this.node !== null;
  }

  /**
   * Opens the microphone and starts buffering. With `autoStop`, recording ends by itself
   * after ~1.2 s of silence following speech (tap-to-talk) or at 15 s.
   */
  async start(options: { autoStop?: boolean } = {}): Promise<void> {
    if (this.node) return;
    this.autoStop = Boolean(options.autoStop);
    this.chunks = [];
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    this.context = new AudioContext();
    if (this.context.state === 'suspended') await this.context.resume();
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' }));
    try {
      await this.context.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }
    this.source = this.context.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.context, 'itantra-capture');
    this.startedAt = performance.now();
    this.heardSpeechAt = 0;
    this.lastLoudAt = 0;
    let lastLevelAt = 0;
    this.node.port.onmessage = (event: MessageEvent<Float32Array>) => {
      const chunk = event.data;
      this.chunks.push(chunk);
      let sum = 0;
      for (let i = 0; i < chunk.length; i += 1) sum += chunk[i] * chunk[i];
      const rms = Math.sqrt(sum / chunk.length);
      const now = performance.now();
      if (rms > 0.004) {
        if (!this.heardSpeechAt) this.heardSpeechAt = now;
        this.lastLoudAt = now;
      }
      if (now - lastLevelAt > 33) {
        lastLevelAt = now;
        // dB-scaled meter: -60 dBFS = empty, -10 dBFS = full, so quiet microphones still show movement.
        const db = 20 * Math.log10(Math.max(rms, 1e-6));
        this.callbacks.onLevel?.(Math.min(1, Math.max(0, (db + 60) / 50)));
      }
      if (this.autoStop) {
        const silentFor = this.lastLoudAt ? now - this.lastLoudAt : 0;
        if ((this.heardSpeechAt && silentFor > 1200) || now - this.startedAt > 15000) {
          this.autoStop = false;
          this.callbacks.onAutoStop?.();
        }
      }
    };
    this.source.connect(this.node);
    // Keep the graph pulled without making sound.
    const mute = this.context.createGain();
    mute.gain.value = 0;
    this.node.connect(mute).connect(this.context.destination);
  }

  /** Stops the microphone and returns the utterance at 16 kHz. */
  async stop(): Promise<Recording | null> {
    if (!this.node || !this.context) return null;
    const rate = this.context.sampleRate;
    const deviceLabel = this.stream?.getAudioTracks()[0]?.label ?? 'microphone';
    this.release();
    const total = this.chunks.reduce((n, c) => n + c.length, 0);
    const joined = new Float32Array(total);
    let offset = 0;
    for (const chunk of this.chunks) {
      joined.set(chunk, offset);
      offset += chunk.length;
    }
    this.chunks = [];
    const samples = downsample(joined, rate);
    let peak = 0;
    for (let i = 0; i < samples.length; i += 1) peak = Math.max(peak, Math.abs(samples[i]));
    this.callbacks.onLevel?.(0);
    return { samples, durationMs: Math.round((samples.length / TARGET_RATE) * 1000), peak, deviceLabel };
  }

  cancel(): void {
    this.release();
    this.chunks = [];
    this.callbacks.onLevel?.(0);
  }

  private release(): void {
    this.node?.port.close();
    this.node?.disconnect();
    this.source?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.context?.close();
    this.node = null;
    this.source = null;
    this.stream = null;
    this.context = null;
  }
}

export interface TranscriptResponse {
  text: string;
  language: string;
  script: 'native' | 'latin' | 'foreign' | 'empty';
  model: string;
  decodeMs: number;
  audioMs: number;
  peak: number;
  note?: string;
  /** Whisper speech-to-English (Marathi), used as the translation pivot. */
  english?: string;
}

/** Sends the utterance to the hub's Whisper. Throws with a user-facing message on failure. */
export async function transcribeOnHub(samples: Float32Array, lang: string): Promise<TranscriptResponse> {
  if (!hubOnline()) {
    throw new Error('Speech recognition runs the ITANTRA Whisper model on the hub, which is offline (Local demo mode). Start it with npm run dev, or type your message.');
  }
  let response: Response;
  try {
    response = await fetch(apiUrl(`/api/stt?lang=${lang}`), {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: samples.buffer.slice(samples.byteOffset, samples.byteOffset + samples.byteLength) as ArrayBuffer,
    });
  } catch {
    throw new Error('Speech recognition runs on the hub, which is not reachable. Start it with npm run dev, or type your message.');
  }
  const body = (await response.json().catch(() => ({}))) as Partial<TranscriptResponse> & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `Speech recognition failed (HTTP ${response.status}).`);
  return body as TranscriptResponse;
}
