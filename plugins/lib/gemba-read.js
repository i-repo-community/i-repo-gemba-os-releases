// gemba-read.js — query（読み返し・gemba-read/1.0）の共有エンジン
//
// ADC-1 契約 §3 の「全ストア共通」部分を一本化する: 出力 envelope（row/query-end/error）、
// 時刻3形式のパースと格納形式への正規化（§3.5 字句比較禁止）、不透明 keyset カーソル、
// 共通フラグの解析、正準名プロジェクション。
//
// 各プラグイン（i-repo-sqlite / mongo / elastic / parquet）はストア固有部分
// （接続・フィルタ構築・読み取り実行・record 復元・dest 記述子）だけを持つ。
//
// 配置: リポジトリ plugins/lib/ が正本。installer が ~/.i-repo/plugins/lib/ へ配布する
// （プラグイン本体からは require("./lib/gemba-read.js") の相対参照で、リポジトリ内・
//  インストール先のどちらでも同じパスで解決される）。
// 依存: なし（node 内蔵のみ）。CommonJS。
"use strict";

const CONTRACT = "gemba-read/1.0";

/** プラグイン名を束ねた読み返しキットを作る。 */
function createReadKit(PLUGIN) {
  const qEmit = (obj) => process.stdout.write(JSON.stringify(obj) + "\n");

  /** query-end トレーラ（§3.3）。0件でも必ず最終行として出すこと。 */
  const queryEnd = (o) =>
    qEmit({ schemaVersion: "1.0", recordType: "query-end", contract: CONTRACT, plugin: PLUGIN, ...o });

  /** row / row-raw 行（§3.3）。 */
  const emitRow = (key, loadedAt, record, raw = false) =>
    qEmit({ schemaVersion: "1.0", recordType: raw ? "row-raw" : "row", contract: CONTRACT,
      plugin: PLUGIN, key, loadedAt, record });

  /** aggregate-row 行（gemba-adc/1.2 §aggregate）。dimensions{}＝group_by の値、measures{}＝集計値（数値）。 */
  const emitAggRow = (dimensions, measures) =>
    qEmit({ schemaVersion: "1.0", recordType: "aggregate-row", contract: CONTRACT,
      plugin: PLUGIN, dimensions, measures });

  /** error envelope を stderr に1行出して exit（§3.3/§3.8）。stdout は汚さない。 */
  const queryError = (code, message, hint, exitCode, dest) => {
    const e = { schemaVersion: "1.0", recordType: "error", contract: CONTRACT, plugin: PLUGIN, code, message };
    if (hint) e.hint = hint;
    if (dest) e.dest = dest;
    e.retryable = code === "E_CONNECT";
    console.error(JSON.stringify(e));
    process.exit(exitCode);
  };

  return { qEmit, queryEnd, emitRow, emitAggRow, queryError };
}

// ── 時刻（§2.6/§3.5）────────────────────────────────────────────────
// 受理3形式: ISO8601（T/Z/offset 含む）/ "YYYY-MM-DD HH:MM:SS" / "YYYY/MM/DD HH:mm:ss"。
// tz 表記の無いものはローカル時刻として解釈する。字句比較は禁止 — 必ずこれでパースし、
// 対象フィールドの「格納形式」（ISO or slash ローカル）へ正規化してから比較すること。
function parseFlexibleDate(s) {
  if (!s) return null;
  s = String(s).trim();
  if (/[TZ]/.test(s) || /[+]\d\d:?\d\d$/.test(s)) {
    const d = new Date(s); return isNaN(d.getTime()) ? null : d;
  }
  const m = s.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!m) { const d = new Date(s); return isNaN(d.getTime()) ? null : d; }
  return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
}

/** ローカル "YYYY/MM/DD HH:mm:ss"（業務時刻 registTime/updateTime の格納形式）。 */
function toLocalSlash(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// ── keyset カーソル（§3.6）。消費側には不透明な base64 文字列。 ──────────
function encodeCursor(key) {
  return Buffer.from(JSON.stringify({ k: key }), "utf8").toString("base64");
}
function decodeCursor(c) {
  try {
    const o = JSON.parse(Buffer.from(String(c), "base64").toString("utf8"));
    return typeof o.k === "string" ? o.k : null;
  } catch { return null; }
}

// ── 正準名プロジェクション（--fields itemId,name,updateTime,detail.clusters）──
// 受理する書式は2つ:
//   1) 封筒パス（ドット区切り）       例 values.name / detail.clusters → そのまま辿る
//   2) 正準名（単一セグメント）       例 name / updateTime
// 正準名は封筒トップに無ければ業務値の入れ子 values.<name> へ自動解決する
// （AGENTS.md §3「正準名のプロジェクション」と実装を一致させる）。出力は封筒形を保つ。
function pickFields(record, paths) {
  const out = {};
  for (const rawPath of paths) {
    // 単一セグメントの正準名で、トップに無く values 配下に在るものは values.<name> へ寄せる。
    const path =
      !rawPath.includes(".") &&
      !(record && typeof record === "object" && rawPath in record) &&
      record && typeof record.values === "object" && record.values && rawPath in record.values
        ? `values.${rawPath}`
        : rawPath;
    const parts = path.split(".");
    let src = record, ok = true;
    for (const k of parts) {
      if (src && typeof src === "object" && k in src) src = src[k];
      else { ok = false; break; }
    }
    if (!ok) continue;
    let dst = out;
    for (let i = 0; i < parts.length - 1; i++) { dst[parts[i]] = dst[parts[i]] || {}; dst = dst[parts[i]]; }
    dst[parts[parts.length - 1]] = src;
  }
  return out;
}

// ── 共通フラグ解析（§3.1 の閉集合）──────────────────────────────────
// connSpec: 接続フラグの宣言 { "--db": "db", "--table": "table", ... }（フラグ → opts キー。
// すべて値を取る文字列フラグ）。共通フラグはここで一括処理し、未知フラグは E_ARGS。
// 戻り値 opts: { since, until, timeField, deleted, ids, itemIds, fields, limit, cursor,
//               countOnly, raw, endpointFp, <connSpec の各キー> }
// extraFlags: プラグインが capability で名乗る追加の選択フラグ（脱料理の拡張点・fail-open）。
//   { "--q": { key: "q" }, "--cluster": { key: "clusters", repeatable: true } } の形。
//   宣言したプラグインだけがそのフラグを受理する。未宣言プラグインでは閉集合のまま＝未知フラグは E_ARGS。
//   新しい検索意味（全文・クラスタ値等）は「取得の選択」に閉じ、集計/自由クエリは足さない（read-only 境界）。
function parseQueryArgs(qargs, connSpec, queryError, extraFlags = {}) {
  const opts = {
    since: null, until: null, timeField: "loaded", deleted: null,
    ids: null, itemIds: [], fields: null, limit: 100, cursor: null,
    countOnly: false, raw: false, endpointFp: null,
  };
  for (const k of Object.values(connSpec)) opts[k] = opts[k] ?? "";
  for (const spec of Object.values(extraFlags)) {
    if (spec.repeatable) opts[spec.key] = opts[spec.key] ?? [];
    else if (opts[spec.key] === undefined) opts[spec.key] = null;
  }

  for (let i = 0; i < qargs.length; i++) {
    const a = qargs[i];
    if (Object.prototype.hasOwnProperty.call(connSpec, a)) { opts[connSpec[a]] = qargs[++i] ?? ""; continue; }
    if (Object.prototype.hasOwnProperty.call(extraFlags, a)) {
      const spec = extraFlags[a];
      const v = qargs[++i] ?? "";
      if (spec.repeatable) opts[spec.key].push(v); else opts[spec.key] = v;
      continue;
    }
    switch (a) {
      case "--since": opts.since = qargs[++i] ?? null; break;
      case "--until": opts.until = qargs[++i] ?? null; break;
      case "--time-field": opts.timeField = qargs[++i] ?? "loaded"; break;
      case "--deleted": opts.deleted = (qargs[++i] === "true"); break;
      case "--ids": opts.ids = (qargs[++i] ?? "").split(",").map((s) => s.trim()).filter(Boolean); break;
      case "--item-id": opts.itemIds.push(qargs[++i] ?? ""); break;
      case "--fields": opts.fields = (qargs[++i] ?? "").split(",").map((s) => s.trim()).filter(Boolean); break;
      // テナント（配信元 i-Reporter エンドポイント）の指紋で厳格に絞る（gemba-adc/1.1）。空文字は未指定扱い。
      // 各 sink は endpoint_fp 列/フィールドと完全一致でフィルタし、未タグ（NULL・列/フィールド無し）は
      // 除外する（＝別テナント・出所不明の混在行を読み返しから外す。仕様 §3.9）。
      case "--endpoint-fp": { const v = (qargs[++i] ?? "").trim(); opts.endpointFp = v || null; break; }
      case "--limit": opts.limit = parseInt(qargs[++i] ?? "100", 10); break;
      case "--cursor": opts.cursor = qargs[++i] ?? null; break;
      case "--count-only": opts.countOnly = true; break;
      case "--raw": opts.raw = true; break;
      default:
        queryError("E_ARGS", `unknown query option: ${a}`, "ADC-1 §3.1 の閉じたフラグ集合のみ", 2);
    }
  }
  if (!["loaded", "updated", "registered"].includes(opts.timeField)) {
    queryError("E_ARGS", `invalid --time-field: ${opts.timeField}`, "loaded|updated|registered", 2);
  }
  if (!Number.isFinite(opts.limit) || opts.limit < 1) opts.limit = 100;
  if (opts.limit > 1000) opts.limit = 1000;
  return opts;
}

/**
 * --since/--until を解釈して「格納形式の比較境界」を返す（§3.5）。
 * storedFormat: "iso"（loaded_at/_loadedAt）| "slash"（registTime/updateTime）。
 * 解釈不能なら E_ARGS で exit。両方 null なら null を返す。
 */
function timeBounds(opts, storedFormat, queryError, dest) {
  if (opts.since == null && opts.until == null) return null;
  const fmt = (d) => (storedFormat === "iso" ? d.toISOString() : toLocalSlash(d));
  const out = {};
  if (opts.since != null) {
    const d = parseFlexibleDate(opts.since);
    if (!d) queryError("E_ARGS", `--since を解釈できません: ${opts.since}`,
      "ISO8601 / YYYY-MM-DD HH:MM:SS / YYYY/MM/DD HH:mm:ss", 2, dest);
    out.gte = fmt(d);
  }
  if (opts.until != null) {
    const d = parseFlexibleDate(opts.until);
    if (!d) queryError("E_ARGS", `--until を解釈できません: ${opts.until}`, null, 2, dest);
    out.lt = fmt(d); // 半開区間 [since, until)
  }
  return out;
}

/**
 * --since/--until が指定されたときに query-end.timeFilter に含めるオブジェクトを返す（§3.5）。
 * TZ 表記なしの入力を UTC（loaded）またはローカル（updated/registered）と解釈した結果を
 * sinceUtc/untilUtc に ISO 8601Z で記録する（監査可能性）。フィルタなしなら null を返す。
 */
function buildTimeFilter(opts) {
  if (opts.since == null && opts.until == null) return null;
  const toUtcIso = (s) => {
    const d = parseFlexibleDate(s);
    return d ? d.toISOString() : null;
  };
  const sinceUtc = opts.since != null ? toUtcIso(opts.since) : null;
  const untilUtc = opts.until != null ? toUtcIso(opts.until) : null;
  if (!sinceUtc && !untilUtc) return null;
  return { field: opts.timeField ?? "loaded", sinceUtc, untilUtc };
}

// ── 構造化集計 aggregate（gemba-adc/1.2）─────────────────────────────
// エージェント面の集計は生方言（native）でなく構造で受ける（audience:["human"] 境界を保つ）。
// フィルタ語彙は query と同一（access.query.filters[]）。次元(group_by)と指標(measure)を追加。
const AGG_GRANULARITIES = ["year", "month", "day", "hour"]; // MVP。quarter/week は将来
const AGG_MEASURE_OPS = ["count", "count_distinct", "sum", "avg"]; // 全て数値。min/max は非数値ゆえ将来

// 時刻バケットの substr 長（"YYYY-MM-DDTHH…" / "YYYY/MM/DD HH…" とも位置が揃う）。
function bucketSubstrLen(granularity) {
  return { year: 4, month: 7, day: 10, hour: 13 }[granularity] || null;
}

// tz 解決（§aggregate・DC 合意）: リクエスト tz を最優先。無ければ field.timezone が
// 「具体」（IANA or "utc"）のときだけ既定採用。記号値（"local"/"unknown"）は未解決＝明示必須（暗黙禁止）。
// システムは Asia/Tokyo 等を勝手に仮定しない（非-JST 顧客の月境界誤算を封じる）。
function resolveBucketTz(requestTz, fieldTimezone, queryError, dest) {
  // 具体 tz（IANA or UTC）だけ受理する。記号値（local/unknown）・空・綴り誤りは未解決/不正として弾く
  // （Intl.DateTimeFormat が無効な timeZone に RangeError を投げるのを利用・ゼロ依存）。
  const concrete = (raw) => {
    const tz = (raw || "").trim();
    if (!tz || tz === "local" || tz === "unknown") return null; // 記号/空＝未解決
    const norm = tz === "utc" ? "UTC" : tz;
    try { new Intl.DateTimeFormat("en-US", { timeZone: norm }); return norm; } catch { return "INVALID"; }
  };
  const rawReq = (requestTz || "").trim();
  if (rawReq) {
    // request で明示したなら具体値でなければ E_ARGS（記号 tz・不正 IANA を素通りさせない・§3.10）。
    const r = concrete(rawReq);
    if (!r || r === "INVALID") {
      queryError("E_ARGS", `date_bucket: tz が不正です: ${rawReq}`,
        "具体 IANA（例 Asia/Tokyo）または UTC を渡す（local/unknown は不可）", 2, dest);
    }
    return r;
  }
  // request 未指定: field.timezone が具体 IANA/UTC のときだけ既定採用（記号値は明示必須）。
  const f = concrete(fieldTimezone);
  if (f && f !== "INVALID") return f;
  queryError("E_ARGS",
    "date_bucket: タイムゾーンを解決できません（field.timezone が記号値のため tz を明示指定してください・例 Asia/Tokyo）",
    "date:<field>:<granularity>:<tz> の tz を具体 IANA で渡す", 2, dest);
}

// --group-by <spec>: "field:<canonical>" | "date:<field>:<granularity>:<tz>"
function parseGroupBySpec(spec, queryError) {
  const s = String(spec || "").trim();
  if (s.startsWith("field:")) {
    const field = s.slice("field:".length).trim();
    if (!field) queryError("E_ARGS", `--group-by field: フィールド名が空です`, "field:<canonical>", 2);
    return { kind: "field", field };
  }
  if (s.startsWith("date:")) {
    const parts = s.slice("date:".length).split(":");
    const [field, granularity, ...tzRest] = parts;
    const tz = tzRest.join(":"); // IANA に ":" は無いが将来のオフセット表記に備え結合
    if (!field || !granularity) queryError("E_ARGS", `--group-by date: 形式は date:<field>:<granularity>:<tz>`, null, 2);
    if (!AGG_GRANULARITIES.includes(granularity))
      queryError("E_ARGS", `--group-by date: 未対応の granularity: ${granularity}`, `対応: ${AGG_GRANULARITIES.join("|")}`, 2);
    return { kind: "date", field, granularity, tz };
  }
  queryError("E_ARGS", `--group-by の形式が不正です: ${s}`, "field:<canonical> または date:<field>:<granularity>:<tz>", 2);
}

// SQL 識別子として安全か（列別名の SQL インジェクション防止＝別名でサブクエリを注入し
// WHERE(テナント絞り)を回避して越境リードする攻撃を封じる）。英字/_ 始まりの英数字・_ のみ許可。
const SAFE_ALIAS = /^[A-Za-z_][A-Za-z0-9_]*$/;

// --measure <spec>: "count" | "count_distinct:<field>[:<alias>]" | "sum:<field>[:<alias>]" | "avg:<field>[:<alias>]"
function parseMeasureSpec(spec, queryError) {
  const s = String(spec || "").trim();
  let m;
  if (s === "count") m = { op: "count", alias: "count" };
  else {
    const [op, field, alias] = s.split(":");
    if (!AGG_MEASURE_OPS.includes(op)) queryError("E_ARGS", `--measure 未対応の op: ${op}`, `対応: ${AGG_MEASURE_OPS.join("|")}`, 2);
    if (op === "count") m = { op: "count", alias: alias || "count" };
    else {
      if (!field) queryError("E_ARGS", `--measure ${op} は field 必須（${op}:<field>[:<alias>]）`, null, 2);
      m = { op, field, alias: alias || `${op}_${field}` };
    }
  }
  // alias は SQL の `AS "<alias>"` に埋まる。安全な識別子だけ許す（field は後段で FIELD_META 照合され
  // 越境しないため、ここで弾くべきは主にエージェント供給の別名）。
  if (!SAFE_ALIAS.test(m.alias)) queryError("E_ARGS", `--measure の alias が不正です: ${m.alias}`, "英数字と _ のみ（先頭は英字/_）", 2);
  return m;
}

// aggregate の引数解析。フィルタ語彙は query と共通（since/until/time-field/deleted/ids/item-id/endpoint-fp）。
// connSpec は接続フラグ（query と同じ）。戻り opts に groupBy[]/measures[]/orderBy/limit を足す。
function parseAggregateArgs(aargs, connSpec, queryError, extraFlags = {}) {
  const opts = {
    since: null, until: null, timeField: "loaded", deleted: null, ids: null, itemIds: [],
    endpointFp: null, groupBy: [], measures: [], orderBy: null, limit: 100, noPiiDimensions: false,
  };
  for (const k of Object.values(connSpec)) opts[k] = opts[k] ?? "";
  for (const spec of Object.values(extraFlags)) {
    if (spec.repeatable) opts[spec.key] = opts[spec.key] ?? [];
    else if (opts[spec.key] === undefined) opts[spec.key] = null;
  }
  for (let i = 0; i < aargs.length; i++) {
    const a = aargs[i];
    if (Object.prototype.hasOwnProperty.call(connSpec, a)) { opts[connSpec[a]] = aargs[++i] ?? ""; continue; }
    if (Object.prototype.hasOwnProperty.call(extraFlags, a)) {
      const spec = extraFlags[a]; const v = aargs[++i] ?? "";
      if (spec.repeatable) opts[spec.key].push(v); else opts[spec.key] = v;
      continue;
    }
    switch (a) {
      case "--group-by": opts.groupBy.push(parseGroupBySpec(aargs[++i] ?? "", queryError)); break;
      case "--measure": opts.measures.push(parseMeasureSpec(aargs[++i] ?? "", queryError)); break;
      case "--order-by": {
        const [by, dir] = (aargs[++i] ?? "").split(":");
        opts.orderBy = { by: by || "", dir: dir === "asc" ? "asc" : "desc" };
        break;
      }
      case "--since": opts.since = aargs[++i] ?? null; break;
      case "--until": opts.until = aargs[++i] ?? null; break;
      case "--time-field": opts.timeField = aargs[++i] ?? "loaded"; break;
      case "--deleted": opts.deleted = (aargs[++i] === "true"); break;
      case "--ids": opts.ids = (aargs[++i] ?? "").split(",").map((s) => s.trim()).filter(Boolean); break;
      case "--item-id": opts.itemIds.push(aargs[++i] ?? ""); break;
      case "--endpoint-fp": { const v = (aargs[++i] ?? "").trim(); opts.endpointFp = v || null; break; }
      case "--limit": opts.limit = parseInt(aargs[++i] ?? "100", 10); break;
      // ブリッジが tenant-scoped セッションで付与する多層 PII ゲート（値なしフラグ）。
      // 立っていれば pii 宣言フィールドを次元(group_by/date_bucket)に使うのを拒否する。
      case "--no-pii-dimensions": opts.noPiiDimensions = true; break;
      default:
        queryError("E_ARGS", `unknown aggregate option: ${a}`, "gemba-adc/1.2 §aggregate の閉じたフラグ集合のみ", 2);
    }
  }
  if (!["loaded", "updated", "registered"].includes(opts.timeField))
    queryError("E_ARGS", `invalid --time-field: ${opts.timeField}`, "loaded|updated|registered", 2);
  if (!opts.groupBy.length) queryError("E_ARGS", "--group-by は1件以上必要です", "field:<canonical> / date:<field>:<granularity>:<tz>", 2);
  if (!opts.measures.length) opts.measures = [{ op: "count", alias: "count" }]; // 既定 count
  if (!Number.isFinite(opts.limit) || opts.limit < 1) opts.limit = 100;
  if (opts.limit > 1000) opts.limit = 1000;
  return opts;
}

module.exports = {
  CONTRACT,
  createReadKit,
  parseFlexibleDate,
  toLocalSlash,
  encodeCursor,
  decodeCursor,
  pickFields,
  parseQueryArgs,
  timeBounds,
  buildTimeFilter,
  AGG_GRANULARITIES,
  AGG_MEASURE_OPS,
  bucketSubstrLen,
  resolveBucketTz,
  parseGroupBySpec,
  parseMeasureSpec,
  parseAggregateArgs,
};
