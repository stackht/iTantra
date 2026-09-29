import { useSyncExternalStore } from 'react';

export const PAGES = [
  { id: 'transceiver', label: 'Live Transceiver', hint: 'Two devices, one channel' },
  { id: 'console', label: 'Console', hint: 'Pipeline, packets, queue, log' },
] as const;

export type PageId = (typeof PAGES)[number]['id'];

const DEFAULT_PAGE: PageId = 'transceiver';

function readHash(): PageId {
  const raw = location.hash.replace(/^#\/?/, '').split('?')[0];
  return PAGES.some((p) => p.id === raw) ? (raw as PageId) : DEFAULT_PAGE;
}

let current = readHash();
const listeners = new Set<() => void>();

window.addEventListener('hashchange', () => {
  current = readHash();
  for (const listener of listeners) listener();
});

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Tiny hash router: two pages do not justify a routing dependency. */
export function useHashPage(): PageId {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => DEFAULT_PAGE,
  );
}

export function navigate(page: PageId): void {
  location.hash = `#/${page}`;
}

export function getPage(): PageId {
  return current;
}
