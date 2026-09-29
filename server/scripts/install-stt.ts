import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import { LOCAL_MODELS } from '../src/models/paths.ts';

/**
 * npm run stt:install
 *
 * Installs the ITANTRA catalog's optional STT upgrade (ModelCatalog.sttEnginePacks):
 * Whisper small multilingual INT8 from the sherpa-onnx asr-models release, verified
 * against the SHA-256 the Android catalog pins. Without it the hub uses the
 * Whisper-base int8 bundled in the APK assets, which is weak on Hindi/Marathi.
 */
const URL = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-small.tar.bz2';
const SHA256 = '486a46afbb7ba798507190ffe02fea2dd726049af212e774537efac6afb210a6';
const SIZE = 639_387_718;

const dir = join(LOCAL_MODELS, 'stt');
const target = join(dir, 'whisper-small');
const archive = join(dir, 'sherpa-onnx-whisper-small.tar.bz2');

if (existsSync(join(target, 'small-encoder.int8.onnx'))) {
  console.log(`Whisper-small already installed at ${target}`);
  process.exit(0);
}

mkdirSync(target, { recursive: true });
console.log(`Downloading ${URL} (${(SIZE / 1e6).toFixed(0)} MB)…`);
const response = await fetch(URL, { redirect: 'follow' });
if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
let received = 0;
let lastPct = -1;
const counter = new TransformStream<Uint8Array, Uint8Array>({
  transform(chunk, controller) {
    received += chunk.byteLength;
    const pct = Math.floor((received / SIZE) * 100);
    if (pct !== lastPct && pct % 10 === 0) {
      lastPct = pct;
      process.stdout.write(`  ${pct}%\n`);
    }
    controller.enqueue(chunk);
  },
});
await pipeline(Readable.fromWeb(response.body.pipeThrough(counter) as import('node:stream/web').ReadableStream), createWriteStream(archive));

const hash = createHash('sha256');
await pipeline(createReadStream(archive), hash);
const digest = hash.digest('hex');
if (digest !== SHA256) {
  rmSync(archive, { force: true });
  throw new Error(`Checksum mismatch: ${digest} (expected ${SHA256})`);
}
console.log('Checksum verified against the ITANTRA catalog.');

const tar = process.platform === 'win32' ? 'C:\\Windows\\System32\\tar.exe' : 'tar';
await promisify(execFile)(tar, ['-xf', archive, '-C', target, '--strip-components=1']);
// Only the int8 graphs are used; drop the fp32 copies and the archive (~1.6 GB).
for (const f of ['small-encoder.onnx', 'small-decoder.onnx']) rmSync(join(target, f), { force: true });
rmSync(archive, { force: true });
console.log(`Installed Whisper-small int8 at ${target}. Restart the hub (npm run dev) to use it.`);
