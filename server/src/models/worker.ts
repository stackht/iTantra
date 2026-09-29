import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { ANDROID_DIR, LOCAL_MODELS, MT_PACK_DIR } from './paths.ts';

/**
 * Persistent Python worker running the ITANTRA product models:
 *   - Whisper STT (byte-correct decode of the product's ONNX graphs)
 *   - Opus-MT translation packs
 * Same stack as the product's reference tooling (onnxruntime, sentencepiece).
 */

const here = dirname(fileURLToPath(import.meta.url));
const WORKER = join(here, 'itantra_worker.py');
const PYTHON = process.env.ITANTRA_PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');

export interface WorkerStatus {
  runtime: boolean;
  error: string | null;
  root: string;
  pairs: Record<string, { installed: boolean; loaded: boolean }>;
}

interface Pending {
  resolve: (value: Record<string, unknown>) => void;
  timer: NodeJS.Timeout;
}

let child: ChildProcessWithoutNullStreams | null = null;
let ready: Promise<WorkerStatus | null> | null = null;
let seq = 0;
const pending = new Map<number, Pending>();
let lastStatus: WorkerStatus | null = null;

function start(): Promise<WorkerStatus | null> {
  if (ready) return ready;
  ready = new Promise((resolve) => {
    try {
      child = spawn(PYTHON, ['-u', WORKER], {
        env: {
          ...process.env,
          ITANTRA_MT_DIR: MT_PACK_DIR,
          ITANTRA_STT_SMALL_DIR: join(LOCAL_MODELS, 'stt', 'whisper-small'),
          ITANTRA_STT_BASE_DIR: join(ANDROID_DIR, 'app', 'src', 'main', 'assets', 'models', 'stt'),
          ITANTRA_SPELL_DIR: join(ANDROID_DIR, 'app', 'src', 'main', 'assets', 'spellcheck'),
          PYTHONIOENCODING: 'utf-8',
          TRANSFORMERS_VERBOSITY: 'error',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (error) {
      console.error('[models] could not start the Python worker:', error);
      resolve(null);
      return;
    }
    const lines = createInterface({ input: child.stdout });
    let first = true;
    lines.on('line', (line) => {
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(line) as Record<string, unknown>;
      } catch {
        return;
      }
      if (first) {
        first = false;
        lastStatus = message as unknown as WorkerStatus;
        resolve(lastStatus);
        return;
      }
      const id = Number(message.id);
      const entry = pending.get(id);
      if (!entry) return;
      clearTimeout(entry.timer);
      pending.delete(id);
      entry.resolve(message);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text && !/FutureWarning|UserWarning|warnings\.warn/.test(text)) console.error('[models]', text.slice(0, 400));
    });
    const fail = () => {
      child = null;
      ready = null;
      for (const [, entry] of pending) {
        clearTimeout(entry.timer);
        entry.resolve({ ok: false, error: 'Model worker exited' });
      }
      pending.clear();
      if (first) resolve(null);
    };
    child.on('exit', fail);
    child.on('error', fail);
  });
  return ready;
}

export function callWorker(payload: Record<string, unknown>, timeoutMs: number): Promise<Record<string, unknown>> {
  return start().then((status) => {
    if (!status || !child) return { ok: false, error: `Python worker unavailable (${PYTHON} with onnxruntime, sentencepiece, transformers)` };
    const id = ++seq;
    return new Promise<Record<string, unknown>>((resolve) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        resolve({ ok: false, error: 'Model worker timed out' });
      }, timeoutMs);
      pending.set(id, { resolve, timer });
      child!.stdin.write(`${JSON.stringify({ id, ...payload })}\n`);
    });
  });
}

export async function workerStatus(): Promise<WorkerStatus | null> {
  const reply = await callWorker({ op: 'status' }, 5000);
  if (reply.ok) lastStatus = reply as unknown as WorkerStatus;
  return lastStatus;
}

/** Start the worker and pre-load Whisper so the first press-to-talk is not slow. */
export function warmWorker(): void {
  void start().then(async (status) => {
    if (!status) {
      console.log('[models] Python worker failed to start — STT and product MT unavailable');
      return;
    }
    const pairs = Object.entries(status.pairs ?? {})
      .map(([pair, s]) => `${pair}${s.installed ? '' : '(missing)'}`)
      .join(', ');
    console.log(`[models] worker ready · ${status.runtime ? 'onnxruntime+sentencepiece ok' : `runtime error: ${status.error}`} · Opus-MT packs: ${pairs}`);
    const warm = await callWorker({ op: 'warm_stt' }, 180_000);
    console.log(`[models] Whisper ${warm.ok ? `${String(warm.model)} warmed in ${String(warm.ms)} ms` : `unavailable: ${String(warm.error ?? '')}`}`);
  });
}
