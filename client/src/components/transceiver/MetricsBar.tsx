import { Activity, Gauge, Route as RouteIcon, Timer } from 'lucide-react';
import type { Metrics } from '@itantra/shared';
import { cx, formatBytes, formatMs } from '../../lib/format.ts';
import { Metric, StatusDot } from '../primitives.tsx';

/**
 * Live metrics.
 *
 * Every number here is read from real state: counters come from the message
 * list, latency is wall-clock time measured between submit and delivery, and
 * anything with no measurement yet renders as `--` instead of a placeholder.
 */
export function MetricsBar({ metrics, className }: { metrics: Metrics; className?: string }) {
  return (
    <div className={cx('panel p-4', className)}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="tech-label">System status</h2>
        <span className="flex items-center gap-1.5">
          <StatusDot tone="ok" pulse />
          <span className="tech-label text-mint">Online</span>
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Metric label="Messages" value={String(metrics.messages)} />
        <Metric label="Delivered" value={String(metrics.delivered)} tone={metrics.delivered > 0 ? 'ok' : undefined} />
        <Metric label="Failed" value={String(metrics.failed)} tone={metrics.failed > 0 ? 'alarm' : undefined} />
        <Metric label="Current route" value={metrics.currentRouteHops === null ? '--' : `${metrics.currentRouteHops} hop(s)`} />
        <Metric label="Payload" value={metrics.lastPayloadBytes === null ? '--' : formatBytes(metrics.lastPayloadBytes)} />
        <Metric
          label="Latency (measured)"
          value={formatMs(metrics.latencyMs)}
          hint={metrics.latencyMs === null ? 'No delivery yet' : 'Submit → delivered, this session'}
          tone={metrics.latencyMs !== null ? 'ok' : undefined}
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <span className="flex items-center gap-1.5">
          <Activity size={11} className="text-cyan" />
          <span className="tech-label">Translation</span>
          <span className={metrics.translationReady ? 'tech-value text-[11px] text-mint' : 'tech-value text-[11px] text-amber'}>
            {metrics.translationReady ? 'READY' : 'OFFLINE'}
          </span>
        </span>
        <span className="flex items-center gap-1.5">
          <Gauge size={11} className="text-cyan" />
          <span className="tech-label">STT</span>
          <span className={metrics.sttReady ? 'tech-value text-[11px] text-mint' : 'tech-value text-[11px] text-amber'}>
            {metrics.sttReady ? 'READY' : 'TEXT MODE'}
          </span>
        </span>
        <span className="flex items-center gap-1.5">
          <Timer size={11} className="text-cyan" />
          <span className="tech-label">TTS</span>
          <span className={metrics.ttsReady ? 'tech-value text-[11px] text-mint' : 'tech-value text-[11px] text-amber'}>
            {metrics.ttsReady ? 'READY' : 'TEXT ONLY'}
          </span>
        </span>
        <span className="flex items-center gap-1.5">
          <RouteIcon size={11} className="text-cyan" />
          <span className="tech-label">Packets transmitted</span>
          <span className="tech-value text-[11px]">{metrics.packetsTransmitted}</span>
        </span>
        {metrics.storedForwards > 0 ? (
          <span className="flex items-center gap-1.5">
            <span className="tech-label text-amber">Store &amp; forward flushes</span>
            <span className="tech-value text-[11px] text-amber">{metrics.storedForwards}</span>
          </span>
        ) : null}
      </div>
    </div>
  );
}
