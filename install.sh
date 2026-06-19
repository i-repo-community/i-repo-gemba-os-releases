#!/usr/bin/env bash
# i-Repo GEMBA OS — macOS ワンライン インストーラ（上級者向け）
#
#   curl -fsSL https://i-repo-community.github.io/i-repo-gemba-os-releases/install.sh | bash
#
# 最新リリースから macOS 版（universal .dmg）を取得し、checksums.txt があれば SHA256 を
# 検証してから開く。GUI 派は導入ページの「ダウンロード」ボタンでOK。
set -euo pipefail

repo="i-repo-community/i-repo-gemba-os-releases"
api="https://api.github.com/repos/$repo/releases/latest"

if [ "$(uname -s)" != "Darwin" ]; then
  echo "このスクリプトは macOS 向けです（Windows は install.ps1、Linux 版は未提供）。" >&2
  exit 1
fi

echo "i-Repo GEMBA OS: 最新リリースを確認中..."
json="$(curl -fsSL -H 'User-Agent: irepo-install' "$api")"

# universal .dmg の download URL を取り出す（jq 非依存）。
url="$(printf '%s' "$json" | grep -o '"browser_download_url":[[:space:]]*"[^"]*universal\.dmg"' | head -1 | sed -E 's/.*"(https[^"]*)".*/\1/')"
[ -n "$url" ] || { echo "macOS インストーラ(.dmg)が見つかりません" >&2; exit 1; }

name="$(basename "$url")"
dest="${TMPDIR:-/tmp}/$name"
echo "ダウンロード: $name"
curl -fsSL -H 'User-Agent: irepo-install' -o "$dest" "$url"

# checksums.txt があれば SHA256 検証。
sums_url="$(printf '%s' "$json" | grep -o '"browser_download_url":[[:space:]]*"[^"]*checksums\.txt"' | head -1 | sed -E 's/.*"(https[^"]*)".*/\1/')"
if [ -n "$sums_url" ]; then
  want="$(curl -fsSL "$sums_url" | grep -F "$name" | head -1 | awk '{print tolower($1)}')"
  got="$(shasum -a 256 "$dest" | awk '{print tolower($1)}')"
  if [ -n "$want" ] && [ "$want" != "$got" ]; then
    rm -f "$dest"; echo "SHA256 不一致（改ざんの可能性）" >&2; exit 1
  fi
  [ -n "$want" ] && echo "SHA256 OK" || echo "（checksums.txt に該当行なし・検証スキップ）"
else
  echo "（checksums.txt 未公開・SHA 検証スキップ）"
fi

echo "開きます: $dest（表示された .dmg のアプリを Applications へドラッグ）"
open "$dest"
