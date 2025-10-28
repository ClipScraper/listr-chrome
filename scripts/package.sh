#!/bin/bash

set -euo pipefail

ENVIRONMENT=${1:-production}
ROOT_DIR=$(cd "$(dirname "$0")/.." && pwd)
RELEASE_DIR="$ROOT_DIR/release"
DIST_DIR="$ROOT_DIR/dist"

echo "Packaging environment: $ENVIRONMENT"

cd "$ROOT_DIR"

echo "Cleaning dist and release directories..."
rm -rf "$DIST_DIR" "$RELEASE_DIR"
mkdir -p "$RELEASE_DIR"

case "$ENVIRONMENT" in
  development|test|production) ;;
  *) echo "Unknown environment: $ENVIRONMENT (use development|test|production)"; exit 1;;
esac

echo "Building extension..."
npm run build --silent

NAME=$(node -e "console.log(require('./package.json').name)")
VERSION=$(node -e "console.log(require('./package.json').version)")
ZIP_NAME="$NAME-$VERSION-$ENVIRONMENT.zip"

echo "Creating zip: $ZIP_NAME"
TEMP_DIR=$(mktemp -d)
trap 'rm -rf "$TEMP_DIR"' EXIT

# Copy required files into temp staging directory
mkdir -p "$TEMP_DIR"
cp -a manifest.json popup.html icons assets "$TEMP_DIR/"
cp -a dist "$TEMP_DIR/"

# Optional: include README and LICENSE
if [ -f README.md ]; then cp README.md "$TEMP_DIR/"; fi
if [ -f LICENSE ]; then cp LICENSE "$TEMP_DIR/"; fi

mkdir -p "$RELEASE_DIR"
(cd "$TEMP_DIR" && zip -q -r "$RELEASE_DIR/$ZIP_NAME" .)

echo "Done: $RELEASE_DIR/$ZIP_NAME"
