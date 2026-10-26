/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'

// BASE is set by CI for project sites on GitHub Pages (e.g. /acrohat/). Locally and in the desktop app it is '/'.
// Two pages: `/` is the website, `/app/` is the editor.
export default defineConfig({
  base: process.env.BASE ?? '/',
  plugins: [react()],
  build: { rollupOptions: { input: { site: resolve(import.meta.dirname, 'index.html'), app: resolve(import.meta.dirname, 'app/index.html') } } },
  worker: { format: 'es' },
  test: { include: ['tests/**/*.test.ts'] },
})
