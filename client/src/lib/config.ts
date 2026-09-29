/**
 * Where the hub lives.
 *
 * Resolution order (first match wins):
 *   1. `?hub=https://…` in the page URL — lets one permanent frontend (Cloudflare Pages) point
 *      at a hub whose address changes (a Cloudflare quick tunnel from the demo PC). Remembered
 *      in localStorage so reloads and shared tabs keep working; `?hub=` (empty) clears it.
 *   2. VITE_HUB_URL at build time — a fixed hub on another origin.
 *   3. Same origin (/api, /ws) — dev via the Vite proxy, or the hub serving the app itself.
 */
const HUB_KEY = 'itantra.hub';

function normalise(url: string | null | undefined): string {
  return (url ?? '').trim().replace(/\/+$/, '');
}

function resolveHub(): string {
  if (typeof window === 'undefined') return normalise(import.meta.env.VITE_HUB_URL);
  const params = new URLSearchParams(window.location.search);
  if (params.has('hub')) {
    const fromUrl = normalise(params.get('hub'));
    try {
      if (fromUrl) window.localStorage.setItem(HUB_KEY, fromUrl);
      else window.localStorage.removeItem(HUB_KEY);
    } catch {
      // Storage unavailable (private mode): the URL parameter still applies to this load.
    }
    if (/^https?:\/\//.test(fromUrl)) return fromUrl;
    if (!fromUrl) return normalise(import.meta.env.VITE_HUB_URL);
  }
  try {
    const saved = normalise(window.localStorage.getItem(HUB_KEY));
    if (/^https?:\/\//.test(saved)) return saved;
  } catch {
    // ignore
  }
  return normalise(import.meta.env.VITE_HUB_URL);
}

export const HUB_URL = resolveHub();

/** Absolute or same-origin URL for a hub API path such as `/api/mt`. */
export function apiUrl(path: string): string {
  return `${HUB_URL}${path}`;
}

function defaultWsUrl(): string {
  if (HUB_URL) return `${HUB_URL.replace(/^http/, 'ws')}/ws`;
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
}

const rawWs = import.meta.env.VITE_WS_URL?.trim();
export const WS_URL = rawWs && rawWs.length > 0 ? rawWs : defaultWsUrl();

/** `mock` = curated dataset only · `mymemory` (default) = product MT → dataset → remote MT. */
export const TRANSLATION_PROVIDER = import.meta.env.VITE_TRANSLATION_PROVIDER ?? 'mymemory';

/** Boot directly in local simulation (no WebSocket round trip needed). */
export const BOOT_LOCAL_SIMULATION = import.meta.env.VITE_DEMO_MODE === 'true';

export const TICK_MS = 40;
