/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'

// BASE is only needed when serving from a sub-path; locally, on Netlify and in the desktop app it is '/'.
//
// Pages: `/` is the Kwiiva site; each app has a product page (`/paper/`, `/write/`) and its web app (`/paper/app/`, `/write/app/`).
// KWIIVA_APP limits a build to one app. The desktop installers use it so each one ships only its own code (see package.json).
const here = (p: string) => resolve(import.meta.dirname, p)
const PAGES = {
  paper: { paper: here('paper/index.html'), paperApp: here('paper/app/index.html') },
  write: { write: here('write/index.html'), writeApp: here('write/app/index.html') },
}
const app = process.env.KWIIVA_APP as keyof typeof PAGES | undefined
const input = app ? PAGES[app] : { site: here('index.html'), ...PAGES.paper, ...PAGES.write }

export default defineConfig({
  base: process.env.BASE ?? '/',
  plugins: [react()],
  build: { outDir: app ? `dist-${app}` : 'dist', rollupOptions: { input } },
  worker: { format: 'es' },
  test: { include: ['tests/**/*.test.ts'] },
})
