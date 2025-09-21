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

## Permissions
- "tabs", "storage"
- Host permissions: `<all_urls>`

## Notes
- Popup UI and content script are ported from the Firefox example.
- `ENDPOINT` is injected via Webpack DefinePlugin using `env.config.js` and `TIKTOKZE_ENV`.
- Uses Tailwind via PostCSS at build time; styles are injected by style-loader.
