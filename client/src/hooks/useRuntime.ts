import { useEffect } from 'react';
import { useStore } from '../store/useStore.ts';
import { TICK_MS } from '../lib/config.ts';

/**
 * Single application ticker. Drives the demo script clock; the transport owns
 * its own engine tick, so this stays very cheap.
 */
export function useRuntime(): void {
  useEffect(() => {
    const timer = window.setInterval(() => {
      useStore.getState().demoTick(Date.now());
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, []);
}
