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

# Ensure dist exists (CI should have built already)
if [ ! -d "$DIST" ]; then
  echo "dist/ not found; running build once…"
  npm run build
fi

echo "Preparing package content…"

# Always include manifest.json in dist/
cp -f "$ROOT/manifest.json" "$DIST/"

# Copy icons/ if present (legacy layout)
if [ -d "$ROOT/icons" ]; then
  echo "Copying icons/ → dist/icons/"
  mkdir -p "$DIST/icons"
  cp -R "$ROOT/icons/." "$DIST/icons/"
fi

# Copy assets/ (common layout for icons/images)
if [ -d "$ROOT/assets" ]; then
  echo "Copying assets/ → dist/assets/"
  mkdir -p "$DIST/assets"
  cp -R "$ROOT/assets/." "$DIST/assets/"
fi

# Copy public/ (static html or images)
if [ -d "$ROOT/public" ]; then
  echo "Copying public/ → dist/"
  cp -R "$ROOT/public/." "$DIST/"
fi

# If those HTML files live at repo root, include them too
for f in popup.html options.html background.html; do
  if [ -f "$ROOT/$f" ]; then
    cp -f "$ROOT/$f" "$DIST/"
  fi
done

echo "Creating zip: $(basename "$ZIP_PATH")"
cd "$DIST"
zip -qr9 "$ZIP_PATH" .

echo "✅ Created: $ZIP_PATH"
