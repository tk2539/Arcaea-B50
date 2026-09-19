// バックアップ JSON から B50 を計算して表示 (動作確認用)
import { readFileSync } from "node:fs";
import { b50, type Play } from "../src/core/store";
import { DATA, loadCharts } from "./node-env";
const charts = new Map(loadCharts().map((c) => [c.id, c]));
const plays = JSON.parse(readFileSync(process.argv[2] ?? `${DATA}/backup.json`, "utf8")).plays as Play[];
for (const at of ["2026-09-18T23:59:59", "2026-09-19T07:59:51", "2026-09-19T23:59:59"]) {
  console.log(at, b50(plays, charts, at).total);
}
