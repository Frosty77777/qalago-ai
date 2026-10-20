/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Backend origin for split deployments. Empty = same origin (nginx in production, Vite proxy in dev). */
  readonly VITE_API_BASE_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
