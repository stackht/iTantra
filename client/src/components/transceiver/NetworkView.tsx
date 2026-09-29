import { useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowDown, Radio, Server, Smartphone } from 'lucide-react';
import type { NetworkTopology } from '@itantra/shared';
import { edgeKey } from '@itantra/shared';
import { cx } from '../../lib/format.ts';
import { StatusDot } from '../primitives.tsx';
import type { FlightSegment } from '../../store/useStore.ts';

interface Point {
  x: number;
  y: number;
}

const LAYOUT: Record<string, Point> = {
  'DEV-A': { x: 12, y: 8 },
  'RELAY-01': { x: 50, y: 8 },
  'RELAY-02': { x: 50, y: 50 },
  'DEV-B': { x: 88, y: 8 },
};

const VIEW_W = 100;
const VIEW_H = 62;

function pointFor(id: string): Point {
  return LAYOUT[id] ?? { x: 50, y: 30 };
}

/**
 * Relay/mesh map. Nodes and links come from the same topology the engine routes
 * against, so a relay marked offline here is genuinely excluded from routing.
 */
export function NetworkView({
  topology,
  flight,
  storedJobs,
  className,
  compact = false,
  highlight,
}: {
  topology: NetworkTopology;
  flight: FlightSegment[];
  storedJobs?: string[];
  className?: string;
  compact?: boolean;
  highlight?: boolean;
}) {
  const nodeMap = useMemo(() => new Map(topology.nodes.map((n) => [n.id, n])), [topology.nodes]);

  const drawnEdges = useMemo(() => {
    const seen = new Set<string>();
    return topology.edges.filter((edge) => {
      const key = edgeKey(edge.from, edge.to);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [topology.edges]);

  return (
    <div className={cx('relative', className)}>
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        className="w-full touch-none select-none"
        style={{ aspectRatio: `${VIEW_W} / ${VIEW_H}`, overflow: 'visible' }}
        role="img"
        aria-label="Relay mesh topology"
      >
        <defs>
          <linearGradient id="link" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#38e1ff" stopOpacity="0.15" />
            <stop offset="50%" stopColor="#38e1ff" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#38e1ff" stopOpacity="0.15" />
          </linearGradient>
        </defs>

        {drawnEdges.map((edge) => {
          const a = nodeMap.get(edge.from);
          const b = nodeMap.get(edge.to);
          if (!a || !b) return null;
          const from = pointFor(a.id);
          const to = pointFor(b.id);
          const up = a.online && b.online && edge.online;
          const failed = a.online && b.online && !edge.online;
          return (
            <g key={edgeKey(a.id, b.id)}>
              <line
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                stroke={up ? 'url(#link)' : '#ff4655'}
                strokeOpacity={up ? 1 : failed ? 0.55 : 0.3}
                strokeWidth={up ? 0.5 : 0.4}
                strokeDasharray={up ? undefined : '1.6 1.4'}
              />
              {failed ? (
                <text
                  x={(from.x + to.x) / 2}
                  y={(from.y + to.y) / 2 - 1.6}
                  textAnchor="middle"
                  fill="#ff7b85"
                  style={{ font: '2.6px ui-monospace, monospace', letterSpacing: '0.1em' }}
                >
                  LINK DOWN
                </text>
              ) : null}
            </g>
          );
        })}

        <AnimatePresence>
          {flight.map((segment) => {
            const from = pointFor(segment.from);
            const to = pointFor(segment.to);
            const t = Math.min(1, Math.max(0, segment.progress));
            const x = from.x + (to.x - from.x) * t;
            const y = from.y + (to.y - from.y) * t;
            const alarm = segment.priority === 'SOS';
            return (
              <motion.g key={`${segment.jobId}-${segment.from}-${segment.to}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <circle cx={x} cy={y} r={2.6} fill={alarm ? '#ff4655' : '#38e1ff'} opacity={0.25} />
                <circle cx={x} cy={y} r={1.2} fill={alarm ? '#ff4655' : '#7aeaff'} />
              </motion.g>
            );
          })}
        </AnimatePresence>

        {topology.nodes.map((node) => {
          const point = pointFor(node.id);
          const Icon = node.kind === 'DEVICE' ? Smartphone : Server;
          const stored = (storedJobs?.length ?? 0) > 0 && node.kind === 'RELAY' && node.online;
          return (
            <g key={node.id} transform={`translate(${point.x} ${point.y})`}>
              <motion.circle
                r={compact ? 3.4 : 4.6}
                fill={node.online ? '#0b1320' : '#1a0d11'}
                stroke={node.online ? (node.kind === 'DEVICE' ? '#38e1ff' : '#5d7590') : '#ff4655'}
                strokeWidth={0.45}
                animate={node.online ? { scale: [1, 1.045, 1] } : { scale: 1 }}
                transition={{ duration: 3.6, repeat: Infinity, ease: 'easeInOut' }}
                style={{ transformOrigin: 'center' }}
              />
              {stored ? (
                <circle r={6.2} fill="none" stroke="#ffb648" strokeWidth={0.35} strokeDasharray="1.2 1.2" opacity={0.8}>
                  <animate attributeName="r" values="5.6;7;5.6" dur="2.4s" repeatCount="indefinite" />
                </circle>
              ) : null}
              <foreignObject x={-5} y={-5} width={10} height={10}>
                <Icon size={compact ? 14 : 18} color={node.online ? '#cfe7f5' : '#ff7b85'} strokeWidth={1.4} />
              </foreignObject>
              <text
                y={compact ? 8.5 : 11}
                textAnchor="middle"
                fill={node.online ? '#90a4bd' : '#ff7b85'}
                style={{ font: `${compact ? 3 : 3.6}px ui-monospace, monospace`, letterSpacing: '0.08em' }}
              >
                {node.shortLabel}
              </text>
            </g>
          );
        })}
      </svg>

      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
        {topology.nodes.map((node) => (
          <span key={node.id} className="flex items-center gap-1.5">
            <StatusDot tone={node.online ? 'ok' : 'alarm'} />
            <span className="tech-label">{node.label}</span>
            <span className={cx('font-mono text-[10px]', node.online ? 'text-mint' : 'text-alarm')}>
              {node.online ? 'ONLINE' : 'OFFLINE'}
            </span>
          </span>
        ))}
      </div>

      {!compact ? (
        <div className="mt-3 flex items-center gap-2 text-[11px] text-muted">
          <Radio size={12} className="text-cyan" />
          <span>Packet motion is driven by engine progress events, not by a canned animation.</span>
          <ArrowDown size={12} className="ml-auto opacity-40" />
        </div>
      ) : null}
      {highlight ? <div className="pointer-events-none absolute inset-0 rounded-[10px] ring-1 ring-cyan/50" aria-hidden="true" /> : null}
    </div>
  );
}
