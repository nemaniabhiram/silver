/// <reference types="vite/client" />

/* Vite types env vars as `any` by default, which spreads through anything that
   reads them. Naming the one variable this app has keeps it typed. */
interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
