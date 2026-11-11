/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BRIEFING_ENDPOINT?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
