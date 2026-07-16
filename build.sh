#!/usr/bin/env bash
# Compile the Bold Code VS Code source tree from this repository root.

set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
cd "${ROOT_DIR}"

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
	cat <<'EOF'
Usage: ./build.sh [--skip-install] [--package]

Installs dependencies (unless --skip-install is supplied) and compiles the
VS Code client into out/.

--package additionally creates a native macOS app in .build/ for the host
architecture (Apple Silicon: VSCode-darwin-arm64; Intel: VSCode-darwin-x64).
EOF
	exit 0
fi

SKIP_INSTALL=false
PACKAGE=false
for option in "$@"; do
	case "${option}" in
		--skip-install) SKIP_INSTALL=true ;;
		--package) PACKAGE=true ;;
		*)
			echo "Unknown option: ${option}" >&2
			exit 2
			;;
	esac
done

required_node=$(<.nvmrc)
NVM_SCRIPT=''
if [[ -n "${NVM_DIR:-}" && -s "${NVM_DIR}/nvm.sh" ]]; then
	NVM_SCRIPT="${NVM_DIR}/nvm.sh"
elif [[ -s "${HOME}/.nvm/nvm.sh" ]]; then
	NVM_SCRIPT="${HOME}/.nvm/nvm.sh"
elif [[ -s "/opt/homebrew/opt/nvm/nvm.sh" ]]; then
	NVM_SCRIPT="/opt/homebrew/opt/nvm/nvm.sh"
fi

if [[ -n "${NVM_SCRIPT}" ]]; then
	# shellcheck disable=SC1090
	. "${NVM_SCRIPT}"
	if ! nvm use "${required_node}"; then
		nvm install "${required_node}"
		nvm use "${required_node}"
	fi

	# Some terminal managers leave another Node shim earlier in PATH even after
	# `nvm use`. Resolve the selected binary and place its directory first.
	nvm_node=$(nvm which "${required_node}")
	if [[ ! -x "${nvm_node}" ]]; then
		echo "Unable to resolve Node ${required_node} through nvm." >&2
		exit 1
	fi
	export PATH="$(dirname "${nvm_node}"):${PATH}"
	hash -r
fi

node_major=$(node --version | sed 's/^v//' | cut -d. -f1)
required_major=${required_node%%.*}
if [[ "${node_major}" != "${required_major}" ]]; then
	echo "Node ${required_node} is required; found $(node --version)." >&2
	exit 1
fi

echo "Using Node $(node --version) from $(command -v node)"

npm_major=$(npm --version | cut -d. -f1)
if (( npm_major >= 12 )); then
	NPM=(npx --yes npm@11)
	# npx 12 preserves its own user-agent when launching npm 11. VS Code checks
	# that value in preinstall, so provide the user-agent for the npm version
	# that actually performs the install.
	NPM_USER_AGENT="npm/11.18.0 node/$(node --version | sed 's/^v//') $(uname | tr '[:upper:]' '[:lower:]') $(uname -m) workspaces/false"
else
	NPM=(npm)
	NPM_USER_AGENT=''
fi

run_npm() {
	if [[ -n "${NPM_USER_AGENT}" ]]; then
		npm_config_user_agent="${NPM_USER_AGENT}" "${NPM[@]}" "$@"
	else
		"${NPM[@]}" "$@"
	fi
}

if [[ "${SKIP_INSTALL}" != true ]]; then
	run_npm ci
fi

node --experimental-strip-types ./scripts/prepare-ai-hub-extensions.ts

export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=8192}"
run_npm run gulp compile

if [[ "${PACKAGE}" == true ]]; then
	case "$(uname -m)" in
		arm64) package_arch='arm64' ;;
		x86_64) package_arch='x64' ;;
		*)
			echo "Unsupported macOS architecture: $(uname -m)" >&2
			exit 1
			;;
	esac

	run_npm run gulp "vscode-darwin-${package_arch}"
	echo "Packaged app: ${ROOT_DIR}/.build/VSCode-darwin-${package_arch}"
fi
