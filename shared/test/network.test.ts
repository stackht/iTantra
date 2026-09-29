import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_TIMING,
  DEVICE_A,
  DEVICE_B,
  MockTranslationEngine,
  RELAY_1,
  RELAY_2,
  SimulationEngine,
  TranslationService,
  createTopology,
  edgeKey,
  findRoute,
  offlineLinks,
  offlineNodes,
  routeLabel,
  setLinkOnline,
  setNodeOnline,
  type EngineEvent,
  type NetworkMode,
  type SimulationEngine as Engine,
} from '../src/index.ts';

const FAST = {
  ...DEFAULT_TIMING,
  stt: 8,
  detect: 4,
  translate: 4,
  packet: 4,
  queue: 4,
  route: 4,
  hop: 8,
  deliver: 4,
  rxTranslate: 4,
  tts: 4,
  storeRetry: 30,
};

function makeEngine(mode: NetworkMode = 'MESH_2') {
  return new SimulationEngine(mode, new TranslationService({ engine: new MockTranslationEngine(0) }), FAST);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The engine reads the wall clock, so tests advance real time rather than
 * faking it — the pipeline still completes in well under a second at FAST speed.
 */
async function drive(engine: Engine, onTick?: (events: EngineEvent[]) => void, maxMs = 6000): Promise<EngineEvent[]> {
  const events: EngineEvent[] = [];
  const startedAt = Date.now();
  while (Date.now() - startedAt < maxMs) {
    const produced = await engine.tick(Date.now());
    if (produced.length > 0) {
      events.push(...produced);
      onTick?.(produced);
    }
    await sleep(2);
  }
  return events;
}

async function driveUntilTerminal(engine: Engine, onTick?: (events: EngineEvent[]) => void): Promise<EngineEvent[]> {
  const events: EngineEvent[] = [];
  const startedAt = Date.now();
  while (Date.now() - startedAt < 6000) {
    const produced = await engine.tick(Date.now());
    if (produced.length > 0) {
      events.push(...produced);
      onTick?.(produced);
      if (produced.some((e) => e.type === 'job:completed' || e.type === 'job:failed')) return events;
    }
    await sleep(2);
  }
  return events;
}

describe('routing', () => {
  const topology = createTopology();

  it('routes direct A → B in DIRECT mode', () => {
    const route = findRoute(topology, DEVICE_A, DEVICE_B, 'DIRECT');
    assert.ok(route);
    assert.deepEqual(route.nodes, [DEVICE_A, DEVICE_B]);
    assert.equal(route.hops, 1);
  });

  it('routes A → Relay 01 → B in 1-hop mode', () => {
    const route = findRoute(topology, DEVICE_A, DEVICE_B, 'RELAY_1');
    assert.ok(route);
    assert.equal(route.hops, 2);
    assert.deepEqual(route.nodes, [DEVICE_A, RELAY_1, DEVICE_B]);
  });
  it('routes A → R1 → R2 → B in mesh mode', () => {
    const route = findRoute(topology, DEVICE_A, DEVICE_B, 'MESH_2');
    assert.ok(route);
    assert.deepEqual(route.nodes, [DEVICE_A, RELAY_1, RELAY_2, DEVICE_B]);
    assert.equal(route.hops, 3);
    assert.equal(routeLabel(topology, route), 'DEV-A → R1 → R2 → DEV-B');
  });

  it('never picks the direct link for a relay mode', () => {
    for (const mode of ['RELAY_1', 'MESH_2'] as const) {
      const route = findRoute(topology, DEVICE_A, DEVICE_B, mode);
      assert.ok(route);
      assert.ok(route.nodes.includes(RELAY_1));
    }
  });

  it('excludes offline relays from the search and strands Device A without RELAY 01', () => {
    const degraded = setNodeOnline(topology, RELAY_1, false);
    assert.deepEqual(offlineNodes(degraded), [RELAY_1]);
    assert.equal(findRoute(degraded, DEVICE_A, DEVICE_B, 'MESH_2'), null);
    assert.equal(findRoute(degraded, DEVICE_A, DEVICE_B, 'RELAY_1'), null);
  });

  it('falls back to a single relay when RELAY 02 dies', () => {
    const degraded = setNodeOnline(topology, RELAY_2, false);
    const route = findRoute(degraded, DEVICE_A, DEVICE_B, 'MESH_2');
    assert.ok(route);
    assert.deepEqual(route.nodes, [DEVICE_A, RELAY_1, DEVICE_B]);
    assert.equal(route.hops, 2);
  });

  it('still has the direct device link available in store-and-forward mode', () => {
    const degraded = setNodeOnline(topology, RELAY_2, false);
    const direct = findRoute(degraded, DEVICE_A, DEVICE_B, 'STORE_FORWARD');
    assert.ok(direct);
    assert.deepEqual(direct.nodes, [DEVICE_A, DEVICE_B]);
  });

  it('honours link-level faults, not just node faults', () => {
    const degraded = setLinkOnline(topology, DEVICE_A, DEVICE_B, false);
    assert.deepEqual(offlineLinks(degraded), [edgeKey(DEVICE_A, DEVICE_B)]);
    assert.equal(findRoute(degraded, DEVICE_A, DEVICE_B, 'DIRECT'), null);
    assert.ok(findRoute(degraded, DEVICE_A, DEVICE_B, 'MESH_2'));
  });

  it('finds no route when the destination is offline', () => {
    assert.equal(findRoute(setNodeOnline(topology, DEVICE_B, false), DEVICE_A, DEVICE_B, 'STORE_FORWARD'), null);
  });
});

describe('end-to-end pipeline', () => {
  it('delivers a spoken Hindi message to Device B in Marathi', async () => {
    const engine = makeEngine();
    const jobId = engine.submit({
      from: DEVICE_A,
      to: DEVICE_B,
      sourceLanguage: 'hi',
      targetLanguage: 'mr',
      text: 'मुझे मदद चाहिए',
      inputMode: 'voice',
    });
    const events = await driveUntilTerminal(engine);

    const stages = events.filter((e) => e.type === 'stage').map((e) => `${e.stage}:${e.side}:${e.status}`);
    for (const expected of [
      'INPUT:source:done',
      'STT:source:done',
      'LANGUAGE_DETECT:source:done',
      'TRANSLATION:source:done',
      'PACKET:source:done',
      'QUEUE:relay:done',
      'ROUTE:relay:done',
      'TRANSMIT:relay:done',
      'DELIVER:relay:done',
      'TRANSLATION:receiver:done',
      'TTS:receiver:done',
      'DONE:receiver:done',
    ]) {
      assert.ok(stages.includes(expected), `missing stage ${expected}`);
    }

    const created = events.find((e) => e.type === 'packet:created');
    assert.ok(created && created.type === 'packet:created');
    assert.equal(created.packet.pivotText, 'I need help.');
    assert.ok(created.packet.payloadBytes > 0);
    assert.match(created.packet.authTag, /^[0-9a-f]{64}$/);

    const rendered = events.find((e) => e.type === 'packet:rendered');
    assert.ok(rendered && rendered.type === 'packet:rendered');
    assert.equal(rendered.text, 'मला मदत हवी आहे');
    assert.equal(rendered.language, 'mr');

    const delivered = events.find((e) => e.type === 'packet:delivered');
    assert.ok(delivered && delivered.type === 'packet:delivered');
    assert.equal(delivered.via, 'RELAY 01 → RELAY 02');
    assert.ok(delivered.latencyMs >= 0, 'latency must be a real measured value');

    assert.ok(events.some((e) => e.type === 'job:completed' && e.jobId === jobId));
  });

  it('skips STT for typed input but uses it for speech input', async () => {
    const typed = makeEngine();
    typed.submit({ from: DEVICE_A, to: DEVICE_B, sourceLanguage: 'hi', targetLanguage: 'mr', text: 'मुझे पानी चाहिए', inputMode: 'text' });
    const typedStages = (await driveUntilTerminal(typed))
      .filter((e) => e.type === 'stage')
      .map((e) => `${e.stage}:${e.status}`);
    assert.ok(typedStages.includes('STT:skipped'));

    const voiced = makeEngine();
    voiced.submit({ from: DEVICE_A, to: DEVICE_B, sourceLanguage: 'hi', targetLanguage: 'mr', text: 'मुझे पानी चाहिए', inputMode: 'voice' });
    const voiceStages = (await driveUntilTerminal(voiced))
      .filter((e) => e.type === 'stage')
      .map((e) => `${e.stage}:${e.status}`);
    assert.ok(voiceStages.includes('STT:done'));
  });

  it('runs the reverse direction Marathi → Hindi', async () => {
    const engine = makeEngine();
    engine.submit({
      from: DEVICE_B,
      to: DEVICE_A,
      sourceLanguage: 'mr',
      targetLanguage: 'hi',
      text: 'मी मदतीसाठी येत आहे.',
      inputMode: 'text',
    });
    const rendered = (await driveUntilTerminal(engine)).find((e) => e.type === 'packet:rendered');
    assert.ok(rendered && rendered.type === 'packet:rendered');
    assert.equal(rendered.text, 'मैं आपकी मदद के लिए आ रहा हूँ');
  });
});

describe('relay failure', () => {
  it('recalculates onto the single-relay route when RELAY 02 dies mid-transmission', async () => {
    const engine = makeEngine();
    engine.submit({ from: DEVICE_A, to: DEVICE_B, sourceLanguage: 'hi', targetLanguage: 'mr', text: 'मुझे मदद चाहिए' });

    let dropped = false;
    const events = await driveUntilTerminal(engine, (batch) => {
      if (dropped) return;
      if (batch.some((e) => e.type === 'stage' && e.stage === 'TRANSMIT' && e.status === 'active')) {
        dropped = true;
        engine.setNodeOnline(RELAY_2, false);
      }
    });

    assert.equal(dropped, true, 'test never reached the TRANSMIT stage');
    assert.ok(events.some((e) => e.type === 'route:recalculating'), 'expected a recalculation event');
    const finalRoute = events.filter((e) => e.type === 'route:selected').at(-1);
    assert.ok(finalRoute && finalRoute.type === 'route:selected');
    assert.deepEqual(finalRoute.route.nodes, [DEVICE_A, RELAY_1, DEVICE_B]);
    assert.ok(events.some((e) => e.type === 'job:completed'), 'the alternate route must deliver');
  });

  it('fails the packet when RELAY 01 strands it outside store-and-forward', async () => {
    const engine = makeEngine();
    engine.setNodeOnline(RELAY_1, false);
    engine.submit({ from: DEVICE_A, to: DEVICE_B, sourceLanguage: 'hi', targetLanguage: 'mr', text: 'मुझे मदद चाहिए' });
    const events = await driveUntilTerminal(engine);
    const failure = events.find((e) => e.type === 'job:failed');
    assert.ok(failure, 'expected the packet to fail');
    assert.match(String((failure as { reason?: string }).reason), /No route/);
  });

  it('invalidates an in-flight route when a used node goes offline', async () => {
    const engine = makeEngine();
    engine.submit({ from: DEVICE_A, to: DEVICE_B, sourceLanguage: 'hi', targetLanguage: 'mr', text: 'मुझे मदद चाहिए' });

    let dropped = false;
    const events = await driveUntilTerminal(engine, (batch) => {
      if (dropped) return;
      if (batch.some((e) => e.type === 'stage' && e.stage === 'TRANSMIT' && e.status === 'active')) {
        dropped = true;
        engine.setNodeOnline(RELAY_1, false);
        engine.setNodeOnline(RELAY_2, false);
      }
    });
    assert.equal(dropped, true, 'test never reached the TRANSMIT stage');
    assert.ok(events.some((e) => e.type === 'route:recalculating'));
    assert.ok(events.some((e) => e.type === 'job:failed'));
  });
});

describe('store and forward', () => {
  it('stores the packet while disconnected and releases it on reconnect', async () => {
    const engine = makeEngine('STORE_FORWARD');
    engine.setNodeOnline(RELAY_1, false);
    engine.setNodeOnline(RELAY_2, false);
    engine.setLinkOnline(DEVICE_A, DEVICE_B, false);
    engine.submit({ from: DEVICE_A, to: DEVICE_B, sourceLanguage: 'hi', targetLanguage: 'mr', text: 'मुझे मदद चाहिए' });

    const first = await drive(engine, undefined, 400);
    const stored = first.find((e) => e.type === 'packet:stored');
    assert.ok(stored && stored.type === 'packet:stored', 'expected a store event');
    assert.ok(!first.some((e) => e.type === 'job:completed'), 'nothing should complete while disconnected');
    assert.equal(stored.nodeId.length > 0, true);

    engine.setNodeOnline(RELAY_1, true);
    const second = await driveUntilTerminal(engine);
    assert.ok(second.some((e) => e.type === 'packet:released'), 'expected a release event');
    assert.ok(second.some((e) => e.type === 'job:completed'), 'expected delivery after reconnect');
  });
});

describe('priority preemption', () => {
  it('transmits an SOS submitted after two normal messages first', async () => {
    const engine = makeEngine();
    engine.submit({ from: DEVICE_A, to: DEVICE_B, sourceLanguage: 'hi', targetLanguage: 'mr', text: 'मुझे पानी चाहिए' });
    engine.submit({ from: DEVICE_A, to: DEVICE_B, sourceLanguage: 'hi', targetLanguage: 'mr', text: 'आप कहाँ हैं?' });
    engine.submit({
      from: DEVICE_A,
      to: DEVICE_B,
      sourceLanguage: 'hi',
      targetLanguage: 'mr',
      text: 'मुझे तुरंत सहायता चाहिए',
      priority: 'SOS',
    });

    const events: EngineEvent[] = [];
    const startedAt = Date.now();
    while (Date.now() - startedAt < 8000) {
      const produced = await engine.tick(Date.now());
      events.push(...produced);
      if (events.filter((e) => e.type === 'job:completed').length === 3) break;
      await sleep(2);
    }

    const delivered = events.filter((e) => e.type === 'packet:delivered');
    assert.equal(delivered.length, 3);
    assert.equal(delivered[0].jobId, 'JOB-0003', 'SOS must leave the queue before queued normal traffic');
  });
});

describe('event stream hygiene', () => {
  it('emits hop progress for all three mesh legs', async () => {
    const engine = makeEngine();
    engine.submit({ from: DEVICE_A, to: DEVICE_B, sourceLanguage: 'hi', targetLanguage: 'mr', text: 'मुझे मदद चाहिए' });
    const events = await driveUntilTerminal(engine);
    const legs = new Set(
      events.filter((e) => e.type === 'hop:progress').map((e) => `${e.from}->${e.to}`),
    );
    assert.deepEqual(
      [...legs].sort(),
      [`${DEVICE_A}->${RELAY_1}`, `${RELAY_1}->${RELAY_2}`, `${RELAY_2}->${DEVICE_B}`].sort(),
    );
  });

  it('logs queue and route decisions', async () => {
    const engine = makeEngine();
    engine.submit({ from: DEVICE_A, to: DEVICE_B, sourceLanguage: 'hi', targetLanguage: 'mr', text: 'मुझे मदद चाहिए' });
    const logs = (await driveUntilTerminal(engine)).filter((e) => e.type === 'log');
    assert.ok(logs.length >= 2, `expected engine log entries, got ${logs.length}`);
    assert.ok(logs.some((e) => e.type === 'log' && e.entry.channel === 'QUEUE'));
    assert.ok(logs.some((e) => e.type === 'log' && e.entry.channel === 'ROUTE'));
  });

  it('tracks job state in the snapshot', async () => {
    const engine = makeEngine();
    const jobId = engine.submit({ from: DEVICE_A, to: DEVICE_B, sourceLanguage: 'hi', targetLanguage: 'mr', text: 'मुझे मदद चाहिए' });
    await driveUntilTerminal(engine);
    const snapshot = engine.snapshot();
    const job = snapshot.jobs.find((j) => j.id === jobId);
    assert.ok(job);
    assert.equal(job.status, 'delivered');
    assert.equal(snapshot.activeJobId, null);
  });
});
