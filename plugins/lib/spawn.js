"use strict";
// 全プラグイン共通の spawn ヘルパ（CommonJS・ゼロ依存）。正本: plugins/lib/。
//
// なぜ要るか（Windows）:
//   bq / mongosh / duckdb は .cmd シム（gcloud SDK の bq.cmd・npm 配布の mongosh.cmd 等）で
//   入ることがある。Node は shell 無しでは .cmd/.bat を直接 spawn できない（CVE-2024-27980 後は
//   EINVAL で失敗）。bare 名 spawnSync("bq", …) は「インストール済みでも起動不可／healthcheck 誤判定」
//   になっていた。i-repo-archive の実績ある方式（cmd.exe の argv を明示構築・メタ文字拒否・
//   windowsVerbatimArguments）を切り出して全プラグインで共用する。
//
//   shell:true は使わない: 引数が cmd.exe で未エスケープ連結され、フィルタ値経由のコマンド注入に
//   なるため（`--word "a & calc"` 等）。
//
// 重要な呼び出し側責務:
//   SQL 文・mongosh の JS 本文のように cmd.exe メタ文字を含み得る「本文」は、引数では渡さず
//   stdin（spawnSync の input）で渡すこと。引数に載せると spawnSpec がメタ文字拒否で throw する。
//   各 CLI は本文を stdin から読める: bq query（位置引数省略時）/ mongosh（パイプされた script を実行）/
//   duckdb（-c 省略時に stdin を SQL として実行）。

const { spawnSync } = require("node:child_process");

// cmd.exe が（クォートしても）再解釈してしまう危険なメタ文字。
const CMD_META = /[&|<>^"%!()\r\n]/;

// OS 非依存の spawn 仕様を作る。
// POSIX: argv 配列をそのまま spawn（shell 無し＝エスケープ不要）。
// Windows: .cmd/.exe どちらでも動くよう cmd.exe 経由にし、各トークンをクォートして argv を明示構築。
//          /s は最外周の引用符のみ剥がす。メタ文字を含む引数は拒否する（stdin で渡すこと）。
function spawnSpec(command, args) {
  const argv = args.map((a) => String(a));
  if (process.platform !== "win32") {
    return { bin: command, argv, extra: {} };
  }
  const unsafe = [command, ...argv].find((a) => CMD_META.test(a));
  if (unsafe !== undefined) {
    throw new Error(
      `Refusing to run ${command}: argument contains characters unsafe for cmd.exe: ${unsafe}`,
    );
  }
  const inner = [command, ...argv].map((a) => `"${a}"`).join(" ");
  return {
    bin: process.env.ComSpec || "cmd.exe",
    argv: ["/d", "/s", "/c", `"${inner}"`],
    extra: { windowsVerbatimArguments: true },
  };
}

// spawnSync を spawnSpec 経由で呼ぶ薄いラッパ。options はそのまま spawnSync に渡す
// （encoding / env / input / timeout / killSignal / maxBuffer 等）。戻り値は spawnSync の結果そのまま。
// spawnSpec がメタ文字で throw した場合は、呼び出し側が status/error で扱えるよう擬似結果を返す
// （EINVAL/ENOENT と同じ枠で分岐できる）。
function spawnSyncSpec(command, args, options = {}) {
  let spec;
  try {
    spec = spawnSpec(command, args);
  } catch (error) {
    return { status: null, signal: null, stdout: "", stderr: String(error.message || error), error };
  }
  return spawnSync(spec.bin, spec.argv, { ...options, ...spec.extra });
}

module.exports = { spawnSpec, spawnSyncSpec, CMD_META };
