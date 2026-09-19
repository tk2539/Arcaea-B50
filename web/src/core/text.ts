// 文字項目 (曲名・難易度・クリア種別) の OCR 前処理。OCR 本体は環境ごとに差し替える
// (ブラウザ: tesseract.js の worker、Node の評価スクリプト: 同じく tesseract.js)。

import { grayCrop, invert, otsu, pad, type Gray, type Rgba, scale, threshold } from "./image";
import { REGIONS, type RegionKey } from "./regions";

export interface OcrOptions { psm: number; whitelist?: string }
export type Ocr = (img: Gray, opts: OcrOptions) => Promise<string>;

const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function prep(img: Rgba, key: RegionKey, invertIt: boolean, f = 2, thresh: number | null = null): Gray {
  let g = grayCrop(img, REGIONS[key]);
  if (f !== 1) g = scale(g, f);
  let b = threshold(g, thresh ?? otsu(g));
  if (invertIt) b = invert(b);
  return pad(b, 16);
}

export async function readTexts(img: Rgba, ocr: Ocr) {
  const [title, difficulty, clear] = await Promise.all([
    // 暗い帯に白文字 → 白文字だけ残して反転
    ocr(prep(img, "title", true, 2, 200), { psm: 7 }),
    // 明るい背景に濃い文字
    ocr(prep(img, "difficulty", false), { psm: 7, whitelist: UPPER }),
    ocr(prep(img, "clear", false, 1), { psm: 7, whitelist: UPPER + " " }),
  ]);
  return { title: title.trim(), difficulty: difficulty.trim(), clear: clear.trim() };
}
