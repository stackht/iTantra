import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * npm run share
 *
 * Makes this PC's hub (all ITANTRA models) reachable from the internet for free:
 *   1. builds the web app (served by the hub itself as a fallback),
 *   2. starts the hub on PORT (default 8787),
 *   3. opens a Cloudflare quick tunnel (no account, no card) to it,
 *   4. prints the links to share.
 *
 * The frontend on Cloudflare Pages takes the hub address from `?hub=`, so the Pages URL stays
 * the same even though the tunnel address changes on every run.
 */
const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT ?? 8787);
const PAGES_URL = (process.env.ITANTRA_PAGES_URL ?? 'https://itantra.pages.dev').replace(/\/+$/, '');
const cloudflared =
  process.env.CLOUDFLARED ??
  (existsSync(join(root, 'deploy', 'bin', process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared'))
    ? join(root, 'deploy', 'bin', process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared')
    : 'cloudflared');

const children: ChildProcess[] = [];
function stopAll(code = 0): void {
  for (const child of children) child.kill();
  process.exit(code);
}
process.on('SIGINT', () => stopAll(0));
process.on('SIGTERM', () => stopAll(0));

function run(cmd: string, args: string[], label: string, env: NodeJS.ProcessEnv = {}, useShell = process.platform === 'win32'): ChildProcess {
  // npm/npx are .cmd shims on Windows and need a shell; a real executable must NOT go through one,
  // or a path with spaces ("iTantra Prototype") gets split into separate arguments.
  const child = spawn(cmd, args, { cwd: root, env: { ...process.env, ...env }, shell: useShell });
  children.push(child);
  child.on('exit', (code) => {
    console.log(`[share] ${label} exited (${code ?? 'signal'}) — stopping.`);
    stopAll(code ?? 1);
  });
  return child;
}

async function waitFor(url: string, timeoutMs: number): Promise<boolean> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      if ((await fetch(url)).ok) return true;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

console.log('[share] building the web app…');
await new Promise<void>((done, fail) => {
  const build = spawn('npm', ['run', 'build'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  build.on('exit', (code) => (code === 0 ? done() : fail(new Error(`build failed (${code})`))));
});

console.log(`[share] starting the hub on port ${PORT} (loading Whisper, Opus-MT, voices)…`);
const hub = run('npx', ['tsx', 'server/src/index.ts'], 'hub', { PORT: String(PORT) });
hub.stdout?.on('data', (d: Buffer) => process.stdout.write(d));
hub.stderr?.on('data', (d: Buffer) => process.stderr.write(d));
if (!(await waitFor(`http://127.0.0.1:${PORT}/healthz`, 120_000))) {
  console.error('[share] hub did not start — is port', PORT, 'already in use (npm run dev)?');
  stopAll(1);
}

console.log('[share] opening a Cloudflare quick tunnel…');
const tunnel = run(cloudflared, ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${PORT}`], 'tunnel', {}, false);
let announced = false;
const onTunnelOutput = (d: Buffer) => {
  const match = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(d.toString());
  if (!match || announced) return;
  announced = true;
  const hubUrl = match[0];
  void waitFor(`${hubUrl}/healthz`, 60_000).then((ok) => {
    console.log('\n──────────────────────────────────────────────────────────────');
    console.log(ok ? '  iTantra is live.' : '  Tunnel opened (still propagating — try the links in a few seconds).');
    console.log(`  Share this:  ${PAGES_URL}/?hub=${hubUrl}`);
    console.log(`  Or directly: ${hubUrl}/`);
    console.log('  Keep this window open. Ctrl+C stops sharing.');
    console.log('──────────────────────────────────────────────────────────────\n');
  });
};
tunnel.stdout?.on('data', onTunnelOutput);
tunnel.stderr?.on('data', onTunnelOutput);
