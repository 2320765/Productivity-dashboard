import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  base: '/',
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      input: {
        app: fileURLToPath(new URL('./index.html', import.meta.url)),
        standalone: fileURLToPath(new URL('./standalone.html', import.meta.url)),
        localRecheck: fileURLToPath(new URL('./local-recheck.html', import.meta.url)),
      },
    },
  },
})
