import { useEffect, useRef } from 'react';
import { Eraser } from 'lucide-react';
import type { LogEntry } from '@itantra/shared';
import { cx, formatClock } from '../../lib/format.ts';

const TONE: Record<LogEntry['severity'], string> = {
  info: 'text-muted',
  success: 'text-mint',
  warn: 'text-amber',
  error: 'text-alarm',
};

export function EventLog({ log, onClear, className }: { log: LogEntry[]; onClear: () => void; className?: string }) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' });
  }, [log.length]);

  return (
    <div className={cx('panel flex min-h-0 flex-col p-4', className)}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="tech-label">System log</h2>
        <button type="button" className="btn btn-ghost !px-2 !py-1 !text-[11px]" onClick={onClear} aria-label="Clear system log">
          <Eraser size={12} />
          Clear
        </button>
      </div>

      <div
        className="panel-inset min-h-[8rem] flex-1 overflow-y-auto p-2 font-mono text-[10.5px] leading-relaxed"
        role="log"
        aria-live="polite"
        aria-label="System event log"
      >
        {log.length === 0 ? (
          <p className="py-6 text-center text-muted">Log cleared.</p>
        ) : (
          log.map((entry) => (
            <div key={entry.id} className="flex gap-2 py-0.5">
              <span className="shrink-0 text-muted/70">{formatClock(entry.at)}</span>
              <span className="w-12 shrink-0 text-cyan/70">{entry.channel}</span>
              <span className={cx('min-w-0 flex-1 break-words', TONE[entry.severity])}>{entry.message}</span>
            </div>
          ))
        )}
        <div ref={endRef} />
      </div>
    </div>
  );
}
