import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEMO_SCRIPT, DEMO_TOTAL_MS, DemoRunner, phraseById, type DemoAction } from '../src/index.ts';

describe('demo script', () => {
  it('starts with pairing and ends with the closing statement', () => {
    assert.equal(DEMO_SCRIPT[0].id, 'pairing');
    assert.equal(DEMO_SCRIPT.at(-1)?.id, 'finish');
    assert.equal(DEMO_SCRIPT.at(-1)?.title, 'Communication established');
  });

  it('runs between 15 and 25 seconds of narration', () => {
    assert.ok(DEMO_TOTAL_MS >= 15000, `demo too short: ${DEMO_TOTAL_MS}`);
    assert.ok(DEMO_TOTAL_MS <= 25000, `demo too long: ${DEMO_TOTAL_MS}`);
  });

  it('transmits Hindi from A then a Marathi reply from B', () => {
    const submits = DEMO_SCRIPT.flatMap((step) => step.actions).filter((a): a is Extract<DemoAction, { kind: 'submit' }> => a.kind === 'submit');
    assert.equal(submits.length, 2);
    assert.deepEqual(
      { from: submits[0].from, source: submits[0].sourceLanguage, target: submits[0].targetLanguage },
      { from: 'DEV-A', source: 'hi', target: 'mr' },
    );
    assert.deepEqual(
      { from: submits[1].from, source: submits[1].sourceLanguage, target: submits[1].targetLanguage },
      { from: 'DEV-B', source: 'mr', target: 'hi' },
    );
  });

  it('uses sentences that exist in the dataset', () => {
    const help = phraseById('need-help');
    const reply = phraseById('coming-to-help');
    const submits = DEMO_SCRIPT.flatMap((step) => step.actions).filter((a) => a.kind === 'submit');
    assert.equal(submits[0].text, help.hi);
    assert.equal(submits[1].text, reply.mr);
  });

  it('pairs the devices with Hindi and Marathi', () => {
    const languages = DEMO_SCRIPT.flatMap((s) => s.actions).filter((a) => a.kind === 'set-language');
    assert.deepEqual(
      languages.map((a) => (a.kind === 'set-language' ? [a.device, a.language] : null)),
      [
        ['A', 'hi'],
        ['B', 'mr'],
      ],
    );
  });
});

describe('demo runner state transitions', () => {
  it('emits the first step immediately on start', () => {
    const runner = new DemoRunner();
    const actions = runner.start(0);
    assert.equal(runner.index, 0);
    assert.ok(actions.some((a) => a.kind === 'set-language'));
  });

  it('advances steps in order against an injected clock', () => {
    const runner = new DemoRunner();
    runner.start(0);

    const seen: string[] = [];
    let clock = 0;
    for (let i = 0; i < 400; i += 1) {
      clock += 100;
      const result = runner.advance(clock);
      for (const step of result.completed) seen.push(step.id);
      if (result.finished) break;
    }

    assert.equal(runner.finished, true);
    assert.deepEqual(seen, DEMO_SCRIPT.map((s) => s.id));
  });

  it('completes the whole script within the narrated duration', () => {
    const runner = new DemoRunner();
    runner.start(0);
    let clock = 0;
    for (let i = 0; i < 1000; i += 1) {
      clock += 50;
      if (runner.advance(clock).finished) break;
    }
    assert.ok(clock >= DEMO_TOTAL_MS, `runner needed ${clock} ms`);
    assert.ok(clock <= DEMO_TOTAL_MS + 500, `runner overshot: ${clock} ms`);
  });

  it('skipToEnd flushes every remaining action and finishes', () => {
    const runner = new DemoRunner();
    runner.start(0);
    const result = runner.skipToEnd(1000);
    assert.equal(result.finished, true);
    assert.equal(result.index, DEMO_SCRIPT.length);
    const submits = result.actions.filter((a) => a.kind === 'submit');
    assert.equal(submits.length, 2);
  });

  it('does nothing after finishing', () => {
    const runner = new DemoRunner();
    runner.start(0);
    runner.skipToEnd(0);
    const after = runner.advance(99_999);
    assert.deepEqual(after.completed, []);
    assert.deepEqual(after.actions, []);
    assert.equal(after.finished, true);
  });

  it('pauses and resumes without losing the remaining script', () => {
    const runner = new DemoRunner();
    runner.start(0);
    runner.advance(600);
    const indexAtPause = runner.index;
    runner.pause();
    const whilePaused = runner.advance(60_000);
    assert.deepEqual(whilePaused.completed, []);
    runner.resume(60_000);
    const after = runner.advance(60_000);
    assert.ok(after.index >= indexAtPause);
  });

  it('resets to the first step', () => {
    const runner = new DemoRunner();
    runner.start(0);
    runner.skipToEnd(100);
    runner.reset();
    assert.equal(runner.index, 0);
    assert.equal(runner.finished, false);
  });
});
