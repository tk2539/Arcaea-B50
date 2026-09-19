// ポテンシャル計算 (v7)。Arcaea Online のベスト枠画像 18 枚で全枠一致を確認済み (../scripts/verify.py)。
//   単曲 = 定数 + スコア係数 + 0.2 (TRACK LOST 以外)
//   総合 = (2 × 上位10 + 11〜50位) / 60 を小数第3位で切り捨て

export type Clear = "TL" | "TC" | "FR" | "PM";

export const B50_TOP = 10;
export const B50_SIZE = 50;

export function scoreFactor(score: number): number {
  if (score >= 10_000_000) return 2.0;
  if (score >= 9_800_000) return 1.0 + (score - 9_800_000) / 200_000;
  return Math.max((score - 9_500_000) / 300_000, 0); // 下限0は未検証
}

export function playPotential(constant: number, score: number, clear: Clear | null): number {
  return constant + scoreFactor(score) + (clear === "TL" ? 0 : 0.2);
}

export function totalPotential(playPotentials: number[]): number {
  const p = [...playPotentials].sort((a, b) => b - a).slice(0, B50_SIZE);
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const raw = (2 * sum(p.slice(0, B50_TOP)) + sum(p.slice(B50_TOP))) / (B50_SIZE + B50_TOP);
  return Math.floor(raw * 1000 + 1e-9) / 1000;
}
