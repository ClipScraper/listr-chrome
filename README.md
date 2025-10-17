# tiktok-downloader-chrome-extension (MV3)

## Develop / Build

```bash
npm install
npm run start   # dev watch
npm run build   # prod build (development endpoint)
npm run build:test
npm run build:prod
```

## Load unpacked in Chrome

1. Run `npm run build` to generate `dist/`.
2. Open `chrome://extensions`.
3. Enable Developer mode (top right).
4. Click "Load unpacked" and select this folder.
5. The popup loads from `popup.html`, scripts from `dist/`.

## Package for Chrome Web Store

You need a ZIP of the extension directory (no `node_modules`, sources compiled to `dist/`). Use the script below:

```bash
# Default: production endpoint
./scripts/package.sh

# Or choose env explicitly: development | test | production
./scripts/package.sh production
```

This creates `release/<name>-<version>-<env>.zip` ready for upload.

## Publish to Chrome Web Store

1. Create a developer account at the Chrome Web Store Developer Dashboard.
2. Click "New Item" and upload the ZIP from the `release/` folder.
3. Fill in listing details, privacy, and permissions justification.
4. Submit for review.

## Permissions
- "tabs", "storage"
- Host permissions: `<all_urls>`

## Notes
- Popup UI and content script are ported from the Firefox example.
- `ENDPOINT` is injected via Webpack DefinePlugin from the `ENDPOINT` environment variable (optional). If not set, it defaults to an empty string.
- Uses Tailwind via PostCSS at build time; styles are injected by style-loader.
