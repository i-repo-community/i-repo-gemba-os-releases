# i-repo-elastic 使い方

> Index NDJSON records into Elasticsearch（日本語全文検索・中間一致・ファセット集計の写し）
> （version 0.1.0 / phases: write, verify / input: stdin-ndjson / mac・Linux・Windows）

manifest の NDJSON を **Elasticsearch に index** する配信プラグイン。
i-Repo DataPipe の「Search Manager」にあたります。MongoDB が**正本**（更新・整合性・S3突合）を
担うのに対し、Elasticsearch は**検索の写し** —— 転置インデックスによる全文検索・スコアリング・
ファセット集計を担います。Node 内蔵 fetch で REST API を直接叩くため **npm 依存ゼロ・外部CLI不要**です。

## ドキュメント構造

`_id` は冪等キー（`idempotencyKey`、なければ `report:<itemId>:rev<revNo>`）。
同じ `_id` への index は**全置換**なので、再実行しても重複しません（実機で確認済み）。

インデックスは初回書き込み時にプラグインが自動作成します。このとき
**`date_detection: false` / `numeric_detection: false`** を設定します——クラスター値には
`"2026/06/10"` のような日付風テキストと普通の文字列が混在するため、ES の動的マッピングに
型推論を任せると `mapper cannot be changed from type [text] to [date]` で index error になります
（実際に踏んだ罠です）。

## Docker での試し方（実機検証済みの手順）

```bash
# 1. Elasticsearch を起動（開発用・セキュリティOFF・メモリ512MB）
docker run -d --name irepo-es-test -p 9200:9200 \
  -e discovery.type=single-node \
  -e xpack.security.enabled=false \
  -e ES_JAVA_OPTS="-Xms512m -Xmx512m" \
  docker.elastic.co/elasticsearch/elasticsearch:8.15.0

# 2. 起動確認（status が yellow/green になるまで数十秒待つ）
curl -s http://localhost:9200/_cluster/health | jq .status

# 3. manifest を配信
cat <archive>/manifests/reports.ndjson \
  | i-repo elastic --url http://localhost:9200 --index irepo-reports
# → receipt 2行（write → verify）。verified:true なら配信成功

# 後片付け
docker rm -f irepo-es-test
```

## Connector（GUI）での使い方

1. 接続先テンプレート → 新規 → プラグイン **elastic** を選択
2. フォームに入力
   - **Elasticsearch URL**（必須）: `http://localhost:9200`
   - **インデックス名**（既定 `irepo-reports`）
   - 認証が必要なら **APIキー** または **Basic認証ユーザー/パスワード**（どちらか）
3. 保存 → フローの配信先として選択（archiveの`--with-detail`をONにすると全文検索の価値が出る）

## パラメータ

| パラメータ | 型 | 必須 | 説明 |
|---|---|:--:|---|
| `--url` | string | ✓ | Elasticsearch ベースURL |
| `--index` | string | | インデックス名（既定: `irepo-reports`、初回書き込みで作成） |
| `--api-key` | string(秘匿) | | `Authorization: ApiKey <key>`（Elastic Cloud等） |
| `--user` / `--password` | string | | Basic認証（`--api-key`と排他） |
| `--dry-run` | bool | | 書き込まず検証のみ |

---

## Elasticsearchならではの検索クエリ集（実データで検証済み）

### ① 全文検索（match）— 転置インデックス・スコア付き
```bash
curl -s http://localhost:9200/irepo-reports/_search -H 'Content-Type: application/json' -d '{
  "query": { "match": { "detail.clusters.value": "通路" } }
}'
# → itemId=609 score=1.96。analyzer が日本語をトークン分割して照合。
#   Mongo の $regex と違い「インデックスに乗った」検索なので件数が増えても速い
```

### ② 中間一致（wildcard on keyword）
```bash
curl -s http://localhost:9200/irepo-reports/_search -H 'Content-Type: application/json' -d '{
  "query": { "wildcard": { "detail.clusters.value.keyword": "*Vv*" } }
}'
```

### ③ ファセット集計（terms aggregation）— ダッシュボードの定番
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

標準 analyzer でも CJK は動きますが、形態素解析するなら kuromoji を入れて
インデックスをマッピング付きで自分で作ってからプラグインで流し込みます：

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

## MongoDB との使い分け（実測の感触）

| 観点 | MongoDB（正本） | Elasticsearch（写し） |
|---|---|---|
| 中間一致 | `$regex` = フルスキャン | wildcard/match = インデックス。**大規模で圧勝** |
| 日本語全文検索 | 苦手 | kuromoji で形態素・同義語・スコアリング |
| 更新・整合性 | upsert・原子的更新 | 準リアルタイム（refresh 後に見える） |
| 役割 | S3突合・クリーンアップの根拠 | 検索・ダッシュボード |

**推奨構成**: フローを2本（または配信先を2つ）にして、**同じ manifest を Mongo と Elastic の両方へ**流す。
冪等キーが共通（`report:<itemId>:rev<revNo>`）なので、Elastic でヒット → Mongo で正本参照 → `artifacts[].objectKey` で S3 の実体PDFへ、と辿れます。

## トラブルシューティング

- **`mapper cannot be changed from type [text] to [date]`** → 旧バージョンのプラグインや手動作成インデックスで日付推論が有効。`curl -X DELETE .../irepo-reports` で作り直すか、本プラグインに任せる（date_detection:false で自動作成）。
- **verified:false** → ES が起動しきっていない（cluster health を確認）か、認証エラー。stderr の HTTP ステータスを確認。
- **Elastic Cloud に繋ぐ** → `--url https://<deployment>.es.cloud.es.io` ＋ `--api-key`。
