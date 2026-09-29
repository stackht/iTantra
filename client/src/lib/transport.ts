import { clientTranslationService } from './clientTranslation.ts';
import {
  createTopology,
  parseServerMessage,
  SimulationEngine,
  type ClientMessage,
  type ConnectionStatus,
  type EngineEvent,
  type NetworkMode,
  type NetworkTopology,
} from '@itantra/shared';
import { BOOT_LOCAL_SIMULATION, TICK_MS, WS_URL } from './config.ts';

export interface TransportHandlers {
  onEvents: (events: EngineEvent[]) => void;
  onStatus: (status: ConnectionStatus, detail: string) => void;
  onSession: (sessionId: string | null) => void;
  onSnapshot: (mode: NetworkMode, topology: NetworkTopology) => void;
}

/**
 * Dual-path transport.
 *
 * - `ONLINE`: commands travel over the WebSocket and the hub's SimulationEngine
 *   streams `engine` event batches back.
 * - `LOCAL_SIMULATION`: the identical SimulationEngine runs in this tab, so the
 *   whole product keeps working with no backend at all.
 */
class Transport {
  private socket: WebSocket | null = null;
  private localEngine: SimulationEngine | null = null;
  private localTimer: number | null = null;
  private reconnectTimer: number | null = null;
  private handlers: TransportHandlers | null = null;
  private status: ConnectionStatus = 'CONNECTING';
  private attempts = 0;
  private closed = false;
  private localMode = new SimulationEngine('MESH_2', clientTranslationService);
  private localModeCapped = false;
  private logSeq = 0;
  private lastTopology: NetworkTopology | null = null;

  register(handlers: TransportHandlers): void {
    this.handlers = handlers;
  }

  start(): void {
    this.closed = false;
    if (BOOT_LOCAL_SIMULATION) {
      // VITE_DEMO_MODE=true: never touch the network, run the engine in this tab.
      this.fallback('VITE_DEMO_MODE=true — local simulation, no hub connection attempted');
      return;
    }
    this.setStatus('CONNECTING', `Connecting to ${WS_URL}`);
    try {
      this.socket = new WebSocket(WS_URL);
    } catch {
      this.fallback('WebSocket URL rejected by the browser');
      this.scheduleReconnect();
      return;
    }

    this.socket.onopen = () => {
      this.attempts = 0;
      this.setStatus('ONLINE', `Hub connected · ${WS_URL}`);
    };

    this.socket.onmessage = (event) => {
      const message = parseServerMessage(String(event.data));
      if (!message) return;

      switch (message.type) {
        case 'hello':
          this.handlers?.onSession(message.sessionId);
          this.emit([
            {
              type: 'log',
              entry: {
                id: `LOG-hello-${message.sessionId}`,
                at: message.serverTime,
                severity: 'success',
                channel: 'LINK',
                message: `Hub session ${message.sessionId} · translation provider "${message.translationProvider}"`,
              },
            },
          ]);
          break;
        case 'snapshot':
          this.handlers?.onStatus(this.status, `Hub online · ${message.clients} client(s)`);
          this.handlers?.onSnapshot(message.mode, message.topology);
          break;
        case 'engine':
          for (const event of message.events) {
            if (event.type === 'network:update') this.lastTopology = event.topology;
          }
          this.handlers?.onEvents(message.events);
          break;
        case 'mode':
          // Keeps every connected tab's selector in step with the hub.
          this.handlers?.onSnapshot(message.mode, this.lastTopology ?? createTopology());
          this.emit([
            {
              type: 'log',
              entry: {
                id: `LOG-mode-${Date.now()}-${++this.logSeq}`,
                at: Date.now(),
                severity: 'info',
                channel: 'NETWORK',
                message: `Hub applied mode ${message.mode}`,
              },
            },
          ]);
          break;
        case 'error':
          this.emit([
            {
              type: 'log',
              entry: {
                id: `LOG-err-${Date.now()}-${++this.logSeq}`,
                at: Date.now(),
                severity: 'warn',
                channel: 'LINK',
                message: message.message,
              },
            },
          ]);
          break;
        case 'pong':
          break;
      }
    };

    this.socket.onclose = () => {
      if (this.closed) return;
      this.fallback('Backend unavailable — running local simulation');
      this.scheduleReconnect();
    };
  }

  stop(): void {
    this.closed = true;
    if (this.reconnectTimer) window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.stopLocal();
    this.socket?.close();
    this.socket = null;
  }

  send(message: ClientMessage): boolean {
    if (this.status === 'ONLINE' && this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
      return true;
    }
    return this.sendLocally(message);
  }

  private sendLocally(message: ClientMessage): boolean {
    const engine = this.ensureLocal();
    switch (message.type) {
      case 'message:create':
        engine.submit({
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
        return true;
      case 'sos:create':
        engine.submit({
          text: message.text,
          from: message.from,
          to: message.to,
          sourceLanguage: message.sourceLanguage,
          targetLanguage: message.targetLanguage,
          priority: 'SOS',
          origin: 'SOS',
          inputMode: 'text',
        });
        return true;
      case 'network:update':
        if (message.mode) engine.setMode(message.mode as NetworkMode);
        if (message.nodeId && typeof message.online === 'boolean') engine.setNodeOnline(message.nodeId, message.online);
        if (message.link && typeof message.link.online === 'boolean') {
          engine.setLinkOnline(message.link.from, message.link.to, message.link.online);
        }
        return true;
      default:
        return false;
    }
  }

  private ensureLocal(): SimulationEngine {
    this.localModeCapped = true;
    if (!this.localEngine) {
      this.localEngine = this.localMode;
      this.localTimer = window.setInterval(() => {
        void this.localMode.tick().then((events) => {
          if (events.length > 0) this.handlers?.onEvents(events);
        });
      }, TICK_MS);
      this.emit([{ type: 'network:update', topology: this.localMode.snapshot().topology }]);
    }
    return this.localEngine;
  }

  private stopLocal(): void {
    if (this.localTimer) window.clearInterval(this.localTimer);
    this.localTimer = null;
    // Keep the instance (and its queue) alive only for the fallback path.
    this.localEngine = this.localModeCapped ? this.localMode : null;
  }

  private fallback(detail: string): void {
    this.setStatus('LOCAL_SIMULATION', detail);
    this.ensureLocal();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.closed) return;
    const delay = Math.min(15000, 1000 * 2 ** this.attempts);
    this.attempts += 1;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.start();
    }, delay);
  }

  private emit(events: EngineEvent[]): void {
    this.handlers?.onEvents(events);
  }

  private setStatus(status: ConnectionStatus, detail: string): void {
    this.status = status;
    this.handlers?.onStatus(status, detail);
  }

  get currentStatus(): ConnectionStatus {
    return this.status;
  }
}

export const transport = new Transport();
export { createTopology };
