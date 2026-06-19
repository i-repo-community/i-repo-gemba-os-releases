# i-repo-hello 使い方

> Hello World example — shows forwarded args and IREPO_* environment
> （version 0.1.0 / 全OS）

動作確認・学習用のサンプルプラグイン。受け取った引数と `IREPO_*` 環境変数をそのまま表示します。
**プラグインの仕組みを理解する/環境変数が正しく渡っているか確認する**のに使います。

## CLI での使い方

```bash
# 引数と環境変数の受け渡しを確認
i-repo hello --foo bar --flag

# i-repoが渡す IREPO_* 環境変数（エンドポイント等）を確認
IREPO_ENDPOINT=https://example.com i-repo hello
```

## 何の役に立つか

- **新しいプラグインを書く前の雛形**: 引数のパース、`IREPO_*` の受け取り方、終了コードの返し方を最小構成で確認できる。
- **Connector からの呼び出し確認**: GUIアプリから子プロセスへ `PATH` や認証情報が正しく渡っているかの切り分けに使える。
- **契約の最小実装の例**: `--plugin-schema` を持たない最小プラグインがどう振る舞うか（GUIでは詳細表示が限定的になる）。

## プラグインを自作するときの出発点

このプラグインを `~/.i-repo/plugins/i-repo-<名前>` にコピーして改造するのが最短です。
配信プラグインにするなら、最低限：

1. `--plugin-schema` で自己記述（params・input・platforms）を返す
2. `--plugin-healthcheck` で依存・認証の充足を返す（`ok` / `checks[]`）
3. `--plugin-verify` で契約適合を返す
4. 本処理は **write → verify → receipt** の3段。`verified:true/false` を receipt に含める
5. stdin から NDJSON を受けるなら `input: ["stdin-ndjson"]` を宣言

詳しくは [mongo](i-repo-mongo.md) / [sqlite](i-repo-sqlite.md) の実装が参考になります
（npm依存ゼロ・標準機能のみで書かれています）。
