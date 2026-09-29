import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { isLanguageCode, type LanguageCode } from '@itantra/shared';
import { SimulationHub } from './hub.ts';
import { installVoice, voiceStates } from './tts/installer.ts';
import { neuralRuntimeAvailable, synthesize, unloadVoice, voiceReady } from './tts/NeuralTts.ts';
import { sttStatus, transcribe } from './stt/WhisperStt.ts';
import { mtStatus, translateDirect, warmMt } from './mt/OpusMt.ts';
import { ANDROID_DIR } from './models/paths.ts';

const here = dirname(fileURLToPath(import.meta.url));
const CLIENT_DIST = resolve(here, '../../client/dist');
const PORT = Number(process.env.PORT ?? 8787);
/** Origins allowed to call the API from another domain (comma list, or * for any). */
const CORS_ORIGINS = (process.env.CORS_ORIGINS ?? '*').split(',').map((o) => o.trim()).filter(Boolean);

function applyCors(req: IncomingMessage, res: ServerResponse): void {
  const origin = req.headers.origin;
  if (!origin) return;
  const allowed = CORS_ORIGINS.includes('*') || CORS_ORIGINS.includes(origin);
  if (!allowed) return;
  res.setHeader('access-control-allow-origin', CORS_ORIGINS.includes('*') ? '*' : origin);
  res.setHeader('vary', 'origin');
  res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type');
  // The phones read these to label the neural voice and its synthesis time.
  res.setHeader('access-control-expose-headers', 'x-itantra-voice, x-itantra-synthesis-ms, x-itantra-duration-ms, x-itantra-cached');
  res.setHeader('access-control-max-age', '600');
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
};

function isReadableFile(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isFile();
  } catch {
    return false;
  }
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * Neural voice API (real sherpa-onnx Piper/VITS voices, the runtime the Android
 * product ships):
 *   GET  /api/tts/voices          → per-language install state
 *   POST /api/tts/install {lang}  → install a pack (copy from the Android repo or download)
 *   GET  /api/tts?lang=mr&text=…  → 16-bit WAV
 */
async function readRawBody(req: IncomingMessage, limitBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limitBytes) throw new Error('Audio too long');
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

async function serveApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  // ---- Product models status (STT / MT / TTS) -------------------------------------
  if (url.pathname === '/api/models') {
    const stt = sttStatus();
    json(res, 200, {
      androidDir: ANDROID_DIR,
      stt: { runtime: stt.runtime, model: stt.model ? { id: stt.model.id, label: stt.model.label, source: stt.model.source } : null },
      mt: await mtStatus(),
      tts: { runtime: neuralRuntimeAvailable(), voices: voiceStates() },
    });
    return true;
  }

  // ---- Speech-to-text: 16 kHz mono Float32 PCM in, transcript out -----------------------
  if (url.pathname === '/api/stt' && req.method === 'POST') {
    const lang = url.searchParams.get('lang') ?? '';
    if (!isLanguageCode(lang)) {
      json(res, 400, { error: 'Unknown language' });
      return true;
    }
    let body: Buffer;
    try {
      body = await readRawBody(req, 16000 * 4 * 30); // 30 s cap
    } catch (error) {
      json(res, 413, { error: error instanceof Error ? error.message : 'Too large' });
      return true;
    }
    if (body.length < 16000 * 4 * 0.2) {
      json(res, 422, { error: 'Recording too short — hold PRESS TO TALK while you speak.' });
      return true;
    }
    const samples = new Float32Array(body.buffer.slice(body.byteOffset, body.byteOffset + body.length - (body.length % 4)));
    try {
      json(res, 200, await transcribe(samples, lang as LanguageCode));
    } catch (error) {
      json(res, 503, { error: error instanceof Error ? error.message : 'Transcription failed' });
    }
    return true;
  }

  // ---- Machine translation: one direct hop with the product's Opus-MT packs -----------
  if (url.pathname === '/api/mt' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const src = String(body.src ?? '');
    const tgt = String(body.tgt ?? '');
    const text = String(body.text ?? '').trim();
    if (!isLanguageCode(src) || !isLanguageCode(tgt) || !text) {
      json(res, 400, { ok: false, error: 'src, tgt and text are required' });
      return true;
    }
    json(res, 200, await translateDirect(text, src, tgt, body.allowGated === true));
    return true;
  }

  if (url.pathname === '/api/tts/voices') {
    json(res, 200, { runtime: neuralRuntimeAvailable(), voices: voiceStates() });
    return true;
  }
  if (url.pathname === '/api/tts/install' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const lang = String(body.lang ?? '');
    if (!isLanguageCode(lang)) {
      json(res, 400, { error: 'Unknown language' });
      return true;
    }
    if (voiceReady(lang)) {
      json(res, 200, { status: 'ready' });
      return true;
    }
    unloadVoice(lang);
    installVoice(lang, (line) => console.log(line)).catch(() => undefined);
    json(res, 202, { status: 'installing' });
    return true;
  }
  if (url.pathname === '/api/tts') {
    const lang = url.searchParams.get('lang') ?? '';
    const text = (url.searchParams.get('text') ?? '').trim().slice(0, 500);
    if (!isLanguageCode(lang) || !text) {
      json(res, 400, { error: 'lang and text are required' });
      return true;
    }
    if (!voiceReady(lang as LanguageCode)) {
      json(res, 404, { error: `No installed neural voice for ${lang}` });
      return true;
    }
    try {
      const result = synthesize(lang as LanguageCode, text);
      res.writeHead(200, {
        'content-type': 'audio/wav',
        'content-length': result.wav.length,
        'cache-control': 'no-store',
        'x-itantra-voice': encodeURIComponent(result.voice),
        'x-itantra-synthesis-ms': String(result.synthesisMs),
        'x-itantra-duration-ms': String(result.durationMs),
        'x-itantra-cached': result.cached ? '1' : '0',
      });
      res.end(result.wav);
    } catch (error) {
      json(res, 503, { error: error instanceof Error ? error.message : 'Synthesis failed' });
    }
    return true;
  }
  return false;
}

async function serve(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  applyCors(req, res);
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  if (url.pathname === '/healthz') {
    json(res, 200, { ok: true, service: 'itantra-hub', ws: '/ws', neuralTts: neuralRuntimeAvailable() });
    return;
  }
  if (url.pathname.startsWith('/api/')) {
    if (await serveApi(req, res, url)) return;
    json(res, 404, { error: 'Unknown API route' });
    return;
  }

  if (!isReadableFile(join(CLIENT_DIST, 'index.html'))) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<h1>iTantra hub running</h1><p>Client not built. Run <code>npm run build</code>, or use the Vite dev server.</p>');
    return;
  }

  const indexPath = join(CLIENT_DIST, 'index.html');
  const safe = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  const candidate = join(CLIENT_DIST, safe === '/' ? 'index.html' : safe);

  // Static asset when it exists, otherwise the SPA entry point. `isFile` keeps a
  // directory request from throwing EISDIR and taking the hub down with it.
  const filePath = candidate.startsWith(CLIENT_DIST) && isReadableFile(candidate) ? candidate : indexPath;
  const ext = filePath.slice(filePath.lastIndexOf('.'));
  res.writeHead(200, { 'content-type': MIME[ext] ?? 'application/octet-stream' });
  res.end(await readFile(filePath));
}

const httpServer = createServer((req, res) => {
  // A failed static read must never become an unhandled rejection.
  serve(req, res).catch((error: unknown) => {
    console.error('[itantra] request failed:', error);
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Internal error');
  });
});

const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
new SimulationHub().attach(wss);

httpServer.listen(PORT, () => {
  const ready = Object.values(voiceStates()).filter((v) => v.status === 'ready').map((v) => v.lang);
  const stt = sttStatus();
  console.log(`[itantra] hub listening on http://localhost:${PORT}  (ws: /ws)`);
  console.log(`[itantra] models from ${ANDROID_DIR}`);
  console.log(`[itantra] STT: ${stt.model ? `${stt.model.label} (${stt.model.source})` : 'Whisper NOT FOUND'}`);
  console.log(`[itantra] TTS: ${neuralRuntimeAvailable() ? 'sherpa-onnx ready' : 'unavailable'} · voices installed: ${ready.join(', ') || 'none'} (npm run voices:install <lang>)`);
  warmMt();
});
