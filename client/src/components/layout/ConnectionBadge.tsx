import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { RadioTower, X } from 'lucide-react';
import type { ConnectionStatus } from '@itantra/shared';
import { cx } from '../../lib/format.ts';
import { useStore } from '../../store/useStore.ts';
import { StatusDot } from '../primitives.tsx';

const LABEL: Record<ConnectionStatus, string> = {
  CONNECTING: 'Connecting',
  ONLINE: 'Online',
  LOCAL_SIMULATION: 'Local demo mode',
};

/** Clickable connection badge that opens the honest network-status sheet. */
export function ConnectionBadge() {
  const [open, setOpen] = useState(false);
  const connection = useStore((s) => s.connection);
  const detail = useStore((s) => s.connectionDetail);
  const sessionId = useStore((s) => s.sessionId);
  const topology = useStore((s) => s.topology);
  const devices = useStore((s) => s.devices);
  const mode = useStore((s) => s.mode);
  const translationProvider = useStore((s) => s.translationProvider);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const tone = connection === 'ONLINE' ? 'ok' : connection === 'CONNECTING' ? 'warn' : 'alarm';

  return (
    <div className="relative">
      <button
        type="button"
        className={cx('btn !py-1.5 !text-[11px]', connection === 'LOCAL_SIMULATION' && '!border-amber/50 !text-amber')}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <StatusDot tone={tone} pulse={connection !== 'LOCAL_SIMULATION'} />
        {LABEL[connection]}
      </button>

      <AnimatePresence>
        {open ? (
          <>
            <button
              type="button"
              className="fixed inset-0 z-40 cursor-default bg-void/40"
              aria-label="Close network status"
              onClick={() => setOpen(false)}
            />
            <motion.div
              role="dialog"
              aria-label="Network status"
              initial={{ opacity: 0, y: -6, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.98 }}
              transition={{ duration: 0.16 }}
              className="panel absolute right-0 z-50 mt-2 w-[17rem] p-3.5"
            >
              <div className="mb-2 flex items-center justify-between">
                <span className="tech-label">Network status</span>
                <button type="button" className="btn btn-ghost !p-1" onClick={() => setOpen(false)} aria-label="Close network status">
                  <X size={12} />
                </button>
              </div>

              <dl className="flex flex-col gap-1 font-mono text-[11px]">
                <Row label="WebSocket" value={connection === 'ONLINE' ? 'CONNECTED' : 'UNAVAILABLE'} tone={connection === 'ONLINE' ? 'ok' : 'warn'} />
                <Row label="Simulation" value={connection === 'ONLINE' ? 'SERVER AUTHORITATIVE' : 'BROWSER LOCAL'} tone={connection === 'ONLINE' ? 'ok' : 'warn'} />
                <Row label="Session" value={sessionId ?? 'local'} />
                <Row label="Translation" value={translationProvider} />
                <Row label="Mode" value={mode} />
              </dl>

              <div className="mt-3 border-t border-edge/50 pt-2">
                <span className="tech-label">Nodes</span>
                <ul className="mt-1 flex flex-col gap-1">
                  {topology.nodes.map((node) => (
                    <li key={node.id} className="flex items-center justify-between font-mono text-[11px]">
                      <span className="flex items-center gap-1.5">
                        <StatusDot tone={node.online ? 'ok' : 'alarm'} />
                        {node.label}
                      </span>
                      <span className={node.online ? 'text-mint' : 'text-alarm'}>{node.online ? 'ONLINE' : 'OFFLINE'}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <p className="mt-3 text-[10px] leading-relaxed text-muted">{detail}</p>

              {connection !== 'ONLINE' ? (
                <p className="mt-2 flex items-start gap-1.5 text-[10.5px] leading-relaxed text-amber">
                  <RadioTower size={11} className="mt-0.5 shrink-0" />
                  <span>
                    The hub is unreachable, so the identical simulation engine runs inside this tab. Everything still
                    works; only the transport is local.
                  </span>
                </p>
              ) : null}

              <p className="mt-2 font-mono text-[10px] text-muted">
                {Object.values(devices).map((d) => `${d.id}=${d.language.toUpperCase()}`).join(' · ')}
              </p>
            </motion.div>
          </>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: 'ok' | 'warn' }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-muted">{label}</dt>
      <dd className={cx('truncate', tone === 'ok' ? 'text-mint' : tone === 'warn' ? 'text-amber' : 'text-ink')}>{value}</dd>
    </div>
  );
}
