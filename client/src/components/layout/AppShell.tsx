import { useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { PAGES, navigate, useHashPage, type PageId } from '../../lib/router.ts';
import { ConnectionBadge } from './ConnectionBadge.tsx';
import { NoticeStack } from './NoticeStack.tsx';
import { HeaderDemo } from './HeaderDemo.tsx';
import { cx } from '../../lib/format.ts';

const PAGE_LABEL: Record<PageId, string> = {
  transceiver: 'Live Transceiver',
  console: 'Console',
};

export function AppShell({ children }: { children: React.ReactNode }) {
  const page = useHashPage();

  useEffect(() => {
    document.title = `iTantra · ${PAGE_LABEL[page]}`;
  }, [page]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!event.altKey) return;
      const index = Number(event.key) - 1;
      const target = PAGES[index];
      if (Number.isInteger(index) && target) navigate(target.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-panel focus:px-3 focus:py-2 focus:text-sm"
      >
        Skip to content
      </a>

      <header className="relative z-30 shrink-0 border-b border-edge/60 bg-void/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[100rem] items-center gap-3 px-4 py-2.5 sm:px-6">
          <button
            type="button"
            className="flex items-baseline gap-2 text-left"
            onClick={() => navigate('transceiver')}
            aria-label="iTantra home"
          >
            <span className="text-base font-semibold tracking-tight text-ink">iTantra</span>
            <span className="tech-label hidden lg:inline">Indian Multilingual Neural Transceiver</span>
          </button>

          <nav className="ml-auto hidden items-center gap-1 md:flex" aria-label="Primary">
            {PAGES.map((entry, index) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => navigate(entry.id)}
                aria-current={page === entry.id ? 'page' : undefined}
                title={`${entry.hint} · Alt+${index + 1}`}
                className={cx(
                  'rounded-lg px-2.5 py-1.5 text-[12px] transition-colors',
                  page === entry.id ? 'bg-cyan/12 text-cyan' : 'text-muted hover:text-ink',
                )}
              >
                {entry.label}
              </button>
            ))}
          </nav>

          <div className="md:ml-2">
            <HeaderDemo />
          </div>

          <ConnectionBadge />
        </div>

        <nav className="flex gap-1 overflow-x-auto border-t border-edge/40 px-3 py-1.5 md:hidden" aria-label="Primary mobile">
          {PAGES.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => navigate(entry.id)}
              aria-current={page === entry.id ? 'page' : undefined}
              className={cx(
                'shrink-0 rounded-lg px-2.5 py-1.5 text-[12px] transition-colors',
                page === entry.id ? 'bg-cyan/12 text-cyan' : 'text-muted hover:text-ink',
              )}
            >
              {entry.label}
            </button>
          ))}
        </nav>
      </header>

      <main
        id="main"
        className={cx(
          'min-h-0 w-full flex-1',
          // The transceiver is laid out to fit the window exactly; only the Console scrolls internally.
          page === 'transceiver' ? 'overflow-hidden' : 'overflow-y-auto',
        )}
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={page}
            className={cx('mx-auto max-w-[100rem] px-4 py-3 sm:px-6', page === 'transceiver' ? 'h-full' : 'sm:py-6')}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
          >
            {children}
          </motion.div>
        </AnimatePresence>
      </main>

      <NoticeStack />
    </div>
  );
}
