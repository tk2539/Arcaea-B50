// ブラウザ用の OCR (tesseract.js)。設定 (psm / whitelist) ごとに worker を1つずつ持つ。
import { createWorker, type Worker } from "tesseract.js";
import type { Gray } from "../core/image";
import type { Ocr } from "../core/text";

const workers = new Map<string, Promise<Worker>>();

function toCanvas(g: Gray): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = g.w;
  c.height = g.h;
  const im = new ImageData(g.w, g.h);
  for (let i = 0; i < g.data.length; i++) {
    im.data[i * 4] = im.data[i * 4 + 1] = im.data[i * 4 + 2] = g.data[i];
    im.data[i * 4 + 3] = 255;
  }
  c.getContext("2d")!.putImageData(im, 0, 0);
  return c;
}

export const browserOcr: Ocr = async (img, { psm, whitelist }) => {
  const key = `${psm}|${whitelist ?? ""}`;
  if (!workers.has(key)) {
    workers.set(key, (async () => {
      const w = await createWorker("eng");
      await w.setParameters({ tessedit_pageseg_mode: String(psm) as any, tessedit_char_whitelist: whitelist ?? "" });
      return w;
    })());
  }
  const w = await workers.get(key)!;
  return (await w.recognize(toCanvas(img))).data.text;
};
