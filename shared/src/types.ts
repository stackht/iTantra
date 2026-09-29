/**
 * Core domain types shared by the web client and the WebSocket hub.
 * No framework imports here — this module must run unchanged in Node and the browser.
 */

export type LanguageCode =
  | 'en'
  | 'hi'
  | 'mr'
  | 'gu'
  | 'bn'
  | 'ta'
  | 'te'
  | 'kn'
  | 'ml'
  | 'or';

/** DEMO_READY = usable in this prototype · FUTURE = future implementation (not selectable). */
export type SupportLevel = 'DEMO_READY' | 'FUTURE';

export type CapabilitySupport = 'available' | 'browser-dependent' | 'planned';

export interface LanguageCapability {
  /** Browser speech recognition / synthesis language tag, e.g. `hi-IN`. */
  tag: string;
  stt: CapabilitySupport;
  tts: CapabilitySupport;
  /** Curated offline demo dataset coverage. */
  translation: CapabilitySupport;
}

export interface LanguageInfo {
  code: LanguageCode;
  name: string;
  nativeName: string;
  script: string;
  flag: string;
  level: SupportLevel;
  note: string;
  capability: LanguageCapability;
}

export type Priority = 'NORMAL' | 'HIGH' | 'SOS';

export const PRIORITY_RANK: Record<Priority, number> = {
  SOS: 0,
  HIGH: 1,
  NORMAL: 2,
};

export interface MessagePacket {
  id: string;
  sourceDevice: string;
  destinationDevice: string;
  sourceLanguage: LanguageCode;
  targetLanguage: LanguageCode;
  /** Original utterance in the source language. */
  text: string;
  /** Utterance rendered in `targetLanguage`. */
  translatedText: string;
  /** Interlingua (English) rendering — the pivot used by the demo engine. */
  pivotText: string;
  timestamp: number;
  priority: Priority;
  hopCount: number;
  /** Real UTF-8 byte length of the encoded payload fields. */
  payloadBytes: number;
  /** Hex SHA-256 tag produced by Web Crypto over the canonical payload. */
  authTag: string;
}

export type PipelineStage =
  | 'INPUT'
  | 'STT'
  | 'LANGUAGE_DETECT'
  | 'TRANSLATION'
  | 'PACKET'
  | 'QUEUE'
  | 'ROUTE'
  | 'TRANSMIT'
  | 'DELIVER'
  | 'TTS'
  | 'DONE';

export const PIPELINE_STAGES: PipelineStage[] = [
  'INPUT',
  'STT',
  'LANGUAGE_DETECT',
  'TRANSLATION',
  'PACKET',
  'QUEUE',
  'ROUTE',
  'TRANSMIT',
  'DELIVER',
  'TTS',
  'DONE',
];

/** Stages of the on-device processing chain (used by the architecture diagram). */
export const SIGNAL_STAGES = [
  'MIC',
  'STT',
  'LANGUAGE',
  'TRANSLATION',
  'COMPRESSION',
  'ENCRYPTION',
  'RADIO / MESH',
  'DECRYPTION',
  'TRANSLATION (RX)',
  'TTS',
  'AUDIO',
] as const;

export type SignalStage = (typeof SIGNAL_STAGES)[number];

export type NodeKind = 'DEVICE' | 'RELAY';
export type NetworkMode = 'DIRECT' | 'RELAY_1' | 'MESH_2' | 'STORE_FORWARD';

export interface NetworkNode {
  id: string;
  label: string;
  shortLabel: string;
  kind: NodeKind;
  online: boolean;
}

export interface NetworkEdge {
  from: string;
  to: string;
  /** Links can be degraded independently of the nodes at either end. */
  online: boolean;
}

export interface Route {
  /** Ordered node ids, source first, destination last. */
  nodes: string[];
  edges: NetworkEdge[];
  /** Number of relay-to-relay / relay-to-device hops (edges). */
  hops: number;
  mode: NetworkMode;
}

export interface NetworkTopology {
  nodes: NetworkNode[];
  edges: NetworkEdge[];
}

export interface TranslationResult {
  text: string;
  sourceLanguage: LanguageCode;
  targetLanguage: LanguageCode;
  pivot?: string;
  /**
   * How the result was produced.
   * dataset = curated demo corpus · ondevice = browser on-device neural MT pack ·
   * remote = hosted MT service · identity = same language · passthrough/unavailable = not translated.
   */
  resolution: 'dataset' | 'ondevice' | 'remote' | 'identity' | 'passthrough' | 'unavailable';
  engine: string;
  /** Human readable caveat for the UI when the dataset had no entry. */
  note?: string;
}

export interface LogEntry {
  id: string;
  at: number;
  severity: 'info' | 'warn' | 'error' | 'success';
  channel: string;
  message: string;
}

export interface Metrics {
  messages: number;
  delivered: number;
  failed: number;
  queued: number;
  currentRouteHops: number | null;
  lastPayloadBytes: number | null;
  translationReady: boolean;
  sttReady: boolean;
  ttsReady: boolean;
  /** Wall-clock milliseconds observed in this session (send -> delivered). */
  latencyMs: number | null;
  stageTimingsMs: Partial<Record<PipelineStage, number>>;
  packetsTransmitted: number;
  relayFailures: number;
  storedForwards: number;
}

export type ConnectionStatus = 'CONNECTING' | 'ONLINE' | 'LOCAL_SIMULATION';

export interface DeviceState {
  id: string;
  name: string;
  language: LanguageCode;
  online: boolean;
  muted: boolean;
  speaking: boolean;
}

export interface MessageRecord {
  id: string;
  packetId: string;
  from: string;
  to: string;
  sourceLanguage: LanguageCode;
  targetLanguage: LanguageCode;
  originalText: string;
  deliveredText: string;
  pivotText: string;
  priority: Priority;
  createdAt: number;
  deliveredAt: number | null;
  /** Route the packet actually took. */
  routeNodes: string[];
  status: 'sending' | 'queued' | 'stored' | 'delivered' | 'failed';
  origin: 'MANUAL' | 'DEMO' | 'SOS';
  latencyMs: number | null;
  authTag: string;
  payloadBytes: number;
  via?: string;
  /** Set when the message entered the pipeline from the microphone. */
  inputMode?: 'voice' | 'text';
  /** Links the record back to the simulation job that carried it. */
  jobId?: string;
}

export interface SosState {
  active: boolean;
  messageId: string | null;
  activatedAt: number | null;
  acknowledged: boolean;
}

export interface DemoStepState {
  index: number;
  total: number;
  running: boolean;
  paused: boolean;
  finished: boolean;
  title: string;
  detail: string;
  completed: boolean[];
}
