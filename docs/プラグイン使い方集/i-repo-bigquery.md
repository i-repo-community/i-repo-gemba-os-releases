# i-repo-bigquery 使い方（Google BigQuery）

> 帳票データを Google BigQuery に蓄積し、クラウドのデータウェアハウスで分析する（macOS・Windows・Linux 対応）

帳票（項目の入力値）を Google Cloud の **BigQuery** テーブルへロードする送り先プラグインです。
大量データの SQL 集計・BI 連携（Looker Studio 等）・他システムとの共有に向いています。

このプラグインは Google Cloud SDK の **`bq` コマンド**を利用します（`gcloud` に同梱）。認証は
`gcloud auth application-default login`（ADC）か、サービスアカウント鍵（`--key-file`）で行います。

## 前提

- **`bq` CLI**（Google Cloud SDK）が入っていて PATH が通っていること（`bq version` で確認）。
- **認証**（どちらか）:
  - `gcloud auth application-default login` で ADC を設定（手元・対話環境向け）。
  - サービスアカウント JSON 鍵を用意し `--key-file ~/sa.json` を渡す（無人・CI 向け。`GOOGLE_APPLICATION_CREDENTIALS` として `bq` に渡ります）。
- 対象の **GCP プロジェクト**と、BigQuery を使える権限（データセット作成・ロード・クエリ）。

## 取り込まれる列

| 列 | 内容 |
|---|---|
| `idempotency_key` | 帳票を一意に識別するキー |
| `record_type` / `item_id` / `rev_no` / `name` / `deleted` | 帳票のメタ情報 |
| `regist_time` / `update_time` | 登録・更新日時（文字列・ローカル時刻） |
| `raw_json` | レコード全体のJSON（項目の入力値・添付の場所を含む） |
| `loaded_at` | 取り込んだ時刻（UTC） |
| `endpoint_fp` | 配信元 i-Reporter の識別（テナント同一性・旧配信行は NULL） |

## 配信（最短例）

```bash
cat <archive>/manifests/reports.ndjson \
  | i-repo bigquery \
      --project my-gcp-project \
      --dataset irepo \
      --table reports \
      --location asia-northeast1
# → 「送信済みの確認」（verified:true）が出れば成功
```

- `--dataset` / `--table` は無ければ作成を試みます。`--location` はデータセットのロケーション（既定 `US`。日本なら `asia-northeast1` 等）。
- サービスアカウント鍵を使う場合は `--key-file ~/sa.json` を足します。

## アプリ（GUI）での使い方

1. 接続先テンプレート → 新規 → プラグイン **bigquery** を選択
2. **GCP プロジェクト ID・データセット・テーブル**を入力（ロケーションは既定 US。日本なら `asia-northeast1`）。無人運用ならサービスアカウント鍵のパスも
3. 保存 → 一覧の「テスト」で疎通確認 → フローの配信先として選択

## パラメータ

| パラメータ | 型 | 説明 |
|---|---|---|
| `--project` | string | BigQuery を持つ GCP プロジェクト ID |
| `--dataset` | string | データセット名（無ければ作成を試みる） |
| `--table` | string | テーブル名（無ければ load が作成） |
| `--location` | string | データセットのロケーション（既定 `US`。例 `asia-northeast1`） |
| `--key-file` | string | サービスアカウント JSON 鍵のパス（省略時は gcloud ADC） |
| `--dry-run` | bool | 書き込まず入力を検証するだけ |

## 読み返し・集計（読み取り専用）

配信済みデータは書き込みゼロで読み返せます。明細は `query`、集計は `aggregate` です。

```bash
# 明細（期間・itemId で絞り、正準封筒形で取得）
i-repo bigquery query --project my-gcp-project --dataset irepo --table reports \
  --time-field updated --since "2026-06-01 00:00:00" --until "2026-07-01 00:00:00"

# 集計（全行を取り出さず BigQuery 側で GROUP BY・~99倍軽い）
# 例: 月別の件数
i-repo bigquery aggregate --project my-gcp-project --dataset irepo --table reports \
  --group-by date:updateTime:month:Asia/Tokyo --measure count
```

現場AIチャットからの集計質問（「月別の件数」「削除区分別の内訳」「合計・平均」等）も、この `aggregate`
経由で BigQuery に集計させて答えます（構造化集計・`gemba-adc/1.2`）。

## 重複排除（append の宿命・latest-wins で読む）

BigQuery へのロードは**追記（WRITE_APPEND）**です。**同じフローを再実行すると同じ帳票が複数行**になります
（`upsert:false` / `dedupe:latest-wins-by-key`）。読む側で最新だけ取ります：

```sql
-- idempotency_key ごとに最新 loaded_at の行だけ（latest-wins ビュー）
SELECT * FROM `my-gcp-project.irepo.reports`
QUALIFY ROW_NUMBER() OVER (PARTITION BY idempotency_key ORDER BY loaded_at DESC) = 1;
```

冪等性が最優先なら sqlite / mongo（upsert）や parquet（上書き）も選べます。BigQuery は
「大量に貯めて SQL で集計・BI 連携する」用途が本領です。

## トラブルシューティング

- **`bq` が見つからない** → Google Cloud SDK を導入（`gcloud` 同梱）。アプリの「プラグイン」タブでも状態を確認できます。
- **認証エラー（401/403）** → `gcloud auth application-default login` を実行するか、`--key-file` にサービスアカウント鍵を指定。鍵にデータセット/テーブルの権限があるか確認。
- **ロケーション不一致** → 既存データセットと `--location` が食い違うと失敗します。データセットのロケーションに合わせる（US / asia-northeast1 等）。
- **「送信済みの確認」が出ない** → 取り込んだ件数の照合に失敗しています。送り先（カタログ／BigQuery）の片方だけ落ちていないか確認する。

---

## 技術メモ（仕組み）

> ここから先は仕組みを知りたい人向けです。ふだんの利用では読まなくて問題ありません。

### 実装の流儀

実装は `bq` CLI を呼ぶ薄いアダプタです（mongo が mongosh を、parquet が duckdb を呼ぶのと同じ流儀）。npm 依存はありません。

### 入力と出力

入力は前段 archive が作る一覧（データ）の NDJSON（`manifests/reports.ndjson`、1行1帳票）です。
配信が終わると receipt が2行（write → verify）出力され、`verified:true` が「送信済みの確認」にあたります。

### テナント分離（endpoint_fp）

`query` / `aggregate` は `--endpoint-fp` で配信元 i-Reporter に厳格一致で絞れます（未タグ＝旧配信は除外）。
アプリ内エージェント（現場AIチャット）はこの値をサーバ側で権威注入するため、テナント越えの読み取りは起きません。
