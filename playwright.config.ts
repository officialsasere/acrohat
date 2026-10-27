import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.spec.ts',
  timeout: 60_000,
  use: { baseURL: 'http://localhost:4173', viewport: { width: 1280, height: 800 } },
  webServer: { command: 'npm run build && npx vite preview --port 4173', url: 'http://localhost:4173/paper/app/', reuseExistingServer: true, timeout: 120_000 },
})
