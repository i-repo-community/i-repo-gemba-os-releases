# i-repo-elastic 使い方

> 帳票データを Elasticsearch に写し、日本語の全文検索・中間一致・集計を行う（macOS・Windows・Linux 対応）

帳票データを **Elasticsearch に送る**プラグインです。日本語の全文検索・あいまい検索（中間一致）や、
項目値の集計（ファセット）に向きます。MongoDB が**正本**（更新・整合性・S3 突合）を担うのに対し、
Elasticsearch は**検索の写し** ——
全文検索・スコア付きの並べ替え・集計（ファセット）を担います。外部 CLI は不要で、Elasticsearch へ直接つなぎます。

## できること

- 帳票の項目入力値を **日本語で全文検索**する（文章の一部からヒット）
- **中間一致**（語の途中に含む文字列での検索）
- クラスター値の出現数などの **集計（ダッシュボード向け）**

検索の写しなので、**項目の入力値**（archive の「項目の入力値も含める」を ON）を一緒に流すと価値が出ます。

## アプリ（GUI）での使い方

1. 接続先テンプレート → 新規 → プラグイン **elastic** を選択
2. フォームに入力
   - **Elasticsearch URL**（必須）: `http://localhost:9200`
   - **インデックス名**（既定 `irepo-reports`）
   - 認証が必要なら **APIキー** または **Basic認証ユーザー/パスワード**（どちらか）
3. 保存 → フローの配信先として選択する

> 全文検索の価値を出すには、archive 側の「項目の入力値も含める」を ON にしてください。

## パラメータ

| パラメータ | 型 | 必須 | 説明 |
|---|---|:--:|---|
| `--url` | string | ✓ | Elasticsearch ベースURL |
| `--index` | string | | インデックス名（既定: `irepo-reports`、初回書き込みで作成） |
| `--api-key` | string(秘匿) | | `Authorization: ApiKey <key>`（Elastic Cloud等） |
| `--user` / `--password` | string | | Basic認証（`--api-key`と排他） |
| `--dry-run` | bool | | 書き込まず検証のみ |

## Docker で試す

```bash
# 1. Elasticsearch を起動（開発用・セキュリティOFF・メモリ512MB）
docker run -d --name irepo-es-test -p 9200:9200 \
  -e discovery.type=single-node \
  -e xpack.security.enabled=false \
  -e ES_JAVA_OPTS="-Xms512m -Xmx512m" \
  docker.elastic.co/elasticsearch/elasticsearch:8.15.0

# 2. 起動確認（status が yellow/green になるまで数十秒待つ）
curl -s http://localhost:9200/_cluster/health | jq .status

# 3. データを配信する
cat <archive>/manifests/reports.ndjson \
  | i-repo elastic --url http://localhost:9200 --index irepo-reports
# → 送信済みの確認が出れば配信成功

# 後片付け
docker rm -f irepo-es-test
```

## 検索クエリ集

### ① 全文検索（match）

```bash
curl -s http://localhost:9200/irepo-reports/_search -H 'Content-Type: application/json' -d '{
  "query": { "match": { "detail.clusters.value": "通路" } }
}'
# → 文章を分割して照合し、関連の高い順（スコア順）に返す
```

### ② 中間一致（wildcard on keyword）

```bash
curl -s http://localhost:9200/irepo-reports/_search -H 'Content-Type: application/json' -d '{
  "query": { "wildcard": { "detail.clusters.value.keyword": "*Vv*" } }
}'
```

### ③ 集計（terms aggregation）— ダッシュボードの定番

```bash
curl -s http://localhost:9200/irepo-reports/_search -H 'Content-Type: application/json' -d '{
  "size": 0,
  "aggs": { "vals": { "terms": { "field": "detail.clusters.value.keyword", "size": 5 } } }
}'
# → クラスター値の出現数 top5 が一発で返る
```

### ④ 複合条件（bool）

```bash
curl -s http://localhost:9200/irepo-reports/_search -H 'Content-Type: application/json' -d '{
  "query": { "bool": { "must": [
    { "match": { "detail.clusters.value": "法定指摘" } },
    { "term":  { "deleted": false } }
  ]}}
}'
```

## 日本語検索を本気にするなら（kuromoji）

標準設定でも日本語は検索できますが、より自然な単語区切りで検索したいなら kuromoji を入れて
インデックスを自分で作ってからプラグインで流し込みます。

```bash
# プラグイン入りイメージを使うか: bin/elasticsearch-plugin install analysis-kuromoji
curl -X PUT http://localhost:9200/irepo-reports -H 'Content-Type: application/json' -d '{
  "settings": { "analysis": { "analyzer": { "ja": { "type": "kuromoji" } } } },
  "mappings": {
    "date_detection": false,
    "properties": {
      "detail": { "properties": { "clusters": { "properties": {
        "value": { "type": "text", "analyzer": "ja",
                   "fields": { "keyword": { "type": "keyword" } } }
      }}}}
    }
  }
}'
# プラグインは「既存インデックスがあればそのまま使う」ので、このマッピングが活きる
```

## MongoDB との使い分け

| 観点 | MongoDB（正本） | Elasticsearch（写し） |
|---|---|---|
| 中間一致 | `$regex` = フルスキャン | wildcard/match はインデックスを使うため、件数が増えても速い |
| 日本語全文検索 | 苦手 | kuromoji で単語区切り・同義語・スコアリング |
| 更新・整合性 | upsert・原子的更新 | 反映に少し時間がかかる（更新直後は見えないことがある） |
| 役割 | S3突合・クリーンアップの根拠 | 検索・ダッシュボード |

**推奨構成**: フローを2本（または配信先を2つ）にして、**同じデータを Mongo と Elastic の両方へ**流します。
両者で共通のキーを持つので、Elastic でヒット → Mongo で正本参照 → S3 の実体 PDF へ、と辿れます。

## トラブルシューティング

- **`mapper cannot be changed from type [text] to [date]`** → 旧バージョンのプラグインや手動作成インデックスで日付の自動判定が有効になっている。`curl -X DELETE .../irepo-reports` で作り直すか、本プラグインに任せる（自動作成では日付判定をOFFにします）。
- **送信済みの確認が出ない** → Elasticsearch が起動しきっていない（cluster health を確認）か、認証エラー。stderr の HTTP ステータスを確認する。
- **Elastic Cloud に繋ぐ** → `--url https://<deployment>.es.cloud.es.io` ＋ `--api-key`。

---

## 技術メモ（仕組み）

> ここから先は仕組みを知りたい人向けです。ふだんの利用では読まなくて問題ありません。

このプラグインは、archive が作る一覧（データ）の NDJSON を 1 行ずつ受け取り、Elasticsearch に
index します。Node 内蔵 fetch で REST API を直接叩くため npm 依存ゼロ・外部 CLI 不要です。

### ドキュメントの `_id`（再実行しても重複しない理由）

`_id` は冪等キー（`idempotencyKey`。なければ `report:<itemId>:rev<revNo>`）です。
同じ `_id` への index は全置換（idempotent）なので、同じデータを再実行しても重複しません。

### インデックスの自動作成と動的マッピング

インデックスは初回書き込み時にプラグインが自動作成します。このとき
**`date_detection: false` / `numeric_detection: false`**（動的マッピングの型推論をOFF）を設定します。
クラスター値には `"2026/06/10"` のような日付風テキストと普通の文字列が混在するため、ES の
動的マッピングに型推論を任せると `mapper cannot be changed from type [text] to [date]` で
index error になるためです。

### 配信の流れと成功判定

配信は write → verify の 2 段で進みます。それぞれの結果が実行の控え（receipt）として 2 行出力され、
最後の `verified:true`（送信済みの確認）が配信成功の唯一の判定です。
