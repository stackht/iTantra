import { PRIORITY_RANK, type Priority } from './types.ts';

export interface QueueItem<T> {
  id: string;
  priority: Priority;
  /** Monotonic sequence number; FIFO tie-break inside a priority band. */
  seq: number;
  payload: T;
}

/**
 * Strict priority queue with FIFO ordering inside each band.
 *
 * SOS (rank 0) therefore preempts HIGH (1) which preempts NORMAL (2) — the
 * behaviour the Emergency section of the demo depends on.
 */
export class PriorityQueue<T> {
  private items: QueueItem<T>[] = [];
  private seq = 0;

  get size(): number {
    return this.items.length;
  }

  get isEmpty(): boolean {
    return this.items.length === 0;
  }

  enqueue(id: string, priority: Priority, payload: T): QueueItem<T> {
    const item: QueueItem<T> = { id, priority, seq: this.seq++, payload };
    this.items.push(item);
    this.sort();
    return item;
  }

  /** Removes and returns the highest priority item, or null when empty. */
  dequeue(): QueueItem<T> | null {
    return this.items.shift() ?? null;
  }

  peek(): QueueItem<T> | null {
    return this.items[0] ?? null;
  }

  remove(id: string): boolean {
    const index = this.items.findIndex((i) => i.id === id);
    if (index === -1) return false;
    this.items.splice(index, 1);
    return true;
  }

  contains(id: string): boolean {
    return this.items.some((i) => i.id === id);
  }

  /** Read-only ordered snapshot for the UI. */
  list(): QueueItem<T>[] {
    return this.items.map((i) => ({ ...i }));
  }

  countByPriority(): Record<Priority, number> {
    const counts: Record<Priority, number> = { SOS: 0, HIGH: 0, NORMAL: 0 };
    for (const item of this.items) counts[item.priority] += 1;
    return counts;
  }

  clear(): void {
    this.items = [];
  }

  private sort(): void {
    this.items.sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.seq - b.seq);
  }
}

/** Highest-priority first comparator, exported for sorting display rows. */
export function byPriority(a: Priority, b: Priority): number {
  return PRIORITY_RANK[a] - PRIORITY_RANK[b];
}
