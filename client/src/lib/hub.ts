/**
 * Whether the hub (and therefore the ITANTRA models it runs) is reachable right now.
 * Kept in step by the store from the transport status, so model clients can skip the
 * network entirely in Local demo mode instead of producing failed requests.
 */
let online = false;

export function setHubOnline(value: boolean): void {
  online = value;
}

export function hubOnline(): boolean {
  return online;
}
