#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-production}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required (to read manifest.json)." >&2
  exit 1
fi

VERSION="$(jq -r .version manifest.json)"
NAME_RAW="$(jq -r .name manifest.json)"
NAME="$(echo "$NAME_RAW" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9-_' | sed -E 's/_+/-/g' | sed -E 's/-+/-/g')"
[ -n "$NAME" ] || NAME="extension"

DIST="$ROOT/dist"
RELEASE_DIR="$ROOT/release"
ZIP_PATH="$RELEASE_DIR/${NAME}-${VERSION}-${MODE}.zip"

echo "Packaging environment: $MODE"
mkdir -p "$RELEASE_DIR"

if [ ! -d "$DIST" ]; then
  echo "dist/ not found; running build once…"
  npm run build
fi

echo "Preparing package content…"
cp -f "$ROOT/manifest.json" "$DIST/"

if [ -d "$ROOT/icons" ]; then
  echo "Copying icons/ → dist/icons/"
  mkdir -p "$DIST/icons"
  cp -R "$ROOT/icons/." "$DIST/icons/"
else
  echo "No icons/ directory; skipping."
fi

if [ -d "$ROOT/assets" ]; then
  echo "Copying assets/ → dist/assets/"
  mkdir -p "$DIST/assets"
  cp -R "$ROOT/assets/." "$DIST/assets/"
fi

if [ -d "$ROOT/public" ]; then
  echo "Copying public/ → dist/"
  cp -R "$ROOT/public/." "$DIST/"
fi

for f in popup.html options.html background.html; do
  if [ -f "$ROOT/$f" ]; then
    cp -f "$ROOT/$f" "$DIST/"
  fi
done

echo "Creating zip: $(basename "$ZIP_PATH")"
cd "$DIST"
zip -qr9 "$ZIP_PATH" .
echo "✅ Created: $ZIP_PATH"
