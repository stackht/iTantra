import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const shared = fileURLToPath(new URL('../shared/src/index.ts', import.meta.url));
const HUB_PORT = Number(process.env.PORT ?? 8787);

/**
 * `vite` (mode development): http://localhost:5173 — localhost counts as a secure
 * context, so the microphone works on this machine.
 *
 * `vite --mode lan --host`: https with a self-signed certificate on every
 * interface, so phones on the same Wi-Fi can use the microphone too (browsers
 * refuse mic access on plain http for any host other than localhost).
 *
 * The hub's WebSocket is proxied at /ws in both modes, so the page never needs
 * a second origin or port.
 */
export default defineConfig(({ mode }) => {
  const lan = mode === 'lan';
  return {
    plugins: [react(), tailwindcss(), ...(lan ? [basicSsl()] : [])],
    resolve: {
      alias: [{ find: /^@itantra\/shared$/, replacement: shared }],
    },
    optimizeDeps: {
      // Workspace package ships raw TS; let Vite transform it instead of prebundling.
      exclude: ['@itantra/shared'],
    },
    server: {
      port: 5173,
      host: lan ? true : undefined,
      proxy: {
        '/ws': { target: `ws://localhost:${HUB_PORT}`, ws: true, changeOrigin: true },
        '/healthz': { target: `http://localhost:${HUB_PORT}`, changeOrigin: true },
        '/api': { target: `http://localhost:${HUB_PORT}`, changeOrigin: true },
      },
    },
    build: {
      target: 'es2022',
      sourcemap: false,
    },
  };
});
