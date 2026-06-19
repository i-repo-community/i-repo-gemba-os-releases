---
title: ホーム
nav_order: 1
---

# i-Repo GEMBA OS

> 現場データを、顧客が選んだデータ基盤に届け、AI エージェントが読み返せるようにする。

i-Reporter に蓄積された帳票データ・PDF・メタデータを、外部データ基盤（SQLite / Parquet /
MongoDB / Elasticsearch / BigQuery / S3 等）へ**安全・継続的・再利用可能**な形で届ける
デスクトップアプリ（Windows / macOS）。

---

## ダウンロード

[**▶ 最新版をダウンロード**](https://github.com/i-repo-community/i-repo-gemba-os-releases/releases/latest){: .btn .btn-primary .fs-5 }

ダウンロードページで、お使いの OS のインストーラを選んでください。

### Windows

| 種類 | ファイル | 使いどころ |
|---|---|---|
| **推奨（オフライン同梱）** | `..._x64-setup.exe` | ネットが弱い・無い現場でも確実に起動。サイズ大（約 200MB） |
| 軽量版（要ネット） | `..._x64-setup-online.exe` | 初回起動時に WebView2 をオンライン取得。サイズ小（約 3MB） |

> どちらか迷ったら**推奨（オフライン同梱）**でOK。一度入れれば、次回からは**アプリが自動で更新**します。

### macOS

`..._universal.dmg` をダウンロード（Apple Silicon / Intel 両対応）。

---

## 説明書

- [ユーザーマニュアル](docs/ユーザーマニュアル.md)
- [プラグイン使い方集](docs/プラグイン使い方集/)

---

## 上級者向け：コマンドでインストール

GUI を使わずコマンドで入れたい場合（IT 管理者・開発者向け）:

```powershell
# Windows (PowerShell)
irm https://i-repo-community.github.io/i-repo-gemba-os-releases/install.ps1 | iex
```

```bash
# macOS / Linux
curl -fsSL https://i-repo-community.github.io/i-repo-gemba-os-releases/install.sh | bash
```

> スクリプトは最新リリースのインストーラを取得し、SHA256 を検証してから実行します。中身はこのリポジトリの
> `install.ps1` / `install.sh` で確認できます。
