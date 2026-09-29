/**
 * SOS attention tone built with the Web Audio API — no asset, no permission.
 * Used only while an SOS packet is in flight.
 */

let ctx: AudioContext | null = null;

function context(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  ctx ??= new Ctor();
  return ctx;
}

function beep(at: number, frequency: number, duration: number, gain: number): void {
  const audio = context();
  if (!audio) return;
  if (audio.state === 'suspended') void audio.resume();
  const oscillator = audio.createOscillator();
  const envelope = audio.createGain();
  oscillator.type = 'square';
  oscillator.frequency.value = frequency;
  envelope.gain.setValueAtTime(0, at);
  envelope.gain.linearRampToValueAtTime(gain, at + 0.01);
  envelope.gain.exponentialRampToValueAtTime(0.0001, at + duration);
  oscillator.connect(envelope).connect(audio.destination);
  oscillator.start(at);
  oscillator.stop(at + duration + 0.02);
}

export function playAlarm(repeats = 3): boolean {
  const audio = context();
  if (!audio) return false;
  const t0 = audio.currentTime + 0.02;
  for (let i = 0; i < repeats; i += 1) {
    beep(t0 + i * 0.42, 880, 0.22, 0.08);
    beep(t0 + i * 0.42 + 0.2, 660, 0.18, 0.06);
  }
  return true;
}

export function playChime(): void {
  const audio = context();
  if (!audio) return;
  const t0 = audio.currentTime + 0.02;
  beep(t0, 523.25, 0.28, 0.05);
  beep(t0 + 0.12, 783.99, 0.36, 0.045);
}
