import { createPacket } from '../packet.ts';
import { PriorityQueue } from '../queue.ts';
import {
  DEVICE_A,
  DEVICE_B,
  createTopology,
  findRoute,
  linkTouchesNode,
  nodeById,
  routeLabel,
  setLinkOnline,
  setNodeOnline,
} from '../network.ts';
import { TranslationService } from '../translation/TranslationService.ts';
import type {
  LanguageCode,
  LogEntry,
  MessagePacket,
  NetworkMode,
  NetworkTopology,
  PipelineStage,
  Priority,
  Route,
} from '../types.ts';

/**
 * Discrete-event simulation of the full iTantra communication pipeline.
 *
 * It is intentionally framework free: the WebSocket hub runs one instance
 * authoritatively, and when the backend is unreachable the browser runs the very
 * same instance locally. Both produce the identical `EngineEvent` stream, so the
 * UI cannot tell the difference beyond the connection badge.
 *
 * TIMING HONESTY: the stage durations in `DEFAULT_TIMING` are simulated link and
 * processing delays chosen to make the pipeline visible. `latencyMs` reported in
 * events is real wall-clock time measured from submit to delivery.
 */
export interface TimingProfile {
  stt: number;
  detect: number;
  translate: number;
  packet: number;
  queue: number;
  route: number;
  hop: number;
  deliver: number;
  rxTranslate: number;
  tts: number;
  /** Interval between store-and-forward re-route attempts. */
  storeRetry: number;
}

export const DEFAULT_TIMING: TimingProfile = {
  stt: 850,
  detect: 300,
  translate: 320,
  packet: 280,
  queue: 400,
  route: 260,
  hop: 780,
  deliver: 220,
  rxTranslate: 320,
  tts: 450,
  storeRetry: 1400,
};

export interface SubmitInput {
  from: string;
  to: string;
  sourceLanguage: LanguageCode;
  targetLanguage: LanguageCode;
  text: string;
  priority?: Priority;
  origin?: 'MANUAL' | 'DEMO' | 'SOS';
  inputMode?: 'voice' | 'text';
  /** Already translated on the sending device (browser on-device pack / remote MT). */
  pivotText?: string;
  pivotEngine?: string;
  translatedText?: string;
  translationEngine?: string;
}

export type StageSide = 'source' | 'relay' | 'receiver';

export type EngineEvent =
  | {
      type: 'job:queued';
      jobId: string;
      priority: Priority;
      position: number;
      origin: NonNullable<SubmitInput['origin']>;
      from: string;
      to: string;
      text: string;
      sourceLanguage: LanguageCode;
      targetLanguage: LanguageCode;
      inputMode: 'voice' | 'text';
    }
  | { type: 'job:started'; jobId: string }
  | { type: 'stage'; jobId: string; stage: PipelineStage; side: StageSide; status: 'active' | 'done' | 'skipped'; note?: string }
  | { type: 'packet:created'; jobId: string; packet: MessagePacket }
  | { type: 'route:selected'; jobId: string; route: Route; label: string }
  | { type: 'route:recalculating'; jobId: string; reason: string }
  | { type: 'route:failed'; jobId: string; reason: string }
  | { type: 'packet:stored'; jobId: string; nodeId: string }
  | { type: 'packet:released'; jobId: string; nodeId: string; waitedMs: number }
  | { type: 'hop:progress'; jobId: string; from: string; to: string; progress: number }
  | { type: 'packet:delivered'; jobId: string; text: string; latencyMs: number; via: string }
  | { type: 'packet:rendered'; jobId: string; text: string; language: LanguageCode }
  | { type: 'job:failed'; jobId: string; reason: string }
  | { type: 'job:completed'; jobId: string; latencyMs: number }
  | { type: 'queue:update'; items: { id: string; priority: Priority; seq: number; label: string }[] }
  | { type: 'network:update'; topology: NetworkTopology }
  | { type: 'log'; entry: LogEntry };

export interface JobView {
  id: string;
  from: string;
  to: string;
  priority: Priority;
  origin: SubmitInput['origin'];
  inputMode: 'voice' | 'text';
  stage: PipelineStage;
  side: StageSide;
  route: Route | null;
  status: 'queued' | 'running' | 'stored' | 'delivered' | 'failed';
}

interface Job {
  id: string;
  from: string;
  to: string;
  sourceLanguage: LanguageCode;
  targetLanguage: LanguageCode;
  text: string;
  priority: Priority;
  origin: 'MANUAL' | 'DEMO' | 'SOS';
  inputMode: 'voice' | 'text';
  createdAt: number;
  stage: PipelineStage;
  side: StageSide;
  status: 'queued' | 'running' | 'stored' | 'done' | 'failed';
  stageStartedAt: number;
  pivotText: string;
  deliveredText: string;
  packet: MessagePacket | null;
  route: Route | null;
  hopIndex: number;
  hopStartedAt: number;
  storedAtNode: string | null;
  storedSince: number;
  deliveredAt: number | null;
  latencyMs: number | null;
  translationNote: string | null;
  presetPivot: string | null;
  presetPivotEngine: string | null;
  presetTarget: string | null;
  presetTargetEngine: string | null;
}

export class SimulationEngine {
  private topology: NetworkTopology = createTopology();
  private queue = new PriorityQueue<string>();
  private jobs = new Map<string, Job>();
  private order: string[] = [];
  private activeJobId: string | null = null;
  private counter = 0;
  private events: EngineEvent[] = [];
  private activeMode: NetworkMode;
  /** Monotonic log sequence; the instance tag keeps hub and in-tab engines from colliding. */
  private logSeq = 0;
  private readonly instance = Math.random().toString(36).slice(2, 7);
  private ticking = false;

  private readonly translationService: TranslationService;
  private readonly timingProfile: TimingProfile;

  constructor(
    mode: NetworkMode = 'MESH_2',
    translation: TranslationService = new TranslationService(),
    timing: TimingProfile = DEFAULT_TIMING,
  ) {
    this.activeMode = mode;
    this.translationService = translation;
    this.timingProfile = timing;
  }

  get mode(): NetworkMode {
    return this.activeMode;
  }

  setMode(mode: NetworkMode): void {
    this.activeMode = mode;
    this.emitLog('info', 'NETWORK', `Mode set: ${mode}`);
    this.emit({ type: 'network:update', topology: this.topology });
  }

  setNodeOnline(id: string, online: boolean): void {
    const node = nodeById(this.topology, id);
    if (!node || node.online === online) return;
    this.topology = setNodeOnline(this.topology, id, online);
    this.emitLog(online ? 'success' : 'warn', 'NETWORK', `${node.label} ${online ? 'ONLINE' : 'OFFLINE'}`);
    if (!online) this.invalidateRouteFor(id, `${node.label} went offline`);
    this.emit({ type: 'network:update', topology: this.topology });
    this.flushStored();
  }

  /** Fault injection for a single link, e.g. losing the direct A↔B link. */
  setLinkOnline(from: string, to: string, online: boolean): void {
    const edge = this.topology.edges.find(
      (e) => (e.from === from && e.to === to) || (e.from === to && e.to === from),
    );
    if (!edge || edge.online === online) return;
    this.topology = setLinkOnline(this.topology, from, to, online);
    this.emitLog(online ? 'success' : 'warn', 'NETWORK', `Link ${from} ↔ ${to} ${online ? 'restored' : 'lost'}`);
    if (!online) {
      this.invalidateRouteFor(null, `Link ${from} ↔ ${to} was lost`, { from, to });
    }
    this.emit({ type: 'network:update', topology: this.topology });
    this.flushStored();
  }

  /**
   * Drops the in-flight route when a fault touches it, forcing a re-route.
   * `nodeId` matches node faults, `link` matches link faults.
   */
  private invalidateRouteFor(nodeId: string | null, reason: string, link?: { from: string; to: string }): void {
    const active = this.activeJob();
    if (!active?.route) return;
    if (active.stage !== 'TRANSMIT' && active.stage !== 'ROUTE') return;

    const affected = nodeId
      ? active.route.nodes.includes(nodeId)
      : link
        ? active.route.edges.some((edge) => linkTouchesNode(edge.from, link) && edge.from === link.from)
        : false;
    if (!affected) return;

    this.emit({ type: 'route:recalculating', jobId: active.id, reason });
    this.emitLog('warn', 'ROUTE', `Route recalculation… (${reason})`);
    active.route = null;
    active.hopIndex = 0;
    this.enterStage(active, 'ROUTE', 'relay');
  }

  submit(input: SubmitInput): string {
    this.counter += 1;
    const id = `JOB-${this.counter.toString().padStart(4, '0')}`;
    const job: Job = {
      id,
      from: input.from,
      to: input.to,
      sourceLanguage: input.sourceLanguage,
      targetLanguage: input.targetLanguage,
      text: input.text.trim(),
      priority: input.priority ?? 'NORMAL',
      origin: input.origin ?? 'MANUAL',
      inputMode: input.inputMode ?? 'text',
      createdAt: Date.now(),
      stage: 'INPUT',
      side: 'source',
      status: 'queued',
      stageStartedAt: Date.now(),
      pivotText: '',
      deliveredText: '',
      packet: null,
      route: null,
      hopIndex: 0,
      hopStartedAt: 0,
      storedAtNode: null,
      storedSince: 0,
      deliveredAt: null,
      latencyMs: null,
      translationNote: null,
      presetPivot: input.pivotText?.trim() || null,
      presetPivotEngine: input.pivotEngine ?? null,
      presetTarget: input.translatedText?.trim() || null,
      presetTargetEngine: input.translationEngine ?? null,
    };
    this.jobs.set(id, job);
    this.order.push(id);
    this.queue.enqueue(id, job.priority, id);
    this.emit({
      type: 'job:queued',
      jobId: id,
      priority: job.priority,
      position: this.queue.size,
      origin: job.origin,
      from: job.from,
      to: job.to,
      text: job.text,
      sourceLanguage: job.sourceLanguage,
      targetLanguage: job.targetLanguage,
      inputMode: job.inputMode,
    });
    this.emitLog(
      job.priority === 'SOS' ? 'error' : 'info',
      'QUEUE',
      `${job.priority} packet queued — position ${this.queue.size}`,
    );
    this.pushQueueState();
    return id;
  }

  /**
   * Advances the simulation and returns every event produced since the last tick.
   *
   * Events raised between ticks (submit, mode change, fault injection,
   * store-and-forward flush) are carried over rather than dropped, so a caller
   * always receives them on the next call.
   */
  async tick(now: number = Date.now()): Promise<EngineEvent[]> {
    // A stage can await (translation), so a fast interval could re-enter mid-stage.
    // Overlapping ticks would advance the same stage twice; refuse instead.
    if (this.ticking) return [];
    this.ticking = true;
    try {
      return await this.tickInner(now);
    } finally {
      this.ticking = false;
    }
  }

  private async tickInner(now: number): Promise<EngineEvent[]> {
    const carried = this.events;
    this.events = [];

    if (!this.activeJobId) {
      const next = this.queue.dequeue();
      if (next) {
        const job = this.jobs.get(next.id)!;
        this.activeJobId = job.id;
        job.status = 'running';
        this.emit({ type: 'job:started', jobId: job.id });
        this.pushQueueState();
        this.enterStage(job, 'INPUT', 'source');
      }
    }

    const active = this.activeJob();
    if (active) await this.advance(active, now);

    const produced = [...carried, ...this.events];
    this.events = [];
    return produced;
  }

  snapshot(): { jobs: JobView[]; queue: JobView[]; topology: NetworkTopology; activeJobId: string | null } {
    const jobViews = (ids: string[]): JobView[] =>
      ids
        .map((id) => this.jobs.get(id))
        .filter((j): j is Job => Boolean(j))
        .map((j) => ({
          id: j.id,
          from: j.from,
          to: j.to,
          priority: j.priority,
          origin: j.origin,
          inputMode: j.inputMode,
          stage: j.stage,
          side: j.side,
          route: j.route,
          status: j.status === 'done' ? 'delivered' : j.status === 'failed' ? 'failed' : j.status,
        }));
    return {
      jobs: jobViews(this.order),
      queue: jobViews(this.queue.list().map((i) => i.payload)),
      topology: this.topology,
      activeJobId: this.activeJobId,
    };
  }

  private activeJob(): Job | undefined {
    return this.activeJobId ? this.jobs.get(this.activeJobId) : undefined;
  }

  private enterStage(job: Job, stage: PipelineStage, side: StageSide): void {
    job.stage = stage;
    job.side = side;
    job.stageStartedAt = Date.now();
    this.emit({ type: 'stage', jobId: job.id, stage, side, status: 'active' });
  }

  private completeStage(job: Job, status: 'done' | 'skipped' = 'done', note?: string): void {
    this.emit({ type: 'stage', jobId: job.id, stage: job.stage, side: job.side, status, ...(note ? { note } : {}) });
  }

  private async advance(job: Job, now: number): Promise<void> {
    const elapsed = now - job.stageStartedAt;

    if (job.status === 'stored') {
      if (elapsed >= this.timingProfile.storeRetry) this.flushStored();
      return;
    }

    switch (job.stage) {
      case 'INPUT': {
        if (elapsed < 60) return;
        this.completeStage(job);
        if (job.inputMode === 'voice') {
          this.enterStage(job, 'STT', 'source');
        } else {
          this.emit({
            type: 'stage',
            jobId: job.id,
            stage: 'STT',
            side: 'source',
            status: 'skipped',
            note: 'Typed input — speech recognition not used.',
          });
          this.enterStage(job, 'LANGUAGE_DETECT', 'source');
        }
        return;
      }

      case 'STT': {
        if (elapsed < this.timingProfile.stt) return;
        this.completeStage(job, 'done', 'Simulated recognition latency (browser Web Speech API handles capture on-device or via browser service).');
        this.enterStage(job, 'LANGUAGE_DETECT', 'source');
        return;
      }

      case 'LANGUAGE_DETECT': {
        if (elapsed < this.timingProfile.detect) return;
        this.completeStage(job, 'done', `Detected ${job.sourceLanguage.toUpperCase()} from the sending device language setting.`);
        this.enterStage(job, 'TRANSLATION', 'source');
        return;
      }

      case 'TRANSLATION': {
        if (elapsed < this.timingProfile.translate) return;
        if (job.side === 'source') {
          if (job.presetPivot) {
            // The sending device already ran its own MT (on-device pack or remote); honour it.
            job.pivotText = job.presetPivot;
            this.completeStage(
              job,
              'done',
              `${job.sourceLanguage.toUpperCase()} → EN pivot on the sending device via ${job.presetPivotEngine ?? 'device MT'}`,
            );
          } else {
            const result = await this.translationService.translate(job.text, job.sourceLanguage, 'en');
            job.pivotText = result.text;
            job.translationNote = result.note ?? null;
            this.completeStage(
              job,
              'done',
              `${job.sourceLanguage.toUpperCase()} → EN pivot via ${result.engine} (${result.resolution})`,
            );
          }
          this.enterStage(job, 'PACKET', 'source');
          return;
        }
        if (job.presetTarget) {
          job.deliveredText = job.presetTarget;
          this.completeStage(
            job,
            'done',
            `EN → ${job.targetLanguage.toUpperCase()} via ${job.presetTargetEngine ?? 'device MT'} for the receiving device.`,
          );
          this.emit({ type: 'packet:rendered', jobId: job.id, text: job.presetTarget, language: job.targetLanguage });
          this.enterStage(job, 'TTS', 'receiver');
          return;
        }
        const result = await this.translationService.translate(job.pivotText, 'en', job.targetLanguage);
        job.deliveredText = result.text;
        this.completeStage(
          job,
          'done',
          `EN → ${job.targetLanguage.toUpperCase()} via ${result.engine} (${result.resolution}) on the receiving device.`,
        );
        this.emit({ type: 'packet:rendered', jobId: job.id, text: result.text, language: job.targetLanguage });
        this.enterStage(job, 'TTS', 'receiver');
        return;
      }

      case 'PACKET': {
        if (elapsed < this.timingProfile.packet) return;
        const packet = await createPacket({
          sourceDevice: job.from,
          destinationDevice: job.to,
          sourceLanguage: job.sourceLanguage,
          targetLanguage: job.targetLanguage,
          text: job.text,
          translatedText: job.pivotText,
          pivotText: job.pivotText,
          timestamp: job.createdAt,
          priority: job.priority,
          id: `ITN-${(this.counter * 7717 % 0xffff).toString(16).toUpperCase().padStart(4, '0')}`,
        });
        job.packet = packet;
        this.emit({ type: 'packet:created', jobId: job.id, packet });
        this.completeStage(job, 'done', `${packet.payloadBytes} B payload + SHA-256 integrity tag`);
        this.enterStage(job, 'QUEUE', 'relay');
        return;
      }

      case 'QUEUE': {
        if (elapsed < this.timingProfile.queue) return;
        this.completeStage(job, 'done', `${job.priority} priority`);
        this.enterStage(job, 'ROUTE', 'relay');
        return;
      }

      case 'ROUTE': {
        if (elapsed < this.timingProfile.route) return;
        const route = findRoute(this.topology, job.from, job.to, this.mode);
        if (!route) {
          if (this.mode === 'STORE_FORWARD') {
            const holder = this.storageNode(job.from);
            job.status = 'stored';
            job.storedAtNode = holder;
            job.storedSince = Date.now();
            this.emit({ type: 'route:failed', jobId: job.id, reason: 'No all-online route in the active topology' });
            this.emit({ type: 'packet:stored', jobId: job.id, nodeId: holder });
            this.emitLog('warn', 'STORE', `Message stored at ${holder} — waiting for connectivity…`);
            return;
          }
          this.fail(job, 'No route to destination in the active network mode');
          return;
        }
        job.route = route;
        job.hopIndex = 0;
        this.emit({ type: 'route:selected', jobId: job.id, route, label: routeLabel(this.topology, route) });
        this.emitLog('info', 'ROUTE', `Route selected: ${routeLabel(this.topology, route)}`);
        this.completeStage(job, 'done', `${route.hops} hop(s)`);
        this.enterStage(job, 'TRANSMIT', 'relay');
        job.hopStartedAt = Date.now();
        return;
      }

      case 'TRANSMIT': {
        const route = job.route;
        if (!route) return;
        const edge = route.edges[job.hopIndex];
        if (!edge) {
          this.completeStage(job, 'done', `${route.hops} hop(s) completed`);
          this.enterStage(job, 'DELIVER', 'relay');
          return;
        }
        const progress = Math.min(1, (now - job.hopStartedAt) / this.timingProfile.hop);
        if (progress > 0) this.emit({ type: 'hop:progress', jobId: job.id, from: edge.from, to: edge.to, progress });
        if (progress < 1) return;
        this.emit({ type: 'hop:progress', jobId: job.id, from: edge.from, to: edge.to, progress: 1 });
        job.hopIndex += 1;
        job.hopStartedAt = Date.now();
        if (job.hopIndex >= route.edges.length) {
          this.completeStage(job, 'done');
          this.enterStage(job, 'DELIVER', 'relay');
        }
        return;
      }

      case 'DELIVER': {
        if (elapsed < this.timingProfile.deliver) return;
        const latencyMs = Date.now() - job.createdAt;
        job.deliveredAt = Date.now();
        job.latencyMs = latencyMs;
        job.packet && (job.packet.hopCount = job.route?.hops ?? 0);
        const via = (job.route?.nodes ?? []).slice(1, -1).map((id) => nodeById(this.topology, id)?.label ?? id);
        this.completeStage(job, 'done', `Observed wall-clock latency ${latencyMs} ms (measured, not modelled).`);
        this.emit({
          type: 'packet:delivered',
          jobId: job.id,
          text: job.pivotText,
          latencyMs,
          via: via.join(' → ') || 'DIRECT',
        });
        this.enterStage(job, 'TRANSLATION', 'receiver');
        return;
      }

      case 'TTS': {
        if (elapsed < this.timingProfile.tts) return;
        this.completeStage(job, 'done', 'Audio ready — awaiting playback on the receiving device.');
        this.enterStage(job, 'DONE', 'receiver');
        return;
      }

      case 'DONE': {
        job.status = 'done';
        this.completeStage(job);
        this.emit({
          type: 'job:completed',
          jobId: job.id,
          latencyMs: job.latencyMs ?? Date.now() - job.createdAt,
        });
        this.activeJobId = null;
        this.pushQueueState();
        return;
      }

      default:
        return;
    }
  }

  /** Where a packet waits when store-and-forward has no route: nearest online relay. */
  private storageNode(from: string): string {
    const route = findRoute(this.topology, from, DEVICE_B, 'RELAY_1');
    if (route) return route.nodes[route.nodes.length - 2] ?? from;
    return from;
  }

  /** Retries every stored packet; called on tick and whenever the topology changes. */
  private flushStored(): void {
    for (const id of this.order) {
      const job = this.jobs.get(id);
      if (!job || job.status !== 'stored') continue;
      const route = findRoute(this.topology, job.from, job.to, this.mode);
      if (!route) continue;
      job.status = 'running';
      job.route = route;
      job.hopIndex = 0;
      const waited = Date.now() - job.storedSince;
      this.emit({ type: 'packet:released', jobId: job.id, nodeId: job.storedAtNode ?? job.from, waitedMs: waited });
      this.emitLog('success', 'STORE', `Stored packet released after ${waited} ms`);
      this.emit({ type: 'route:selected', jobId: job.id, route, label: routeLabel(this.topology, route) });
      this.emit({ type: 'route:recalculating', jobId: job.id, reason: 'Connectivity restored' });
      job.storedAtNode = null;
      job.stage = 'ROUTE';
      job.side = 'relay';
      job.stageStartedAt = Date.now() - this.timingProfile.route;
    }
  }

  private fail(job: Job, reason: string): void {
    job.status = 'failed';
    this.emit({ type: 'job:failed', jobId: job.id, reason });
    this.emitLog('error', 'LINK', `Delivery failed: ${reason}`);
    this.activeJobId = null;
    this.pushQueueState();
  }

  private pushQueueState(): void {
    this.emit({
      type: 'queue:update',
      items: this.queue.list().map((item) => {
        const job = this.jobs.get(item.payload);
        return {
          id: item.payload,
          priority: item.priority,
          seq: item.seq,
          label: job ? `${job.from} → ${job.to} · ${job.text.slice(0, 28)}` : item.payload,
        };
      }),
    });
  }

  private emit(event: EngineEvent): void {
    this.events.push(event);
  }

  private emitLog(severity: LogEntry['severity'], channel: string, message: string): void {
    this.emit({
      type: 'log',
      entry: {
        id: `ENG-${this.instance}-${++this.logSeq}`,
        at: Date.now(),
        severity,
        channel,
        message,
      },
    });
  }
}

export { DEVICE_A, DEVICE_B };
