# Security

PDF files are a common way to deliver malware, so Acrohat treats every file as untrusted:

- Parsing and rendering run inside PDFium compiled to WebAssembly, in a Web Worker, so a malformed file cannot reach your system through the parser.
- PDF JavaScript is not executed. Links are not opened automatically.
- The desktop app can only read `.pdf` files the OS gives it or that you pick in a dialog, and only write where you choose.
- Nothing is uploaded; there is no telemetry.

Found a vulnerability? Please report it privately through GitHub's "Report a vulnerability" button on the Security tab rather than opening a public issue.

## Known dependency advisory
`npm audit` reports a high-severity advisory in `node-forge` (RSA PKCS#1 v1.5 *signature verification*), pulled in by `@signpdf/signer-p12`. Acrohat only uses it to **create** signatures, never to verify them, so the affected code path is not reachable. We will switch libraries when a patched release is available.
