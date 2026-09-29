import type { NetworkEdge, NetworkMode, NetworkNode, NetworkTopology, Route } from './types.ts';

export const DEVICE_A = 'DEV-A';
export const DEVICE_B = 'DEV-B';
export const RELAY_1 = 'RELAY-01';
export const RELAY_2 = 'RELAY-02';

export function edgeKey(from: string, to: string): string {
  return [from, to].sort().join('~');
}

/**
 * Relay/mesh topology used by the Live Transceiver and the Network page.
 *
 *   DEVICE A ── RELAY 01 ── RELAY 02 ── DEVICE B   (2-hop mesh, default mode)
 *                   └────────────── DEVICE B       (1-relay alternate)
 *   DEVICE A ─────────────────────── DEVICE B       (direct link)
 *
 * RELAY 01 is Device A's only first hop, so:
 *   - losing RELAY 02 recalculates onto DEVICE A → RELAY 01 → DEVICE B;
 *   - losing RELAY 01 genuinely strands packets, which is what makes the
 *     failure and store-and-forward demonstrations meaningful.
 */
export function createTopology(): NetworkTopology {
  const nodes: NetworkNode[] = [
    { id: DEVICE_A, label: 'DEVICE A', shortLabel: 'DEV-A', kind: 'DEVICE', online: true },
    { id: RELAY_1, label: 'RELAY 01', shortLabel: 'R1', kind: 'RELAY', online: true },
    { id: RELAY_2, label: 'RELAY 02', shortLabel: 'R2', kind: 'RELAY', online: true },
    { id: DEVICE_B, label: 'DEVICE B', shortLabel: 'DEV-B', kind: 'DEVICE', online: true },
  ];
  const links: [string, string][] = [
    [DEVICE_A, RELAY_1],
    [RELAY_1, RELAY_2],
    [RELAY_2, DEVICE_B],
    [RELAY_1, DEVICE_B],
    [DEVICE_A, DEVICE_B],
  ];
  const edges: NetworkEdge[] = links.map(([from, to]) => ({ from, to, online: true }));
  return { nodes, edges };
}

function neighbours(topology: NetworkTopology, id: string): string[] {
  const nodeOnline = new Set(topology.nodes.filter((n) => n.online).map((n) => n.id));
  const result: string[] = [];
  for (const edge of topology.edges) {
    if (!edge.online) continue;
    if (edge.from === id && nodeOnline.has(edge.to) && edge.to !== id) result.push(edge.to);
    else if (edge.to === id && nodeOnline.has(edge.from) && edge.from !== id) result.push(edge.from);
  }
  return [...new Set(result)];
}

interface HopPolicy {
  min: number;
  max: number;
  /** Mesh range extension prefers relay reuse; direct links prefer the shortest path. */
  prefer: 'deepest' | 'shallowest';
}

const HOP_POLICY: Record<NetworkMode, HopPolicy> = {
  DIRECT: { min: 1, max: 1, prefer: 'shallowest' },
  RELAY_1: { min: 2, max: 2, prefer: 'shallowest' },
  MESH_2: { min: 2, max: 3, prefer: 'deepest' },
  STORE_FORWARD: { min: 1, max: Number.MAX_SAFE_INTEGER, prefer: 'shallowest' },
};

/**
 * Depth-limited path search at one exact hop count.
 *
 * A single global `visited` set cannot be used here: the hop *window* makes
 * "already seen" depth-dependent, so a destination reached in one hop must
 * still be reachable in three. The topology is four nodes wide, so an explicit
 * path-local cycle check is both correct and cheap.
 */
function pathAtExactHops(
  topology: NetworkTopology,
  from: string,
  to: string,
  depth: number,
  prefix: string[] = [from],
): string[] | null {
  const current = prefix[prefix.length - 1];
  if (prefix.length - 1 === depth) return current === to ? prefix : null;
  for (const next of neighbours(topology, current)) {
    if (prefix.includes(next)) continue;
    const found = pathAtExactHops(topology, from, to, depth, [...prefix, next]);
    if (found) return found;
  }
  return null;
}

/** Shortest or deepest viable path within the active mode's hop window. */
export function findRoute(topology: NetworkTopology, from: string, to: string, mode: NetworkMode): Route | null {
  const policy = HOP_POLICY[mode];
  const ceiling = Math.min(policy.max, topology.nodes.length - 1);
  const depths: number[] = [];
  for (let depth = policy.min; depth <= ceiling; depth += 1) depths.push(depth);
  if (policy.prefer === 'deepest') depths.reverse();

  for (const depth of depths) {
    const path = pathAtExactHops(topology, from, to, depth);
    if (!path) continue;
    const edges: NetworkEdge[] = path.slice(1).map((node, i) => ({ from: path[i], to: node, online: true }));
    return { nodes: path, edges, hops: edges.length, mode };
  }
  return null;
}

export function setNodeOnline(topology: NetworkTopology, id: string, online: boolean): NetworkTopology {
  return { ...topology, nodes: topology.nodes.map((n) => (n.id === id ? { ...n, online } : n)) };
}

export function setLinkOnline(topology: NetworkTopology, from: string, to: string, online: boolean): NetworkTopology {
  const key = edgeKey(from, to);
  return {
    ...topology,
    edges: topology.edges.map((edge) => (edgeKey(edge.from, edge.to) === key ? { ...edge, online } : edge)),
  };
}

export function offlineLinks(topology: NetworkTopology): string[] {
  return topology.edges.filter((edge) => !edge.online).map((edge) => edgeKey(edge.from, edge.to));
}

export function nodeById(topology: NetworkTopology, id: string): NetworkNode | undefined {
  return topology.nodes.find((n) => n.id === id);
}

export function offlineNodes(topology: NetworkTopology): string[] {
  return topology.nodes.filter((n) => !n.online).map((n) => n.id);
}

/** True when a link touches the given node (either direction). */
export function linkTouchesNode(nodeId: string, link: { from: string; to: string }): boolean {
  return link.from === nodeId || link.to === nodeId;
}

/** Human readable route string, e.g. `DEV-A → R1 → DEV-B`. */
export function routeLabel(topology: NetworkTopology, route: Route): string {
  return route.nodes.map((id) => nodeById(topology, id)?.shortLabel ?? id).join(' → ');
}

export const MODE_LABELS: Record<NetworkMode, string> = {
  DIRECT: 'Direct',
  RELAY_1: '1-Hop Relay',
  MESH_2: '2-Hop Mesh',
  STORE_FORWARD: 'Store & Forward',
};

export const MODE_DESCRIPTIONS: Record<NetworkMode, string> = {
  DIRECT: 'Single link between the two devices. Any degradation drops the packet.',
  RELAY_1: 'Exactly one relay: DEVICE A → RELAY → DEVICE B.',
  MESH_2: 'Mesh range extension. Prefers the two-relay path; falls back to one relay if a hop is lost.',
  STORE_FORWARD: 'Any number of hops, and relays buffer packets while no route exists.',
};

export const HOP_WINDOWS: Record<NetworkMode, string> = {
  DIRECT: 'exactly 1 hop',
  RELAY_1: 'exactly 2 hops',
  MESH_2: '2–3 hops, deepest first',
  STORE_FORWARD: 'any number of hops, shortest first',
};
