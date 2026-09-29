import { useState } from 'react';
import { getLanguage } from '@itantra/shared';
import { DevicePanel } from '../components/transceiver/DevicePanel.tsx';
import { cx } from '../lib/format.ts';
import { useStore } from '../store/useStore.ts';

/**
 * The primary demonstration screen: two handsets, sized to the window so the page never
 * scrolls. On narrow screens only one handset fits, so a switch picks which one is shown
 * (both stay mounted, so the hidden one still receives and speaks messages).
 */
export function TransceiverPage() {
  const [shown, setShown] = useState<'A' | 'B'>('A');
  const devices = useStore((s) => s.devices);
  const messages = useStore((s) => s.messages);
  const unreadFor = (id: string) => messages.filter((m) => m.to === id && m.status === 'delivered').length;

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex shrink-0 justify-center gap-1 md:hidden" role="tablist" aria-label="Choose device">
        {(['A', 'B'] as const).map((side) => {
          const device = devices[`DEV-${side}`];
          return (
            <button
              key={side}
              type="button"
              role="tab"
              aria-selected={shown === side}
              onClick={() => setShown(side)}
              className={cx(
                'rounded-full border px-3 py-1 text-[12px] transition-colors',
                shown === side ? 'border-cyan/50 bg-cyan/12 text-cyan' : 'border-edge/60 text-muted',
              )}
            >
              Device {side} · {device ? getLanguage(device.language).nativeName : ''}
              <span className="ml-1.5 font-mono text-[10px] text-muted">{unreadFor(`DEV-${side}`)}</span>
            </button>
          );
        })}
      </div>

      <div className="mx-auto grid min-h-0 w-full max-w-[900px] flex-1 gap-8 md:grid-cols-2 md:gap-10">
        <DevicePanel deviceId="DEV-A" side="A" className={shown === 'A' ? '' : 'hidden md:flex'} />
        <DevicePanel deviceId="DEV-B" side="B" className={shown === 'B' ? '' : 'hidden md:flex'} />
      </div>
    </div>
  );
}
