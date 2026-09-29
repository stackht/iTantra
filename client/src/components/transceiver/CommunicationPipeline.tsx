import { motion } from 'framer-motion';
import { Check, Loader2, Minus } from 'lucide-react';
import type { PipelineStage } from '@itantra/shared';
import { cx } from '../../lib/format.ts';
import type { JobUi, StageView } from '../../store/useStore.ts';

const LABELS: { stage: PipelineStage; label: string }[] = [
  { stage: 'INPUT', label: 'Input' },
  { stage: 'STT', label: 'STT' },
  { stage: 'LANGUAGE_DETECT', label: 'Language' },
  { stage: 'TRANSLATION', label: 'Translate' },
  { stage: 'PACKET', label: 'Encode' },
  { stage: 'QUEUE', label: 'Queue' },
  { stage: 'ROUTE', label: 'Route' },
  { stage: 'TRANSMIT', label: 'Transmit' },
  { stage: 'DELIVER', label: 'Decode' },
  { stage: 'TRANSLATION', label: 'Translate' },
  { stage: 'TTS', label: 'TTS' },
  { stage: 'DONE', label: 'Ready' },
];

function stageKey(stage: PipelineStage, side: string): string {
  return `${stage}-${side}`;
}

function statusOf(stages: StageView[], stage: PipelineStage, side: StageView['side']): StageView | null {
  return [...stages].reverse().find((s) => s.stage === stage && s.side === side) ?? null;
}

/** Stage slots ordered the way the engine actually walks them. */
const SEQUENCE: { stage: PipelineStage; side: StageView['side'] }[] = [
  { stage: 'INPUT', side: 'source' },
  { stage: 'STT', side: 'source' },
  { stage: 'LANGUAGE_DETECT', side: 'source' },
  { stage: 'TRANSLATION', side: 'source' },
  { stage: 'PACKET', side: 'source' },
  { stage: 'QUEUE', side: 'relay' },
  { stage: 'ROUTE', side: 'relay' },
  { stage: 'TRANSMIT', side: 'relay' },
  { stage: 'DELIVER', side: 'relay' },
  { stage: 'TRANSLATION', side: 'receiver' },
  { stage: 'TTS', side: 'receiver' },
  { stage: 'DONE', side: 'receiver' },
];

/** Consecutive differences between completed stage timestamps — measured, not modelled. */
function stageDurations(stages: StageView[]): Record<string, number> {
  const done = stages.filter((s) => s.status === 'done').sort((a, b) => a.at - b.at);
  const durations: Record<string, number> = {};
  const firstStartedAt = stages.length > 0 ? stages[0].at : 0;
  for (let i = 1; i < done.length; i += 1) {
    durations[stageKey(done[i].stage, done[i].side)] = done[i].at - done[i - 1].at;
  }
  if (done.length > 0) {
    durations[stageKey(done[0].stage, done[0].side)] = Math.max(0, done[0].at - firstStartedAt);
  }
  return durations;
}

export function CommunicationPipeline({ job }: { job: JobUi | null }) {
  if (!job) {
    return (
      <div className="panel px-4 py-5">
        <div className="tech-label mb-3">Transmission pipeline</div>
        <p className="text-xs leading-relaxed text-muted">
          Send a message from either device. Each stage below reports its real state as the packet moves:
          speech → text → language → translation → encoding → relay → decoding → speech.
        </p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {SEQUENCE.map(({ stage, side }) => (
            <span key={stageKey(stage, side)} className="pill opacity-45">
              {LABELS.find((l) => l.stage === stage)?.label ?? stage}
            </span>
          ))}
        </div>
      </div>
    );
  }

  const durations = stageDurations(job.stages);
  const done = job.stages.filter((s) => s.status === 'done' || s.status === 'skipped').length;
  const progress = job.stages.length > 0 ? done / SEQUENCE.length : 0;

  return (
    <div className="panel px-4 py-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span className="tech-label">Transmission pipeline · {job.id}</span>
        <span className="tech-label">
          {job.status === 'stored'
            ? 'MESSAGE STORED'
            : job.status === 'failed'
              ? 'FAILED'
              : job.status === 'delivered'
                ? 'DELIVERED'
                : 'IN FLIGHT'}
        </span>
      </div>

      <ol className="grid grid-cols-3 gap-1.5 sm:grid-cols-6 lg:grid-cols-12" role="list" aria-label="Pipeline stages">
        {SEQUENCE.map((slot) => {
          const view = statusOf(job.stages, slot.stage, slot.side);
          const label = LABELS.find((l) => l.stage === slot.stage)?.label ?? slot.stage;
          const isActive = view?.status === 'active';
          const isDone = view?.status === 'done';
          const isSkipped = view?.status === 'skipped';
          const duration = durations[stageKey(slot.stage, slot.side)];
          const alarm = job.priority === 'SOS' && isActive;

          return (
            <li key={stageKey(slot.stage, slot.side)} className="min-w-0">
              <motion.div
                layout
                className={cx(
                  'relative h-full rounded-lg border px-2 py-2 transition-colors',
                  isActive
                    ? alarm
                      ? 'border-alarm/70 bg-alarm/12'
                      : 'border-cyan/60 bg-cyan/10'
                    : isDone
                      ? 'border-mint/25 bg-mint/5'
                      : isSkipped
                        ? 'border-edge/70 bg-transparent opacity-60'
                        : 'border-edge/60 opacity-45',
                )}
                aria-current={isActive ? 'step' : undefined}
              >
                <div className="flex items-center gap-1">
                  {isDone ? (
                    <Check size={10} className="shrink-0 text-mint" aria-hidden="true" />
                  ) : isSkipped ? (
                    <Minus size={10} className="shrink-0 text-muted" aria-hidden="true" />
                  ) : isActive ? (
                    <Loader2 size={10} className="shrink-0 animate-spin text-cyan" aria-hidden="true" />
                  ) : (
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-muted/40" aria-hidden="true" />
                  )}
                  <span
                    className={cx(
                      'truncate font-mono text-[9.5px] tracking-[0.1em] uppercase',
                      isActive ? 'text-cyan' : isDone ? 'text-mint' : 'text-muted',
                    )}
                  >
                    {label}
                  </span>
                </div>
                {view?.status === 'active' ? (
                  <div className="tech-label mt-1 text-[9px] text-cyan/70">{slot.side}</div>
                ) : duration !== undefined ? (
                  <div className="tech-value mt-1 text-[9px] text-muted">{duration} ms</div>
                ) : null}
                <span className="sr-only">
                  {label}: {view?.status ?? 'idle'}
                  {view?.note ? `. ${view.note}` : ''}
                </span>
              </motion.div>
            </li>
          );
        })}
      </ol>

      <div className="mt-3 h-0.5 w-full overflow-hidden rounded-full bg-edge/70">
        <motion.div
          className={cx('h-full rounded-full', job.priority === 'SOS' ? 'bg-alarm' : 'bg-cyan')}
          initial={false}
          animate={{ width: `${Math.min(100, progress * 100)}%` }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
        />
      </div>

      <p aria-live="polite" className="mt-2 min-h-[2.5rem] text-[11px] leading-relaxed text-muted">
        {job.stages.length === 0
          ? 'Queued — waiting for the channel.'
          : (job.stages[job.stages.length - 1]?.note ?? 'Stage detail appears here as the pipeline advances.')}
      </p>
    </div>
  );
}

/** Architecture chain (MIC → … → AUDIO) with an active glow on the current stage. */
export function SignalChain({ stages, className }: { stages: { stage: string; status: 'idle' | 'active' | 'done' }[]; className?: string }) {
  return (
    <ol className={cx('flex flex-wrap items-center gap-x-1 gap-y-1.5', className)} aria-label="Signal chain">
      {stages.map((item, index) => (
        <li key={item.stage} className="flex items-center gap-1">
          <span
            className={cx(
              'rounded-md border px-2 py-1 font-mono text-[9.5px] tracking-[0.1em] uppercase transition-colors',
              item.status === 'active'
                ? 'border-cyan/60 bg-cyan/12 text-cyan'
                : item.status === 'done'
                  ? 'border-mint/30 bg-mint/6 text-mint'
                  : 'border-edge/60 text-muted/70',
            )}
          >
            {item.stage}
          </span>
          {index < stages.length - 1 ? <span className="text-muted/40" aria-hidden="true">→</span> : null}
        </li>
      ))}
    </ol>
  );
}
