import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PRIORITY_RANK, PriorityQueue } from '../src/index.ts';

describe('priority queue ordering', () => {
  it('ranks SOS above HIGH above NORMAL', () => {
    assert.ok(PRIORITY_RANK.SOS < PRIORITY_RANK.HIGH);
    assert.ok(PRIORITY_RANK.HIGH < PRIORITY_RANK.NORMAL);
  });

  it('transmits SOS first even when it arrives last', () => {
    const queue = new PriorityQueue<string>();
    queue.enqueue('n1', 'NORMAL', 'a');
    queue.enqueue('n2', 'NORMAL', 'b');
    queue.enqueue('h1', 'HIGH', 'c');
    queue.enqueue('s1', 'SOS', 'd');

    assert.deepEqual(
      queue.list().map((item) => item.id),
      ['s1', 'h1', 'n1', 'n2'],
    );
    assert.equal(queue.dequeue()?.id, 's1');
    assert.equal(queue.dequeue()?.id, 'h1');
  });

  it('keeps FIFO order inside a priority band', () => {
    const queue = new PriorityQueue<string>();
    queue.enqueue('a', 'NORMAL', '1');
    queue.enqueue('b', 'NORMAL', '2');
    queue.enqueue('c', 'NORMAL', '3');
    assert.deepEqual(
      queue.list().map((i) => i.id),
      ['a', 'b', 'c'],
    );
  });

  it('counts by band and removes items', () => {
    const queue = new PriorityQueue<string>();
    queue.enqueue('a', 'SOS', '1');
    queue.enqueue('b', 'HIGH', '2');
    queue.enqueue('c', 'HIGH', '3');
    assert.deepEqual(queue.countByPriority(), { SOS: 1, HIGH: 2, NORMAL: 0 });
    assert.equal(queue.contains('b'), true);
    assert.equal(queue.remove('b'), true);
    assert.equal(queue.contains('b'), false);
    assert.equal(queue.size, 2);
  });

  it('drains completely and reports empty', () => {
    const queue = new PriorityQueue<number>();
    queue.enqueue('x', 'HIGH', 1);
    assert.equal(queue.isEmpty, false);
    assert.equal(queue.dequeue()?.payload, 1);
    assert.equal(queue.dequeue(), null);
    assert.equal(queue.isEmpty, true);
  });
});
