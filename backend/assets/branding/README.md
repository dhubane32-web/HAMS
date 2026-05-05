# Hawana Airways — print / PDF branding (HAMS)

## Official source lock

Official source of truth is exactly:

- `frontend/public/brand/source/Hawana Logo Monotone.pdf`

No additional source PDF files are allowed in `frontend/public/brand/source/` or `backend/assets/branding/`.
The brand build script fails if duplicates or legacy source PDFs are present.

## Generate PNGs (web + print)

From **`frontend/`** (writes `public/brand/*.png`, `favicon.ico`, and copies print PNG here when this directory exists):

```bash
npm run brand:build
```

Requires Poppler (`pdftocairo`). On macOS: `brew install poppler`.

Print PNG script (still uses the same official source file):

```bash
bash backend/scripts/extract-hawana-logo-png.sh
```

Legacy fallbacks are intentionally disabled in the brand build pipeline.

## Web UI

Production UI uses **`/brand/hawana-logo.png`** and **`/brand/hawana-logo-dark.png`** via `BrandLogo` and `lib/brand.ts`. Optional localStorage overrides may point to other URLs.
