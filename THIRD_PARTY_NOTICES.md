# Third-party software

Acrohat is MIT licensed. It bundles the following components, all under licenses that allow redistribution.

| Component | Used for | License |
|---|---|---|
| [PDFium](https://pdfium.googlesource.com/pdfium/) via [@embedpdf/pdfium](https://github.com/embedpdf/embed-pdf-viewer) | Rendering, text, annotations, page operations | BSD-3-Clause / Apache-2.0 |
| [qpdf](https://github.com/qpdf/qpdf) via @neslinesli93/qpdf-wasm | Encryption, decryption, size optimization | Apache-2.0 |
| [Tesseract](https://github.com/tesseract-ocr/tesseract) via tesseract.js, `eng` model from tessdata_best | Text recognition (OCR) | Apache-2.0 |
| [pdf-lib](https://github.com/Hopding/pdf-lib) | Form fields, document properties | MIT |
| [@signpdf](https://github.com/vbuch/node-signpdf) and [node-forge](https://github.com/digitalbazaar/forge) | Certificate-based digital signatures | MIT / BSD-3-Clause |
| [Liberation fonts](https://github.com/liberationfonts/liberation-fonts) | Replacement fonts for text editing | SIL OFL 1.1 (`public/fonts/LICENSE-Liberation.txt`) |
| [DejaVu fonts](https://dejavu-fonts.github.io/) | Replacement fonts with wider symbol coverage | Bitstream Vera / Public Domain (`public/fonts/LICENSE-DejaVu.txt`) |
| [React](https://react.dev), [Zustand](https://github.com/pmndrs/zustand), [fflate](https://github.com/101arrowz/fflate) | Interface, state, ZIP files | MIT |
| [Tauri](https://tauri.app) | Desktop shell | MIT / Apache-2.0 |

MuPDF and other AGPL/GPL PDF engines are deliberately **not** used, so the whole app can be reused under MIT terms.
