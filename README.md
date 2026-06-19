# i-Repo GEMBA OS — 配布（Releases & Docs）

このリポジトリは **i-Repo GEMBA OS の配布物と公開ドキュメント専用**です。**ソースコードは別の
（非公開）リポジトリ**にあり、ここには CI が生成したインストーラと、利用者向けの説明書だけを置きます。

- **ダウンロード / 説明書**: https://i-repo-community.github.io/i-repo-gemba-os-releases/
- **最新リリース**: https://github.com/i-repo-community/i-repo-gemba-os-releases/releases/latest

## 中身

- `index.md` … 導入ページ（GitHub Pages のトップ）
- `docs/` … 利用者向け説明書（ユーザーマニュアル・プラグイン使い方集）
- `install.ps1` / `install.sh` … 上級者向け 1 行インストーラ
- Releases … 署名済みインストーラ（Windows `.exe`/`.msi`・macOS `.dmg`）。CI が自動 publish。

> 中身の更新（インストーラ・説明書）はソース側 CI が自動で行います。ここを直接編集する運用は最小限に。
