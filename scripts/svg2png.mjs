// Renders an SVG to a PNG with Chromium (already installed for the e2e tests). Used once to make the app icon.
import { chromium } from '@playwright/test'
import { readFileSync } from 'node:fs'

const [, , input, output, size = '1024'] = process.argv
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: +size, height: +size } })
await page.setContent(`<body style="margin:0;background:transparent">${readFileSync(input, 'utf8').replace('<svg', `<svg style="width:${size}px;height:${size}px"`)}</body>`)
await page.screenshot({ path: output, omitBackground: true })
await browser.close()
