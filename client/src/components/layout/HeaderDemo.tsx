import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Pause, Play, SkipForward, Square, X } from 'lucide-react';
import { DEMO_TOTAL_MS } from '@itantra/shared';
import { navigate } from '../../lib/router.ts';
import { useStore } from '../../store/useStore.ts';

/**
 * Demo control that lives inside the header bar. Idle: a Start demo button.
 * Running / paused / finished: step counter, current step, controls, and a thin
 * progress line along the bottom edge of the header.
 */
export function HeaderDemo() {
  const demo = useStore((s) => s.demo);
  const startDemo = useStore((s) => s.startDemo);
  const pauseDemo = useStore((s) => s.pauseDemo);
  const resumeDemo = useStore((s) => s.resumeDemo);
  const skipDemo = useStore((s) => s.skipDemo);
  const stopDemo = useStore((s) => s.stopDemo);
  const [, tick] = useState(0);

  const active = demo.running || demo.paused || demo.finished;

  // Re-render a few times a second so the progress line moves smoothly while running.
  useEffect(() => {
    if (!demo.running) return;
    const timer = window.setInterval(() => tick((n) => n + 1), 250);
    return () => window.clearInterval(timer);
  }, [demo.running]);

  const launch = () => {
    navigate('transceiver');
    startDemo();
  };

  if (!active) {
    return (
      <button
        type="button"
        className="btn btn-primary !py-1.5 !text-[12px]"
        onClick={launch}
        title="Run the scripted Hindi ↔ Marathi demonstration on the two devices"
      >
        <Play size={12} />
        Start demo
      </button>
    );
  }

  const elapsed = demo.startedAt && demo.running ? Date.now() - demo.startedAt : 0;
  const progress = demo.finished ? 1 : Math.min(1, elapsed / DEMO_TOTAL_MS);
  const title = demo.finished ? 'Communication established' : (demo.step?.title ?? 'Ready');

  return (
    <>
      <div className="flex min-w-0 items-center gap-2" role="status" aria-live="polite">
        <span className="tech-label shrink-0 text-cyan">
          Demo {Math.min(demo.index + 1, demo.total)}/{demo.total}
        </span>
        <span className="hidden min-w-0 truncate text-[12px] font-medium text-ink sm:inline" title={demo.step?.detail ?? title}>
          {title}
        </span>
        <span className="flex shrink-0 items-center gap-1">
          {demo.running ? (
            <button type="button" className="btn btn-ghost !p-1.5" onClick={pauseDemo} aria-label="Pause demo" title="Pause">
              <Pause size={13} />
            </button>
          ) : null}
          {demo.paused ? (
            <button type="button" className="btn btn-ghost !p-1.5" onClick={resumeDemo} aria-label="Resume demo" title="Resume">
              <Play size={13} />
            </button>
          ) : null}
          {demo.running || demo.paused ? (
            <button type="button" className="btn btn-ghost !p-1.5" onClick={skipDemo} aria-label="Skip demo" title="Skip to the end">
              <SkipForward size={13} />
            </button>
          ) : null}
          {demo.finished ? (
            <button type="button" className="btn btn-ghost !p-1.5" onClick={launch} aria-label="Restart demo" title="Restart">
              <Play size={13} />
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn-ghost !p-1.5"
            onClick={stopDemo}
            aria-label={demo.finished ? 'Dismiss demo' : 'Stop demo'}
            title={demo.finished ? 'Dismiss' : 'Stop'}
          >
            {demo.finished ? <X size={13} /> : <Square size={12} />}
          </button>
        </span>
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[2px] bg-edge/40" aria-hidden="true">
        <motion.div className="h-full bg-cyan" initial={false} animate={{ width: `${progress * 100}%` }} transition={{ duration: 0.3 }} />
      </div>
    </>
  );
}
