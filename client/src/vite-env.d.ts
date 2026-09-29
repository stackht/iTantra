/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_HUB_URL?: string;
  readonly VITE_WS_URL?: string;
  readonly VITE_DEMO_MODE?: string;
  readonly VITE_TRANSLATION_PROVIDER?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
