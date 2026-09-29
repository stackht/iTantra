import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, Siren } from 'lucide-react';
import { PRIORITY_RANK, type Priority } from '@itantra/shared';
import { cx } from '../../lib/format.ts';
import type { QueueRow } from '../../store/useStore.ts';
import { Pill } from '../primitives.tsx';

const LABELS: Record<Priority, { text: string; order: number; tone: 'alarm' | 'warn' | 'default' }> = {
  SOS: { text: 'SOS', order: 1, tone: 'alarm' },
  HIGH: { text: 'HIGH', order: 2, tone: 'warn' },
  NORMAL: { text: 'NORMAL', order: 3, tone: 'default' },
};

/** Live view of the strict priority queue: SOS > HIGH > NORMAL, FIFO within a band. */
export function QueuePanel({ queue, className }: { queue: QueueRow[]; className?: string }) {
  const counts = queue.reduce(
    (acc, row) => ({ ...acc, [row.priority]: acc[row.priority] + 1 }),
    { SOS: 0, HIGH: 0, NORMAL: 0 } as Record<Priority, number>,
  );

  return (
    <div className={cx('panel p-4', className)}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="tech-label">Transmission queue</h2>
        <span className="tech-value text-[11px] text-muted">{queue.length} waiting</span>
      </div>

      <div className="mb-3 grid grid-cols-3 gap-1.5">
        {(['SOS', 'HIGH', 'NORMAL'] as Priority[]).map((priority) => (
          <div
            key={priority}
            className={cx(
              'rounded-lg border px-2 py-1.5 text-center',
              priority === 'SOS' && counts.SOS > 0 ? 'border-alarm/60 bg-alarm/12' : 'border-edge/60',
            )}
          >
            <div
              className={cx(
                'font-mono text-[9.5px] tracking-[0.12em] uppercase',
                priority === 'SOS' && counts.SOS > 0 ? 'text-alarm' : 'text-muted',
              )}
            >
              {LABELS[priority].text}
            </div>
            <div className="tech-value mt-0.5 text-base leading-none">{counts[priority]}</div>
          </div>
        ))}
      </div>

      <ol className="flex flex-col gap-1.5" aria-live="polite">
        <AnimatePresence initial={false}>
          {queue.map((row, index) => (
            <motion.li
              key={row.id}
              layout
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 8 }}
              transition={{ duration: 0.2 }}
              className={cx(
                'flex items-center gap-2 rounded-lg border px-2.5 py-1.5',
                row.priority === 'SOS' ? 'border-alarm/55 bg-alarm/10' : 'border-edge/60 bg-void/30',
              )}
            >
              <span className="tech-value w-5 shrink-0 text-[11px] text-muted">{index + 1}</span>
              {row.priority === 'SOS' ? (
                <Siren size={12} className="shrink-0 text-alarm" aria-hidden="true" />
              ) : row.priority === 'HIGH' ? (
                <AlertTriangle size={12} className="shrink-0 text-amber" aria-hidden="true" />
              ) : null}
              <span className="min-w-0 flex-1 truncate text-[12px] text-ink">{row.label}</span>
              <Pill tone={LABELS[row.priority].tone}>P{LABELS[row.priority].order}</Pill>
            </motion.li>
          ))}
        </AnimatePresence>
        {queue.length === 0 ? (
          <li className="rounded-lg border border-edge/50 px-3 py-4 text-center text-[11px] text-muted">
            Channel idle — nothing waiting.
          </li>
        ) : null}
      </ol>

      <p className="mt-3 text-[10.5px] leading-relaxed text-muted">
        Strict priority with FIFO inside each band (rank {Object.values(PRIORITY_RANK).join(' < ')}). A packet arriving as SOS
        preempts anything already waiting.
      </p>
    </div>
  );
}
