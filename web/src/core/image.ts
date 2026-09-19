// 解析に必要な最小限の画像処理 (OpenCV.js は重いので自前で持つ)。
// ブラウザでは ImageData、Node ではデコード済みの RGBA を同じ形で渡す。

export interface Rgba {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array; // RGBA
}

export interface Gray {
  w: number;
  h: number;
  data: Uint8Array;
}

export type Rect = [x: number, y: number, w: number, h: number];

/** 指定範囲をグレースケールで切り出す (OpenCV の BGR2GRAY と同じ係数) */
export function grayCrop(img: Rgba, [x0, y0, w, h]: Rect): Gray {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = ((y0 + y) * img.width + (x0 + x)) * 4;
      out[y * w + x] = Math.round(0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2]);
    }
  }
  return { w, h, data: out };
}

export function threshold(g: Gray, t: number): Gray {
  return { w: g.w, h: g.h, data: g.data.map((v) => (v > t ? 255 : 0)) };
}

/** 大津の二値化のしきい値 */
export function otsu(g: Gray): number {
  const hist = new Array(256).fill(0);
  for (const v of g.data) hist[v]++;
  const total = g.data.length;
  let sumAll = 0;
  for (let i = 0; i < 256; i++) sumAll += i * hist[i];
  let sumB = 0, wB = 0, best = 0, bestT = 0;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sumAll - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) { best = between; bestT = t; }
  }
  return bestT;
}

export function invert(g: Gray): Gray {
  return { w: g.w, h: g.h, data: g.data.map((v) => 255 - v) };
}

function morph(g: Gray, dilate: boolean): Gray {
  const out = new Uint8Array(g.data.length);
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      let v = dilate ? 0 : 255;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const yy = y + dy, xx = x + dx;
          if (yy < 0 || yy >= g.h || xx < 0 || xx >= g.w) continue;
          const p = g.data[yy * g.w + xx];
          v = dilate ? Math.max(v, p) : Math.min(v, p);
        }
      }
      out[y * g.w + x] = v;
    }
  }
  return { w: g.w, h: g.h, data: out };
}

/** 3x3 のクロージング (途切れた細線をつなぐ) */
export function close3(g: Gray): Gray {
  return morph(morph(g, true), false);
}

export interface Component { x: number; y: number; w: number; h: number; area: number }

/** 8近傍の連結成分 (白画素) */
export function components(g: Gray): Component[] {
  const label = new Int32Array(g.data.length).fill(-1);
  const out: Component[] = [];
  const stack: number[] = [];
  for (let start = 0; start < g.data.length; start++) {
    if (g.data[start] === 0 || label[start] >= 0) continue;
    const id = out.length;
    let minX = g.w, minY = g.h, maxX = 0, maxY = 0, area = 0;
    label[start] = id;
    stack.push(start);
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % g.w, y = (p / g.w) | 0;
      area++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || xx >= g.w || yy < 0 || yy >= g.h) continue;
          const q = yy * g.w + xx;
          if (g.data[q] !== 0 && label[q] < 0) { label[q] = id; stack.push(q); }
        }
      }
    }
    out.push({ x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1, area });
  }
  return out;
}

export function sub(g: Gray, x: number, y: number, w: number, h: number): Gray {
  const out = new Uint8Array(w * h);
  for (let yy = 0; yy < h; yy++) out.set(g.data.subarray((y + yy) * g.w + x, (y + yy) * g.w + x + w), yy * w);
  return { w, h, data: out };
}

/** 面積平均による縮小・拡大 (OpenCV の INTER_AREA 相当)。値は 0..1 の Float32 */
export function resizeArea(g: Gray, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h);
  const sx = g.w / w, sy = g.h / h;
  for (let y = 0; y < h; y++) {
    const y0 = y * sy, y1 = y0 + sy;
    for (let x = 0; x < w; x++) {
      const x0 = x * sx, x1 = x0 + sx;
      let acc = 0, wsum = 0;
      for (let yy = Math.floor(y0); yy < Math.min(Math.ceil(y1), g.h); yy++) {
        const wy = Math.min(yy + 1, y1) - Math.max(yy, y0);
        for (let xx = Math.floor(x0); xx < Math.min(Math.ceil(x1), g.w); xx++) {
          const wx = Math.min(xx + 1, x1) - Math.max(xx, x0);
          acc += g.data[yy * g.w + xx] * wx * wy;
          wsum += wx * wy;
        }
      }
      out[y * w + x] = wsum ? acc / wsum / 255 : 0;
    }
  }
  return out;
}

/** 双線形補間で拡大 (OCR 前処理用) */
export function scale(g: Gray, f: number): Gray {
  const w = Math.round(g.w * f), h = Math.round(g.h * f);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const fy = Math.min((y + 0.5) / f - 0.5, g.h - 1);
    const y0 = Math.max(0, Math.floor(fy)), y1 = Math.min(y0 + 1, g.h - 1), ty = Math.max(0, fy - y0);
    for (let x = 0; x < w; x++) {
      const fx = Math.min((x + 0.5) / f - 0.5, g.w - 1);
      const x0 = Math.max(0, Math.floor(fx)), x1 = Math.min(x0 + 1, g.w - 1), tx = Math.max(0, fx - x0);
      const a = g.data[y0 * g.w + x0], b = g.data[y0 * g.w + x1];
      const c = g.data[y1 * g.w + x0], d = g.data[y1 * g.w + x1];
      out[y * w + x] = Math.round((a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty);
    }
  }
  return { w, h, data: out };
}

export function pad(g: Gray, p: number, value = 255): Gray {
  const w = g.w + 2 * p, h = g.h + 2 * p;
  const out = new Uint8Array(w * h).fill(value);
  for (let y = 0; y < g.h; y++) out.set(g.data.subarray(y * g.w, (y + 1) * g.w), (y + p) * w + p);
  return { w, h, data: out };
}

/** 画像全体を指定サイズに拡縮 (同じ比率の別解像度の端末向け) */
export function resizeRgba(img: Rgba, w: number, h: number): Rgba {
  const out = new Uint8ClampedArray(w * h * 4);
  const sx = img.width / w, sy = img.height / h;
  for (let y = 0; y < h; y++) {
    const yy = Math.min(img.height - 1, Math.floor((y + 0.5) * sy));
    for (let x = 0; x < w; x++) {
      const xx = Math.min(img.width - 1, Math.floor((x + 0.5) * sx));
      const i = (yy * img.width + xx) * 4, o = (y * w + x) * 4;
      out[o] = img.data[i]; out[o + 1] = img.data[i + 1]; out[o + 2] = img.data[i + 2]; out[o + 3] = 255;
    }
  }
  return { width: w, height: h, data: out };
}
