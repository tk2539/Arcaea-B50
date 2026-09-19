// 手持ちの記録 (Arcaea Online のベスト枠書き起こし + リザルトスクショの正解データ) を
// アプリで読み込めるバックアップ JSON にする。
// usage: npm run -s backup -- ../data/backup.json
import { readFileSync, writeFileSync } from "node:fs";
import type { Chart } from "../src/core/charts";
import { playPotential, scoreFactor, type Clear } from "../src/core/potential";
import type { Backup, NewPlay } from "../src/core/store";
import { DATA, loadCharts, loadGt } from "./node-env";

const CLEAR: Record<string, Clear> = { C: "TC", F: "FR", P: "PM", L: "TL" };
const charts = loadCharts();
const norm = (s: string) => s.normalize("NFKC").toLowerCase().replace(/ /g, "");

function csv(path: string): Record<string, string>[] {
  const [head, ...lines] = readFileSync(path, "utf8").trim().split(/\r?\n/);
  const keys = head.split(",");
  return lines.map((l) => Object.fromEntries(l.split(",").map((v, i) => [keys[i], v])));
}

/** ベスト枠画像の (途中で切れた) 曲名とレベル表記から、逆算した定数に最も近い譜面を探す */
function findChart(title: string, level: string, implied: number): Chart {
  const cands = charts.filter((c) => norm(c.title).startsWith(norm(title)) && c.level === level);
  if (!cands.length) throw new Error(`譜面が見つからない: ${title} ${level}`);
  return cands.sort((a, b) => Math.abs(a.constant - implied) - Math.abs(b.constant - implied))[0];
}

const plays: NewPlay[] = [];
for (const meta of csv(`${DATA}/records/index.csv`)) {
  for (const r of csv(`${DATA}/records/${meta.file}`)) {
    const score = Number(r.score), clear = CLEAR[r.clear];
    const base = meta.version === "v6" ? scoreFactor(score) : playPotential(0, score, clear);
    const chart = findChart(r.title, r.level, Number(r.potential) - base);
    plays.push({ chartId: chart.id, score, clear, pure: null, far: null, lost: null,
      playedAt: `${meta.file.slice(0, 10)}T00:00:00`, source: "arcaea_online", imageHash: null });
  }
}
for (const r of loadGt()) {
  const chart = charts.find((c) => c.title === r.title && c.difficulty === r.difficulty)!;
  const m = r.file.match(/(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/)!;
  const at = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
  plays.push({ chartId: chart.id, score: Number(r.score), clear: r.clear as Clear,
    pure: Number(r.pure), far: Number(r.far), lost: Number(r.lost), playedAt: at, source: "screenshot", imageHash: null });
  if (Number(r.high_score) > 0) {
    plays.push({ chartId: chart.id, score: Number(r.high_score), clear: null, pure: null, far: null, lost: null,
      playedAt: at, source: "high_score", imageHash: null });
  }
}

const out = process.argv[2] ?? `${DATA}/backup.json`;
const backup: Backup = { app: "arcaea-b50", version: 1, exportedAt: new Date().toISOString(), plays };
writeFileSync(out, JSON.stringify(backup));
console.log(`${plays.length} plays -> ${out}`);
