---
title: 初回セットアップ
parent: ユーザーマニュアル
nav_order: 1
---

# 初回セットアップ

1. アプリを起動します。
2. 初回は **設定** 画面が自動で開きます。
3. **i-Reporter の接続先（API エンドポイント）**・**ユーザーID**・**パスワード** を入力して保存します。
4. 同梱のプラグイン（送り先ごとの部品）をインストールします。
   - Windows: `powershell -ExecutionPolicy Bypass -File .\plugins\install.ps1`
   - macOS / Linux: `./plugins/install.sh`
5. 画面左下の状態表示で **`i-repo CLI` が緑** になっていれば準備完了です。

> プラグインは「送り先の種類」ごとの部品です。使う送り先のプラグインだけ入っていれば動きます（[プラグイン](screen-plugins.html)画面で状態を確認できます）。
