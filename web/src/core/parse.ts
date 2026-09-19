// リザルト画面のスクショ1枚から、譜面・スコア・判定数・クリア種別を読み取る。
//
// 譜面の特定は曲名 OCR に頼らず、
//   (1) 難易度 (OCR、ほぼ確実)
//   (2) PURE + FAR + LOST = ノーツ数
//   (3) スコア = floor(10M × (PURE + FAR/2) / ノーツ数) + 大PURE数 (0..PURE)
// で候補を絞り、曲名 OCR のあいまい一致と合わせて順位づけする。
// 判定数は読み間違えやすい桁の別候補も試す。LOST が隠れていても ノーツ数 - PURE - FAR で補える。

import { type Chart, DIFFICULTIES } from "./charts";
import type { DigitReader } from "./digits";
import { partialRatio, ratio } from "./fuzz";
import { type Rgba, resizeRgba } from "./image";
import type { Clear } from "./potential";
import { BASE_H, BASE_W } from "./regions";
import { type Ocr, readTexts } from "./text";

export interface ParseResult {
  chart: Chart | null;
  score: number | null;
  highScore: number | null;
  clear: Clear;
  pure: number | null;
  far: number | null;
  lost: number | null;
  confident: boolean; // 自動確定してよいか
  candidates: { chart: Chart; score: number }[]; // 確認用の候補 (上位5)
  raw: { title: string; difficulty: string; clear: string };
}

export function scoreConsistent(score: number, pure: number, far: number, notes: number): boolean {
  const base = Math.floor((10_000_000 * (pure + far / 2)) / notes);
  return score - base >= 0 && score - base <= pure;
}

export class UnsupportedSizeError extends Error {}

/** 同じ比率なら基準サイズに拡縮する。比率が違えば例外 */
export function normalize(img: Rgba): Rgba {
  if (img.width === BASE_W && img.height === BASE_H) return img;
  if (Math.abs(img.width / img.height - BASE_W / BASE_H) > 0.01) {
    throw new UnsupportedSizeError(`${img.width}x${img.height}`);
  }
  return resizeRgba(img, BASE_W, BASE_H);
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

function clearOf(ocr: string, far: number | null, lost: number | null): Clear {
  const o = ocr.toUpperCase().replace(/ /g, "");
  if (o.includes("LOST") || o.startsWith("TRACKL")) return "TL";
  if (lost === 0) return far === 0 ? "PM" : "FR";
  return "TC";
}

export class ResultParser {
  constructor(private reader: DigitReader, private charts: Chart[], private ocr: Ocr) {}

  async parse(input: Rgba, exclude?: string): Promise<ParseResult> {
    const img = normalize(input);
    const raw = await readTexts(img, this.ocr);
    const num = (s: string) => (/^\d+$/.test(s) ? Number(s) : null);
    const score = num(this.reader.read(img, "score", exclude));
    const highScore = num(this.reader.read(img, "high_score", exclude));
    let pure = num(this.reader.read(img, "pure", exclude));
    let far = num(this.reader.read(img, "far", exclude));
    let lost = num(this.reader.read(img, "lost", exclude));

    const diffScored = DIFFICULTIES.map((d) => [d, ratio(capitalize(raw.difficulty), d)] as const)
      .sort((a, b) => b[1] - a[1])[0];
    const diff = diffScored[1] >= 60 ? diffScored[0] : null;
    const cands = this.charts.filter((c) => diff === null || c.difficulty === diff);

    // 判定数の読み候補から、ノーツ数とスコアに矛盾しない組み合わせを探す
    const alts = Object.fromEntries((["pure", "far", "lost"] as const).map((k) => [k,
      this.reader.readAlternatives(img, k, exclude).filter(([t]) => /^\d+$/.test(t)).map(([t, c]) => [Number(t), c] as const),
    ])) as Record<"pure" | "far" | "lost", (readonly [number, number])[]>;
    const fits = new Map<string, { cost: number; pure: number; far: number; lost: number }>();
    if (score !== null) {
      const byNotes = new Map<number, Chart[]>();
      for (const c of cands) if (c.notes) byNotes.set(c.notes, [...(byNotes.get(c.notes) ?? []), c]);
      for (const [p, pc] of alts.pure.slice(0, 30)) {
        for (const [f, fc] of alts.far.slice(0, 30)) {
          for (const [n, charts] of byNotes) {
            if (p + f > n || !scoreConsistent(score, p, f, n)) continue;
            const l = n - p - f;
            const lc = alts.lost.find(([v]) => v === l)?.[1] ?? 1.0; // 読めた候補になければ罰則
            const cost = pc + fc + lc;
            for (const c of charts) {
              const cur = fits.get(c.id);
              if (!cur || cost < cur.cost) fits.set(c.id, { cost, pure: p, far: f, lost: l });
            }
          }
        }
      }
    }

    // 曲名のあいまい一致 (隠れて途中までしか読めない前提で partial も使う) と判定数の無理のなさを合わせる
    const titleScore = (c: Chart) =>
      Math.max(...c.names.map((nm) => Math.max(ratio(raw.title, nm), partialRatio(raw.title, nm) - 5)));
    const total = (c: Chart) => titleScore(c) - (fits.has(c.id) ? 200 * fits.get(c.id)!.cost : 100);
    const pool = fits.size ? cands.filter((c) => fits.has(c.id)) : cands;
    const ranked = pool.map((c) => ({ chart: c, score: total(c) })).sort((a, b) => b.score - a.score);
    const best = ranked[0]?.chart ?? null;
    const margin = ranked.length > 1 ? ranked[0].score - ranked[1].score : 100;

    const fit = best && fits.get(best.id);
    if (fit) ({ pure, far, lost } = fit);
    const confident = !!best && !!fit && titleScore(best) >= 60 && margin >= 15;
    return {
      chart: best, score, highScore, clear: clearOf(raw.clear, far, lost), pure, far, lost,
      confident, candidates: ranked.slice(0, 5), raw,
    };
  }
}
