#!/usr/bin/env bash
# shellcheck shell=bash

node_version_satisfies() {
  local current="${1#v}"
  local required="${2#v}"
  local current_major current_minor current_patch required_major required_minor required_patch

  IFS=. read -r current_major current_minor current_patch _ <<< "${current}"
  IFS=. read -r required_major required_minor required_patch _ <<< "${required}"

  current_minor="${current_minor:-0}"
  current_patch="${current_patch:-0}"
  required_minor="${required_minor:-0}"
  required_patch="${required_patch:-0}"

  [[ "${current_major}" == "${required_major}" ]] || return 1
  (( current_minor > required_minor )) && return 0
  (( current_minor == required_minor && current_patch >= required_patch ))
}

ensure_node_from_nvmrc() {
  local nvmrc_path="${1:-.nvmrc}"
  [[ -f "${nvmrc_path}" ]] || return 0

  local required_node current_node
  required_node="$(tr -d '[:space:]' < "${nvmrc_path}")"
  current_node="$(command -v node >/dev/null 2>&1 && node --version | sed 's/^v//' || echo '')"

  if [[ -n "${current_node}" ]] && node_version_satisfies "${current_node}" "${required_node}"; then
    echo "Using Node.js $(node --version) at $(command -v node)" >&2
    return 0
  fi

  echo "Switching Node.js to ${required_node} for build (current: ${current_node:-not found})" >&2

  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  if [[ -s "${NVM_DIR}/nvm.sh" ]]; then
    . "${NVM_DIR}/nvm.sh"
  elif [[ -s "/opt/homebrew/opt/nvm/nvm.sh" ]]; then
    . "/opt/homebrew/opt/nvm/nvm.sh"
  fi

  if type nvm >/dev/null 2>&1; then
    nvm install "${required_node}"
    nvm use "${required_node}"
    if [[ -d "${NVM_DIR}/versions/node/v${required_node}/bin" ]]; then
      export PATH="${NVM_DIR}/versions/node/v${required_node}/bin:${PATH}"
    fi
  elif command -v fnm >/dev/null 2>&1; then
    eval "$(fnm env --shell bash)"
    fnm install "${required_node}" >/dev/null
    fnm use "${required_node}" >/dev/null
  elif command -v asdf >/dev/null 2>&1; then
    asdf install nodejs "${required_node}" >/dev/null 2>&1 || true
    asdf shell nodejs "${required_node}"
  elif command -v volta >/dev/null 2>&1; then
    volta install "node@${required_node}" >/dev/null
  elif [[ -d "/opt/homebrew/opt/node@${required_node%%.*}/bin" ]]; then
    export PATH="/opt/homebrew/opt/node@${required_node%%.*}/bin:${PATH}"
  elif [[ -d "/usr/local/opt/node@${required_node%%.*}/bin" ]]; then
    export PATH="/usr/local/opt/node@${required_node%%.*}/bin:${PATH}"
  fi

  hash -r 2>/dev/null || true

  current_node="$(command -v node >/dev/null 2>&1 && node --version | sed 's/^v//' || echo '')"
  if [[ -z "${current_node}" ]] || ! node_version_satisfies "${current_node}" "${required_node}"; then
    echo "Node.js ${required_node} or newer with major ${required_node%%.*} is required by ${nvmrc_path}, but 'node' resolves to ${current_node:-not found}." >&2
    echo "Install a supported Node version or configure nvm/fnm/asdf/volta before building." >&2
    return 1
  fi

  echo "Using Node.js $(node --version) at $(command -v node)" >&2
}
