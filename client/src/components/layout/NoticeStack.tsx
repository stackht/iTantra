import { useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Info, TriangleAlert, X } from 'lucide-react';
import { cx } from '../../lib/format.ts';
import { useStore } from '../../store/useStore.ts';

/** Transient, honest degradation messages (mic missing, no voices, no backend…). */
export function NoticeStack() {
  const notices = useStore((s) => s.notices);
  const dismiss = useStore((s) => s.dismissNotice);

  useEffect(() => {
    if (notices.length === 0) return;
    const timers = notices.map((notice) =>
      window.setTimeout(() => dismiss(notice.id), 7000),
    );
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [notices, dismiss]);

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex flex-col items-center gap-2 px-4">
      <AnimatePresence initial={false}>
        {notices.map((notice) => {
          const Icon = notice.tone === 'error' ? TriangleAlert : notice.tone === 'warn' ? TriangleAlert : Info;
          return (
            <motion.div
              key={notice.id}
              layout
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ duration: 0.2 }}
              className={cx(
                'panel pointer-events-auto flex max-w-lg items-center gap-2 px-3 py-2 text-[12px]',
                notice.tone === 'warn' && 'border-amber/45 text-amber',
                notice.tone === 'error' && 'border-alarm/50 text-alarm',
              )}
              role="status"
            >
              <Icon size={13} className="shrink-0" />
              <span className="text-ink">{notice.message}</span>
              <button
                type="button"
                className="btn btn-ghost !p-1"
                onClick={() => dismiss(notice.id)}
                aria-label="Dismiss notice"
              >
                <X size={11} />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
