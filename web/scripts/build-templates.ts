// 正解データ (../data/results_gt) から数字テンプレートを作り public/data/digit-templates.json に保存する。
// usage: npm run templates
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { DigitReader, type DigitField, FIELDS } from "../src/core/digits";
import { DATA, digitsText, loadGt, loadImage } from "./node-env";

const reader = new DigitReader();
let skipped = 0;
for (const r of loadGt()) {
  const img = loadImage(`${DATA}/results_raw/${r.file}`);
  for (const key of Object.keys(FIELDS) as DigitField[]) {
    if (r[key] && Number(r[key]) > 0 && !reader.add(img, key, digitsText(key, r[key]), r.file)) skipped++;
  }
}
const out = resolve(import.meta.dirname, "../public/data/digit-templates.json");
writeFileSync(out, JSON.stringify(reader.toJSON()));
console.log(`score ${reader.templates.score.length} / count ${reader.templates.count.length} (切り出し数不一致 ${skipped}) -> ${out}`);
