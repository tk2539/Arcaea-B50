// リザルト画面の数字 (スコア・判定数) を読む。
// フォントが固定なので、二値化 → 連結成分で1文字ずつ切り出し → 20x30 に正規化 →
// 正解データから作った数字テンプレートと最近傍比較する。

import { close3, components, grayCrop, otsu, resizeArea, type Rgba, sub, threshold } from "./image";
import { REGIONS } from "./regions";

export const GLYPH_W = 20;
export const GLYPH_H = 30;

export type Font = "score" | "count";
export type DigitField = "score" | "high_score" | "pure" | "far" | "lost";

// フィールドごとの (フォント, 二値化しきい値)。score 系は Otsu で決める
export const FIELDS: Record<DigitField, [Font, number | null]> = {
  score: ["score", null],
  high_score: ["score", null],
  pure: ["count", 235],
  far: ["count", 235],
  lost: ["count", 235],
};

type Box = [number, number, number, number];

/** フィールド内の数字を左から順に正規化ビットマップで返す */
export function glyphs(img: Rgba, key: DigitField): Float32Array[] {
  const [, thresh] = FIELDS[key];
  const g = grayCrop(img, REGIONS[key]);
  let b = threshold(g, thresh ?? otsu(g));
  if (thresh !== null) b = close3(b); // 白抜き文字は細く途切れやすいので軽くつなぐ

  let boxes: Box[] = components(b).filter((c) => c.area >= 8).map((c) => [c.x, c.y, c.w, c.h]);
  if (!boxes.length) return [];
  let maxH = Math.max(...boxes.map((bx) => bx[3]));
  boxes = boxes.filter((bx) => bx[2] < 3 * maxH); // 帯の縁 (横長) を除外
  maxH = Math.max(0, ...boxes.map((bx) => bx[3]));

  // 高さが足りない成分は、数字の欠け (他の文字の枠内) なら統合、そうでなければ ' やノイズとして捨てる
  const full = boxes.filter((bx) => bx[3] >= 0.6 * maxH).map((bx) => [...bx] as Box);
  for (const [x, y, w, h] of boxes) {
    if (h >= 0.6 * maxH) continue;
    const cx = x + w / 2;
    for (const f of full) {
      if (f[0] <= cx && cx <= f[0] + f[2] && y + h > f[1] && y < f[1] + f[3] + 2) {
        const nx = Math.min(f[0], x), ny = Math.min(f[1], y);
        f[2] = Math.max(f[0] + f[2], x + w) - nx;
        f[3] = Math.max(f[1] + f[3], y + h) - ny;
        f[0] = nx; f[1] = ny;
        break;
      }
    }
  }
  full.sort((a, c) => a[0] - c[0] || a[1] - c[1]);

  // 2文字がくっついた成分は、縦の画素数が最小になる列で分割
  const widths = full.map((f) => f[2]).sort((a, c) => a - c);
  const typical = widths.length ? widths[widths.length >> 1] : 0;
  const merged: Box[] = [];
  for (const [x, y, w, h] of full) {
    if (typical && w > 1.6 * typical && full.length > 1) {
      const lo = Math.floor(w * 0.3), hi = Math.floor(w * 0.7);
      let cut = lo, best = Infinity;
      for (let cx = lo; cx < hi; cx++) {
        let n = 0;
        for (let yy = y; yy < y + h; yy++) if (b.data[yy * b.w + x + cx]) n++;
        if (n < best) { best = n; cut = cx; }
      }
      merged.push([x, y, cut, h], [x + cut, y, w - cut, h]);
    } else {
      merged.push([x, y, w, h]);
    }
  }

  return merged.map(([x, y, w, h]) => {
    // 縦横比を保ったまま枠に収める ("1" が潰れないように)
    const s = Math.min(GLYPH_W / w, GLYPH_H / h);
    const rw = Math.max(1, Math.round(w * s)), rh = Math.max(1, Math.round(h * s));
    const r = resizeArea(sub(b, x, y, w, h), rw, rh);
    const canvas = new Float32Array(GLYPH_W * GLYPH_H);
    const oy = (GLYPH_H - rh) >> 1, ox = (GLYPH_W - rw) >> 1;
    for (let yy = 0; yy < rh; yy++) canvas.set(r.subarray(yy * rw, (yy + 1) * rw), (oy + yy) * GLYPH_W + ox);
    return canvas;
  });
}

export interface Template { digit: string; bitmap: Float32Array; source: string }

function distance(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s / a.length;
}

export class DigitReader {
  templates: Record<Font, Template[]> = { score: [], count: [] };

  /** 正解が分かっている数字を登録 (切り出し数が合わなければ false) */
  add(img: Rgba, key: DigitField, text: string, source = ""): boolean {
    const gs = glyphs(img, key);
    if (gs.length !== text.length) return false;
    const [font] = FIELDS[key];
    gs.forEach((g, i) => this.templates[font].push({ digit: text[i], bitmap: g, source }));
    return true;
  }

  /** 各文字について、数字ごとの最小距離を小さい順に */
  private ranked(img: Rgba, key: DigitField, exclude?: string): [string, number][][] {
    const tpl = this.templates[FIELDS[key][0]].filter((t) => t.source !== exclude || !exclude);
    return glyphs(img, key).map((g) => {
      const best = new Map<string, number>();
      for (const t of tpl) {
        const d = distance(g, t.bitmap);
        if (d < (best.get(t.digit) ?? Infinity)) best.set(t.digit, d);
      }
      return [...best.entries()].sort((a, b) => a[1] - b[1]);
    });
  }

  read(img: Rgba, key: DigitField, exclude?: string): string {
    return this.ranked(img, key, exclude).map((r) => r[0]?.[0] ?? "").join("");
  }

  /** 読み候補を [文字列, コスト] で返す。コスト = 各文字の最良候補からの距離の増分の和 */
  readAlternatives(img: Rgba, key: DigitField, exclude?: string, perGlyph = 5, limit = 60): [string, number][] {
    const options = this.ranked(img, key, exclude).map((r) => {
      const base = r[0][1];
      return r.slice(0, perGlyph).map(([d, dist]) => [d, dist - base] as [string, number]);
    });
    if (!options.length) return [];
    let combos: [string, number][] = [["", 0]];
    for (const opt of options) {
      combos = combos.flatMap(([s, c]) => opt.map(([d, x]) => [s + d, c + x] as [string, number]));
      combos.sort((a, b) => a[1] - b[1]);
      combos = combos.slice(0, limit * 4); // 途中で打ち切っても上位は残る
    }
    return combos.slice(0, limit);
  }

  // テンプレートの保存形式: 0..255 に量子化した bitmap を base64 で
  toJSON() {
    const enc = (t: Template[]) => ({
      digits: t.map((x) => x.digit).join(""),
      bitmaps: b64(Uint8Array.from(t.flatMap((x) => Array.from(x.bitmap, (v) => Math.round(v * 255))))),
    });
    return { w: GLYPH_W, h: GLYPH_H, score: enc(this.templates.score), count: enc(this.templates.count) };
  }

  static fromJSON(j: ReturnType<DigitReader["toJSON"]>): DigitReader {
    const r = new DigitReader();
    for (const font of ["score", "count"] as Font[]) {
      const bytes = unb64(j[font].bitmaps);
      const n = GLYPH_W * GLYPH_H;
      r.templates[font] = [...j[font].digits].map((digit, i) => ({
        digit, source: "",
        bitmap: Float32Array.from(bytes.subarray(i * n, (i + 1) * n), (v) => v / 255),
      }));
    }
    return r;
  }
}

function b64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function unb64(s: string): Uint8Array {
  const bin = atob(s);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
