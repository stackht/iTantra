import { useCallback, useEffect, useMemo, useRef } from 'react';
import { DEVICE_B, type LanguageCode } from '@itantra/shared';
import { captureSupported, microphoneAllowedHere, MicRecorder, transcribeOnHub, type TranscriptResponse } from '../lib/recorder.ts';
import { speaker, speechSynthesisSupported } from '../lib/tts.ts';
import { useStore } from '../store/useStore.ts';

export interface UseRecorderOptions {
  lang: LanguageCode;
  onLevel: (level: number) => void;
  onTranscript: (result: TranscriptResponse) => void;
  /** Recording ended (normally or not) — the UI leaves the listening state. */
  onDone: () => void;
  onAutoStop: () => void;
}

export interface RecorderHandle {
  supported: boolean;
  blockedReason: string | null;
  start: (autoStop: boolean) => Promise<boolean>;
  /** Stop capture and send the audio to the hub's Whisper. */
  finish: () => Promise<void>;
  cancel: () => void;
}

/**
 * Push-to-talk on the product's Whisper model. Capture happens in the browser,
 * recognition on the hub; every failure is explained through the notice stack.
 */
export function useRecorder({ lang, onLevel, onTranscript, onDone, onAutoStop }: UseRecorderOptions): RecorderHandle {
  const pushNotice = useStore((s) => s.pushNotice);
  const cb = useRef({ onLevel, onTranscript, onDone, onAutoStop, pushNotice, lang });
  cb.current = { onLevel, onTranscript, onDone, onAutoStop, pushNotice, lang };

  const recorder = useMemo(
    () => new MicRecorder({ onLevel: (l) => cb.current.onLevel(l), onAutoStop: () => cb.current.onAutoStop() }),
    [],
  );
  useEffect(() => () => recorder.cancel(), [recorder]);

  const secure = microphoneAllowedHere();
  const supported = captureSupported() && secure;
  const blockedReason = !secure
    ? 'Microphone blocked on plain http. Use http://localhost on this computer, or run npm run dev:lan and open the https:// address.'
    : !captureSupported()
      ? 'This browser cannot capture microphone audio. Type your message instead.'
      : null;

  const start = useCallback(
    async (autoStop: boolean) => {
      try {
        await recorder.start({ autoStop });
        return true;
      } catch (error) {
        const name = error instanceof Error ? error.name : '';
        cb.current.pushNotice({
          tone: 'warn',
          message:
            name === 'NotAllowedError'
              ? 'Microphone permission denied. Click the lock icon in the address bar, allow the microphone, and try again.'
              : name === 'NotFoundError'
                ? 'No microphone found. Connect one, or type your message.'
                : name === 'NotReadableError'
                  ? 'The microphone is in use by another app. Close it and try again.'
                  : `Could not open the microphone (${name || 'unknown error'}).`,
        });
        cb.current.onDone();
        return false;
      }
    },
    [recorder],
  );

  const finish = useCallback(async () => {
    const recording = await recorder.stop();
    if (!recording) {
      cb.current.onDone();
      return;
    }
    if (recording.durationMs < 300) {
      cb.current.pushNotice({ tone: 'info', message: 'Too short — hold PRESS TO TALK while you speak, or tap once and speak.' });
      cb.current.onDone();
      return;
    }
    if (recording.peak < 0.0005) {
      cb.current.pushNotice({
        tone: 'warn',
        message: `"${recording.deviceLabel}" sent digital silence. It is muted, or its input volume is at 0 in Windows Settings → System → Sound → Input.`,
      });
      cb.current.onDone();
      return;
    }
    if (recording.peak < 0.02) {
      cb.current.pushNotice({
        tone: 'info',
        message: `"${recording.deviceLabel}" is very quiet (peak ${Math.round(recording.peak * 1000) / 10}%). Sending anyway with extra gain; raise the input volume in Windows Settings → System → Sound → Input for better accuracy.`,
      });
    }
    try {
      const result = await transcribeOnHub(recording.samples, cb.current.lang);
      if (result.note) cb.current.pushNotice({ tone: result.text ? 'info' : 'warn', message: result.note });
      if (!result.text) {
        if (!result.note) cb.current.pushNotice({ tone: 'info', message: 'Whisper heard no words. Speak a little louder and closer to the mic.' });
      } else {
        cb.current.onTranscript(result);
      }
    } catch (error) {
      cb.current.pushNotice({ tone: 'warn', message: error instanceof Error ? error.message : 'Speech recognition failed.' });
    } finally {
      cb.current.onDone();
    }
  }, [recorder]);

  return { supported, blockedReason, start, finish, cancel: () => recorder.cancel() };
}

/** One-shot capability probe: drives status bars and honest capability copy. */
export function useCapabilities(): void {
  const setCapabilities = useStore((s) => s.setCapabilities);
  const setReadiness = useStore((s) => s.setReadiness);
  const pushNotice = useStore((s) => s.pushNotice);

  useEffect(() => {
    let cancelled = false;
    const stt = captureSupported() && microphoneAllowedHere();
    const tts = speechSynthesisSupported();
    setReadiness(stt, tts);

    void speaker.waitForVoices().then((voices) => {
      if (cancelled) return;
      const targetLanguage = useStore.getState().devices[DEVICE_B]?.language ?? 'mr';
      setCapabilities({ voices: voices.length, voicesForTarget: speaker.pickVoice(targetLanguage, voices) ? 1 : 0 });
    });

    if (!microphoneAllowedHere()) {
      pushNotice({
        tone: 'warn',
        message: 'Microphone is blocked because this page is not HTTPS. Open it on localhost, or run "npm run dev:lan" and use the https:// address.',
      });
    }

    return () => {
      cancelled = true;
    };
  }, [setCapabilities, setReadiness, pushNotice]);
}

/** Speak/cancel helper bound to a device, keeping the speaking indicator honest. */
export function useSpeak(deviceId: string) {
  const setSpeaking = useStore((s) => s.setSpeaking);
  const pushNotice = useStore((s) => s.pushNotice);
  const muted = useStore((s) => s.devices[deviceId]?.muted ?? false);
  const language = useStore((s) => s.devices[deviceId]?.language ?? 'en');

  const stop = useCallback(() => {
    speaker.cancel();
    setSpeaking(deviceId, false);
  }, [deviceId, setSpeaking]);

  const speak = useCallback(
    (text: string, overrideLanguage?: LanguageCode) => {
      const value = text.trim();
      if (!value) return false;
      if (muted) {
        pushNotice({ tone: 'info', message: `${useStore.getState().devices[deviceId]?.name} is muted.` });
        return false;
      }
      speaker.cancel();
      return speaker.speak(value, overrideLanguage ?? language, {
        onStart: () => setSpeaking(deviceId, true),
        onEnd: () => setSpeaking(deviceId, false),
        onError: (message) => {
          setSpeaking(deviceId, false);
          pushNotice({ tone: 'warn', message });
        },
        onFallback: (message) => pushNotice({ tone: 'info', message }),
      });
    },
    [deviceId, language, muted, pushNotice, setSpeaking],
  );

  return { speak, stop };
}
