# Contributing

Thanks for helping make a free PDF editor better.

## Set up

```bash
npm install
npm run dev          # web app at http://localhost:5173
npm test             # unit tests for the PDF engine (Vitest, no browser needed)
npm run test:e2e     # browser tests (Playwright; first run: npx playwright install chromium)
npm run typecheck && npx oxlint
```

Desktop shell (needs [Rust](https://rustup.rs) and the [Tauri prerequisites](https://tauri.app/start/prerequisites/)):

```bash
npm run tauri dev
```

## Where things live

- `src/engine/` – everything that touches PDF bytes. Runs in a Web Worker; `core.ts` wraps PDFium's C API.
  - `text.ts` reads text objects and groups them into lines and paragraphs.
  - `edit.ts` rewrites a paragraph (re-flow, font choice, substitution). **Read its tests first.**
  - `annotate.ts`, `pages.ts`, `search.ts`, `forms.ts`, `ocr.ts`, `qpdf.ts`, `extras.ts`, `objects.ts`, `sign.ts`/`verify.ts`, `pdfa.ts`/`icc.ts`, `access.ts` – one feature each.
  - **Wanted:** run `veraPDF` over `pdfa.ts` output and fix what it finds; check `access.ts` output with PAC.
- `src/components/` – React UI. `PageCanvas.tsx` holds all page tool interactions.
- `tests/` – engine tests against generated PDFs. `e2e/` – tests that drive the real UI.
- `src-tauri/` – the small Rust shell (file associations, native dialogs).

## Rules of thumb

- Every engine feature gets a unit test that **saves, reopens and checks the result**, not just that a call returned.
- Never write a half-edited page. If an edit can't be done correctly, fail with a clear message (see `UnsupportedCharactersError`).
- Coordinates crossing the worker boundary are "device points" (top-left origin, rotation applied); see `space.ts`.
- No network requests at runtime, no telemetry. Fonts, OCR data and WASM are all bundled.
- Keep dependencies permissively licensed (MIT/BSD/Apache). No AGPL/GPL.

## Bugs

A PDF that renders or edits wrongly is the most valuable report. Please attach it if it contains nothing private, or say what kind of file it is (scanner, Word export, InDesign…).
