import { Plug, PlugZap, Power, Radio, RadioTower, RefreshCw } from 'lucide-react';
import {
  DEVICE_A,
  DEVICE_B,
  HOP_WINDOWS,
  MODE_DESCRIPTIONS,
  MODE_LABELS,
  RELAY_1,
  RELAY_2,
  edgeKey,
  type NetworkMode,
} from '@itantra/shared';
import { cx } from '../../lib/format.ts';
import { useStore } from '../../store/useStore.ts';
import { Toggle } from '../primitives.tsx';

const MODES: NetworkMode[] = ['DIRECT', 'RELAY_1', 'MESH_2', 'STORE_FORWARD'];

/** Mode selector plus link/node fault injection, all wired to the real router. */
export function NetworkControls({ className }: { className?: string }) {
  const mode = useStore((s) => s.mode);
  const topology = useStore((s) => s.topology);
  const setMode = useStore((s) => s.setMode);
  const setNodeOnline = useStore((s) => s.setNodeOnline);
  const setLinkOnline = useStore((s) => s.setLinkOnline);
  const storedJobs = useStore((s) => s.storedJobs);

  const relayOne = topology.nodes.find((n) => n.id === 'RELAY-01');
  const relayTwo = topology.nodes.find((n) => n.id === 'RELAY-02');
  const directLink = topology.edges.find((e) => edgeKey(e.from, e.to) === edgeKey(DEVICE_A, DEVICE_B));
  const relaysUp = topology.nodes.filter((n) => n.kind === 'RELAY' && n.online).length;
  const linksDown = topology.edges.filter((e) => !e.online).length;
  const isolated = relayOne?.online === false && directLink?.online === false;

  /**
   * One-click store-and-forward scenario: Device A loses both its relay uplink and
   * the direct link, so nothing can reach Device B until connectivity is restored.
   */
  const isolateDeviceA = () => {
    setMode('STORE_FORWARD');
    if (relayOne?.online) setNodeOnline(RELAY_1, false);
    if (directLink?.online) setLinkOnline(DEVICE_A, DEVICE_B, false);
  };

  const restoreAll = () => {
    for (const node of topology.nodes) if (!node.online) setNodeOnline(node.id, true);
    if (directLink && !directLink.online) setLinkOnline(DEVICE_A, DEVICE_B, true);
  };
  const devicesDown = topology.nodes.filter((n) => n.kind === 'DEVICE' && !n.online).length;

  return (
    <div className={cx('panel p-4', className)}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="tech-label">Network controls</h2>
        <span className="tech-value text-[11px] text-muted">{relaysUp}/2 relays up</span>
      </div>

      <fieldset className="mb-3">
        <legend className="tech-label mb-1.5">
          Topology mode · <span className="text-cyan/80">{HOP_WINDOWS[mode]}</span>
        </legend>
        <div className="grid grid-cols-2 gap-1.5">
          {MODES.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setMode(option)}
              aria-pressed={mode === option}
              title={MODE_DESCRIPTIONS[option]}
              className={cx(
                'rounded-lg border px-2.5 py-2 text-left transition-colors',
                mode === option ? 'border-cyan/55 bg-cyan/10' : 'border-edge/70 hover:border-cyan/30',
              )}
            >
              <span className={cx('block text-[12.5px]', mode === option ? 'text-cyan' : 'text-ink')}>{MODE_LABELS[option]}</span>
              <span className="mt-0.5 block text-[10.5px] leading-tight text-muted">{MODE_DESCRIPTIONS[option]}</span>
            </button>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-col gap-1.5">
        <span className="tech-label mb-0.5">Fault injection</span>
        <Toggle
          tone="alarm"
          checked={relayOne ? !relayOne.online : false}
          onChange={(failing) => setNodeOnline(RELAY_1, !failing)}
          label="Simulate Relay 01 failure"
          description="RELAY 01 is Device A's only way into the mesh, so this strands packets — route recalculation then fails, or waits in Store & Forward mode."
        />
        <Toggle
          tone="alarm"
          checked={relayTwo ? !relayTwo.online : false}
          onChange={(failing) => setNodeOnline(RELAY_2, !failing)}
          label="Simulate Relay 02 failure"
          description="Drops the 2-hop path; the router falls back to the single-relay alternate route."
        />
        <Toggle
          tone="alarm"
          checked={directLink ? !directLink.online : false}
          onChange={(failing) => setLinkOnline(DEVICE_A, DEVICE_B, !failing)}
          label="Simulate direct link loss"
          description="Removes the DEVICE A ↔ DEVICE B link so only relay paths remain."
        />
      </div>

      <div className="mt-3 flex flex-col gap-1.5">
        <span className="tech-label mb-0.5">Scenarios</span>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            className="btn !text-[12px]"
            onClick={isolateDeviceA}
            disabled={isolated && mode === 'STORE_FORWARD'}
            title="Store & Forward mode, RELAY 01 offline, direct link down — the next message waits until connectivity returns."
          >
            <RadioTower size={13} />
            Cut Device A off (store &amp; forward)
          </button>
          <button
            type="button"
            className="btn !text-[12px]"
            onClick={restoreAll}
            disabled={relaysUp === 2 && linksDown === 0 && devicesDown === 0}
            title="Bring every relay and link back online; stored packets are released immediately."
          >
            <RefreshCw size={13} />
            Restore connectivity
          </button>
        </div>
        <p className="text-[10.5px] leading-tight text-muted">
          Send a message while Device A is cut off, then restore connectivity and watch the stored packet flush.
        </p>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="flex items-center gap-1.5">
          {relaysUp < 2 ? <Plug size={11} className="text-alarm" /> : <PlugZap size={11} className="text-mint" />}
          <span className="tech-label">Relays online</span>
          <span className="tech-value text-[11px]">{relaysUp}/2</span>
        </span>
        <span className="flex items-center gap-1.5">
          <Power size={11} className={linksDown > 0 ? 'text-alarm' : 'text-muted'} />
          <span className="tech-label">Links down</span>
          <span className="tech-value text-[11px]">{linksDown}</span>
        </span>
        <span className="flex items-center gap-1.5">
          <Radio size={11} className={storedJobs.length > 0 ? 'text-amber' : 'text-muted'} />
          <span className="tech-label">Stored packets</span>
          <span className="tech-value text-[11px]">{storedJobs.length}</span>
        </span>
      </div>
    </div>
  );
}
