import type { Rect } from "./image";

// リザルト画面 (2340x1080) の各項目の位置。同じ比率の画面はこのサイズに拡縮してから読む。
export const BASE_W = 2340;
export const BASE_H = 1080;

export const REGIONS = {
  title: [700, 112, 940, 80],
  level: [238, 296, 104, 92],
  difficulty: [350, 300, 150, 42],
  clear: [770, 290, 790, 92],
  score: [930, 418, 480, 100],
  high_score: [1118, 535, 220, 52],
  pure: [1170, 786, 110, 36],
  far: [1170, 842, 110, 36],
  lost: [1170, 898, 110, 36],
  ptt: [1172, 60, 100, 42],
  ptt_delta: [1272, 60, 130, 42],
} satisfies Record<string, Rect>;

// ジャケット (リザルト画面左側の正方形。枠線を避けて少し内側)
export const JACKET: Rect = [262, 407, 553, 553];

export type RegionKey = keyof typeof REGIONS;
