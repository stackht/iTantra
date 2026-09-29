import type { LanguageCode } from '@itantra/shared';
import { getLanguage } from '@itantra/shared';
import { neuralVoiceReady, synthesizeNeural } from './neuralTts.ts';

/**
 * window.speechSynthesis wrapper.
 *
 * Voice availability is entirely OS/browser dependent: Chrome desktop ships a
 * Google Hindi voice, Edge has neural Indian voices, plain Windows often has only
 * English. When the exact language has no voice we fall back to a voice that
 * reads the same script (a Hindi voice reads Devanagari Marathi intelligibly)
 * and say so — never silently.
 */

export const speechSynthesisSupported = (): boolean =>
  typeof window !== 'undefined' && 'speechSynthesis' in window;

export interface SpeakOptions {
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (message: string) => void;
  /** Called when playback proceeds with a substitute voice. */
  onFallback?: (message: string) => void;
}

export interface VoicePick {
  voice: SpeechSynthesisVoice | null;
  /** 'exact' = language voice · 'script' = same-script substitute · 'none' = nothing usable */
  match: 'exact' | 'script' | 'none';
}

/** Languages whose script another installed voice can read acceptably. */
const SCRIPT_SUBSTITUTES: Partial<Record<LanguageCode, LanguageCode[]>> = {
  mr: ['hi'],
  hi: ['mr'],
};

export class Speaker {
  private current: SpeechSynthesisUtterance | null = null;
  private currentAudio: HTMLAudioElement | null = null;
  private generation = 0;

  /**
   * Neural path: the hub synthesises with the product's sherpa-onnx voice pack
   * and the phone plays the WAV. Falls back to the browser voice on any failure.
   */
  private async speakNeural(text: string, language: LanguageCode, options: SpeakOptions, generation: number): Promise<void> {
    const audio = await synthesizeNeural(text, language);
    if (generation !== this.generation) {
      if (audio) URL.revokeObjectURL(audio.url);
      return;
    }
    if (!audio) {
      this.speakBrowser(text, language, options);
      return;
    }
    const element = new Audio(audio.url);
    this.currentAudio = element;
    const done = () => {
      if (this.currentAudio === element) this.currentAudio = null;
      URL.revokeObjectURL(audio.url);
    };
    element.onplay = () => options.onStart?.();
    element.onended = () => {
      done();
      options.onEnd?.();
    };
    element.onerror = () => {
      done();
      this.speakBrowser(text, language, options);
    };
    try {
      await element.play();
      options.onFallback?.(`Neural voice: ${audio.voice} · synthesised on the hub in ${audio.synthesisMs} ms`);
    } catch {
      done();
      options.onError?.('Audio playback blocked until you interact with the page. Showing translated text.');
    }
  }

  listVoices(): SpeechSynthesisVoice[] {
    if (!speechSynthesisSupported()) return [];
    return window.speechSynthesis.getVoices();
  }

  /** Voices load asynchronously in Chromium; resolve once they are present. */
  waitForVoices(timeoutMs = 1200): Promise<SpeechSynthesisVoice[]> {
    if (!speechSynthesisSupported()) return Promise.resolve([]);
    const immediate = window.speechSynthesis.getVoices();
    if (immediate.length > 0) return Promise.resolve(immediate);
    return new Promise((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        window.speechSynthesis.removeEventListener('voiceschanged', done);
        resolve(window.speechSynthesis.getVoices());
      };
      window.speechSynthesis.addEventListener('voiceschanged', done);
      setTimeout(done, timeoutMs);
    });
  }

  private voiceFor(language: LanguageCode, voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
    const tag = getLanguage(language).capability.tag.toLowerCase();
    const base = tag.split('-')[0];
    const norm = (v: SpeechSynthesisVoice) => v.lang.toLowerCase().replace('_', '-');
    return voices.find((v) => norm(v) === tag) ?? voices.find((v) => norm(v).startsWith(`${base}-`) || norm(v) === base) ?? null;
  }

  pickVoiceDetailed(language: LanguageCode, voices: SpeechSynthesisVoice[]): VoicePick {
    const exact = this.voiceFor(language, voices);
    if (exact) return { voice: exact, match: 'exact' };
    for (const substitute of SCRIPT_SUBSTITUTES[language] ?? []) {
      const voice = this.voiceFor(substitute, voices);
      if (voice) return { voice, match: 'script' };
    }
    return { voice: null, match: 'none' };
  }

  /** Back-compat helper: the voice to use, exact or same-script substitute. */
  pickVoice(language: LanguageCode, voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
    return this.pickVoiceDetailed(language, voices).voice;
  }

  speak(text: string, language: LanguageCode, options: SpeakOptions = {}): boolean {
    this.cancel();
    if (neuralVoiceReady(language)) {
      const generation = this.generation;
      void this.speakNeural(text, language, options, generation);
      return true;
    }
    return this.speakBrowser(text, language, options);
  }

  private speakBrowser(text: string, language: LanguageCode, options: SpeakOptions): boolean {
    if (!speechSynthesisSupported()) {
      options.onError?.('Voice playback unavailable in this browser. Showing translated text.');
      return false;
    }
    const utterance = new SpeechSynthesisUtterance(text);
    const info = getLanguage(language);
    const pick = this.pickVoiceDetailed(language, this.listVoices());
    utterance.lang = pick.match === 'script' && pick.voice ? pick.voice.lang : info.capability.tag;
    if (pick.voice) utterance.voice = pick.voice;
    utterance.rate = 0.96;
    utterance.pitch = 1;

    utterance.onstart = () => options.onStart?.();
    utterance.onend = () => {
      this.current = null;
      options.onEnd?.();
    };
    utterance.onerror = (event) => {
      this.current = null;
      if (event.error === 'interrupted' || event.error === 'canceled') return;
      const message =
        event.error === 'not-allowed'
          ? 'Voice playback blocked until you interact with the page. Showing translated text.'
          : 'Voice playback unavailable. Showing translated text.';
      options.onError?.(message);
    };

    this.current = utterance;
    window.speechSynthesis.speak(utterance);
    if (pick.match === 'script' && pick.voice) {
      options.onFallback?.(`No ${info.name} voice installed — reading with ${pick.voice.name} (${pick.voice.lang}).`);
    } else if (pick.match === 'none') {
      options.onFallback?.(`No ${info.name} voice installed on this system. Speaking with the browser default; install a ${info.name} voice for natural playback.`);
    }
    return true;
  }

  cancel(): void {
    this.generation += 1;
    if (this.currentAudio) {
      const element = this.currentAudio;
      this.currentAudio = null;
      // Detach first: clearing src fires 'error', which must not trigger the fallback voice.
      element.onplay = null;
      element.onended = null;
      element.onerror = null;
      element.pause();
      element.removeAttribute('src');
      element.load();
    }
    if (!speechSynthesisSupported()) return;
    window.speechSynthesis.cancel();
    this.current = null;
  }

  get isSpeaking(): boolean {
    return Boolean(this.current) || Boolean(this.currentAudio);
  }
}

export const speaker = new Speaker();
