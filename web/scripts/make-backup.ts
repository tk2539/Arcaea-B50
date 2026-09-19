// 手持ちの記録 (Arcaea Online のベスト枠書き起こし + リザルトスクショの正解データ) を
// アプリで読み込めるバックアップ JSON にする。
// usage: npm run -s backup -- ../data/backup.json
import { readFileSync, writeFileSync } from "node:fs";
import jpeg from "jpeg-js";
import { PNG } from "pngjs";
import type { Chart } from "../src/core/charts";
import { playPotential, scoreFactor, type Clear } from "../src/core/potential";
import type { Rgba } from "../src/core/image";
import { JACKET } from "../src/core/regions";
import type { Backup, BackupJacket, JacketSource, NewPlay } from "../src/core/store";
import { DATA, loadCharts, loadGt, loadImage } from "./node-env";

// ---- ジャケットの切り出し (自分の画像から。出力ファイルは手元にだけ置く) ----
const JACKET_PX = 256;
const DOWNLOADS = `${DATA}/../discord_dl_bot/downloads`;
// Arcaea Online のベスト枠画像 (B30/B50 とも同じ配置): 1枠目のジャケット位置と枠の間隔
const AO = { x: 183, y: 364, size: 176, dx: 334, dy: 271 };

function loadAny(path: string): Rgba {
  if (!path.endsWith(".png")) return loadImage(path);
  const png = PNG.sync.read(readFileSync(path));
  return { width: png.width, height: png.height, data: png.data };
}

/** 範囲を切り出して JACKET_PX 四方に双線形補間で拡縮し、JPEG の data URL にする */
function jacketDataUrl(img: Rgba, x0: number, y0: number, size: number): string {
  const out = Buffer.alloc(JACKET_PX * JACKET_PX * 4);
  const f = size / JACKET_PX;
  for (let y = 0; y < JACKET_PX; y++) {
    const sy = Math.min(y0 + (y + 0.5) * f - 0.5, img.height - 1), iy = Math.floor(sy), ty = sy - iy;
    for (let x = 0; x < JACKET_PX; x++) {
      const sx = Math.min(x0 + (x + 0.5) * f - 0.5, img.width - 1), ix = Math.floor(sx), tx = sx - ix;
      for (let c = 0; c < 3; c++) {
        const p = (yy: number, xx: number) => img.data[(Math.min(yy, img.height - 1) * img.width + Math.min(xx, img.width - 1)) * 4 + c];
        const v = (p(iy, ix) * (1 - tx) + p(iy, ix + 1) * tx) * (1 - ty) + (p(iy + 1, ix) * (1 - tx) + p(iy + 1, ix + 1) * tx) * ty;
        out[(y * JACKET_PX + x) * 4 + c] = Math.round(v);
      }
      out[(y * JACKET_PX + x) * 4 + 3] = 255;
    }
  }
  const enc = jpeg.encode({ data: out, width: JACKET_PX, height: JACKET_PX }, 85);
  return `data:image/jpeg;base64,${enc.data.toString("base64")}`;
}

const jackets = new Map<string, BackupJacket>();
function putJacket(chartId: string, source: JacketSource, dataUrl: string) {
  // リザルト画面由来を優先。同じ取得元なら新しい画像で上書き
  if (jackets.get(chartId)?.source === "result" && source !== "result") return;
  jackets.set(chartId, { chartId, source, dataUrl });
}

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
  const aoImage = loadAny(`${DOWNLOADS}/${meta.image}`);
  for (const r of csv(`${DATA}/records/${meta.file}`)) {
    const score = Number(r.score), clear = CLEAR[r.clear];
    const base = meta.version === "v6" ? scoreFactor(score) : playPotential(0, score, clear);
    const chart = findChart(r.title, r.level, Number(r.potential) - base);
    plays.push({ chartId: chart.id, score, clear, pure: null, far: null, lost: null,
      playedAt: `${meta.file.slice(0, 10)}T00:00:00`, source: "arcaea_online", imageHash: null });
    const i = Number(r.rank) - 1;
    putJacket(chart.id, "arcaea_online", jacketDataUrl(aoImage, AO.x + AO.dx * (i % 5), AO.y + AO.dy * Math.floor(i / 5), AO.size));
  }
}
for (const r of loadGt()) {
  const chart = charts.find((c) => c.title === r.title && c.difficulty === r.difficulty)!;
  const m = r.file.match(/(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/)!;
  const at = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
  const [jx, jy, js] = JACKET;
  putJacket(chart.id, "result", jacketDataUrl(loadImage(`${DATA}/results_raw/${r.file}`), jx, jy, js));
  plays.push({ chartId: chart.id, score: Number(r.score), clear: r.clear as Clear,
    pure: Number(r.pure), far: Number(r.far), lost: Number(r.lost), playedAt: at, source: "screenshot", imageHash: null });
  if (Number(r.high_score) > 0) {
    plays.push({ chartId: chart.id, score: Number(r.high_score), clear: null, pure: null, far: null, lost: null,
      playedAt: at, source: "high_score", imageHash: null });
  }
}

const out = process.argv[2] ?? `${DATA}/backup.json`;
const backup: Backup = { app: "arcaea-b50", version: 1, exportedAt: new Date().toISOString(), plays, jackets: [...jackets.values()] };
writeFileSync(out, JSON.stringify(backup));
const bySource = [...jackets.values()].reduce((m, j) => ({ ...m, [j.source]: (m[j.source] ?? 0) + 1 }), {} as Record<string, number>);
console.log(`${plays.length} plays, jackets ${JSON.stringify(bySource)} -> ${out}`);
