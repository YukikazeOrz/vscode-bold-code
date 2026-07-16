#!/usr/bin/env bash
# shellcheck disable=SC2129

set -e

# git workaround
if [[ "${CI_BUILD}" != "no" ]]; then
  git config --global --add safe.directory "/__w/$( echo "${GITHUB_REPOSITORY}" | awk '{print tolower($0)}' )"
fi

if [[ -z "${RELEASE_VERSION}" ]]; then
  if [[ "${VSCODE_LATEST}" == "yes" ]] || [[ ! -f "./upstream/${VSCODE_QUALITY}.json" ]]; then
    echo "Retrieve lastest version"
    UPDATE_INFO=$( curl --silent --fail "https://update.code.visualstudio.com/api/update/darwin/${VSCODE_QUALITY}/0000000000000000000000000000000000000000" )
  else
    echo "Get version from ${VSCODE_QUALITY}.json"
    MS_COMMIT=$( jq -r '.commit' "./upstream/${VSCODE_QUALITY}.json" )
    MS_TAG=$( jq -r '.tag' "./upstream/${VSCODE_QUALITY}.json" )
  fi

  if [[ -z "${MS_COMMIT}" ]]; then
    MS_COMMIT=$( echo "${UPDATE_INFO}" | jq -r '.version' )
    MS_TAG=$( echo "${UPDATE_INFO}" | jq -r '.name' )

    if [[ "${VSCODE_QUALITY}" == "insider" ]]; then
      MS_TAG="${MS_TAG/\-insider/}"
    fi
  fi

  TIME_PATCH=$( printf "%04d" $(($(date +%-j) * 24 + $(date +%-H))) )

  if [[ "${VSCODE_QUALITY}" == "insider" ]]; then
    RELEASE_VERSION="${MS_TAG}${TIME_PATCH}-insider"
  else
    RELEASE_VERSION="${MS_TAG}${TIME_PATCH}"
  fi
else
  if [[ "${VSCODE_QUALITY}" == "insider" ]]; then
    if [[ "${RELEASE_VERSION}" =~ ^([0-9]+\.[0-9]+\.[0-5])[0-9]+-insider$ ]];
    then
      MS_TAG="${BASH_REMATCH[1]}"
    else
      echo "Error: Bad RELEASE_VERSION: ${RELEASE_VERSION}"
      exit 1
    fi
  else
    if [[ "${RELEASE_VERSION}" =~ ^([0-9]+\.[0-9]+\.[0-5])[0-9]+$ ]];
    then
      MS_TAG="${BASH_REMATCH[1]}"
    else
      echo "Error: Bad RELEASE_VERSION: ${RELEASE_VERSION}"
      exit 1
    fi
  fi

  if [[ "${MS_TAG}" == "$( jq -r '.tag' "./upstream/${VSCODE_QUALITY}.json" )" ]]; then
    MS_COMMIT=$( jq -r '.commit' "./upstream/${VSCODE_QUALITY}.json" )
  else
    echo "Error: No MS_COMMIT for ${RELEASE_VERSION}"
    exit 1
  fi
fi

echo "RELEASE_VERSION=\"${RELEASE_VERSION}\""

mkdir -p vscode
cd vscode || { echo "'vscode' dir not found"; exit 1; }

git init -q
git remote add origin https://github.com/Microsoft/vscode.git 2>/dev/null || git remote set-url origin https://github.com/Microsoft/vscode.git

# Bold Code keeps its fully materialized VS Code source on a regular branch.
# Set VSCODE_SOURCE_MODE=no to fall back to the legacy upstream + patch flow.
export VSCODE_SOURCE_MODE="${VSCODE_SOURCE_MODE:-yes}"
export VSCODE_SOURCE_REPOSITORY="${VSCODE_SOURCE_REPOSITORY:-https://github.com/YukikazeOrz/vscode-bold-code.git}"
export VSCODE_SOURCE_REF="${VSCODE_SOURCE_REF:-codex/vscode-source}"

# figure out latest tag by calling MS update API
if [[ -z "${MS_TAG}" ]]; then
  UPDATE_INFO=$( curl --silent --fail "https://update.code.visualstudio.com/api/update/darwin/${VSCODE_QUALITY}/0000000000000000000000000000000000000000" )
  MS_COMMIT=$( echo "${UPDATE_INFO}" | jq -r '.version' )
  MS_TAG=$( echo "${UPDATE_INFO}" | jq -r '.name' )
elif [[ -z "${MS_COMMIT}" ]]; then
  REFERENCE=$( git ls-remote --tags | grep -x ".*refs\/tags\/${MS_TAG}" | head -1 )

  if [[ -z "${REFERENCE}" ]]; then
    echo "Error: The following tag can't be found: ${MS_TAG}"
    exit 1
  elif [[ "${REFERENCE}" =~ ^([[:alnum:]]+)[[:space:]]+refs\/tags\/([0-9]+\.[0-9]+\.[0-5])$ ]]; then
    MS_COMMIT="${BASH_REMATCH[1]}"
    MS_TAG="${BASH_REMATCH[2]}"
  else
    echo "Error: The following reference can't be parsed: ${REFERENCE}"
    exit 1
  fi
fi

echo "MS_TAG=\"${MS_TAG}\""
echo "MS_COMMIT=\"${MS_COMMIT}\""

if [[ "${VSCODE_SOURCE_MODE}" == "yes" ]]; then
  git remote add bold-code-source "${VSCODE_SOURCE_REPOSITORY}" 2>/dev/null || git remote set-url bold-code-source "${VSCODE_SOURCE_REPOSITORY}"

  # Local source development deliberately keeps uncommitted changes. CI and
  # fresh checkouts always resolve the remote branch to a deterministic tree.
  if [[ "${CI_BUILD}" == "no" && "$(git branch --show-current)" == "${VSCODE_SOURCE_REF}" ]]; then
    echo "Using local source branch ${VSCODE_SOURCE_REF} (working tree preserved)"
  else
    git fetch --depth 1 bold-code-source "${VSCODE_SOURCE_REF}"
    git checkout -B "${VSCODE_SOURCE_REF}" FETCH_HEAD
    git reset -q --hard FETCH_HEAD
    git clean -q -fdx
  fi
elif git cat-file -e "${MS_COMMIT}^{commit}" 2>/dev/null; then
  echo "Using cached upstream commit ${MS_COMMIT}"
  CHECKOUT_TARGET="${MS_COMMIT}"
else
  git fetch --depth 1 origin "${MS_COMMIT}"
  CHECKOUT_TARGET="FETCH_HEAD"
fi

if [[ "${VSCODE_SOURCE_MODE}" != "yes" ]]; then
  git checkout "${CHECKOUT_TARGET}"

  # `git checkout` above is a no-op for the working tree when the target is
  # already the checked-out commit. Force a pristine legacy patch worktree.
  git reset -q --hard "${CHECKOUT_TARGET}"
  git clean -q -fdx
fi
unset CHECKOUT_TARGET

cd ..

# for GH actions
if [[ "${GITHUB_ENV}" ]]; then
  echo "MS_TAG=${MS_TAG}" >> "${GITHUB_ENV}"
  echo "MS_COMMIT=${MS_COMMIT}" >> "${GITHUB_ENV}"
  echo "RELEASE_VERSION=${RELEASE_VERSION}" >> "${GITHUB_ENV}"
fi

export MS_TAG
export MS_COMMIT
export RELEASE_VERSION
