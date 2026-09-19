// Tachi の seeds と定数補正 (../data/overrides.csv) から、ブラウザ用の譜面データ public/data/charts.json を作る。
// usage: npm run data
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Chart } from "../src/core/charts";

const DATA = resolve(import.meta.dirname, "../../data");

function parseCsv(text: string): Record<string, string>[] {
  const [head, ...lines] = text.trim().split(/\r?\n/);
  const keys = head.split(",");
  return lines.map((l) => Object.fromEntries(l.split(",").map((v, i) => [keys[i], v])));
}

const songs = new Map<string, any>(
  JSON.parse(readFileSync(`${DATA}/tachi/songs-arcaea.json`, "utf8")).map((s: any) => [s.id, s]),
);
const overrides = new Map(
  parseCsv(readFileSync(`${DATA}/overrides.csv`, "utf8")).map((o) => [`${o.inGameStrID}:${o.difficulty}`, Number(o.constant)]),
);

const charts: Chart[] = JSON.parse(readFileSync(`${DATA}/tachi/charts-arcaea.json`, "utf8")).map((c: any) => {
  const s = songs.get(c.songID);
  const id = `${c.data.inGameStrID}:${c.difficulty}`;
  return {
    id,
    songId: c.data.inGameStrID,
    title: s.title,
    artist: s.artist ?? "",
    pack: s.data?.songPack ?? "",
    names: [s.title, ...(s.altTitles ?? []), ...(s.searchTerms ?? [])],
    difficulty: c.difficulty,
    level: c.level,
    constant: overrides.get(id) ?? c.levelNum,
    notes: c.data.notecount ?? null,
  };
});

writeFileSync(resolve(import.meta.dirname, "../public/data/charts.json"), JSON.stringify(charts));
console.log(`${charts.length} charts (${overrides.size} overrides) -> public/data/charts.json`);
