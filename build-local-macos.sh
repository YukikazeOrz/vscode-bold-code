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

# Keep every reusable download outside vscode/, because get_repo.sh resets that
# worktree before each build. Override VSCODE_BUILD_CACHE to place it elsewhere.
export VSCODE_BUILD_CACHE="${VSCODE_BUILD_CACHE:-$(pwd)/.build-cache}"
export VSCODE_DOWNLOAD_CACHE="${VSCODE_DOWNLOAD_CACHE:-${VSCODE_BUILD_CACHE}/downloads}"
export VSCODE_EXTENSION_CACHE="${VSCODE_EXTENSION_CACHE:-${VSCODE_BUILD_CACHE}/extensions}"
export VSCODE_BUILTIN_EXTENSIONS_CACHE="${VSCODE_BUILTIN_EXTENSIONS_CACHE:-${VSCODE_BUILD_CACHE}/builtInExtensions}"
export npm_config_cache="${npm_config_cache:-${VSCODE_BUILD_CACHE}/npm}"
export npm_config_devdir="${npm_config_devdir:-${VSCODE_BUILD_CACHE}/node-gyp}"
export ELECTRON_CACHE="${ELECTRON_CACHE:-${VSCODE_BUILD_CACHE}/electron}"
export electron_config_cache="${electron_config_cache:-${VSCODE_BUILD_CACHE}/electron}"
export ELECTRON_BUILDER_CACHE="${ELECTRON_BUILDER_CACHE:-${VSCODE_BUILD_CACHE}/electron-builder}"
export CARGO_HOME="${CARGO_HOME:-${VSCODE_BUILD_CACHE}/cargo}"

mkdir -p \
  "${VSCODE_DOWNLOAD_CACHE}" \
  "${VSCODE_EXTENSION_CACHE}" \
  "${VSCODE_BUILTIN_EXTENSIONS_CACHE}" \
  "${npm_config_cache}" \
  "${npm_config_devdir}" \
  "${ELECTRON_CACHE}" \
  "${ELECTRON_BUILDER_CACHE}" \
  "${CARGO_HOME}"

persist_builtin_extensions() {
  local source_dir="vscode/.build/builtInExtensions"
  [[ -d "${source_dir}" ]] || return 0

  mkdir -p "${VSCODE_BUILTIN_EXTENSIONS_CACHE}"
  local extension_dir extension_name
  for extension_dir in "${source_dir}"/*; do
    [[ -f "${extension_dir}/package.json" ]] || continue
    extension_name=$(basename "${extension_dir}")
    rm -rf "${VSCODE_BUILTIN_EXTENSIONS_CACHE:?}/${extension_name}"
    cp -R "${extension_dir}" "${VSCODE_BUILTIN_EXTENSIONS_CACHE}/${extension_name}"
  done
}

restore_builtin_extensions() {
  [[ -d "${VSCODE_BUILTIN_EXTENSIONS_CACHE}" ]] || return 0
  mkdir -p vscode/.build/builtInExtensions
  cp -R "${VSCODE_BUILTIN_EXTENSIONS_CACHE}/." vscode/.build/builtInExtensions/
}

# Preserve anything completed by an interrupted build as well as a successful one.
persist_builtin_extensions
trap persist_builtin_extensions EXIT

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
command -v python3 >/dev/null || { echo "python3 is required" >&2; exit 1; }
xcode-select -p >/dev/null 2>&1 || { echo "Xcode Command Line Tools are required (run: xcode-select --install)" >&2; exit 1; }

# Homebrew's rustup formula symlinks only the `rustup` binary itself into
# /opt/homebrew/bin; cargo/rustc/etc. stay in the keg-only opt dir (to avoid
# clashing with the separate `rust` formula). So `command -v rustup` alone
# can succeed while `cargo` is still unresolvable -- always prepend the
# keg-only dir rather than gating on rustup already being found.
if [[ -d "/opt/homebrew/opt/rustup/bin" ]]; then
  export PATH="/opt/homebrew/opt/rustup/bin:${PATH}"
fi
command -v rustup >/dev/null || { echo "rustup is required (brew install rustup)" >&2; exit 1; }

if [[ -f ".nvmrc" ]]; then
  REQUIRED_NODE=$(cat .nvmrc)
  CURRENT_NODE=$(command -v node >/dev/null && node --version | sed 's/^v//' || echo "")
  if [[ "${CURRENT_NODE%%.*}" != "${REQUIRED_NODE%%.*}" ]]; then
    # This script is invoked as a non-interactive, non-login subprocess, so
    # it never sources ~/.zshrc — nvm's PATH change in an interactive parent
    # shell does NOT reach here on its own. Load nvm and switch ourselves
    # rather than relying on the caller's shell already having done so.
    export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
    if [[ -s "${NVM_DIR}/nvm.sh" ]]; then
      . "${NVM_DIR}/nvm.sh"
    elif [[ -s "/opt/homebrew/opt/nvm/nvm.sh" ]]; then
      . "/opt/homebrew/opt/nvm/nvm.sh"
    fi
    if command -v nvm >/dev/null 2>&1; then
      nvm use "${REQUIRED_NODE}" >/dev/null 2>&1 || nvm install "${REQUIRED_NODE}" >/dev/null 2>&1
      CURRENT_NODE=$(node --version | sed 's/^v//')
    fi
  fi
fi

command -v node >/dev/null || { echo "node is required — see .nvmrc for the expected version" >&2; exit 1; }

if [[ -f ".nvmrc" ]]; then
  CURRENT_NODE=$(node --version | sed 's/^v//')
  if [[ "${CURRENT_NODE%%.*}" != "${REQUIRED_NODE%%.*}" ]]; then
    echo "Warning: .nvmrc wants Node ${REQUIRED_NODE}, but 'node' resolves to ${CURRENT_NODE}. Native module builds may fail — use nvm/fnm to switch." >&2
  fi
fi

echo "== Building ${APP_NAME} (${VSCODE_QUALITY}, ${VSCODE_ARCH}) =="
echo "Build cache: ${VSCODE_BUILD_CACHE}"
if [[ -n "${CERTIFICATE_OSX_P12_DATA:-}" ]]; then
  echo "Signing certificate detected — will produce a signed, notarized dmg."
else
  echo "No CERTIFICATE_OSX_P12_DATA set — producing an UNSIGNED dmg."
fi

echo ""
echo "-- Step 1/3: Clone pinned upstream VS Code --"
. ./get_repo.sh
restore_builtin_extensions

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
