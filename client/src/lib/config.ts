const rawWs = import.meta.env.VITE_WS_URL?.trim();

/**
 * Default: same origin, path /ws. In dev Vite proxies it to the hub; in production
 * the hub serves the client itself. Same-origin means https pages get wss for free.
 */
export const WS_URL = rawWs && rawWs.length > 0
  ? rawWs
  : `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;

/** `mock` = curated dataset only · `mymemory` (default) = dataset → on-device pack → remote MT. */
export const TRANSLATION_PROVIDER = import.meta.env.VITE_TRANSLATION_PROVIDER ?? 'mymemory';

/** Boot directly in local simulation (no WebSocket round trip needed). */
export const BOOT_LOCAL_SIMULATION = import.meta.env.VITE_DEMO_MODE === 'true';

export const TICK_MS = 40;
