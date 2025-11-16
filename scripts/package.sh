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

STAGING_DIR="$(mktemp -d "$RELEASE_DIR/staging.XXXXXX")"
cleanup() {
  rm -rf "$STAGING_DIR"
}
trap cleanup EXIT

echo "Staging files in $STAGING_DIR"

echo "• Copying manifest.json"
cp "$ROOT/manifest.json" "$STAGING_DIR/manifest.json"

for f in popup.html options.html background.html; do
  if [ -f "$ROOT/$f" ]; then
    echo "• Copying $f"
    cp "$ROOT/$f" "$STAGING_DIR/$f"
  fi
done

if [ -d "$ROOT/assets" ]; then
  echo "• Copying assets/"
  mkdir -p "$STAGING_DIR/assets"
  cp -R "$ROOT/assets/." "$STAGING_DIR/assets/"
fi

if [ -d "$ROOT/icons" ]; then
  echo "• Copying icons/"
  mkdir -p "$STAGING_DIR/icons"
  cp -R "$ROOT/icons/." "$STAGING_DIR/icons/"
fi

if [ -d "$ROOT/public" ]; then
  echo "• Copying public/"
  mkdir -p "$STAGING_DIR/public"
  cp -R "$ROOT/public/." "$STAGING_DIR/public/"
fi

echo "• Copying compiled dist/"
mkdir -p "$STAGING_DIR/dist"
cp -R "$DIST/." "$STAGING_DIR/dist/"

echo "Creating zip: $(basename "$ZIP_PATH")"
cd "$STAGING_DIR"
zip -qr9 "$ZIP_PATH" .
echo "✅ Created: $ZIP_PATH"
