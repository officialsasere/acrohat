# Contributing to Kwiiva

Thank you for helping! Kwiiva is a family of free, open-source apps (the first is **Kwiiva Paper**, a PDF editor). You do not need to be an expert, and you do not need to ask permission first. Small fixes, typo corrections, bug reports with a sample file and translations are all welcome.

By taking part you agree to our [Code of Conduct](CODE_OF_CONDUCT.md). Contributions are licensed under the project's [MIT license](LICENSE).

## Your first contribution in 10 minutes

1. **Fork** the repo on GitHub, then clone your fork.
2. Set up (Node 22 or newer; nothing else is needed for the web app):
   ```bash
   npm install
   npm run dev          # opens the site at http://localhost:5173/ and the editor at /paper/app/
   ```
3. Make a change on a branch (`git switch -c fix-my-thing`).
4. Check it: `npm run check` (typecheck + lint + unit tests, about 30 seconds).
5. Open a pull request. The template asks four short questions. A maintainer will review it; CI runs the same checks plus the browser tests.

Not sure where to start? Look for issues labelled **good first issue** or **help wanted**, or see "Ideas" below.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Dev server with hot reload |
| `npm run check` | Typecheck, lint and unit tests (run before every PR) |
| `npm test` | Unit tests for the PDF engine (Vitest, no browser) |
| `npm run test:e2e` | Browser tests that drive the real UI (first time: `npx playwright install chromium`) |
| `npm run build` | Production build of the whole site into `dist/` |
| `npm run build:write` / `build:paper` | Build one app only (what the desktop installers bundle) |
| `cd src-tauri-write && npx tauri dev` | Kwiiva Write desktop app (needs [Rust](https://rustup.rs) and the [Tauri prerequisites](https://tauri.app/start/prerequisites/)); use `src-tauri` for Kwiiva Paper |
| `node scripts/make-logos.mjs` | Regenerates the logos in `public/` |

## Where things live

```
index.html, paper/index.html, write/index.html   The Kwiiva home page and each app's page (plain HTML)
public/site.js                 Download buttons and public counters for every app (the PRODUCTS list)
netlify/functions/             The counter: counts downloads and anonymous launches (Netlify Blobs, free)
shared/usage.ts                The anonymous launch message the apps send
paper/app/ + src/              Kwiiva Paper, the PDF editor (React + TypeScript)
  src/engine/                  Everything that touches PDF bytes; runs in a Web Worker
  src/components/              React UI (PageCanvas.tsx holds the page tool interactions)
write/app/ + write/src/        Kwiiva Write, the document editor (React + Tiptap/ProseMirror)
  editor/                      Extensions, the page layout (pagination.ts), find and replace, fonts
  formats/                     DOCX reader and writer, Markdown, plain text
  components/                  Menus, toolbar, dialogs, start screen
tests/                         Unit tests (PDF engine, DOCX round trips, counters)
e2e/                           Playwright tests: site, both editors, phone layouts
src-tauri/, src-tauri-write/   The small Rust shells for the two desktop apps
.github/workflows/             CI and the release pipeline
```

Inside `write/src/formats/`, `docxWrite.ts` and `docxRead.ts` are written from the file format itself with no third-party library, and `tests/write-docx.test.ts` round-trips every feature; add a case there when you add a feature that gets saved.

Inside `src/engine/` (Kwiiva Paper): `text.ts` reads text and groups it into lines and paragraphs; `edit.ts` rewrites a paragraph (re-flow, font choice) and is the trickiest file, so read its tests first; `annotate.ts`, `pages.ts`, `search.ts`, `forms.ts`, `ocr.ts`, `qpdf.ts`, `sign.ts`/`verify.ts`, `pdfa.ts`, `access.ts` and the rest each own one feature.

## Rules of thumb

- **Test what the user gets.** An engine feature needs a unit test that saves, reopens and checks the file, not only that a call returned.
- **Never write a half-edited page.** If an edit cannot be done correctly, fail with a clear message (see `UnsupportedCharactersError`).
- **Privacy is a feature.** Documents never leave the device and everything the app needs (fonts, OCR data, WASM) ships inside it. The one network call is the anonymous launch counter in `shared/usage.ts`; do not add any other without discussing it first.
- **Licences:** dependencies must be permissive (MIT, BSD, Apache). No GPL or AGPL. Add new ones to `THIRD_PARTY_NOTICES.md`.
- **Phones count.** Check your UI change at phone width (the e2e suite has a phone test).
- Coordinates crossing the worker boundary are "device points" (top-left origin, rotation applied); see `space.ts`.
- Keep pull requests small and focused; one idea per PR is easiest to review. Match the style of the surrounding code.

## Ideas that would help a lot

- Run veraPDF over `pdfa.ts` output and fix what it reports; check `access.ts` output with the PAC checker.
- More OCR languages; translations of the interface.
- Better handling of unusual PDFs. A file that renders or edits wrongly is the most valuable bug report you can send (see below).
- Accessibility improvements (keyboard use, screen readers) in the editor.
- Packaging: Homebrew cask, winget, Flathub (see `docs/PACKAGING.md`).

## Reporting bugs

Use the **Bug report** template. Please attach the PDF if it contains nothing private, or say what produced it (scanner, an office suite, a design app…). Describe what you expected and what happened.

## Adding a new Kwiiva app

Kwiiva is an umbrella; each app is a folder on the site and a release in this repo.

1. Pages: `<app>/index.html` (product page) and `<app>/app/index.html` (the web app if it has one); add them to `build.rollupOptions.input` in `vite.config.ts`.
2. Downloads: add the app to `PRODUCTS` in `public/site.js` and put `<div data-product="<app>">` with a `[data-role="main"]` button on its page (copy `paper/index.html`).
3. Desktop app: copy `src-tauri-write/` (its own `Cargo.toml`, `tauri.conf.json`, icons), add an entry to `PAGES` in `vite.config.ts` and a `build:<app>` script, then add a two-line `.github/workflows/release-<app>.yml` that calls `desktop-release.yml`. Also list the app in `netlify/functions/lib/counters.ts` so its downloads and launches are counted.
4. Logo: add a mark to `scripts/make-logos.mjs` in the same rounded-square style.

## Releasing (maintainers)

Bump the version of the app in its `tauri.conf.json` and `Cargo.toml`, add a line to `CHANGELOG.md`, then run **Actions → Release Kwiiva Paper** (or **Release Kwiiva Write**) → Run workflow, or push a `paper-v<version>` / `write-v<version>` tag.
