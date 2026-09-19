// Node で解析を動かすための補助 (JPEG デコード、tesseract.js、正解データ読み込み)
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import jpeg from "jpeg-js";
import { PNG } from "pngjs";
import { createWorker, type Worker } from "tesseract.js";
import type { Chart } from "../src/core/charts";
import type { Gray, Rgba } from "../src/core/image";
import type { Ocr } from "../src/core/text";

export const DATA = resolve(import.meta.dirname, "../../data");

export function loadImage(path: string): Rgba {
  const img = jpeg.decode(readFileSync(path), { useTArray: true, formatAsRGBA: true });
  return { width: img.width, height: img.height, data: img.data };
}

export function loadCharts(): Chart[] {
  return JSON.parse(readFileSync(resolve(import.meta.dirname, "../public/data/charts.json"), "utf8"));
}

export interface GtRow {
  file: string; title: string; difficulty: string; level: string;
  score: string; high_score: string; clear: string; pure: string; far: string; lost: string;
}

export function loadGt(): GtRow[] {
  const rows: GtRow[] = [];
  for (const f of ["labels_a.csv", "labels_b.csv"]) {
    const [head, ...lines] = readFileSync(`${DATA}/results_gt/${f}`, "utf8").trim().split(/\r?\n/);
    const keys = head.split(",");
    for (const l of lines) rows.push(Object.fromEntries(l.split(",").map((v, i) => [keys[i], v])) as any);
  }
  return rows;
}

export function digitsText(key: string, v: string) {
  return key === "score" || key === "high_score" ? String(Number(v)).padStart(8, "0") : String(Number(v));
}

function toPng(g: Gray): Buffer {
  const png = new PNG({ width: g.w, height: g.h });
  for (let i = 0; i < g.data.length; i++) {
    png.data[i * 4] = png.data[i * 4 + 1] = png.data[i * 4 + 2] = g.data[i];
    png.data[i * 4 + 3] = 255;
  }
  return PNG.sync.write(png);
}

/** tesseract.js の worker を設定ごとに1つずつ持つ OCR 関数 */
export function nodeOcr(): { ocr: Ocr; close: () => Promise<void> } {
  const workers = new Map<string, Promise<Worker>>();
  const ocr: Ocr = async (img, { psm, whitelist }) => {
    const key = `${psm}|${whitelist ?? ""}`;
    if (!workers.has(key)) {
      workers.set(key, (async () => {
        const w = await createWorker("eng");
        await w.setParameters({ tessedit_pageseg_mode: String(psm) as any, tessedit_char_whitelist: whitelist ?? "" });
        return w;
      })());
    }
    const w = await workers.get(key)!;
    return (await w.recognize(toPng(img))).data.text;
  };
  return { ocr, close: async () => { for (const w of workers.values()) await (await w).terminate(); } };
}
