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

interface Schema extends DBSchema {
  plays: { key: number; value: Play; indexes: { dedupeKey: string; imageHash: string } };
}

// 同じ記録の二重登録を防ぐキー (同じスクショを2回、送信中と送信後の両方を撮った など)
const dedupeKey = (p: NewPlay) => [p.chartId, p.score, p.source, p.pure ?? -1, p.far ?? -1, p.lost ?? -1].join("|");

export class Store {
  private constructor(private db: IDBPDatabase<Schema>) {}

  static async open(name = "arcaea-b50") {
    const db = await openDB<Schema>(name, 1, {
      upgrade(db) {
        const s = db.createObjectStore("plays", { keyPath: "id", autoIncrement: true });
        s.createIndex("dedupeKey", "dedupeKey", { unique: true });
        s.createIndex("imageHash", "imageHash");
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
export interface Backup { app: "arcaea-b50"; version: 1; exportedAt: string; plays: NewPlay[] }

export async function exportBackup(store: Store): Promise<Backup> {
  const plays = (await store.all()).map(({ id, dedupeKey, createdAt, ...p }) => p);
  return { app: "arcaea-b50", version: 1, exportedAt: new Date().toISOString(), plays };
}

export async function importBackup(store: Store, b: Backup) {
  if (b.app !== "arcaea-b50" || b.version !== 1) throw new Error("このアプリのバックアップではありません");
  let added = 0;
  for (const p of b.plays) if ((await store.add(p)) !== null) added++;
  return { added, skipped: b.plays.length - added };
}
