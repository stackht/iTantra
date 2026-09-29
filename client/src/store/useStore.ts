import { create } from 'zustand';
import {
  DEMO_SCRIPT,
  DemoRunner,
  DEVICE_A,
  DEVICE_B,
  createTopology,
  getLanguage,
  isActiveLanguage,
  phraseById,
  render,
  type ConnectionStatus,
  type DemoAction,
  type DemoStep,
  type EngineEvent,
  type LanguageCode,
  type LogEntry,
  type MessagePacket,
  type MessageRecord,
  type Metrics,
  type NetworkMode,
  type NetworkTopology,
  type PipelineStage,
  type Priority,
  type Route,
  type SignalStage,
  type SosState,
} from '@itantra/shared';
import { TRANSLATION_PROVIDER, apiUrl } from '../lib/config.ts';
import { playAlarm } from '../lib/audio.ts';
import { translateFromPivot, translateOnDevice } from '../lib/clientTranslation.ts';
import { fetchNeuralVoices, rememberReadiness, requestVoiceInstall, type NeuralVoiceState } from '../lib/neuralTts.ts';
import { transport } from '../lib/transport.ts';
import { hubOnline, setHubOnline } from '../lib/hub.ts';

export interface StageView {
  stage: PipelineStage;
  side: 'source' | 'relay' | 'receiver';
  status: 'active' | 'done' | 'skipped';
  note?: string;
  at: number;
}

export interface JobUi {
  id: string;
  from: string;
  to: string;
  text: string;
  priority: Priority;
  origin: MessageRecord['origin'];
  stages: StageView[];
  packet: MessagePacket | null;
  route: Route | null;
  routeLabel: string | null;
  storedAtNode: string | null;
  renderedText: string | null;
  latencyMs: number | null;
  status: 'queued' | 'sending' | 'stored' | 'delivered' | 'failed';
  startedAt: number;
}

export interface FlightSegment {
  jobId: string;
  from: string;
  to: string;
  progress: number;
  priority: Priority;
}

export interface QueueRow {
  id: string;
  priority: Priority;
  seq: number;
  label: string;
}

export interface Notice {
  id: string;
  tone: 'info' | 'warn' | 'error';
  message: string;
}

export interface Capabilities {
  speechRecognition: boolean;
  speechSynthesis: boolean;
  mediaDevices: boolean;
  secureContext: boolean;
  voices: number;
  voicesForTarget: number;
}

export interface DemoState {
  running: boolean;
  paused: boolean;
  finished: boolean;
  index: number;
  total: number;
  step: DemoStep | null;
  completed: string[];
  highlight: string | null;
  startedAt: number | null;
}

interface AppState {
  ready: boolean;
  connection: ConnectionStatus;
  connectionDetail: string;
  sessionId: string | null;
  translationProvider: string;

  devices: Record<string, DeviceUi>;
  capabilities: Capabilities;

  messages: MessageRecord[];
  jobs: Record<string, JobUi>;
  activeJobId: string | null;
  focusJobId: string | null;
  flight: FlightSegment[];
  storedJobs: string[];

  topology: NetworkTopology;
  mode: NetworkMode;
  queue: QueueRow[];

  log: LogEntry[];
  metrics: Metrics;
  signalStages: { stage: SignalStage; status: 'idle' | 'active' | 'done' }[];

  sos: SosState;
  demo: DemoState;
  notices: Notice[];

  init: () => void;
  applyEvents: (events: EngineEvent[]) => void;
  /** Adopt the hub's authoritative mode/topology (it outlives page reloads). */
  applySnapshot: (mode: NetworkMode, topology: NetworkTopology) => void;
  setFocusJob: (id: string | null) => void;
  setLanguage: (deviceId: string, language: LanguageCode) => void;
  setMode: (mode: NetworkMode) => void;
  setNodeOnline: (nodeId: string, online: boolean) => void;
  setLinkOnline: (from: string, to: string, online: boolean) => void;
  toggleMute: (deviceId: string) => void;
  setSpeaking: (deviceId: string, speaking: boolean) => void;
  setCapabilities: (caps: Partial<Capabilities>) => void;
  setReadiness: (sttReady: boolean, ttsReady: boolean) => void;
  sendText: (deviceId: string, text: string, options?: SendOptions) => boolean;
  setBusy: (deviceId: string, busy: DeviceUi['busy']) => void;
  /** On-device MT pack state per language pair (`hi>en`), from the browser itself. */
  /** Status of the ITANTRA product models the hub runs (Whisper STT, Opus-MT, Piper TTS). */
  productModels: ProductModels | null;
  refreshProductModels: () => Promise<void>;
  /** Neural voice packs installed on the hub (sherpa-onnx Piper/VITS). */
  neuralVoices: Record<string, NeuralVoiceState>;
  neuralRuntime: boolean;
  refreshNeuralVoices: () => Promise<void>;
  installNeuralVoice: (language: LanguageCode) => Promise<void>;
  requestSos: (deviceId: string) => void;
  acknowledgeSos: () => void;
  clearSos: () => void;
  pushNotice: (notice: Omit<Notice, 'id'>) => void;
  dismissNotice: (id: string) => void;
  clearLog: () => void;
  startDemo: () => void;
  pauseDemo: () => void;
  resumeDemo: () => void;
  skipDemo: () => void;
  stopDemo: () => void;
  demoTick: (now: number) => void;
  runDemoActions: (actions: DemoAction[]) => void;
}

export interface DeviceUi {
  id: string;
  name: string;
  language: LanguageCode;
  online: boolean;
  muted: boolean;
  speaking: boolean;
  /** Sender-side work in progress before the packet reaches the link. */
  busy: 'translating' | null;
}

export interface ProductModels {
  androidDir: string;
  stt: { runtime: boolean; model: { id: string; label: string; source: string } | null };
  mt: { runtime: boolean; error: string | null; root: string; pairs: Record<string, { installed: boolean; loaded: boolean }> } | null;
}

export interface SendOptions {
  origin?: MessageRecord['origin'];
  priority?: Priority;
  inputMode?: 'voice' | 'text';
  /** Language the text is actually in, when it differs from the device setting (Whisper answered in English). */
  sourceLanguage?: LanguageCode;
  /** English already produced from the speech itself (Whisper speech-to-English for Marathi). */
  pivotText?: string;
}

const INITIAL_DEVICES: Record<string, DeviceUi> = {
  [DEVICE_A]: { id: DEVICE_A, name: 'DEVICE A', language: 'hi', online: true, muted: false, speaking: false, busy: null },
  [DEVICE_B]: { id: DEVICE_B, name: 'DEVICE B', language: 'mr', online: true, muted: false, speaking: false, busy: null },
};

const EMPTY_METRICS: Metrics = {
  messages: 0,
  delivered: 0,
  failed: 0,
  queued: 0,
  currentRouteHops: null,
  lastPayloadBytes: null,
  translationReady: false,
  sttReady: false,
  ttsReady: false,
  latencyMs: null,
  stageTimingsMs: {},
  packetsTransmitted: 0,
  relayFailures: 0,
  storedForwards: 0,
};

const LOG_LIMIT = 300;
const demoRunner = new DemoRunner();
let messageSeq = 0;

function nextMessageId(): string {
  messageSeq += 1;
  return `MSG-${String(messageSeq).padStart(4, '0')}`;
}

function otherDevice(id: string): string {
  return id === DEVICE_A ? DEVICE_B : DEVICE_A;
}

let clientLogSeq = 0;

/** Unique id for every log line minted in this tab (engine lines carry their own `ENG-` ids). */
function nextLogId(tag = 'ui'): string {
  clientLogSeq += 1;
  return `LOG-${tag}-${clientLogSeq}`;
}

export function appendLog(severity: LogEntry['severity'], channel: string, message: string): void {
  useStore.setState((s) => ({
    log: [...s.log, { id: nextLogId(), at: Date.now(), severity, channel, message }].slice(-LOG_LIMIT),
  }));
}

function initialSignalStages(): { stage: SignalStage; status: 'idle' }[] {
  return (
    [
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
    ] as SignalStage[]
  ).map((stage) => ({ stage, status: 'idle' }));
}

export const useStore = create<AppState>((set, get) => ({
  ready: false,
  connection: 'CONNECTING',
  connectionDetail: 'Starting transport…',
  sessionId: null,
  translationProvider: TRANSLATION_PROVIDER,

  devices: INITIAL_DEVICES,
  capabilities: {
    speechRecognition: false,
    speechSynthesis: false,
    mediaDevices: typeof navigator !== 'undefined' ? Boolean(navigator.mediaDevices?.getUserMedia) : false,
    secureContext: typeof window !== 'undefined' ? window.isSecureContext : false,
    voices: 0,
    voicesForTarget: 0,
  },

  messages: [],
  jobs: {},
  activeJobId: null,
  focusJobId: null,
  flight: [],
  storedJobs: [],
  productModels: null,
  neuralVoices: {},
  neuralRuntime: false,

  topology: createTopology(),
  mode: 'MESH_2',
  queue: [],

  log: [
    {
      id: 'LOG-boot',
      at: Date.now(),
      severity: 'info',
      channel: 'BOOT',
      message: `iTantra prototype booting · translation provider "${TRANSLATION_PROVIDER}"`,
    },
  ],
  metrics: EMPTY_METRICS,
  signalStages: initialSignalStages(),

  sos: { active: false, messageId: null, activatedAt: null, acknowledged: false },
  demo: {
    running: false,
    paused: false,
    finished: false,
    index: 0,
    total: DEMO_SCRIPT.length,
    step: DEMO_SCRIPT[0],
    completed: [],
    highlight: null,
    startedAt: null,
  },
  notices: [],

  init: () => {
    if (get().ready) return;
    transport.register({
      onEvents: (events) => get().applyEvents(events),
      onStatus: (connection, connectionDetail) => {
        setHubOnline(connection === 'ONLINE');
        const wasOnline = get().connection === 'ONLINE';
        set({ connection, connectionDetail });
        if (connection === 'ONLINE' && !wasOnline) {
          void get().refreshNeuralVoices();
          void get().refreshProductModels();
        }
        if (connection === 'LOCAL_SIMULATION') {
          rememberReadiness({});
          set({ neuralVoices: {}, neuralRuntime: false, productModels: null });
        }
      },
      onSession: (sessionId) => set({ sessionId }),
      onSnapshot: (mode, topology) => get().applySnapshot(mode, topology),
    });
    transport.start();
    set((s) => ({ ready: true, metrics: { ...s.metrics, translationReady: true } }));
    // Neural voices are probed when the hub connects (see onStatus), never against a missing hub.
  },

  refreshNeuralVoices: async () => {
    if (!hubOnline()) {
      set({ neuralVoices: {}, neuralRuntime: false });
      return;
    }
    const result = await fetchNeuralVoices();
    if (!result) {
      set({ neuralVoices: {}, neuralRuntime: false });
      return;
    }
    set({ neuralVoices: result.voices, neuralRuntime: result.runtime });
  },

  installNeuralVoice: async (language) => {
    const current = get().neuralVoices[language];
    if (!current || current.status === 'ready' || current.status === 'installing') return;
    appendLog('info', 'VOICES', `Installing neural voice for ${getLanguage(language).name} on the hub…`);
    const accepted = await requestVoiceInstall(language);
    if (!accepted) {
      appendLog('warn', 'VOICES', 'Hub refused the voice install request');
      return;
    }
    // Poll until the hub reports ready/error (packs are ~20 MB; copies take seconds, downloads longer).
    const deadline = Date.now() + 15 * 60 * 1000;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      await get().refreshNeuralVoices();
      const state = get().neuralVoices[language];
      if (!state || state.status === 'ready' || state.status === 'error' || state.status === 'none') {
        appendLog(
          state?.status === 'ready' ? 'success' : 'warn',
          'VOICES',
          state?.status === 'ready' ? `Neural voice ready: ${state.label}` : `Voice install failed: ${state?.detail ?? 'unknown'}`,
        );
        return;
      }
    }
  },

  applyEvents: (events) => {
    if (events.length === 0) return;
    const state = get();
    const jobs = { ...state.jobs };
    const messages = [...state.messages];
    const newLog: LogEntry[] = [];
    let flight = state.flight;
    let activeJobId = state.activeJobId;
    let queue = state.queue;
    let storedJobs = state.storedJobs;
    let topology = state.topology;
    let sosDelivered = false;
    let metrics: Metrics = {
      ...state.metrics,
      queued: state.queue.length,
      packetsTransmitted: state.metrics.packetsTransmitted,
    };

    const touchJob = (id: string, patch: Partial<JobUi>): JobUi | null => {
      const job = jobs[id];
      if (!job) return null;
      const updated = { ...job, ...patch };
      jobs[id] = updated;
      return updated;
    };

    for (const event of events) {
      switch (event.type) {
        case 'log':
          newLog.push(event.entry);
          break;

        case 'network:update':
          topology = event.topology;
          break;

        case 'queue:update':
          queue = event.items.map((item) => ({ ...item }));
          metrics = { ...metrics, queued: event.items.length };
          break;

        case 'job:queued': {
          const messageId = nextMessageId();
          jobs[event.jobId] = {
            id: event.jobId,
            from: event.from,
            to: event.to,
            text: event.text,
            priority: event.priority,
            origin: event.origin,
            stages: [],
            packet: null,
            route: null,
            routeLabel: null,
            storedAtNode: null,
            renderedText: null,
            latencyMs: null,
            status: 'queued',
            startedAt: Date.now(),
          };
          messages.push({
            id: messageId,
            packetId: 'ITN-0000',
            from: event.from,
            to: event.to,
            sourceLanguage: event.sourceLanguage,
            targetLanguage: event.targetLanguage,
            originalText: event.text,
            deliveredText: '',
            pivotText: '',
            priority: event.priority,
            createdAt: Date.now(),
            deliveredAt: null,
            routeNodes: [],
            status: 'queued',
            origin: event.origin,
            latencyMs: null,
            authTag: '',
            payloadBytes: 0,
            inputMode: event.inputMode,
            jobId: event.jobId,
          });
          break;
        }

        case 'job:started':
          touchJob(event.jobId, { status: 'sending' });
          activeJobId = event.jobId;
          break;

        case 'stage': {
          const job = jobs[event.jobId];
          if (!job) break;
          const stages = [
            ...job.stages.filter((s) => !(s.stage === event.stage && s.side === event.side && s.status === 'active')),
            {
              stage: event.stage,
              side: event.side,
              status: event.status,
              at: Date.now(),
              ...(event.note ? { note: event.note } : {}),
            },
          ];
          jobs[event.jobId] = { ...job, stages };
          newLog.push({
            id: nextLogId(`${event.jobId}-${event.stage}`),
            at: Date.now(),
            severity: event.status === 'done' ? 'success' : 'info',
            channel: event.side === 'receiver' ? 'RX' : event.side === 'relay' ? 'LINK' : 'TX',
            message: `${event.stage} ${event.status}${event.note ? ` — ${event.note}` : ''}`,
          });
          break;
        }

        case 'packet:created': {
          const job = touchJob(event.jobId, { packet: event.packet });
          if (!job) break;
          metrics = { ...metrics, lastPayloadBytes: event.packet.payloadBytes };
          touchMessageByJob(messages, event.jobId, {
            packetId: event.packet.id,
            pivotText: event.packet.pivotText,
            payloadBytes: event.packet.payloadBytes,
            authTag: event.packet.authTag,
          });
          flight = [{ jobId: event.jobId, from: job.from, to: job.to, progress: 0, priority: job.priority }];
          break;
        }

        case 'route:selected': {
          const job = touchJob(event.jobId, { route: event.route, routeLabel: event.label });
          if (!job) break;
          metrics = { ...metrics, currentRouteHops: event.route.hops };
          touchMessageByJob(messages, event.jobId, { routeNodes: event.route.nodes });
          break;
        }

        case 'route:recalculating':
          newLog.push({
            id: nextLogId(`${event.jobId}-reroute`),
            at: Date.now(),
            severity: 'warn',
            channel: 'ROUTE',
            message: event.reason,
          });
          break;

        case 'route:failed':
          newLog.push({
            id: nextLogId(`${event.jobId}-routefail`),
            at: Date.now(),
            severity: 'warn',
            channel: 'ROUTE',
            message: event.reason,
          });
          break;

        case 'packet:stored': {
          touchJob(event.jobId, { status: 'stored', storedAtNode: event.nodeId });
          storedJobs = [...new Set([...storedJobs, event.jobId])];
          metrics = { ...metrics, storedForwards: metrics.storedForwards + 1 };
          touchMessageByJob(messages, event.jobId, { status: 'stored' });
          break;
        }

        case 'packet:released': {
          touchJob(event.jobId, { status: 'sending', storedAtNode: null });
          storedJobs = storedJobs.filter((id) => id !== event.jobId);
          touchMessageByJob(messages, event.jobId, { status: 'sending' });
          break;
        }

        case 'hop:progress': {
          const job = jobs[event.jobId];
          flight = [
            {
              jobId: event.jobId,
              from: event.from,
              to: event.to,
              progress: event.progress,
              priority: job?.priority ?? 'NORMAL',
            },
          ];
          if (event.progress >= 1) metrics = { ...metrics, packetsTransmitted: metrics.packetsTransmitted + 1 };
          break;
        }

        case 'packet:delivered': {
          const job = touchJob(event.jobId, {
            status: 'delivered',
            renderedText: event.text,
            latencyMs: event.latencyMs,
          });
          if (!job) break;
          touchMessageByJob(messages, event.jobId, {
            status: 'delivered',
            deliveredAt: Date.now(),
            latencyMs: event.latencyMs,
            via: event.via,
            routeNodes: job.route?.nodes ?? [],
          });
          metrics = { ...metrics, delivered: metrics.delivered + 1, latencyMs: event.latencyMs };
          // An emergency ends once its packet is delivered; the phones return to normal.
          if (job.priority === 'SOS') sosDelivered = true;
          flight = [];
          break;
        }

        case 'packet:rendered': {
          const job = touchJob(event.jobId, { renderedText: event.text });
          if (!job) break;
          touchMessageByJob(messages, event.jobId, { deliveredText: event.text });
          break;
        }

        case 'job:failed': {
          touchJob(event.jobId, { status: 'failed' });
          touchMessageByJob(messages, event.jobId, { status: 'failed' });
          metrics = { ...metrics, failed: metrics.failed + 1 };
          activeJobId = null;
          flight = [];
          break;
        }

        case 'job:completed':
          activeJobId = null;
          flight = [];
          break;
      }
    }

    set({
      jobs,
      messages: [...messages],
      log: newLog.length > 0 ? [...state.log, ...newLog].slice(-LOG_LIMIT) : state.log,
      flight,
      activeJobId,
      queue,
      storedJobs,
      topology,
      metrics: { ...metrics, messages: messages.length },
      ...(sosDelivered ? { sos: { active: false, messageId: null, activatedAt: null, acknowledged: false } } : {}),
    });
  },

  applySnapshot: (mode, topology) => {
    const previous = get().mode;
    set({ mode, topology });
    if (previous !== mode) appendLog('info', 'NETWORK', `Hub reports active mode ${mode}`);
  },

  setFocusJob: (focusJobId) => set({ focusJobId }),

  setLanguage: (deviceId, language) => {
    const devices = get().devices;
    const device = devices[deviceId];
    if (!device || device.language === language) return;
    if (!isActiveLanguage(language)) {
      get().pushNotice({ tone: 'info', message: `${getLanguage(language).name} is a future implementation. The prototype runs English, Hindi and Marathi.` });
      return;
    }
    set({ devices: { ...devices, [deviceId]: { ...device, language } } });
    appendLog('info', 'DEVICE', `${device.name} language → ${getLanguage(language).name} (${language.toUpperCase()})`);
    transport.send({ type: 'device:update', deviceId, language });
  },

  setMode: (mode) => {
    if (mode === get().mode) return;
    set({ mode });
    transport.send({ type: 'network:update', mode });
    appendLog('info', 'NETWORK', `Network mode → ${mode}`);
  },

  setNodeOnline: (nodeId, online) => {
    transport.send({ type: 'network:update', nodeId, online });
    appendLog(online ? 'success' : 'warn', 'NETWORK', `${nodeId} ${online ? 'restored' : 'taken offline'}`);
  },

  setLinkOnline: (from, to, online) => {
    transport.send({ type: 'network:update', link: { from, to, online } });
    appendLog(online ? 'success' : 'warn', 'NETWORK', `Link ${from} ↔ ${to} ${online ? 'restored' : 'lost'}`);
  },

  toggleMute: (deviceId) => {
    const devices = get().devices;
    const device = devices[deviceId];
    if (!device) return;
    set({ devices: { ...devices, [deviceId]: { ...device, muted: !device.muted } } });
  },

  setSpeaking: (deviceId, speaking) => {
    const devices = get().devices;
    const device = devices[deviceId];
    if (!device || device.speaking === speaking) return;
    set({ devices: { ...devices, [deviceId]: { ...device, speaking } } });
  },

  setCapabilities: (caps) => set((s) => ({ capabilities: { ...s.capabilities, ...caps } })),

  setReadiness: (sttReady, ttsReady) =>
    set((s) => ({
      capabilities: { ...s.capabilities, speechRecognition: sttReady, speechSynthesis: ttsReady },
      metrics: { ...s.metrics, sttReady, ttsReady },
    })),

  sendText: (deviceId, text, options = {}) => {
    const trimmed = text.trim();
    if (!trimmed) return false;
    const devices = get().devices;
    const source = devices[deviceId];
    const targetId = otherDevice(deviceId);
    const target = devices[targetId];
    if (!source || !target) return false;
    const origin = options.origin ?? 'MANUAL';
    const priority = options.priority ?? (origin === 'SOS' ? 'SOS' : 'NORMAL');
    const sourceLanguage = options.sourceLanguage ?? source.language;
    const targetLanguage = target.language;

    appendLog(
      priority === 'SOS' ? 'error' : 'info',
      'TX',
      `${source.name} → ${target.name} · ${sourceLanguage.toUpperCase()} → ${targetLanguage.toUpperCase()} · ${priority}`,
    );

    // Translate on the sending device first (dataset → on-device pack → remote MT),
    // then hand the packet to the link. The phone shows TRANSLATING meanwhile.
    get().setBusy(deviceId, 'translating');
    const pivotText = options.pivotText?.trim();
    void (pivotText && sourceLanguage !== 'en'
      ? translateFromPivot(trimmed, pivotText, sourceLanguage, targetLanguage)
      : translateOnDevice(trimmed, sourceLanguage, targetLanguage))
      .then((mt) => {
        if (mt.resolved) {
          appendLog(
            'success',
            'MT',
            `${source.name}: ${mt.path.map((l) => l.toUpperCase()).join(' → ')} · ${mt.targetEngine}`,
          );
        } else {
          appendLog('warn', 'MT', `${source.name}: not translated — ${mt.targetResult.note ?? 'no engine resolved it'}`);
        }
        transport.send({
          type: 'message:create',
          text: trimmed,
          from: deviceId,
          to: targetId,
          sourceLanguage,
          targetLanguage,
          priority,
          origin,
          inputMode: options.inputMode ?? 'text',
          ...(mt.resolved
            ? {
                pivotText: mt.pivot,
                pivotEngine: mt.pivotEngine,
                translatedText: mt.target,
                translationEngine: mt.targetEngine,
              }
            : {}),
        });
      })
      .catch(() => {
        // Never lose the message: the engine's own chain will try again.
        transport.send({
          type: 'message:create',
          text: trimmed,
          from: deviceId,
          to: targetId,
          sourceLanguage,
          targetLanguage,
          priority,
          origin,
          inputMode: options.inputMode ?? 'text',
        });
      })
      .finally(() => get().setBusy(deviceId, null));
    return true;
  },

  setBusy: (deviceId, busy) => {
    const devices = get().devices;
    const device = devices[deviceId];
    if (!device || device.busy === busy) return;
    set({ devices: { ...devices, [deviceId]: { ...device, busy } } });
  },

  refreshProductModels: async () => {
    if (!hubOnline()) {
      set({ productModels: null });
      return;
    }
    try {
      const response = await fetch(apiUrl('/api/models'), { cache: 'no-store' });
      if (!response.ok) throw new Error(String(response.status));
      set({ productModels: (await response.json()) as ProductModels });
    } catch {
      set({ productModels: null });
    }
  },

  requestSos: (deviceId) => {
    const devices = get().devices;
    // Emergency sentence in the sending device's own language, so the dataset resolves it.
    const sourceLanguage = devices[deviceId]?.language ?? 'hi';
    const sent = get().sendText(deviceId, render(phraseById('need-immediate-help'), sourceLanguage), {
      origin: 'SOS',
      priority: 'SOS',
    });
    if (!sent) return;
    set({ sos: { active: true, messageId: deviceId, activatedAt: Date.now(), acknowledged: false } });
    if (!playAlarm(3)) {
      get().pushNotice({ tone: 'warn', message: 'Audio unavailable — SOS alert is visual only in this browser.' });
    }
    appendLog('error', 'SOS', `EMERGENCY priority engaged from ${devices[deviceId]?.name ?? deviceId}`);
  },

  acknowledgeSos: () => set((s) => ({ sos: { ...s.sos, acknowledged: true } })),
  clearSos: () => set({ sos: { active: false, messageId: null, activatedAt: null, acknowledged: false } }),

  pushNotice: (notice) =>
    set((s) => ({
      notices: [...s.notices, { ...notice, id: `NOTICE-${Date.now()}-${s.notices.length}` }].slice(-4),
    })),
  dismissNotice: (id) => set((s) => ({ notices: s.notices.filter((n) => n.id !== id) })),

  clearLog: () => {
    set({ log: [] });
    transport.send({ type: 'log:clear' });
  },

  startDemo: () => {
    // The script needs both handsets on the mesh; bring back anything switched off.
    for (const node of get().topology.nodes) {
      if (node.kind === 'DEVICE' && !node.online) get().setNodeOnline(node.id, true);
    }
    const actions = demoRunner.start(Date.now());
    set({
      messages: [],
      jobs: {},
      activeJobId: null,
      focusJobId: null,
      flight: [],
      storedJobs: [],
      queue: [],
      sos: { active: false, messageId: null, activatedAt: null, acknowledged: false },
      metrics: { ...EMPTY_METRICS, translationReady: true },
      signalStages: initialSignalStages(),
      log: [
        {
          id: `LOG-demo-${Date.now()}`,
          at: Date.now(),
          severity: 'info',
          channel: 'DEMO',
          message: 'Scripted demonstration started',
        },
      ],
      demo: {
        running: true,
        paused: false,
        finished: false,
        index: 0,
        total: DEMO_SCRIPT.length,
        step: DEMO_SCRIPT[0],
        completed: [],
        highlight: null,
        startedAt: Date.now(),
      },
    });
    get().runDemoActions(actions);
  },

  pauseDemo: () => {
    demoRunner.pause();
    set((s) => ({ demo: { ...s.demo, running: false, paused: true } }));
  },

  resumeDemo: () => {
    demoRunner.resume(Date.now());
    set((s) => ({ demo: { ...s.demo, running: true, paused: false } }));
  },

  skipDemo: () => {
    const result = demoRunner.skipToEnd(Date.now());
    get().runDemoActions(result.actions);
    set((s) => ({
      demo: { ...s.demo, index: result.index, running: false, finished: true, step: null, highlight: null },
    }));
  },

  stopDemo: () => {
    demoRunner.reset();
    set((s) => ({
      demo: { ...s.demo, running: false, paused: false, finished: false, index: 0, step: DEMO_SCRIPT[0], highlight: null },
    }));
  },

  demoTick: (now) => {
    const state = get();
    if (!state.demo.running) return;
    const result = demoRunner.advance(now);
    if (result.completed.length === 0) return;
    const completed = [...state.demo.completed, ...result.completed.map((s) => s.id)];
    const nextStep = result.index < DEMO_SCRIPT.length ? DEMO_SCRIPT[result.index] : null;
    set({
      demo: {
        ...state.demo,
        index: result.index,
        completed,
        step: nextStep,
        running: result.finished ? false : state.demo.running,
        finished: result.finished,
      },
    });
    get().runDemoActions(result.actions);
    if (result.finished) appendLog('success', 'DEMO', 'Scripted demonstration complete');
  },

  runDemoActions: (actions) => {
    for (const action of actions) {
      switch (action.kind) {
        case 'set-language': {
          const deviceId = action.device === 'A' ? DEVICE_A : DEVICE_B;
          const devices = get().devices;
          const device = devices[deviceId];
          if (device && device.language !== action.language) {
            set({ devices: { ...devices, [deviceId]: { ...device, language: action.language } } });
            appendLog('info', 'DEMO', `${device.name} set to ${getLanguage(action.language).name}`);
          }
          break;
        }
        case 'highlight':
          set((s) => ({ demo: { ...s.demo, highlight: action.target } }));
          break;
        case 'submit':
          get().sendText(action.from, action.text, { origin: action.origin, inputMode: action.inputMode });
          break;
        case 'speak': {
          const deviceId = action.device === 'A' ? DEVICE_A : DEVICE_B;
          const latest = get().messages.filter((m) => m.to === deviceId && m.status === 'delivered').slice(-1)[0];
          if (!latest) break;
          set((s) => ({
            focusJobId: latest.jobId ?? null,
            demo: { ...s.demo, highlight: `speak-${latest.id}` },
          }));
          break;
        }
        case 'finish':
          set((s) => ({ demo: { ...s.demo, highlight: null } }));
          break;
      }
    }
  },
}));

function touchMessageByJob(messages: MessageRecord[], jobId: string, patch: Partial<MessageRecord>): void {
  const index = messages.findIndex((m) => m.jobId === jobId);
  if (index === -1) return;
  messages[index] = { ...messages[index], ...patch };
}
