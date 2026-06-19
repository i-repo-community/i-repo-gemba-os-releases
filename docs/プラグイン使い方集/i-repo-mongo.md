# i-repo-mongo 使い方

> Upsert NDJSON records into MongoDB（帳票IDキーでネスト構造をドキュメント保持）
> （version 0.1.0 / phases: write, verify / input: stdin-ndjson / mac・Linux・Windows）

manifest の NDJSON を **MongoDB へ upsert** する配信プラグイン。
i-Repo DataPipe for NoSQL の「Storage Manager（構造化データ側）」にあたります。
帳票の入れ子構造（`detail.clusters` 等）を**そのままドキュメントとして保持**するため、
クラスター値の検索・集計が SQL のような正規化なしに行えます。

## ドキュメント構造

`_id` は冪等キー（`idempotencyKey`、なければ `report:<itemId>:rev<revNo>`）。
manifest のレコードを丸ごと展開（`{ ...record, _id, _loadedAt }`）するので、
archive の `--with-detail` で付いた `detail` / `artifacts` もそのまま乗ります。

```json
{
  "_id": "report:609:rev1",
  "itemId": "609", "revNo": "1", "isCurrent": true,
  "values": { ... },
  "artifacts": [ { "type": "pdf", "objectKey": "documents/609___Vvb()-pdf.pdf" } ],
  "detail": { "clusters": [ { "name": "不具合内容", "value": "Vvb" }, ... ] },
  "_loadedAt": "2026-06-12T00:49:49.973Z"
}
```

## Connector（GUI）での使い方

1. 接続先テンプレート → 新規 → プラグイン **mongo** を選択
2. スキーマから自動生成されたフォームに入力
   - **MongoDB接続URI**（必須・秘匿）: `mongodb://localhost:27017`
   - **データベース名**（必須）: `irepo`
   - **コレクション名**（既定 `reports`）
3. 保存 → フロー作成時に配信先として選択（archiveの`--with-detail`をONにすると検索価値が上がる）

## CLI での使い方

配信プラグインは **stdin から NDJSON を受け取る**設計です。archive の manifest を流し込みます。

```bash
# manifest を mongo に upsert
cat ~/irepo-archives/2026-06/manifests/reports.ndjson \
  | i-repo mongo \
      --uri "mongodb://localhost:27017" \
      --db irepo \
      --collection reports

# 書き込まず検証だけ
cat .../reports.ndjson | i-repo mongo --uri ... --db irepo --dry-run
```

## パラメータ

| パラメータ | 型 | 必須 | 説明 |
|---|---|:--:|---|
| `--uri` | string(秘匿) | ✓ | 接続文字列（`mongodb://` または `mongodb+srv://`） |
| `--db` | string | ✓ | データベース名 |
| `--collection` | string | | コレクション名（既定: `reports`、初回書き込みで作成） |
| `--dry-run` | bool | | 書き込まず検証のみ |

---

## MongoDBならではの検索クエリ集（実データで検証済み）

`detail.clusters` は `{name, value, sheetNo, clusterId}` の**配列**。これをネストのまま検索します。

### ① 中間一致（部分一致）— `$elemMatch` + 正規表現
```js
// 「不具合内容」クラスターの値に "Vv" を含む帳票（中間一致・大小無視）
db.reports.find({
  "detail.clusters": { $elemMatch: { name: "不具合内容", value: /Vv/i } }
})
```
> **`$elemMatch` が肝**: 配列なので「同じ1要素の中で name と value が両方一致」を保証する。
> これがないと「nameがAの要素」と「valueがBの別要素」でも誤ヒットする。

### ② 横断中間一致 — クラスター名を問わず
```js
// どのクラスターでもいいので値に "通路" を含む帳票
db.reports.find({ "detail.clusters.value": /通路/ })
```

### ③ 複合AND — 複数クラスター条件
```js
// 指摘区分=法定指摘 かつ 現象=その他
db.reports.find({ $and: [
  { "detail.clusters": { $elemMatch: { name: "指摘区分", value: "法定指摘" } } },
  { "detail.clusters": { $elemMatch: { name: "現象",     value: "その他" } } }
]})
```

### ④ 集計 — 指摘区分ごとの件数（BIダッシュボード用ファセット）
```js
db.reports.aggregate([
  { $unwind: "$detail.clusters" },
  { $match:  { "detail.clusters.name": "指摘区分" } },
  { $group:  { _id: "$detail.clusters.value", 件数: { $sum: 1 } } },
  { $sort:   { 件数: -1 } }
])
```

### ⑤ NoSQL → S3 リンク（DataPipe構想の核）
```js
db.reports.findOne({ _id: "report:609:rev1" }, { artifacts: 1 })
// → [{type:"pdf", objectKey:"documents/609___Vvb()-pdf.pdf"}, ...]
// 構造化データはMongo、実体PDFはS3。objectKeyで突合
```

### ⑥ 値が入っているクラスターだけ投影（`$filter`）
```js
db.reports.aggregate([
  { $match: { _id: "report:609:rev1" } },
  { $project: { _id: 0, 入力値: {
      $filter: { input: "$detail.clusters", as: "c",
        cond: { $and: [ { $ne: ["$$c.value", "Image"] }, { $ne: ["$$c.value", ""] } ] } }
  }}}
])
```

## 高速化（中間一致を速くする）

`/Vv/` のような**中間一致は通常インデックスが効かない**（前方一致 `/^Vv/` なら効く）。

```js
// テキストインデックス（語単位の全文検索）
db.reports.createIndex({ "detail.clusters.value": "text" })
db.reports.find({ $text: { $search: "通路 外構" } })

// name で絞ってから regex（スキャン対象を減らす）
db.reports.createIndex({ "detail.clusters.name": 1 })
```

## Elasticsearch との違い

| 観点 | MongoDB | Elasticsearch |
|---|---|---|
| 中間一致 | `$regex` で書けるがフルスキャン。件数が増えると遅い | 転置インデックスで桁違いに速い。本領 |
| 日本語あいまい | ほぼ完全一致 or regex。表記ゆれは苦手 | 形態素解析・同義語・スコアリングが標準 |
| 更新/整合性 | upsert・原子的更新が得意（**正本向き**） | 準リアルタイム。**検索の写し向き** |
| 集計 | `aggregate` で十分実用的 | ファセットがさらに高速・柔軟 |
| 運用 | 1プロセスで軽い | クラスタ前提で重い |

**目安**: 数十〜数千件なら Mongo で中間一致も集計も問題なし。数十万件＋日本語あいまい全文検索が要件になったら Elastic が圧勝。
理想は **Mongo=正本（更新・S3突合）／Elastic=検索の写し** の両刀。

## トラブルシューティング

- **detailが無い** → archive側の`--with-detail`が必要。mongoは渡されたものを捨てない。
- **`mongosh`が見つからない（GUI起動時）** → `brew install mongosh`。Connectorはログインシェルの`PATH`を継承する。
- **`verified:false`** → 書き戻し件数が一致しない。stdinが途中で切れていないか、receiptのcountを確認。
