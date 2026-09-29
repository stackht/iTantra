import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { cx } from '../lib/format.ts';

export function Panel({
  children,
  className,
  label,
  right,
  id,
}: {
  children: ReactNode;
  className?: string;
  label?: string;
  right?: ReactNode;
  id?: string;
}) {
  return (
    <section id={id} className={cx('panel p-4 sm:p-5', className)}>
      {(label || right) && (
        <header className="mb-3 flex items-center justify-between gap-3">
          {label ? <h2 className="tech-label">{label}</h2> : <span />}
          {right}
        </header>
      )}
      {children}
    </section>
  );
}

export function StatusDot({ tone, pulse = false }: { tone: 'ok' | 'warn' | 'alarm' | 'idle'; pulse?: boolean }) {
  const color =
    tone === 'ok' ? 'bg-mint' : tone === 'warn' ? 'bg-amber' : tone === 'alarm' ? 'bg-alarm' : 'bg-muted/60';
  return (
    <span className="relative inline-flex h-2 w-2 shrink-0" aria-hidden="true">
      {pulse && <span className={cx('absolute inset-0 rounded-full opacity-70', color, 'animate-ping')} />}
      <span className={cx('relative h-2 w-2 rounded-full', color)} />
    </span>
  );
}

export function Pill({
  children,
  tone = 'default',
  title,
}: {
  children: ReactNode;
  tone?: 'default' | 'ok' | 'warn' | 'alarm' | 'accent';
  title?: string;
}) {
  const tones: Record<string, string> = {
    default: 'border-edge/70 text-muted',
    ok: 'border-mint/40 text-mint',
    warn: 'border-amber/45 text-amber',
    alarm: 'border-alarm/55 text-alarm',
    accent: 'border-cyan/45 text-cyan',
  };
  return (
    <span className={cx('pill', tones[tone])} title={title}>
      {children}
    </span>
  );
}

export function Metric({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: 'ok' | 'warn' | 'alarm' }) {
  const color = tone === 'ok' ? 'text-mint' : tone === 'warn' ? 'text-amber' : tone === 'alarm' ? 'text-alarm' : 'text-ink';
  return (
    <div className="panel-inset px-3 py-2.5">
      <div className="tech-label">{label}</div>
      <div className={cx('tech-value mt-1 text-lg leading-none font-semibold sm:text-xl', color)}>{value}</div>
      {hint ? <div className="mt-1 text-[11px] leading-tight text-muted">{hint}</div> : null}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
  tone = 'default',
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  description?: string;
  tone?: 'default' | 'alarm';
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cx(
        'flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors',
        checked
          ? tone === 'alarm'
            ? 'border-alarm/60 bg-alarm/12'
            : 'border-cyan/45 bg-cyan/10'
          : 'border-edge/70 hover:border-cyan/30',
      )}
    >
      <span className="min-w-0">
        <span className={cx('block text-sm', tone === 'alarm' && checked ? 'text-alarm' : 'text-ink')}>{label}</span>
        {description ? <span className="mt-0.5 block text-[11px] leading-tight text-muted">{description}</span> : null}
      </span>
      <span
        className={cx(
          'relative h-5 w-9 shrink-0 rounded-full transition-colors',
          checked ? (tone === 'alarm' ? 'bg-alarm/80' : 'bg-cyan/70') : 'bg-edge',
        )}
        aria-hidden="true"
      >
        <motion.span
          layout
          transition={{ type: 'spring', stiffness: 520, damping: 34 }}
          className={cx('absolute top-0.5 h-4 w-4 rounded-full bg-ink', checked ? 'left-[1.15rem]' : 'left-0.5')}
        />
      </span>
    </button>
  );
}

/** Progress rail used by the pipeline and the signal chain. */
export function Rail({ value, tone = 'accent' }: { value: number; tone?: 'accent' | 'alarm' }) {
  return (
    <div className="h-0.5 w-full overflow-hidden rounded-full bg-edge/70">
      <motion.div
        className={cx('h-full rounded-full', tone === 'alarm' ? 'bg-alarm' : 'bg-cyan')}
        initial={false}
        animate={{ width: `${Math.min(100, Math.max(0, value * 100))}%` }}
        transition={{ duration: 0.35, ease: 'easeOut' }}
      />
    </div>
  );
}

export function EmptyHint({ children }: { children: ReactNode }) {
  return <p className="px-1 py-6 text-center text-xs leading-relaxed text-muted">{children}</p>;
}
