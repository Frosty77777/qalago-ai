import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The dev server proxies /api to the backend so the UI and API share one origin, exactly like
// production behind nginx. Same-origin keeps the session cookie first-party (SameSite=Lax).
const backend = process.env.QALAGO_BACKEND ?? 'http://127.0.0.1:8000'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173, strictPort: true, proxy: { '/api': { target: backend, changeOrigin: false } } },
  preview: { port: 4173, strictPort: true, proxy: { '/api': { target: backend, changeOrigin: false } } },
})
