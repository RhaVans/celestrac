import { defineConfig } from 'vite'

const here = decodeURIComponent(new URL('.', import.meta.url).pathname)

export default defineConfig({
  server: { port: 5173, strictPort: false },
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
    rollupOptions: {
      input: {
        main: `${here}index.html`,
        privacy: `${here}privacy.html`,
        terms: `${here}terms.html`,
        notFound: `${here}404.html`,
      },
      output: {
        manualChunks: (id: string) => (id.includes('node_modules/three') ? 'three' : undefined),
      },
    },
  },
})
