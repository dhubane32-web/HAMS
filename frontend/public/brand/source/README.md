Official HAMS brand source folder.

Required file (only source of truth):
- `Hawana Logo Monotone.pdf`

Rules:
- Keep only this PDF in this folder (no extra PDFs).
- If you only have `Hawana Logo - Monotone.pdf`, place it in this folder once; `npm run brand:build` will rename it to `Hawana Logo Monotone.pdf` when the canonical name is missing.
- Or set `HAMS_BRAND_SOURCE_PDF` to an absolute path before `npm run brand:build` to copy into the canonical file.
- Requires Poppler (`pdftocairo` or `pdftoppm`). macOS: `brew install poppler`.

Run `npm run brand:build` from `frontend/` to regenerate:
  - `public/brand/hawana-logo.png`
  - `public/brand/hawana-logo-dark.png`
  - `public/brand/favicon.ico`
  - optional `public/brand/hawana-logo.svg` (when `pdf2svg` is installed)
