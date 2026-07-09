#!/usr/bin/env bash
# shellcheck disable=SC1091
#
# Build a VSCodium .dmg locally on macOS, mirroring what the
# .github/workflows/build-macos.yml CI job does. Run from the repo root:
#
#   ./build-local-macos.sh
#
# For a signed/notarized dmg, export CERTIFICATE_OSX_P12_DATA (base64 of your
# .p12), CERTIFICATE_OSX_P12_PASSWORD, CERTIFICATE_OSX_TEAM_ID,
# CERTIFICATE_OSX_APPLE_ID and CERTIFICATE_OSX_APP_PASSWORD before running
# this script. Without them you get an unsigned dmg (Gatekeeper will warn on
# first launch — right-click the app > Open, or run:
#   xattr -dr com.apple.quarantine /Applications/VSCodium.app

set -e

if [[ "$(uname)" != "Darwin" ]]; then
  echo "This script must be run on macOS." >&2
  exit 1
fi

if [[ ! -f "./get_repo.sh" ]]; then
  echo "Run this from the repo root (get_repo.sh not found in $(pwd))." >&2
  exit 1
fi

export APP_NAME="${APP_NAME:-VSCodium}"
export BINARY_NAME="${BINARY_NAME:-codium}"
export OS_NAME=osx
export VSCODE_QUALITY="${VSCODE_QUALITY:-stable}"
export SHOULD_BUILD=yes

if [[ -z "${VSCODE_ARCH:-}" ]]; then
  case "$(uname -m)" in
    arm64) VSCODE_ARCH=arm64 ;;
    x86_64) VSCODE_ARCH=x64 ;;
    *) echo "Unrecognized architecture: $(uname -m); set VSCODE_ARCH manually." >&2; exit 1 ;;
  esac
  export VSCODE_ARCH
fi

if [[ -z "${GH_REPO_PATH:-}" ]]; then
  REMOTE_URL=$(git config --get remote.origin.url 2>/dev/null || true)
  if [[ "${REMOTE_URL}" =~ github\.com[:/]([^/]+)/([^/.]+)(\.git)?$ ]]; then
    export ORG_NAME="${ORG_NAME:-${BASH_REMATCH[1]}}"
    export GH_REPO_PATH="${BASH_REMATCH[1]}/${BASH_REMATCH[2]}"
  else
    echo "Note: could not derive GH_REPO_PATH from 'git remote origin' — not required for a local dmg build, only for release.sh." >&2
  fi
fi

echo "== Prerequisite checks =="
command -v jq >/dev/null || { echo "jq is required (brew install jq)" >&2; exit 1; }
command -v node >/dev/null || { echo "node is required — see .nvmrc for the expected version" >&2; exit 1; }
command -v python3 >/dev/null || { echo "python3 is required" >&2; exit 1; }
xcode-select -p >/dev/null 2>&1 || { echo "Xcode Command Line Tools are required (run: xcode-select --install)" >&2; exit 1; }

if [[ -f ".nvmrc" ]]; then
  REQUIRED_NODE=$(cat .nvmrc)
  CURRENT_NODE=$(node --version | sed 's/^v//')
  if [[ "${CURRENT_NODE%%.*}" != "${REQUIRED_NODE%%.*}" ]]; then
    echo "Warning: .nvmrc wants Node ${REQUIRED_NODE}, but 'node' resolves to ${CURRENT_NODE}. Native module builds may fail — use nvm/fnm to switch." >&2
  fi
fi

echo "== Building ${APP_NAME} (${VSCODE_QUALITY}, ${VSCODE_ARCH}) =="
if [[ -n "${CERTIFICATE_OSX_P12_DATA:-}" ]]; then
  echo "Signing certificate detected — will produce a signed, notarized dmg."
else
  echo "No CERTIFICATE_OSX_P12_DATA set — producing an UNSIGNED dmg."
fi

echo ""
echo "-- Step 1/3: Clone pinned upstream VS Code --"
. ./get_repo.sh

echo ""
echo "-- Step 2/3: Build (apply patches, fetch bundled AI extensions, npm ci, gulp compile) --"
echo "   This is the long step — expect 30-90+ minutes depending on hardware."
./build.sh

echo ""
echo "-- Step 3/3: Package into dmg --"
./prepare_assets.sh

echo ""
DMG=$(find assets -maxdepth 1 -name "*.dmg" 2>/dev/null | head -1)
if [[ -n "${DMG}" ]]; then
  echo "== Done: ${DMG} =="
else
  echo "Build finished but no .dmg was found under assets/ — check the log above for what prepare_assets.sh actually produced." >&2
  exit 1
fi
