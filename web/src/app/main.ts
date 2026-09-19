import "./style.css";
import { type Chart, DIFF_ABBR } from "../core/charts";
import { DigitReader } from "../core/digits";
import type { Rgba } from "../core/image";
import { type ParseResult, ResultParser, scoreConsistent, UnsupportedSizeError } from "../core/parse";
import { B50_TOP, type Clear, playPotential } from "../core/potential";
import { b50, type Backup, exportBackup, importBackup, type NewPlay, type Play, Store } from "../core/store";
import { loadFonts, renderB50 as drawB50Image } from "./b50image";
import { browserOcr } from "./ocr";

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const BASE = import.meta.env.BASE_URL;
const CLEAR_LABEL: Record<Clear, string> = { TL: "TRACK LOST", TC: "CLEAR", FR: "FULL RECALL", PM: "PURE MEMORY" };
const CLEAR_SHORT: Record<Clear, string> = { TL: "L", TC: "C", FR: "F", PM: "P" };

let store: Store;
let charts: Map<string, Chart>;
let parser: ResultParser;
let plays: Play[] = [];

const fmtScore = (s: number) => String(s).padStart(8, "0").replace(/\B(?=(\d{3})+$)/g, "'");
const chartLabel = (c: Chart) => `${c.title} [${DIFF_ABBR[c.difficulty]} ${c.constant.toFixed(1)}]`;
const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

function localIso(d: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** スクショのファイル名 (Screenshot_20260913_094738 など) から撮影日時。なければファイルの更新日時 */
function playedAtOf(file: File) {
  const m = file.name.match(/(20\d{2})(\d{2})(\d{2})[_-]?(\d{2})(\d{2})(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}` : localIso(new Date(file.lastModified || Date.now()));
}

async function sha256(buf: ArrayBuffer) {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", buf));
  return Array.from(h, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function decode(file: Blob): Promise<Rgba> {
  const bmp = await createImageBitmap(file);
  const c = document.createElement("canvas");
  c.width = bmp.width;
  c.height = bmp.height;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  return ctx.getImageData(0, 0, c.width, c.height);
}

// ---- 表示 ----
function renderB50() {
  const { top, total } = b50(plays, charts);
  $("#total").textContent = top.length ? total.toFixed(3) : "-";
  $("#empty").hidden = top.length > 0;
  $("#b50 tbody").innerHTML = top.map((b, i) => `
    <tr class="${i < B50_TOP ? "top10" : ""} ${i === B50_TOP - 1 ? "cut" : ""}">
      <td class="rank">${i + 1}</td>
      <td class="song">
        <div class="name">${esc(b.chart.title)}</div>
        <div class="meta"><span class="diff ${b.chart.difficulty}">${DIFF_ABBR[b.chart.difficulty]} ${b.chart.constant.toFixed(1)}</span></div>
      </td>
      <td class="score">${fmtScore(b.play.score)}${b.play.clear ? `<span class="clear ${b.play.clear}">${CLEAR_SHORT[b.play.clear]}</span>` : ""}</td>
      <td class="pot">${b.potential.toFixed(3)}</td>
    </tr>`).join("");
  const songs = new Set(plays.map((p) => p.chartId)).size;
  $("#stats").textContent = `記録 ${plays.length} 件 / ${songs} 譜面`;
}

async function reload() {
  plays = await store.all();
  renderB50();
}

function addCard(cls: string, html: string): HTMLDivElement {
  $("#results-title").hidden = false;
  const card = document.createElement("div");
  card.className = `card ${cls}`;
  card.innerHTML = html;
  $("#results").prepend(card);
  return card;
}

// ---- 登録 ----
async function save(chart: Chart, res: Pick<ParseResult, "score" | "highScore" | "clear" | "pure" | "far" | "lost">,
  playedAt: string, imageHash: string, card: HTMLDivElement) {
  const before = b50(plays, charts);
  const base = { chartId: chart.id, playedAt, pure: null, far: null, lost: null, imageHash: null } as const;
  const ids: number[] = [];
  const id = await store.add({ ...base, score: res.score!, clear: res.clear, pure: res.pure, far: res.far,
    lost: res.lost, source: "screenshot", imageHash });
  if (id === null) {
    card.className = "card duplicate";
    card.innerHTML = `<div class="title">${esc(chartLabel(chart))}</div><div>${fmtScore(res.score!)} は登録済みです。</div>`;
    return;
  }
  ids.push(id);
  if (res.highScore) {
    const hid = await store.add({ ...base, score: res.highScore, clear: null, source: "high_score" } as NewPlay);
    if (hid !== null) ids.push(hid);
  }
  await reload();
  const after = b50(plays, charts);
  const pot = playPotential(chart.constant, res.score!, res.clear);
  const rank = after.top.findIndex((b) => b.play.id === id) + 1;
  const diff = after.total - before.total;
  card.className = "card saved";
  card.innerHTML = `
    <div class="title">${esc(chartLabel(chart))}</div>
    <div class="line">${fmtScore(res.score!)} ${CLEAR_LABEL[res.clear]} → 単曲 ${pot.toFixed(3)}</div>
    ${res.pure !== null && res.lost !== null ? `<div class="line muted">PURE ${res.pure} / FAR ${res.far} / LOST ${res.lost}</div>` : ""}
    ${rank ? `<div class="up">B50 #${rank} に入りました</div>` : ""}
    <div class="line">ポテンシャル ${before.top.length ? `${before.total.toFixed(3)} → ` : ""}${after.total.toFixed(3)}
      ${before.top.length ? `<span class="${diff > 0 ? "up" : "muted"}">(${diff >= 0 ? "+" : ""}${diff.toFixed(3)})</span>` : ""}</div>
    <div class="actions"><button class="secondary undo">取り消し</button></div>`;
  card.querySelector<HTMLButtonElement>(".undo")!.onclick = async () => {
    await store.delete(ids);
    await reload();
    card.classList.add("undone");
    card.querySelector(".actions")!.innerHTML = `<span class="muted">取り消しました</span>`;
  };
}

function askChart(res: ParseResult, playedAt: string, imageHash: string, card: HTMLDivElement) {
  card.className = "card pending";
  card.innerHTML = `
    <div class="title">譜面を特定できませんでした</div>
    <div class="line">スコア ${fmtScore(res.score!)}（読み取った曲名: ${esc(res.raw.title || "?")}）</div>
    <div class="actions">
      <select>${res.candidates.map((c) => `<option value="${esc(c.chart.id)}">${esc(chartLabel(c.chart))}</option>`).join("")}</select>
      <button class="ok">登録</button>
    </div>`;
  card.querySelector<HTMLButtonElement>(".ok")!.onclick = async () => {
    const chart = charts.get(card.querySelector("select")!.value)!;
    // 読めた判定数がこの譜面と矛盾するなら判定数は捨てる (スコアとクリアだけ保存)
    let { pure, far, lost } = res;
    if (pure === null || far === null || !chart.notes || !scoreConsistent(res.score!, pure, far, chart.notes)) {
      pure = far = lost = null;
    } else {
      lost = chart.notes - pure - far;
    }
    await save(chart, { ...res, pure, far, lost }, playedAt, imageHash, card);
  };
}

async function processFile(file: Blob & { name?: string; lastModified?: number }) {
  const name = file instanceof File ? file.name : (file.name ?? "image");
  const card = addCard("", `<div class="muted">${esc(name)} を解析中…</div>`);
  try {
    const buf = await file.arrayBuffer();
    const hash = await sha256(buf);
    if (await store.hasImage(hash)) {
      card.className = "card duplicate";
      card.innerHTML = `<div>${esc(name)}: このスクショは登録済みです。</div>`;
      return;
    }
    const res = await parser.parse(await decode(file));
    if (res.score === null) throw new Error("リザルト画面として読み取れませんでした。");
    const playedAt = playedAtOf(file instanceof File ? file : new File([file], name));
    if (res.confident && res.chart) await save(res.chart, res, playedAt, hash, card);
    else askChart(res, playedAt, hash, card);
  } catch (e) {
    card.className = "card error";
    const msg = e instanceof UnsupportedSizeError
      ? `未対応の画面サイズです (${e.message})。今は 2340×1080 と同じ比率の画面のみ対応しています。`
      : (e as Error).message;
    card.innerHTML = `<div>${esc(name)}: ${esc(msg)}</div>`;
    console.error(e);
  }
}

async function processFiles(files: Iterable<Blob>) {
  for (const f of files) if (f.type.startsWith("image/")) await processFile(f); // 1枚ずつ (OCR が重いので)
}

/** 共有メニュー (Web Share Target) から受け取った画像。service worker がキャッシュに置いている */
async function processShared() {
  if (!new URLSearchParams(location.search).has("shared")) return;
  history.replaceState(null, "", BASE);
  const cache = await caches.open("share-target");
  for (const req of await cache.keys()) {
    const resp = await cache.match(req);
    if (resp) {
      const blob = await resp.blob();
      const name = decodeURIComponent(resp.headers.get("x-filename") ?? "shared.jpg");
      await processFile(new File([blob], name, { type: blob.type, lastModified: Number(resp.headers.get("x-modified")) || Date.now() }));
    }
    await cache.delete(req);
  }
}

// ---- 設定 ----
function download(name: string, text: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---- ベスト枠画像 ----
let imageBlob: Blob | null = null;

function storedName() {
  try { return localStorage.getItem("playerName") ?? ""; } catch { return ""; }
}

async function makeImage() {
  const { top, total } = b50(plays, charts);
  if (!top.length) return;
  $<HTMLButtonElement>("#make-image").disabled = true;
  try {
    await loadFonts();
    const canvas = drawB50Image({ playerName: $<HTMLInputElement>("#player-name").value.trim(), total, top, date: new Date() });
    imageBlob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/png"));
    const img = $<HTMLImageElement>("#image-preview");
    if (img.src) URL.revokeObjectURL(img.src);
    img.src = imageBlob ? URL.createObjectURL(imageBlob) : "";
    $("#image-box").hidden = false;
    $<HTMLButtonElement>("#share-image").hidden = !imageFile() || !navigator.canShare?.({ files: [imageFile()!] });
  } finally {
    $<HTMLButtonElement>("#make-image").disabled = false;
  }
}

function imageFile() {
  return imageBlob && new File([imageBlob], `arcaea-b50-${localIso(new Date()).slice(0, 10)}.png`, { type: "image/png" });
}

function bindUi() {
  const nameInput = $<HTMLInputElement>("#player-name");
  nameInput.value = storedName();
  nameInput.onchange = () => {
    try { localStorage.setItem("playerName", nameInput.value.trim()); } catch { /* 保存できなくても動く */ }
    if (!$("#image-box").hidden) makeImage();
  };
  $("#make-image").onclick = makeImage;
  $("#close-image").onclick = () => { $("#image-box").hidden = true; };
  $("#save-image").onclick = () => {
    const f = imageFile();
    if (!f) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(f);
    a.download = f.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  $("#share-image").onclick = async () => {
    const f = imageFile();
    if (f) await navigator.share({ files: [f] }).catch(() => {}); // キャンセルは無視
  };

  $<HTMLInputElement>("#file").onchange = async (e) => {
    const input = e.target as HTMLInputElement;
    const files = [...(input.files ?? [])];
    input.value = "";
    await processFiles(files);
  };

  // ドラッグ&ドロップ (PC 用)。ファイルを運んでいる間だけ案内を出す
  const drop = $("#drop");
  const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes("Files") ?? false;
  let hideTimer = 0;
  // dragover はドラッグ中ずっと発火するので、途切れたら (画面外に出た・キャンセルされた) 消す
  window.addEventListener("dragover", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    drop.hidden = false;
    clearTimeout(hideTimer);
    hideTimer = window.setTimeout(() => { drop.hidden = true; }, 400);
  });
  window.addEventListener("drop", async (e) => {
    drop.hidden = true;
    if (!hasFiles(e)) return;
    e.preventDefault();
    await processFiles([...(e.dataTransfer?.files ?? [])]);
  });
  drop.addEventListener("click", () => { drop.hidden = true; });
  // 貼り付け (PC 用)
  window.addEventListener("paste", async (e) => processFiles([...(e.clipboardData?.files ?? [])]));

  $("#export").onclick = async () => {
    download(`arcaea-b50-backup-${localIso(new Date()).slice(0, 10)}.json`, JSON.stringify(await exportBackup(store)));
  };
  $<HTMLInputElement>("#import").onchange = async (e) => {
    const input = e.target as HTMLInputElement;
    const f = input.files?.[0];
    input.value = "";
    if (!f) return;
    try {
      const r = await importBackup(store, JSON.parse(await f.text()) as Backup);
      await reload();
      addCard("saved", `バックアップから ${r.added} 件を追加しました（重複 ${r.skipped} 件はスキップ）`);
    } catch (err) {
      addCard("error", `バックアップを読み込めませんでした: ${esc((err as Error).message)}`);
    }
  };
  $("#wipe").onclick = async () => {
    if (!confirm("全ての記録を削除します。先にバックアップを書き出しましたか？")) return;
    await store.clear();
    await reload();
  };
}

async function main() {
  const [chartList, templates] = await Promise.all([
    fetch(`${BASE}data/charts.json`).then((r) => r.json()) as Promise<Chart[]>,
    fetch(`${BASE}data/digit-templates.json`).then((r) => r.json()),
  ]);
  charts = new Map(chartList.map((c) => [c.id, c]));
  parser = new ResultParser(DigitReader.fromJSON(templates), chartList, browserOcr);
  store = await Store.open();
  bindUi();
  await reload();
  if ("serviceWorker" in navigator && import.meta.env.PROD) {
    navigator.serviceWorker.register(`${BASE}sw.js`).catch(console.error);
  }
  await processShared();
}

main().catch((e) => {
  console.error(e);
  addCard("error", `起動に失敗しました: ${esc(String(e))}`);
});
