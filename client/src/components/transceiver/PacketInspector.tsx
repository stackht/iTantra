import { motion } from 'framer-motion';
import { ShieldCheck } from 'lucide-react';
import { formatBytes, formatMs } from '../../lib/format.ts';
import type { JobUi } from '../../store/useStore.ts';
import { Pill } from '../primitives.tsx';

/**
 * Packet inspector.
 *
 * PAYLOAD is the real UTF-8 byte length of the transmitted text fields, and the
 * latency figure is wall-clock time measured in this browser session. Hop count
 * and priority come from the engine. Everything else about a production link
 * (compression ratio, airtime, BER) is NOT modelled and is labelled as such.
 */
export function PacketInspector({ job }: { job: JobUi | null }) {
  if (!job?.packet) {
    return (
      <div className="panel p-4">
        <h2 className="tech-label mb-2">Packet inspector</h2>
        <p className="text-xs leading-relaxed text-muted">
          A packet appears here as soon as the encoder runs. Payload size is the actual UTF-8 length of the
          transmitted text — nothing is estimated.
        </p>
      </div>
    );
  }

  const packet = job.packet;
  const rows: [string, string][] = [
    ['ID', packet.id],
    ['PAYLOAD', formatBytes(packet.payloadBytes)],
    ['SOURCE', packet.sourceDevice],
    ['TARGET', packet.destinationDevice],
    ['LANG', `${packet.sourceLanguage.toUpperCase()} → ${packet.targetLanguage.toUpperCase()}`],
    ['HOPS', String(job.route?.hops ?? packet.hopCount)],
    ['PRIORITY', packet.priority],
    ['LATENCY', formatMs(job.latencyMs)],
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24 }}
      className="panel p-4"
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="tech-label">Simulated packet</h2>
        <Pill tone={packet.priority === 'SOS' ? 'alarm' : 'accent'}>
          <ShieldCheck size={9} /> SHA-256 tagged
        </Pill>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-4">
        {rows.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="tech-label">{label}</dt>
            <dd className={label === 'PRIORITY' && value === 'SOS' ? 'tech-value text-alarm' : 'tech-value truncate text-sm'}>
              {value}
            </dd>
          </div>
        ))}
      </dl>

      <div className="mt-3 space-y-1.5 border-t border-edge/50 pt-3">
        <p className="text-[13px] leading-snug break-words" lang={packet.sourceLanguage}>
          <span className="tech-label mr-2">SRC</span>
          {packet.text}
        </p>
        <p className="text-[13px] leading-snug break-words text-muted" lang="en">
          <span className="tech-label mr-2">PIVOT</span>
          {packet.pivotText || '—'}
        </p>
        {job.renderedText ? (
          <p className="text-[13px] leading-snug break-words" lang={packet.targetLanguage}>
            <span className="tech-label mr-2">RX</span>
            {job.renderedText}
          </p>
        ) : null}
      </div>

      <p className="mt-3 font-mono text-[9.5px] leading-relaxed break-all text-muted/80">
        TAG {packet.authTag.slice(0, 32)}…
      </p>
      <p className="mt-2 text-[10.5px] leading-relaxed text-muted">
        Byte counts are measured from the payload text. Link capacity, airtime and compression ratio are{' '}
        <span className="text-amber">not modelled</span> in this prototype.
      </p>
    </motion.div>
  );
}
