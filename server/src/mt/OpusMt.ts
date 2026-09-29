import { callWorker, warmWorker, workerStatus, type WorkerStatus } from '../models/worker.ts';

/**
 * The product's Opus-MT packs, executed by the shared Python model worker
 * (onnxruntime + sentencepiece, bit-for-bit the product's reference decode).
 */

export type MtStatus = WorkerStatus;

export interface MtResult {
  ok: boolean;
  text?: string;
  pair?: string;
  ms?: number;
  error?: string;
  gated?: boolean;
  backTranslation?: string;
  overlap?: number;
}

export function mtStatus(): Promise<MtStatus | null> {
  return workerStatus();
}

/** One direct hop (e.g. hi→en). Pivoting is the caller's job, exactly as in the product. */
export async function translateDirect(text: string, src: string, tgt: string, allowGated = false): Promise<MtResult> {
  // First use of a pair loads ~140-550 MB of ONNX; allow for it.
  return (await callWorker({ op: 'translate', src, tgt, text, allowGated }, 90_000)) as unknown as MtResult;
}

export function warmMt(): void {
  warmWorker();
}
