#!/usr/bin/env bash
# shellcheck disable=SC1091,2154

set -e

if [[ "${VSCODE_QUALITY}" == "insider" ]]; then
  cp -rp src/insider/* vscode/
else
  cp -rp src/stable/* vscode/
fi

cp -f LICENSE vscode/LICENSE.txt

cd vscode || { echo "'vscode' dir not found"; exit 1; }

{ set +x; } 2>/dev/null

. ../build/ensure_node.sh
ensure_node_from_nvmrc ".nvmrc"

# {{{ product.json
cp product.json{,.bak}

setpath() {
  local jsonTmp
  { set +x; } 2>/dev/null
  jsonTmp=$( jq --arg 'value' "${3}" "setpath(path(.${2}); \$value)" "${1}.json" )
  echo "${jsonTmp}" > "${1}.json"
  set -x
}

setpath_json() {
  local jsonTmp
  { set +x; } 2>/dev/null
  jsonTmp=$( jq --argjson 'value' "${3}" "setpath(path(.${2}); \$value)" "${1}.json" )
  echo "${jsonTmp}" > "${1}.json"
  set -x
}

setpath "product" "checksumFailMoreInfoUrl" "https://go.microsoft.com/fwlink/?LinkId=828886"
setpath "product" "documentationUrl" "https://go.microsoft.com/fwlink/?LinkID=533484#vscode"
setpath_json "product" "extensionsGallery" '{"serviceUrl": "https://open-vsx.org/vscode/gallery", "itemUrl": "https://open-vsx.org/vscode/item", "latestUrlTemplate": "https://open-vsx.org/vscode/gallery/{publisher}/{name}/latest", "controlUrl": "https://raw.githubusercontent.com/EclipseFdn/publish-extensions/refs/heads/master/extension-control/extensions.json"}'

setpath "product" "introductoryVideosUrl" "https://go.microsoft.com/fwlink/?linkid=832146"
setpath "product" "keyboardShortcutsUrlLinux" "https://go.microsoft.com/fwlink/?linkid=832144"
setpath "product" "keyboardShortcutsUrlMac" "https://go.microsoft.com/fwlink/?linkid=832143"
setpath "product" "keyboardShortcutsUrlWin" "https://go.microsoft.com/fwlink/?linkid=832145"
setpath "product" "licenseUrl" "https://github.com/VSCodium/vscodium/blob/master/LICENSE"
setpath_json "product" "linkProtectionTrustedDomains" '["https://open-vsx.org"]'
setpath "product" "releaseNotesUrl" "https://go.microsoft.com/fwlink/?LinkID=533483#vscode"
setpath "product" "reportIssueUrl" "https://github.com/VSCodium/vscodium/issues/new"
setpath "product" "requestFeatureUrl" "https://go.microsoft.com/fwlink/?LinkID=533482"
setpath "product" "tipsAndTricksUrl" "https://go.microsoft.com/fwlink/?linkid=852118"
setpath "product" "twitterUrl" "https://go.microsoft.com/fwlink/?LinkID=533687"

if [[ "${DISABLE_UPDATE}" != "yes" ]]; then
  setpath "product" "updateUrl" "https://raw.githubusercontent.com/VSCodium/versions/refs/heads/master"

  if [[ "${VSCODE_QUALITY}" == "insider" ]]; then
    setpath "product" "downloadUrl" "https://github.com/VSCodium/vscodium-insiders/releases"
  else
    setpath "product" "downloadUrl" "https://github.com/VSCodium/vscodium/releases"
  fi

  # if [[ "${OS_NAME}" == "windows" ]]; then
  #   setpath_json "product" "win32VersionedUpdate" "true"
  # fi
fi

if [[ "${VSCODE_QUALITY}" == "insider" ]]; then
  setpath "product" "nameShort" "VSCodium - Insiders"
  setpath "product" "nameLong" "VSCodium - Insiders"
  setpath "product" "applicationName" "codium-insiders"
  setpath "product" "dataFolderName" ".vscodium-insiders"
  setpath "product" "linuxIconName" "vscodium-insiders"
  setpath "product" "quality" "insider"
  setpath "product" "urlProtocol" "vscodium-insiders"
  setpath "product" "serverApplicationName" "codium-server-insiders"
  setpath "product" "serverDataFolderName" ".vscodium-server-insiders"
  setpath "product" "darwinBundleIdentifier" "com.vscodium.VSCodiumInsiders"
  setpath "product" "win32AppUserModelId" "VSCodium.VSCodiumInsiders"
  setpath "product" "win32DirName" "VSCodium Insiders"
  setpath "product" "win32MutexName" "vscodiuminsiders"
  setpath "product" "win32NameVersion" "VSCodium Insiders"
  setpath "product" "win32RegValueName" "VSCodiumInsiders"
  setpath "product" "win32ShellNameShort" "VSCodium Insiders"
  setpath "product" "win32AppId" "{{EF35BB36-FA7E-4BB9-B7DA-D1E09F2DA9C9}"
  setpath "product" "win32x64AppId" "{{B2E0DDB2-120E-4D34-9F7E-8C688FF839A2}"
  setpath "product" "win32arm64AppId" "{{44721278-64C6-4513-BC45-D48E07830599}"
  setpath "product" "win32UserAppId" "{{ED2E5618-3E7E-4888-BF3C-A6CCC84F586F}"
  setpath "product" "win32x64UserAppId" "{{20F79D0D-A9AC-4220-9A81-CE675FFB6B41}"
  setpath "product" "win32arm64UserAppId" "{{2E362F92-14EA-455A-9ABD-3E656BBBFE71}"
  setpath "product" "tunnelApplicationName" "codium-insiders-tunnel"
  setpath "product" "win32TunnelServiceMutex" "vscodiuminsiders-tunnelservice"
  setpath "product" "win32TunnelMutex" "vscodiuminsiders-tunnel"
  setpath "product" "win32ContextMenu.x64.clsid" "90AAD229-85FD-43A3-B82D-8598A88829CF"
  setpath "product" "win32ContextMenu.arm64.clsid" "7544C31C-BDBF-4DDF-B15E-F73A46D6723D"
else
  setpath "product" "nameShort" "VSCodium"
  setpath "product" "nameLong" "VSCodium"
  setpath "product" "applicationName" "codium"
  setpath "product" "linuxIconName" "vscodium"
  setpath "product" "quality" "stable"
  setpath "product" "urlProtocol" "vscodium"
  setpath "product" "serverApplicationName" "codium-server"
  setpath "product" "serverDataFolderName" ".vscodium-server"
  setpath "product" "darwinBundleIdentifier" "com.vscodium"
  setpath "product" "win32AppUserModelId" "VSCodium.VSCodium"
  setpath "product" "win32DirName" "VSCodium"
  setpath "product" "win32MutexName" "vscodium"
  setpath "product" "win32NameVersion" "VSCodium"
  setpath "product" "win32RegValueName" "VSCodium"
  setpath "product" "win32ShellNameShort" "VSCodium"
  setpath "product" "win32AppId" "{{763CBF88-25C6-4B10-952F-326AE657F16B}"
  setpath "product" "win32x64AppId" "{{88DA3577-054F-4CA1-8122-7D820494CFFB}"
  setpath "product" "win32arm64AppId" "{{67DEE444-3D04-4258-B92A-BC1F0FF2CAE4}"
  setpath "product" "win32UserAppId" "{{0FD05EB4-651E-4E78-A062-515204B47A3A}"
  setpath "product" "win32x64UserAppId" "{{2E1F05D1-C245-4562-81EE-28188DB6FD17}"
  setpath "product" "win32arm64UserAppId" "{{57FD70A5-1B8D-4875-9F40-C5553F094828}"
  setpath "product" "tunnelApplicationName" "codium-tunnel"
  setpath "product" "win32TunnelServiceMutex" "vscodium-tunnelservice"
  setpath "product" "win32TunnelMutex" "vscodium-tunnel"
  setpath "product" "win32ContextMenu.x64.clsid" "D910D5E6-B277-4F4A-BDC5-759A34EEE25D"
  setpath "product" "win32ContextMenu.arm64.clsid" "4852FC55-4A84-4EA1-9C86-D53BE3DF83C0"
fi

setpath_json "product" "tunnelApplicationConfig" '{}'

# {{{ bundled AI extensions
# VSCodium's 00-build-download-extensions-from-gh.patch removes marketplace fetching from
# builtInExtensions entirely, so each entry needs either a local vsix or a real GitHub release
# asset. Neither Anthropic.claude-code nor openai.chatgpt publish a vsix via GitHub Releases
# (only via Open VSX), and both ship a separate vsix per target platform rather than one
# universal build. For the platforms we actually ship (macOS, Windows) the vsix are committed
# in ../ai-hub-extensions/ via Git LFS, so those builds don't depend on Open VSX being
# reachable/unthrottled. Other platforms still fetch live since we don't commit vsix for them.
mkdir -p .build/ai-hub-extensions

sha256_file() {
  node -e "const c=require('crypto').createHash('sha256'); require('fs').createReadStream(process.argv[1]).on('data',d=>c.update(d)).on('end',()=>console.log(c.digest('hex')))" "$1"
}

download_with_retries() {
  local url="$1" dest="$2" label="$3" temp="${2}.part.$$"
  rm -f "${temp}"

  for i in {1..5}; do
    if curl --silent --fail --location "${url}" -o "${temp}"; then
      mv "${temp}" "${dest}"
      return 0
    fi

    rm -f "${temp}"
    if [[ $i == 5 ]]; then
      echo "Failed to download ${label} after 5 attempts" >&2
      exit 1
    fi
    echo "Download of ${label} failed, attempt $i, retrying..."
    sleep $(( 10 * (i + 1) ))
  done
}

resolve_open_vsx_extension() {
  local publisher="$1" name="$2" version="$3" target="$4" dest="$5" sha256Var="$6" localFile="${7:-}"
  local fileBase base label cacheVsix="" cacheSha="" expected="" actual="" cacheHit="no"

  if [[ -n "${target}" ]]; then
    fileBase="${publisher}.${name}-${version}@${target}"
    base="https://open-vsx.org/api/${publisher}/${name}/${target}/${version}/file/${fileBase}"
    label="${publisher}.${name}@${version} (${target})"
  else
    fileBase="${publisher}.${name}-${version}"
    base="https://open-vsx.org/api/${publisher}/${name}/${version}/file/${fileBase}"
    label="${publisher}.${name}@${version}"
  fi

  if [[ -n "${localFile}" && -f "${localFile}" ]]; then
    cp "${localFile}" "${dest}"
  else
    if [[ -n "${VSCODE_EXTENSION_CACHE:-}" ]]; then
      mkdir -p "${VSCODE_EXTENSION_CACHE}"
      cacheVsix="${VSCODE_EXTENSION_CACHE}/${fileBase}.vsix"
      cacheSha="${VSCODE_EXTENSION_CACHE}/${fileBase}.sha256"
    fi

    if [[ -f "${cacheVsix}" && -f "${cacheSha}" ]]; then
      expected=$(awk '{print $1}' "${cacheSha}")
      actual=$(sha256_file "${cacheVsix}")
      if [[ -n "${expected}" && "${actual}" == "${expected}" ]]; then
        echo "Using cached extension: ${label}"
        cp "${cacheVsix}" "${dest}"
        cacheHit="yes"
      else
        echo "Discarding invalid cached extension: ${label}" >&2
        rm -f "${cacheVsix}" "${cacheSha}"
        expected=""
      fi
    fi

    if [[ "${cacheHit}" != "yes" ]]; then
      download_with_retries "${base}.vsix" "${dest}" "${label}"
      download_with_retries "${base}.sha256" "${dest}.sha256" "${label} checksum"
      expected=$(awk '{print $1}' "${dest}.sha256")
      rm -f "${dest}.sha256"
      actual=$(sha256_file "${dest}")

      if [[ -z "${expected}" || "${actual}" != "${expected}" ]]; then
        echo "Checksum mismatch for ${label}: expected ${expected:-<empty>}, got ${actual}" >&2
        exit 1
      fi

      if [[ -n "${cacheVsix}" ]]; then
        cp "${dest}" "${cacheVsix}"
        printf '%s\n' "${expected}" > "${cacheSha}"
      fi
    fi
  fi

  actual=$(sha256_file "${dest}")
  if [[ -n "${expected}" && "${actual}" != "${expected}" ]]; then
    echo "Checksum mismatch for ${label}: expected ${expected}, got ${actual}" >&2
    exit 1
  fi
  printf -v "${sha256Var}" '%s' "${actual}"
}

# claude-code has no real glibc Linux build on Open VSX, only musl (alpine) --
# it's statically linked so the alpine build runs fine on mainstream distros too.
CLAUDE_VERSION="2.1.205"
case "${OS_NAME}-${VSCODE_ARCH}" in
  osx-arm64) CLAUDE_TARGET="darwin-arm64" ;;
  osx-x64) CLAUDE_TARGET="darwin-x64" ;;
  windows-x64) CLAUDE_TARGET="win32-x64" ;;
  windows-arm64) CLAUDE_TARGET="win32-arm64" ;;
  linux-x64) CLAUDE_TARGET="alpine-x64" ;;
  linux-arm64) CLAUDE_TARGET="alpine-arm64" ;;
  *) echo "No known Anthropic.claude-code Open VSX build for platform ${OS_NAME}-${VSCODE_ARCH}" >&2; exit 1 ;;
esac
resolve_open_vsx_extension "anthropic" "claude-code" "${CLAUDE_VERSION}" "${CLAUDE_TARGET}" ".build/ai-hub-extensions/claude-code.vsix" CLAUDE_SHA256 "../ai-hub-extensions/claude-code-${CLAUDE_VERSION}-${CLAUDE_TARGET}.vsix"

CODEX_VERSION="26.5623.141536"
case "${OS_NAME}-${VSCODE_ARCH}" in
  osx-arm64) CODEX_TARGET="darwin-arm64" ;;
  osx-x64) CODEX_TARGET="darwin-x64" ;;
  windows-x64) CODEX_TARGET="win32-x64" ;;
  windows-arm64) CODEX_TARGET="win32-arm64" ;;
  linux-x64) CODEX_TARGET="linux-x64" ;;
  linux-arm64) CODEX_TARGET="linux-arm64" ;;
  *) echo "No known openai.chatgpt Open VSX build for platform ${OS_NAME}-${VSCODE_ARCH}" >&2; exit 1 ;;
esac
resolve_open_vsx_extension "openai" "chatgpt" "${CODEX_VERSION}" "${CODEX_TARGET}" ".build/ai-hub-extensions/codex.vsix" CODEX_SHA256 "../ai-hub-extensions/chatgpt-${CODEX_VERSION}-${CODEX_TARGET}.vsix"

# Chinese (Simplified) language pack and SSH ship one universal VSIX.
ZH_HANS_VERSION="1.128.0"
resolve_open_vsx_extension "MS-CEINTL" "vscode-language-pack-zh-hans" "${ZH_HANS_VERSION}" "" ".build/ai-hub-extensions/zh-hans.vsix" ZH_HANS_SHA256

OPEN_REMOTE_SSH_VERSION="0.2.0"
resolve_open_vsx_extension "jeanp413" "open-remote-ssh" "${OPEN_REMOTE_SSH_VERSION}" "" ".build/ai-hub-extensions/open-remote-ssh.vsix" OPEN_REMOTE_SSH_SHA256
# }}}

jsonTmp=$( jq -s '.[0] * .[1]' product.json ../product.json )
echo "${jsonTmp}" > product.json && unset jsonTmp

# jq's deep-merge (`*`) replaces arrays wholesale rather than concatenating them, so
# builtInExtensions can't live in ../product.json without wiping upstream's own entries
# (e.g. ms-vscode.js-debug-companion). Append our AI extensions here instead. Both
# entries are built dynamically since their checksum varies per target platform.
claudeExtJson=$( jq -n --arg version "${CLAUDE_VERSION}" --arg sha256 "${CLAUDE_SHA256}" '{
  name: "Anthropic.claude-code",
  version: $version,
  sha256: $sha256,
  repo: "https://github.com/anthropics/claude-code",
  vsix: ".build/ai-hub-extensions/claude-code.vsix",
  metadata: {
    id: "20aa0d0e-e336-4cb8-b6d0-73831ba9d165",
    publisherId: { publisherId: "anthropic", publisherName: "Anthropic", displayName: "Anthropic", flags: "none" },
    publisherDisplayName: "Anthropic"
  }
}' )
codexExtJson=$( jq -n --arg version "${CODEX_VERSION}" --arg sha256 "${CODEX_SHA256}" '{
  name: "openai.chatgpt",
  version: $version,
  sha256: $sha256,
  repo: "https://github.com/openai/codex",
  vsix: ".build/ai-hub-extensions/codex.vsix",
  metadata: {
    id: "7bf0412a-41da-431c-bc29-5b548b414efc",
    publisherId: { publisherId: "openai", publisherName: "openai", displayName: "OpenAI", flags: "none" },
    publisherDisplayName: "OpenAI"
  }
}' )
zhHansExtJson=$( jq -n --arg version "${ZH_HANS_VERSION}" --arg sha256 "${ZH_HANS_SHA256}" '{
  name: "MS-CEINTL.vscode-language-pack-zh-hans",
  version: $version,
  sha256: $sha256,
  repo: "https://github.com/microsoft/vscode-loc",
  vsix: ".build/ai-hub-extensions/zh-hans.vsix",
  metadata: {
    id: "152fbf73-6e0f-4169-8c47-f14c32181cd1",
    publisherId: { publisherId: "ms-ceintl", publisherName: "MS-CEINTL", displayName: "Microsoft", flags: "none" },
    publisherDisplayName: "Microsoft"
  }
}' )
openRemoteSshExtJson=$( jq -n --arg version "${OPEN_REMOTE_SSH_VERSION}" --arg sha256 "${OPEN_REMOTE_SSH_SHA256}" '{
  name: "jeanp413.open-remote-ssh",
  version: $version,
  sha256: $sha256,
  repo: "https://github.com/jeanp413/open-remote-ssh",
  vsix: ".build/ai-hub-extensions/open-remote-ssh.vsix",
  metadata: {
    id: "9fc16cea-08a5-41ab-b499-801c0be12ab3",
    publisherId: { publisherId: "82e59f8d-e645-42f6-8b18-25ea83942fb8", publisherName: "jeanp413", displayName: "jeanp413", flags: "none" },
    publisherDisplayName: "jeanp413"
  }
}' )
jsonTmp=$( jq --argjson exts "$( cat ../ai-builtin-extensions.json )" --argjson claudeExt "${claudeExtJson}" --argjson codexExt "${codexExtJson}" --argjson zhHansExt "${zhHansExtJson}" --argjson openRemoteSshExt "${openRemoteSshExtJson}" \
  '.builtInExtensions += $exts + [$claudeExt, $codexExt, $zhHansExt, $openRemoteSshExt]
  | .builtInExtensionsEnabledWithAutoUpdates += [$claudeExt.name, $codexExt.name]' product.json )
echo "${jsonTmp}" > product.json && unset jsonTmp

cat product.json
# }}}

# include common functions
. ../utils.sh

# {{{ apply patches

echo "APP_NAME=\"${APP_NAME}\""
echo "APP_NAME_LC=\"${APP_NAME_LC}\""
echo "ASSETS_REPOSITORY=\"${ASSETS_REPOSITORY}\""
echo "BINARY_NAME=\"${BINARY_NAME}\""
echo "GH_REPO_PATH=\"${GH_REPO_PATH}\""
echo "GLOBAL_DIRNAME=\"${GLOBAL_DIRNAME}\""
echo "ORG_NAME=\"${ORG_NAME}\""
echo "TUNNEL_APP_NAME=\"${TUNNEL_APP_NAME}\""

if [[ "${DISABLE_UPDATE}" == "yes" ]]; then
  mv ../patches/00-update-disable.patch.yet ../patches/00-update-disable.patch
fi

for file in ../patches/*.json; do
  if [[ -f "${file}" ]]; then
    apply_actions "${file}"
  fi
done

for file in ../patches/*.patch; do
  if [[ -f "${file}" ]]; then
    apply_patch "${file}"
  fi
done

if [[ "${VSCODE_QUALITY}" == "insider" ]]; then
  for file in ../patches/insider/*.patch; do
    if [[ -f "${file}" ]]; then
      apply_patch "${file}"
    fi
  done
fi

if [[ -d "../patches/${OS_NAME}/" ]]; then
  for file in "../patches/${OS_NAME}/"*.patch; do
    if [[ -f "${file}" ]]; then
      apply_patch "${file}"
    fi
  done
fi

for file in ../patches/user/*.patch; do
  if [[ -f "${file}" ]]; then
    apply_patch "${file}"
  fi
done
# }}}

set -x

# {{{ install dependencies
export ELECTRON_SKIP_BINARY_DOWNLOAD=1
export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

if [[ "${OS_NAME}" == "linux" ]]; then
  export VSCODE_SKIP_NODE_VERSION_CHECK=1

   if [[ "${npm_config_arch}" == "arm" ]]; then
    export npm_config_arm_version=7
  fi
elif [[ "${OS_NAME}" == "windows" ]]; then
  if [[ "${npm_config_arch}" == "arm" ]]; then
    export npm_config_arm_version=7
  fi
else
  if [[ "${CI_BUILD}" != "no" ]]; then
    clang++ --version
  fi
fi

node build/npm/preinstall.ts

mv .npmrc .npmrc.bak
cp ../npmrc .npmrc

for i in {1..5}; do # try 5 times
  if [[ "${CI_BUILD}" != "no" && "${OS_NAME}" == "osx" ]]; then
    CXX=clang++ npm ci && break
  else
    npm ci && break
  fi

  if [[ $i == 5 ]]; then
    echo "Npm install failed too many times" >&2
    exit 1
  fi
  echo "Npm install failed $i, trying again..."

  sleep $(( 15 * (i + 1)))
done

mv .npmrc.bak .npmrc
# }}}

# package.json
cp package.json{,.bak}

setpath "package" "version" "${RELEASE_VERSION%-insider}"

replace 's|Microsoft Corporation|VSCodium|' package.json

cp resources/server/manifest.json{,.bak}

if [[ "${VSCODE_QUALITY}" == "insider" ]]; then
  setpath "resources/server/manifest" "name" "VSCodium - Insiders"
  setpath "resources/server/manifest" "short_name" "VSCodium - Insiders"
else
  setpath "resources/server/manifest" "name" "VSCodium"
  setpath "resources/server/manifest" "short_name" "VSCodium"
fi

# announcements
replace "s|\\[\\/\\* BUILTIN_ANNOUNCEMENTS \\*\\/\\]|$( tr -d '\n' < ../announcements-builtin.json )|" src/vs/workbench/contrib/welcomeGettingStarted/browser/gettingStarted.ts

../undo_telemetry.sh

replace 's|Microsoft Corporation|VSCodium|' build/lib/electron.ts
replace 's|([0-9]) Microsoft|\1 VSCodium|' build/lib/electron.ts

if [[ "${OS_NAME}" == "linux" ]]; then
  # microsoft adds their apt repo to sources
  # unless the app name is code-oss
  # as we are renaming the application to vscodium
  # we need to edit a line in the post install template
  if [[ "${VSCODE_QUALITY}" == "insider" ]]; then
    sed -i "s/code-oss/codium-insiders/" resources/linux/debian/postinst.template
  else
    sed -i "s/code-oss/codium/" resources/linux/debian/postinst.template
  fi

  # fix the packages metadata
  # code.appdata.xml
  sed -i 's|Visual Studio Code|VSCodium|g' resources/linux/code.appdata.xml
  sed -i 's|https://code.visualstudio.com/docs/setup/linux|https://github.com/VSCodium/vscodium#download-install|' resources/linux/code.appdata.xml
  sed -i 's|https://code.visualstudio.com/home/home-screenshot-linux-lg.png|https://vscodium.com/img/vscodium.png|' resources/linux/code.appdata.xml
  sed -i 's|https://code.visualstudio.com|https://vscodium.com|' resources/linux/code.appdata.xml

  # control.template
  sed -i 's|Microsoft Corporation <vscode-linux@microsoft.com>|VSCodium Team https://github.com/VSCodium/vscodium/graphs/contributors|'  resources/linux/debian/control.template
  sed -i 's|Visual Studio Code|VSCodium|g' resources/linux/debian/control.template
  sed -i 's|https://code.visualstudio.com/docs/setup/linux|https://github.com/VSCodium/vscodium#download-install|' resources/linux/debian/control.template
  sed -i 's|https://code.visualstudio.com|https://vscodium.com|' resources/linux/debian/control.template

  # code.spec.template
  sed -i 's|Microsoft Corporation|VSCodium Team|' resources/linux/rpm/code.spec.template
  sed -i 's|Visual Studio Code Team <vscode-linux@microsoft.com>|VSCodium Team https://github.com/VSCodium/vscodium/graphs/contributors|' resources/linux/rpm/code.spec.template
  sed -i 's|Visual Studio Code|VSCodium|' resources/linux/rpm/code.spec.template
  sed -i 's|https://code.visualstudio.com/docs/setup/linux|https://github.com/VSCodium/vscodium#download-install|' resources/linux/rpm/code.spec.template
  sed -i 's|https://code.visualstudio.com|https://vscodium.com|' resources/linux/rpm/code.spec.template

  # snapcraft.yaml
  sed -i 's|Visual Studio Code|VSCodium|' resources/linux/rpm/code.spec.template
elif [[ "${OS_NAME}" == "windows" ]]; then
  # code.iss
  sed -i 's|https://code.visualstudio.com|https://vscodium.com|' build/win32/code.iss
  sed -i 's|Microsoft Corporation|VSCodium|' build/win32/code.iss
fi

cd ..
