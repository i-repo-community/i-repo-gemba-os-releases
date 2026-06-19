# i-Repo GEMBA OS — Windows ワンライン インストーラ（上級者向け）
#
#   irm https://i-repo-community.github.io/i-repo-gemba-os-releases/install.ps1 | iex
#
# 最新リリースから「推奨（オフライン同梱）」の Windows インストーラを取得し、
# checksums.txt があれば SHA256 を検証してから起動する。GUI 派は導入ページの
# 「ダウンロード」ボタンでOK（このスクリプトは中身が見える形で公開している）。

$ErrorActionPreference = "Stop"
$repo = "i-repo-community/i-repo-gemba-os-releases"
$ua = @{ "User-Agent" = "irepo-install" }

Write-Host "i-Repo GEMBA OS: 最新リリースを確認中..."
$rel = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/releases/latest" -Headers $ua

# 推奨＝オフライン同梱（-online を除く x64-setup.exe）。軽量版が欲しい場合は導入ページから。
$asset = $rel.assets |
  Where-Object { $_.name -like "*x64-setup.exe" -and $_.name -notlike "*-online*" } |
  Select-Object -First 1
if (-not $asset) { throw "Windows インストーラが見つかりません（リリース: $($rel.tag_name)）" }

$dest = Join-Path $env:TEMP $asset.name
Write-Host "ダウンロード: $($asset.name) ($([math]::Round($asset.size/1MB)) MB)"
Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $dest -Headers $ua

# checksums.txt があれば SHA256 検証（無ければスキップ。配信は HTTPS で取得済み）。
$sums = $rel.assets | Where-Object { $_.name -eq "checksums.txt" } | Select-Object -First 1
if ($sums) {
  $txt = (Invoke-WebRequest -Uri $sums.browser_download_url -Headers $ua).Content
  $line = ($txt -split "`n" | Where-Object { $_ -match [regex]::Escape($asset.name) } | Select-Object -First 1)
  $want = if ($line) { ($line.Trim() -split "\s+")[0].ToLower() } else { $null }
  $got = (Get-FileHash $dest -Algorithm SHA256).Hash.ToLower()
  if ($want -and $got -ne $want) { Remove-Item $dest -Force; throw "SHA256 不一致（改ざんの可能性）" }
  if ($want) { Write-Host "SHA256 OK" } else { Write-Host "（checksums.txt に該当行なし・検証スキップ）" }
} else {
  Write-Host "（checksums.txt 未公開・SHA 検証スキップ）"
}

Write-Host "インストーラを起動します: $dest"
Start-Process -FilePath $dest
