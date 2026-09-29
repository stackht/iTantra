import { CommunicationPipeline } from '../components/transceiver/CommunicationPipeline.tsx';
import { NetworkView } from '../components/transceiver/NetworkView.tsx';
import { NetworkControls } from '../components/transceiver/NetworkControls.tsx';
import { PacketInspector } from '../components/transceiver/PacketInspector.tsx';
import { QueuePanel } from '../components/transceiver/QueuePanel.tsx';
import { MetricsBar } from '../components/transceiver/MetricsBar.tsx';
import { EventLog } from '../components/transceiver/EventLog.tsx';
import { useStore } from '../store/useStore.ts';

/**
 * Engineering console: everything that happens between the two handsets.
 * Shares the same store, so a message sent on the Live Transceiver is visible
 * here mid-flight when you switch tabs.
 */
export function ConsolePage() {
  const jobs = useStore((s) => s.jobs);
  const activeJobId = useStore((s) => s.activeJobId);
  const focusJobId = useStore((s) => s.focusJobId);
  const setFocusJob = useStore((s) => s.setFocusJob);
  const topology = useStore((s) => s.topology);
  const flight = useStore((s) => s.flight);
  const storedJobs = useStore((s) => s.storedJobs);
  const queue = useStore((s) => s.queue);
  const metrics = useStore((s) => s.metrics);
  const log = useStore((s) => s.log);
  const clearLog = useStore((s) => s.clearLog);

  const jobIds = Object.keys(jobs);
  const job = jobs[focusJobId ?? activeJobId ?? jobIds[jobIds.length - 1] ?? ''] ?? null;

  return (
    <div className="flex flex-col gap-4">
      <CommunicationPipeline job={job} />

      {jobIds.length > 1 ? (
        <div className="panel flex flex-wrap items-center gap-2 p-3">
          <span className="tech-label">Inspect transmission</span>
          {jobIds.map((id) => (
            <button
              key={id}
              type="button"
              className={`btn !px-2 !py-1 !text-[11px] ${job?.id === id ? '!border-cyan/55 !bg-cyan/10' : ''}`}
              onClick={() => setFocusJob(id === job?.id ? null : id)}
              aria-pressed={job?.id === id}
            >
              {id} · {jobs[id].status}
            </button>
          ))}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[1.25fr_1fr]">
        <div className="panel p-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="tech-label">Relay mesh</h2>
            <span className="tech-value text-[11px] text-muted">{job?.routeLabel ?? 'no route selected yet'}</span>
          </div>
          <NetworkView topology={topology} flight={flight} storedJobs={storedJobs} />
          <div className="mt-4">
            <NetworkControls />
          </div>
        </div>
        <div className="flex flex-col gap-4">
          <PacketInspector job={job} />
          <QueuePanel queue={queue} />
        </div>
      </div>

      <MetricsBar metrics={metrics} />

      <EventLog log={log} onClear={clearLog} className="h-64" />
    </div>
  );
}
