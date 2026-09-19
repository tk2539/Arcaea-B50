// ベスト枠画像の描画 (Canvas)。レイアウトは Arcaea Online のベスト枠画像 (1800px 幅・5列) に寄せるが、
// ロゴ・キャラクター・背景・ジャケットなど公式の素材は一切使わない。ジャケットの位置には自作のパネルを描く。

import { type Chart, DIFF_ABBR, type Difficulty } from "../core/charts";
import { B50_TOP } from "../core/potential";
import type { Best } from "../core/store";

const W = 1800;
const HEADER_H = 350;
const ROW_H = 272;
const FOOTER_H = 90;
const COLS = 5;
const CELL_W = 316;
const CELL_H = 236;
const GRID_X = (W - (COLS * CELL_W + (COLS - 1) * 22)) / 2;
const PANEL = 180; // ジャケット位置のパネル (正方形)

const NUM_FONT = `"Exo 2", "Segoe UI", system-ui, sans-serif`;
const TEXT_FONT = `"Exo 2", "Hiragino Sans", "Noto Sans JP", "Yu Gothic", system-ui, sans-serif`;

const DIFF_COLOR: Record<Difficulty, [string, string]> = {
  Past: ["#3f9fdc", "#1f5c8a"],
  Present: ["#83bd4c", "#3f6e22"],
  Future: ["#9a68d8", "#4d2a80"],
  Beyond: ["#e04a63", "#7a1a2c"],
  Eternal: ["#c0b2e6", "#5d5680"], // FTR と区別できるよう淡い灰紫
};
const CLEAR_STYLE: Record<string, { label: string; fill: string; text: string }> = {
  PM: { label: "P", fill: "#1d2f5c", text: "#bfe6ff" },
  FR: { label: "F", fill: "#5c1d4d", text: "#ffc4ec" },
  TC: { label: "C", fill: "#3a2360", text: "#ffffff" },
  TL: { label: "L", fill: "#333", text: "#bbb" },
};

export interface ImageOptions { playerName: string; total: number; top: Best[]; date: Date }

export function grade(score: number): string {
  if (score >= 9_900_000) return "EX+";
  if (score >= 9_800_000) return "EX";
  if (score >= 9_500_000) return "AA";
  if (score >= 9_200_000) return "A";
  if (score >= 8_900_000) return "B";
  if (score >= 8_600_000) return "C";
  return "D";
}

const fmtScore = (s: number) => String(s).padStart(8, "0").replace(/\B(?=(\d{3})+$)/g, "'");

/** 描画に使うフォントを読み込んでおく (読み込み前に描くと代替フォントになるため) */
export async function loadFonts() {
  if (!document.querySelector("link[data-b50-font]")) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=Exo+2:ital,wght@0,400;0,600;0,700;1,700&display=swap";
    link.dataset.b50Font = "";
    document.head.append(link);
    await new Promise((ok) => { link.onload = ok; link.onerror = ok; });
  }
  await Promise.all(["400", "600", "700", "italic 700"].map((w) => document.fonts.load(`${w} 40px "Exo 2"`).catch(() => {})));
}

export function renderB50(opts: ImageOptions): HTMLCanvasElement {
  const rows = Math.max(1, Math.ceil(opts.top.length / COLS));
  const H = HEADER_H + rows * ROW_H + FOOTER_H;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;

  drawBackground(ctx, H);
  drawHeader(ctx, opts);
  opts.top.forEach((b, i) => {
    const col = i % COLS, row = Math.floor(i / COLS);
    drawCell(ctx, GRID_X + col * (CELL_W + 22), HEADER_H + row * ROW_H, i + 1, b);
  });
  // 上位10 (2倍計上) と11位以降の境目
  if (opts.top.length > B50_TOP) {
    const y = HEADER_H + 2 * ROW_H - 18;
    ctx.strokeStyle = "rgba(255, 214, 120, 0.35)";
    ctx.lineWidth = 2;
    ctx.setLineDash([10, 8]);
    line(ctx, GRID_X, y, W - GRID_X, y);
    ctx.setLineDash([]);
  }
  drawFooter(ctx, H);
  return canvas;
}

// ---- 部品 ----
function line(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function diamond(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(cx, cy - r);
  ctx.lineTo(cx + r, cy);
  ctx.lineTo(cx, cy + r);
  ctx.lineTo(cx - r, cy);
  ctx.closePath();
}

function hexagon(ctx: CanvasRenderingContext2D, cx: number, cy: number, w: number, h: number) {
  ctx.beginPath();
  ctx.moveTo(cx - w / 2, cy);
  ctx.lineTo(cx - w / 2 + h / 2, cy - h / 2);
  ctx.lineTo(cx + w / 2 - h / 2, cy - h / 2);
  ctx.lineTo(cx + w / 2, cy);
  ctx.lineTo(cx + w / 2 - h / 2, cy + h / 2);
  ctx.lineTo(cx - w / 2 + h / 2, cy + h / 2);
  ctx.closePath();
}

/** 幅に収まるよう末尾を省略 */
function fitText(ctx: CanvasRenderingContext2D, text: string, maxW: number) {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + "…").width > maxW) t = t.slice(0, -1);
  return t + "…";
}

function shadowText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, blur = 6) {
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.85)";
  ctx.shadowBlur = blur;
  ctx.shadowOffsetY = 2;
  ctx.fillText(text, x, y);
  ctx.restore();
}

function drawBackground(ctx: CanvasRenderingContext2D, H: number) {
  const g = ctx.createLinearGradient(0, 0, W * 0.4, H);
  g.addColorStop(0, "#241c3d");
  g.addColorStop(0.5, "#1a1530");
  g.addColorStop(1, "#120f22");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // 薄い斜線と光のにじみ (自作の装飾)
  ctx.save();
  ctx.globalAlpha = 0.06;
  ctx.strokeStyle = "#c9b6ff";
  ctx.lineWidth = 2;
  for (let x = -H; x < W; x += 90) line(ctx, x, 0, x + H * 0.6, H);
  ctx.restore();
  for (const [x, y, r, c] of [[W * 0.85, 120, 700, "rgba(160,110,255,0.18)"], [W * 0.1, H * 0.6, 900, "rgba(90,140,255,0.08)"]] as const) {
    const rg = ctx.createRadialGradient(x, y, 0, x, y, r);
    rg.addColorStop(0, c);
    rg.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = rg;
    ctx.fillRect(0, 0, W, H);
  }
}

function potentialColor(p: number): [string, string] {
  if (p >= 13) return ["#ffd86b", "#b34fd6"];
  if (p >= 12) return ["#d06bff", "#6a2a9a"];
  if (p >= 11) return ["#ff6b7f", "#8a1f36"];
  if (p >= 10) return ["#d9546a", "#6a1a2a"];
  if (p >= 7) return ["#a773e0", "#4b2c7a"];
  if (p >= 3.5) return ["#5cc27a", "#245a36"];
  return ["#5aa7e0", "#23527a"];
}

function drawHeader(ctx: CanvasRenderingContext2D, { playerName, total, date }: ImageOptions) {
  // 見出し (ロゴの代わりに文字だけ)
  ctx.fillStyle = "#ffffff";
  ctx.font = `italic 700 92px ${NUM_FONT}`;
  ctx.textBaseline = "alphabetic";
  shadowText(ctx, "BEST 50", GRID_X, 150, 12);
  ctx.fillStyle = "rgba(255,255,255,0.6)";
  ctx.font = `600 26px ${NUM_FONT}`;
  ctx.fillText("TOP 10 COUNTED TWICE  ·  (2 × TOP10 + 11–50) / 60", GRID_X + 4, 196);

  // プレイヤー名の帯
  const bx = 560, by = 216, bw = 680, bh = 84;
  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.beginPath();
  ctx.moveTo(bx + 40, by);
  ctx.lineTo(bx + bw, by);
  ctx.lineTo(bx + bw - 40, by + bh);
  ctx.lineTo(bx, by + bh);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = "#2a2140";
  ctx.font = `600 48px ${TEXT_FONT}`;
  ctx.textAlign = "center";
  ctx.fillText(fitText(ctx, playerName || "PLAYER", bw - 220), bx + bw / 2 - 60, by + 60);

  // ポテンシャルのひし形
  const [c1, c2] = potentialColor(total);
  const cx = bx + bw - 60, cy = by + bh / 2, r = 86;
  const g = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
  g.addColorStop(0, c1);
  g.addColorStop(1, c2);
  ctx.fillStyle = g;
  diamond(ctx, cx, cy, r);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.lineWidth = 5;
  ctx.stroke();
  ctx.fillStyle = "#fff";
  ctx.font = `700 46px ${NUM_FONT}`;
  shadowText(ctx, total.toFixed(3), cx, cy + 16, 8);
  ctx.textAlign = "left";

  // 日付
  ctx.textAlign = "right";
  ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.font = `600 28px ${NUM_FONT}`;
  ctx.fillText("Generated on:", W - GRID_X, 110);
  ctx.fillStyle = "#fff";
  ctx.font = `700 50px ${NUM_FONT}`;
  const d = `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}`;
  ctx.fillText(d, W - GRID_X, 164);
  ctx.textAlign = "left";
}

function drawPanel(ctx: CanvasRenderingContext2D, x: number, y: number, chart: Chart) {
  const [c1, c2] = DIFF_COLOR[chart.difficulty];
  const g = ctx.createLinearGradient(x, y, x + PANEL, y + PANEL);
  g.addColorStop(0, c2);
  g.addColorStop(1, "#15112a");
  ctx.fillStyle = g;
  ctx.fillRect(x, y, PANEL, PANEL);
  // 斜めの帯
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, PANEL, PANEL);
  ctx.clip();
  ctx.globalAlpha = 0.25;
  ctx.fillStyle = c1;
  ctx.beginPath();
  ctx.moveTo(x + PANEL * 0.55, y);
  ctx.lineTo(x + PANEL, y);
  ctx.lineTo(x + PANEL * 0.45, y + PANEL);
  ctx.lineTo(x, y + PANEL);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  // パック名・定数
  ctx.fillStyle = "rgba(255,255,255,0.7)";
  ctx.font = `600 16px ${TEXT_FONT}`;
  ctx.fillText(fitText(ctx, chart.pack, PANEL - 50), x + 10, y + 26);
  ctx.fillStyle = "#fff";
  ctx.font = `italic 700 64px ${NUM_FONT}`;
  shadowText(ctx, chart.constant.toFixed(1), x + 12, y + 118, 10);
  ctx.strokeStyle = "rgba(255,255,255,0.25)";
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 1, y + 1, PANEL - 2, PANEL - 2);
}

function drawCell(ctx: CanvasRenderingContext2D, x: number, y: number, rank: number, b: Best) {
  const isTop = rank <= B50_TOP;
  // 土台
  ctx.fillStyle = "rgba(58, 44, 92, 0.78)";
  ctx.fillRect(x, y + 18, CELL_W, CELL_H - 18);
  ctx.strokeStyle = isTop ? "rgba(255, 214, 120, 0.55)" : "rgba(190, 170, 255, 0.35)";
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y + 18, CELL_W, CELL_H - 18);

  // 順位タグ
  ctx.fillStyle = isTop ? "#6b4fa8" : "#4a3c70";
  ctx.beginPath();
  ctx.moveTo(x - 6, y + 22);
  ctx.lineTo(x + 78, y + 22);
  ctx.lineTo(x + 96, y + 44);
  ctx.lineTo(x + 78, y + 66);
  ctx.lineTo(x - 6, y + 66);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.font = `700 30px ${NUM_FONT}`;
  ctx.fillText(`#${rank}`, x + 8, y + 56);

  // POTENTIAL
  ctx.fillStyle = "rgba(255,255,255,0.8)";
  ctx.font = `600 14px ${NUM_FONT}`;
  ctx.fillText("POTENTIAL", x + 12, y + 96);
  ctx.fillStyle = isTop ? "#ffd678" : "#ffffff";
  ctx.font = `700 32px ${NUM_FONT}`;
  ctx.fillText(b.potential.toFixed(3), x + 10, y + 132);

  // ランク (六角形)
  const gx = x + 58, gy = y + 172;
  ctx.fillStyle = "rgba(240, 235, 255, 0.9)";
  hexagon(ctx, gx, gy, 90, 44);
  ctx.fill();
  ctx.fillStyle = "#5b3f96";
  ctx.font = `700 26px ${NUM_FONT}`;
  ctx.textAlign = "center";
  ctx.fillText(grade(b.play.score), gx, gy + 9);
  ctx.textAlign = "left";

  // ジャケット位置のパネル
  const px = x + CELL_W - PANEL - 14, py = y + 30;
  drawPanel(ctx, px, py, b.chart);

  // レベルのひし形 (右上)
  const [c1, c2] = DIFF_COLOR[b.chart.difficulty];
  const dg = ctx.createLinearGradient(0, py - 30, 0, py + 30);
  dg.addColorStop(0, c1);
  dg.addColorStop(1, c2);
  ctx.fillStyle = dg;
  diamond(ctx, px + PANEL, py, 30);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.8)";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = "#fff";
  ctx.font = `700 ${b.chart.level.endsWith("+") ? 22 : 26}px ${NUM_FONT}`;
  ctx.textAlign = "center";
  ctx.fillText(b.chart.level, px + PANEL, py + 9);
  ctx.font = `700 12px ${NUM_FONT}`;
  ctx.fillText(DIFF_ABBR[b.chart.difficulty], px + PANEL, py - 34);
  ctx.textAlign = "left";

  // スコア (パネル下部に重ねる)
  const sg = ctx.createLinearGradient(0, py + PANEL - 44, 0, py + PANEL);
  sg.addColorStop(0, "rgba(10,8,20,0)");
  sg.addColorStop(1, "rgba(10,8,20,0.85)");
  ctx.fillStyle = sg;
  ctx.fillRect(px, py + PANEL - 44, PANEL, 44);
  ctx.fillStyle = "#fff";
  // 右下のクリアのひし形と重ならないよう、パネル幅 - ひし形分に収める
  ctx.font = `600 27px ${NUM_FONT}`;
  shadowText(ctx, fmtScore(b.play.score), px + 6, py + PANEL - 10, 4);

  // クリア (右下のひし形)
  const cs = CLEAR_STYLE[b.play.clear ?? "TC"];
  diamond(ctx, px + PANEL + 4, py + PANEL - 14, 24);
  ctx.fillStyle = cs.fill;
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.85)";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = cs.text;
  ctx.font = `700 22px ${NUM_FONT}`;
  ctx.textAlign = "center";
  ctx.fillText(cs.label, px + PANEL + 4, py + PANEL - 6);
  ctx.textAlign = "left";

  // 曲名
  ctx.fillStyle = "rgba(20, 15, 36, 0.8)";
  ctx.fillRect(x, y + CELL_H - 30, CELL_W, 30);
  ctx.fillStyle = "#fff";
  ctx.font = `600 22px ${TEXT_FONT}`;
  ctx.fillText(fitText(ctx, b.chart.title, CELL_W - 20), x + 10, y + CELL_H - 8);
}

function drawFooter(ctx: CanvasRenderingContext2D, H: number) {
  ctx.fillStyle = "rgba(255,255,255,0.45)";
  ctx.font = `400 20px ${TEXT_FONT}`;
  ctx.fillText("Unofficial fan-made tool. Not affiliated with or endorsed by lowiro.", GRID_X, H - 36);
  ctx.textAlign = "right";
  ctx.fillText("Arcaea B50 · tk2539.github.io/Arcaea-B50", W - GRID_X, H - 36);
  ctx.textAlign = "left";
}
