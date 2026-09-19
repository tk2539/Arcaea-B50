// プレイ記録の保存 (ブラウザの IndexedDB) と B50 の計算。
// 記録は全部残し、B50 は毎回計算する。

import { type DBSchema, type IDBPDatabase, openDB } from "idb";
import type { Chart } from "./charts";
import { B50_SIZE, type Clear, playPotential, totalPotential } from "./potential";

export type Source = "screenshot" | "high_score" | "arcaea_online" | "manual";

export interface Play {
  id?: number;
  chartId: string; // `${songId}:${difficulty}`
  score: number;
  clear: Clear | null; // null = 不明 (HIGH SCORE 欄から拾った記録など)
  pure: number | null;
  far: number | null;
  lost: number | null;
  playedAt: string; // ISO8601 (ローカル時刻)。ベスト枠画像由来は画像の生成日
  source: Source;
  imageHash: string | null;
  dedupeKey: string;
  createdAt: string;
}

export type NewPlay = Omit<Play, "id" | "dedupeKey" | "createdAt">;

// ジャケットはユーザー自身のスクショから切り出してブラウザ内にだけ保存する (配布はしない)
export type JacketSource = "result" | "arcaea_online";
export interface Jacket { chartId: string; blob: Blob; source: JacketSource; updatedAt: string }
const JACKET_PRIORITY: Record<JacketSource, number> = { arcaea_online: 0, result: 1 }; // リザルト画面の方が高解像度で隠れもない

interface Schema extends DBSchema {
  plays: { key: number; value: Play; indexes: { dedupeKey: string; imageHash: string } };
  jackets: { key: string; value: Jacket };
}

// 同じ記録の二重登録を防ぐキー (同じスクショを2回、送信中と送信後の両方を撮った など)
const dedupeKey = (p: NewPlay) => [p.chartId, p.score, p.source, p.pure ?? -1, p.far ?? -1, p.lost ?? -1].join("|");

export class Store {
  private constructor(private db: IDBPDatabase<Schema>) {}

  static async open(name = "arcaea-b50") {
    const db = await openDB<Schema>(name, 2, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          const s = db.createObjectStore("plays", { keyPath: "id", autoIncrement: true });
          s.createIndex("dedupeKey", "dedupeKey", { unique: true });
          s.createIndex("imageHash", "imageHash");
        }
        if (oldVersion < 2) db.createObjectStore("jackets", { keyPath: "chartId" });
      },
    });
    return new Store(db);
  }

  /** 登録できたら id、重複なら null */
  async add(p: NewPlay): Promise<number | null> {
    const key = dedupeKey(p);
    if (await this.db.getKeyFromIndex("plays", "dedupeKey", key)) return null;
    try {
      return await this.db.add("plays", { ...p, dedupeKey: key, createdAt: new Date().toISOString() } as Play);
    } catch (e) {
      if (e instanceof DOMException && e.name === "ConstraintError") return null; // 同時に追加された
      throw e;
    }
  }

  async hasImage(hash: string) {
    return (await this.db.getKeyFromIndex("plays", "imageHash", hash)) !== undefined;
  }

  async delete(ids: number[]) {
    const tx = this.db.transaction("plays", "readwrite");
    await Promise.all([...ids.map((id) => tx.store.delete(id)), tx.done]);
  }

  all() {
    return this.db.getAll("plays");
  }

  async clear() {
    await this.db.clear("plays");
    await this.db.clear("jackets");
  }

  /** ジャケットを保存。既存のものより優先度が低い取得元なら上書きしない */
  async putJacket(chartId: string, blob: Blob, source: JacketSource) {
    const cur = await this.db.get("jackets", chartId);
    if (cur && JACKET_PRIORITY[cur.source] > JACKET_PRIORITY[source]) return false;
    await this.db.put("jackets", { chartId, blob, source, updatedAt: new Date().toISOString() });
    return true;
  }

  allJackets() {
    return this.db.getAll("jackets");
  }
}

export interface Best { chart: Chart; play: Play; potential: number }

/** 譜面ごとに単曲ポテンシャルが最大のプレイ (at 指定でその時点まで) */
export function bests(plays: Play[], charts: Map<string, Chart>, at?: string): Best[] {
  const best = new Map<string, Best>();
  for (const play of plays) {
    if (at && play.playedAt > at) continue;
    const chart = charts.get(play.chartId);
    if (!chart) continue;
    // clear 不明の記録はクリア扱い (HIGH SCORE 欄の記録はほぼクリア済みのため)
    const potential = playPotential(chart.constant, play.score, play.clear ?? "TC");
    const cur = best.get(play.chartId);
    if (!cur || potential > cur.potential || (potential === cur.potential && play.score > cur.play.score)) {
      best.set(play.chartId, { chart, play, potential });
    }
  }
  return [...best.values()].sort((a, b) => b.potential - a.potential || b.play.score - a.play.score);
}

export function b50(plays: Play[], charts: Map<string, Chart>, at?: string) {
  const top = bests(plays, charts, at).slice(0, B50_SIZE);
  return { top, total: totalPotential(top.map((b) => b.potential)) };
}

// ---- バックアップ (JSON の書き出し・読み込み) ----
export interface BackupJacket { chartId: string; source: JacketSource; dataUrl: string }
export interface Backup {
  app: "arcaea-b50"; version: 1; exportedAt: string; plays: NewPlay[];
  jackets?: BackupJacket[]; // 任意 (自分のスクショから切り出したもの)
}

function blobToDataUrl(b: Blob): Promise<string> {
  return new Promise((ok, ng) => {
    const r = new FileReader();
    r.onload = () => ok(r.result as string);
    r.onerror = ng;
    r.readAsDataURL(b);
  });
}

export async function exportBackup(store: Store): Promise<Backup> {
  const plays = (await store.all()).map(({ id, dedupeKey, createdAt, ...p }) => p);
  const jackets = await Promise.all((await store.allJackets()).map(async (j) =>
    ({ chartId: j.chartId, source: j.source, dataUrl: await blobToDataUrl(j.blob) })));
  return { app: "arcaea-b50", version: 1, exportedAt: new Date().toISOString(), plays, jackets };
}

export async function importBackup(store: Store, b: Backup) {
  if (b.app !== "arcaea-b50" || b.version !== 1) throw new Error("このアプリのバックアップではありません");
  let added = 0;
  for (const p of b.plays) if ((await store.add(p)) !== null) added++;
  let jackets = 0;
  for (const j of b.jackets ?? []) {
    const blob = await (await fetch(j.dataUrl)).blob();
    if (await store.putJacket(j.chartId, blob, j.source)) jackets++;
  }
  return { added, skipped: b.plays.length - added, jackets };
}
