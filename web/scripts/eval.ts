// 正解データで解析精度を評価する (数字テンプレートは leave-one-out)。Python 版 core/parse.py と同じ指標。
// usage: npm run eval
import { DigitReader, type DigitField, FIELDS } from "../src/core/digits";
import { ResultParser } from "../src/core/parse";
import { DATA, digitsText, loadCharts, loadGt, loadImage, nodeOcr } from "./node-env";

const gt = loadGt();
const imgs = new Map(gt.map((r) => [r.file, loadImage(`${DATA}/results_raw/${r.file}`)]));
const reader = new DigitReader();
for (const r of gt) {
  for (const key of Object.keys(FIELDS) as DigitField[]) {
    if (r[key] && Number(r[key]) > 0) reader.add(imgs.get(r.file)!, key, digitsText(key, r[key]), r.file);
  }
}

const { ocr, close } = nodeOcr();
const parser = new ResultParser(reader, loadCharts(), ocr);
const stats = { chart: 0, score: 0, counts: 0, clear: 0, all: 0, confident: 0, confidentWrong: 0 };
const t0 = performance.now();
for (const r of gt) {
  const res = await parser.parse(imgs.get(r.file)!, r.file);
  const ok = {
    chart: res.chart?.title === r.title && res.chart?.difficulty === r.difficulty,
    score: res.score === Number(r.score),
    counts: res.pure === Number(r.pure) && res.far === Number(r.far) && res.lost === Number(r.lost),
    clear: res.clear === r.clear,
  };
  for (const [k, v] of Object.entries(ok)) stats[k as keyof typeof ok] += Number(v);
  const all = Object.values(ok).every(Boolean);
  stats.all += Number(all);
  stats.confident += Number(res.confident);
  stats.confidentWrong += Number(res.confident && !all);
  if (!all || !res.confident) {
    console.log(`${all ? "OK" : "NG"} ${res.confident ? "確定" : "要確認"} ${r.file.slice(20, 44)} ` +
      `want=${r.title}/${r.difficulty}/${r.score}/${r.clear} got=${res.chart?.title}/${res.score}/${res.clear} ` +
      `counts=${res.pure},${res.far},${res.lost} raw=${JSON.stringify(res.raw)} ` +
      `cands=${res.candidates.slice(0, 3).map((c) => `${c.chart.title}:${c.score.toFixed(0)}`).join(" ")}`);
  }
}
await close();
const n = gt.length;
console.log(`\n譜面 ${stats.chart}/${n}  スコア ${stats.score}/${n}  判定数 ${stats.counts}/${n}  ` +
  `クリア ${stats.clear}/${n}  全項目 ${stats.all}/${n}`);
console.log(`自動確定 ${stats.confident}/${n} (うち誤り ${stats.confidentWrong})  ${((performance.now() - t0) / n).toFixed(0)}ms/枚`);
