import { randomUUID } from 'node:crypto';
import { ProductMtEngine } from './mt/ProductMtEngine.ts';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  DEFAULT_TIMING,
  SimulationEngine,
  createTranslationService,
  parseClientMessage,
  type ClientMessage,
  type NetworkMode,
  type ServerMessage,
} from '@itantra/shared';

const TRANSLATION_PROVIDER = process.env.TRANSLATION_PROVIDER ?? 'mymemory';
const TICK_MS = 40;

/**
 * Authoritative simulation hub.
 *
 * While this is reachable the browser submits commands and renders the `engine`
 * event batches that come back. If the socket drops, the browser instantiates the
 * very same `SimulationEngine` locally, so the demo is never dead in the water.
 *
 * The demo script is intentionally *not* driven here: narration, highlighting
 * and TTS belong to the browser, which sends each scripted message as an
 * ordinary `message:create`.
 */
export class SimulationHub {
  readonly engine: SimulationEngine;
  private readonly clients = new Set<WebSocket>();
  private ticking = false;

  constructor(provider = TRANSLATION_PROVIDER) {
    this.engine = new SimulationEngine('MESH_2', createTranslationService({ provider, leadingEngines: [new ProductMtEngine()] }), DEFAULT_TIMING);
  }

  attach(server: WebSocketServer): void {
    server.on('connection', (socket) => {
      this.clients.add(socket);
      this.send(socket, {
        type: 'hello',
        sessionId: randomUUID().slice(0, 8).toUpperCase(),
        serverTime: Date.now(),
        translationProvider: TRANSLATION_PROVIDER,
      });
      this.send(socket, {
        type: 'snapshot',
        topology: this.engine.snapshot().topology,
        mode: this.engine.mode,
        clients: this.clients.size,
      });

      socket.on('message', (raw) => {
        const message = parseClientMessage(raw.toString());
        if (!message) {
          this.send(socket, { type: 'error', message: 'Unrecognised message shape', fatal: false });
          return;
        }
        this.handle(message, socket);
      });

      const drop = () => this.clients.delete(socket);
      socket.on('close', drop);
      socket.on('error', drop);
    });

    const timer = setInterval(() => void this.step(), TICK_MS);
    const shutdown = () => {
      clearInterval(timer);
      server.close();
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  }

  /** Serialises ticks so a slow translation can never overlap the next interval. */
  private async step(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const events = await this.engine.tick(Date.now());
      if (events.length > 0) this.broadcast({ type: 'engine', events });
    } finally {
      this.ticking = false;
    }
  }

  private handle(message: ClientMessage, socket: WebSocket): void {
    switch (message.type) {
      case 'message:create':
        this.engine.submit({
          text: message.text,
          from: message.from,
          to: message.to,
          sourceLanguage: message.sourceLanguage,
          targetLanguage: message.targetLanguage,
          priority: message.priority ?? 'NORMAL',
          origin: message.origin ?? 'MANUAL',
          inputMode: message.inputMode ?? 'text',
          pivotText: message.pivotText,
          pivotEngine: message.pivotEngine,
          translatedText: message.translatedText,
          translationEngine: message.translationEngine,
        });
        break;

      case 'sos:create':
        this.engine.submit({
          text: message.text,
          from: message.from,
          to: message.to,
          sourceLanguage: message.sourceLanguage,
          targetLanguage: message.targetLanguage,
          priority: 'SOS',
          origin: 'SOS',
          inputMode: 'text',
        });
        break;

      case 'network:update':
        if (message.mode) {
          this.engine.setMode(message.mode as NetworkMode);
          this.broadcast({ type: 'mode', mode: message.mode as NetworkMode });
        }
        if (message.nodeId && typeof message.online === 'boolean') {
          this.engine.setNodeOnline(message.nodeId, message.online);
        }
        if (message.link && typeof message.link.online === 'boolean') {
          this.engine.setLinkOnline(message.link.from, message.link.to, message.link.online);
        }
        break;

      case 'ping':
        this.send(socket, { type: 'pong', serverTime: Date.now() });
        break;

      default:
        // device:connect / device:update / demo:* / log:clear are browser-local.
        break;
    }
  }

  private broadcast(message: ServerMessage): void {
    const payload = JSON.stringify(message);
    for (const client of this.clients) {
      if (client.readyState === client.OPEN) client.send(payload);
    }
  }

  private send(socket: WebSocket, message: ServerMessage): void {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
  }
}
