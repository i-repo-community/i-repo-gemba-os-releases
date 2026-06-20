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

  /** error envelope を stderr に1行出して exit（§3.3/§3.8）。stdout は汚さない。 */
  const queryError = (code, message, hint, exitCode, dest) => {
    const e = { schemaVersion: "1.0", recordType: "error", contract: CONTRACT, plugin: PLUGIN, code, message };
    if (hint) e.hint = hint;
    if (dest) e.dest = dest;
    e.retryable = code === "E_CONNECT";
    console.error(JSON.stringify(e));
    process.exit(exitCode);
  };

  return { qEmit, queryEnd, emitRow, queryError };
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
//               countOnly, raw, <connSpec の各キー> }
// extraFlags: プラグインが capability で名乗る追加の選択フラグ（脱料理の拡張点・fail-open）。
//   { "--q": { key: "q" }, "--cluster": { key: "clusters", repeatable: true } } の形。
//   宣言したプラグインだけがそのフラグを受理する。未宣言プラグインでは閉集合のまま＝未知フラグは E_ARGS。
//   新しい検索意味（全文・クラスタ値等）は「取得の選択」に閉じ、集計/自由クエリは足さない（read-only 境界）。
function parseQueryArgs(qargs, connSpec, queryError, extraFlags = {}) {
  const opts = {
    since: null, until: null, timeField: "loaded", deleted: null,
    ids: null, itemIds: [], fields: null, limit: 100, cursor: null,
    countOnly: false, raw: false,
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
};
