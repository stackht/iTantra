export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export function formatMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '-- ms';
  return `${Math.round(ms)} ms`;
}

export function formatClock(at: number): string {
  const d = new Date(at);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function formatClockMs(at: number): string {
  return `${formatClock(at)}.${String(new Date(at).getMilliseconds()).padStart(3, '0')}`;
}

/** Only shown when the value is genuinely measured this session. */
export function measuredOrDash(ms: number | null | undefined): string {
  return ms === null || ms === undefined ? '--' : `${Math.round(ms)}`;
}

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

export function isTypingCodePoint(text: string): boolean {
  return /[\u0900-\u097F\u0B80-\u0BFF\u0C00-\u0C7F\u0D00-\u0D7F]/.test(text);
}
