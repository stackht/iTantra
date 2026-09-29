import { phraseById } from './data/phrases.ts';
import { DEVICE_A, DEVICE_B } from './network.ts';
import type { LanguageCode } from './types.ts';

export type DemoAction =
  | { kind: 'set-language'; device: 'A' | 'B'; language: LanguageCode }
  | { kind: 'highlight'; target: string }
  | {
      kind: 'submit';
      text: string;
      from: string;
      to: string;
      sourceLanguage: LanguageCode;
      targetLanguage: LanguageCode;
      origin: 'DEMO' | 'SOS';
      inputMode: 'voice' | 'text';
    }
  | { kind: 'speak'; device: 'A' | 'B'; language: LanguageCode }
  | { kind: 'finish' };

export interface DemoStep {
  id: string;
  title: string;
  detail: string;
  durationMs: number;
  actions: DemoAction[];
}

const HELP_HI = phraseById('need-help');
const REPLY_MR = phraseById('coming-to-help');

/**
 * Scripted demo. Timings are authored narration windows, not measured values.
 * Total runtime is roughly 18 seconds.
 */
export const DEMO_SCRIPT: DemoStep[] = [
  {
    id: 'pairing',
    title: 'Device pairing',
    detail: 'Two devices join the same low-bandwidth link. Each keeps its own language.',
    durationMs: 1300,
    actions: [
      { kind: 'set-language', device: 'A', language: 'hi' },
      { kind: 'set-language', device: 'B', language: 'mr' },
    ],
  },
  {
    id: 'capture',
    title: 'Device A speaks',
    detail: 'Person A holds the microphone and speaks Hindi.',
    durationMs: 1100,
    actions: [{ kind: 'highlight', target: 'device-a-mic' }],
  },
  {
    id: 'stt',
    title: 'Speech recognised',
    detail: 'Speech-to-text produces a transcript, then language detection confirms Hindi.',
    durationMs: 1400,
    actions: [
      {
        kind: 'submit',
        text: HELP_HI.hi,
        from: DEVICE_A,
        to: DEVICE_B,
        sourceLanguage: 'hi',
        targetLanguage: 'mr',
        origin: 'DEMO',
        inputMode: 'voice',
      },
    ],
  },
  { id: 'pivot', title: 'Hindi → English → Marathi', detail: 'The transcript is translated through an English pivot before transmission.', durationMs: 1500, actions: [] },
  { id: 'packet', title: 'Packet created', detail: 'Text, pivot and priority are packed with a SHA-256 integrity tag.', durationMs: 1500, actions: [{ kind: 'highlight', target: 'packet-inspector' }] },
  { id: 'route', title: 'Routed over the mesh', detail: 'The packet walks DEVICE A → RELAY 01 → RELAY 02 → DEVICE B.', durationMs: 2400, actions: [{ kind: 'highlight', target: 'network-view' }] },
  {
    id: 'deliver',
    title: 'Delivered to Device B',
    detail: 'Device B renders the message in Marathi — the language its user reads.',
    durationMs: 1300,
    actions: [{ kind: 'highlight', target: 'device-b-inbox' }],
  },
  {
    id: 'tts',
    title: 'Spoken aloud',
    detail: 'Text-to-speech reads the Marathi text using a system voice when one is installed.',
    durationMs: 2200,
    actions: [{ kind: 'speak', device: 'B', language: 'mr' }],
  },
  {
    id: 'reply',
    title: 'Device B replies',
    detail: 'Person B answers in Marathi. The same pipeline runs in reverse.',
    durationMs: 1500,
    actions: [
      { kind: 'highlight', target: 'device-b-input' },
      {
        kind: 'submit',
        text: REPLY_MR.mr,
        from: DEVICE_B,
        to: DEVICE_A,
        sourceLanguage: 'mr',
        targetLanguage: 'hi',
        origin: 'DEMO',
        inputMode: 'voice',
      },
    ],
  },
  { id: 'translate-back', title: 'Marathi → English → Hindi', detail: 'The reply is translated back into Hindi and delivered to Device A.', durationMs: 3000, actions: [] },
  {
    id: 'finish',
    title: 'Communication established',
    detail: 'Different languages. One communication channel.',
    durationMs: 1800,
    actions: [{ kind: 'finish' }],
  },
];

export const DEMO_TOTAL_MS = DEMO_SCRIPT.reduce((sum, step) => sum + step.durationMs, 0);

export interface DemoTickResult {
  completed: DemoStep[];
  actions: DemoAction[];
  index: number;
  finished: boolean;
}

/**
 * Pure time-driven demo runner: `advance(now)` returns whatever finished in the
 * elapsed window. No timers, so it is testable with an injected clock.
 */
export class DemoRunner {
  private readonly script: DemoStep[];

  index = 0;
  startedAt = 0;
  finished = false;
  private elapsedOffset = 0;

  constructor(script: DemoStep[] = DEMO_SCRIPT) {
    this.script = script;
  }

  get total(): number {
    return this.script.length;
  }

  start(now: number): DemoAction[] {
    this.index = 0;
    this.startedAt = now;
    this.finished = false;
    return this.script[0]?.actions ?? [];
  }

  pause(): void {
    // Re-base the clock so the paused window is not counted once resumed.
    this.startedAt = Date.now();
    const cursor = this.script[this.index];
    if (cursor) this.elapsedOffset = cursor.durationMs;
  }

  resume(now: number): void {
    this.startedAt = now - this.elapsedOffset;
  }

  advance(now: number): DemoTickResult {
    const completed: DemoStep[] = [];
    const actions: DemoAction[] = [];
    if (this.finished) return { completed, actions, index: this.index, finished: true };

    let cursorNow = now;
    while (this.index < this.script.length) {
      const step = this.script[this.index];
      const deadline = this.startedAt + this.elapsedOffset + step.durationMs;
      if (cursorNow < deadline) break;
      completed.push(step);
      actions.push(...step.actions);
      this.index += 1;
      this.elapsedOffset = 0;
      // Subsequent steps are back-to-back from the previous deadline.
      this.startedAt = deadline;
      cursorNow = Math.max(cursorNow, deadline);
    }

    if (this.index >= this.script.length) {
      this.finished = true;
    }
    return { completed, actions, index: this.index, finished: this.finished };
  }

  skipToEnd(now: number): DemoTickResult {
    const completed: DemoStep[] = [];
    const actions: DemoAction[] = [];
    while (this.index < this.script.length) {
      const step = this.script[this.index];
      completed.push(step);
      actions.push(...step.actions);
      this.index += 1;
    }
    this.finished = true;
    this.startedAt = now;
    this.elapsedOffset = 0;
    return { completed, actions, index: this.index, finished: true };
  }

  reset(): void {
    this.index = 0;
    this.startedAt = 0;
    this.elapsedOffset = 0;
    this.finished = false;
  }
}
