import type { EngineEvent } from './simulation/SimulationEngine.ts';
import type { LanguageCode, NetworkMode, Priority } from './types.ts';

/**
 * Typed client -> server commands.
 * `unknown` payloads are rejected at the server boundary before reaching the engine.
 */
export type ClientMessage =
  | { type: 'device:connect'; deviceId: string; name: string; language: LanguageCode }
  | { type: 'device:update'; deviceId: string; language?: LanguageCode; muted?: boolean }
  | {
      type: 'message:create';
      text: string;
      from: string;
      to: string;
      sourceLanguage: LanguageCode;
      targetLanguage: LanguageCode;
      priority?: Priority;
      origin?: 'MANUAL' | 'DEMO' | 'SOS';
      inputMode?: 'voice' | 'text';
      /** Translation already performed on the sending device (browser on-device pack / remote MT). */
      pivotText?: string;
      pivotEngine?: string;
      translatedText?: string;
      translationEngine?: string;
    }
  | { type: 'sos:create'; text: string; from: string; to: string; sourceLanguage: LanguageCode; targetLanguage: LanguageCode }
  | { type: 'network:update'; mode?: NetworkMode; nodeId?: string; online?: boolean; link?: { from: string; to: string; online: boolean } }
  | { type: 'demo:start' }
  | { type: 'demo:step'; step: number }
  | { type: 'log:clear' }
  | { type: 'ping' };

/** Typed server -> client messages. */
export type ServerMessage =
  | { type: 'hello'; sessionId: string; serverTime: number; translationProvider: string }
  | { type: 'pong'; serverTime: number }
  | { type: 'snapshot'; topology: import('./types.ts').NetworkTopology; mode: NetworkMode; clients: number }
  | { type: 'engine'; events: EngineEvent[] }
  | { type: 'mode'; mode: NetworkMode }
  | { type: 'error'; message: string; fatal: boolean };

export function isClientMessage(value: unknown): value is ClientMessage {
  if (typeof value !== 'object' || value === null) return false;
  const type = (value as { type?: unknown }).type;
  return typeof type === 'string' && KNOWN_CLIENT_TYPES.has(type);
}

const KNOWN_CLIENT_TYPES: ReadonlySet<string> = new Set<ClientMessage['type']>([
  'device:connect',
  'device:update',
  'message:create',
  'sos:create',
  'network:update',
  'demo:start',
  'demo:step',
  'log:clear',
  'ping',
]);

export function parseClientMessage(raw: string): ClientMessage | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    return isClientMessage(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function parseServerMessage(raw: string): ServerMessage | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const type = (parsed as { type?: unknown }).type;
    return typeof type === 'string' ? (parsed as ServerMessage) : null;
  } catch {
    return null;
  }
}
