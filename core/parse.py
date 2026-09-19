"""リザルト画面のスクショ1枚から、譜面・スコア・判定数・クリア種別を読み取る。

譜面の特定は曲名 OCR に頼らず、
  (1) 難易度 (OCR、ほぼ確実)
  (2) PURE+FAR+LOST = ノーツ数
  (3) スコア = floor(10M × (PURE + FAR/2) / ノーツ数) + 大PURE数 (0..PURE)
で候補を絞り、残った候補を曲名 OCR のあいまい一致で並べる。
"""
import os
import sys
from dataclasses import dataclass, field

import cv2
from rapidfuzz import fuzz, process

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from core import text
from core.charts import load_charts
from core.digits import FIELDS, DigitReader

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIFFICULTIES = ["Past", "Present", "Future", "Eternal", "Beyond"]


def score_consistent(score, pure, far, notes):
    base = 10_000_000 * (pure + far / 2) // notes
    return 0 <= score - base <= pure


@dataclass
class Result:
    chart: dict | None
    score: int | None
    high_score: int | None
    clear: str | None           # TC / FR / PM / TL
    pure: int | None
    far: int | None
    lost: int | None
    confident: bool             # 自動確定してよいか
    candidates: list = field(default_factory=list)  # 確認用の候補 [(title, difficulty, score)]
    raw: dict = field(default_factory=dict)


class ResultParser:
    def __init__(self, reader: DigitReader, charts=None):
        self.reader = reader
        self.charts = charts or list(load_charts().values())

    def _int(self, img, key, exclude):
        s, _ = self.reader.read(img, key, exclude_source=exclude)
        return int(s) if s.isdigit() else None

    def parse(self, img, exclude_source=None):
        raw = {
            "title": text.read_title(img),
            "difficulty": text.read_difficulty(img),
            "clear": text.read_clear(img),
        }
        score = self._int(img, "score", exclude_source)
        high = self._int(img, "high_score", exclude_source)
        pure, far, lost = (self._int(img, k, exclude_source) for k in ("pure", "far", "lost"))

        diff = process.extractOne(raw["difficulty"].capitalize(), DIFFICULTIES, scorer=fuzz.ratio)
        diff = diff[0] if diff and diff[1] >= 60 else None
        cands = [c for c in self.charts if diff is None or c["difficulty"] == diff]

        # 判定数: 読み候補の組み合わせから、ノーツ数とスコアに矛盾しないものを探す。
        # LOST が隠れて読めなくても ノーツ数 - PURE - FAR で補える。
        alts = {k: [(int(t), c) for t, c in self.reader.read_alternatives(img, k, exclude_source, per_glyph=5, limit=60)
                    if t.isdigit()]
                for k in ("pure", "far", "lost")}
        fits = {}  # chart id -> (cost, pure, far, lost)
        if score is not None:
            notes_to_charts = {}
            for c in cands:
                notes_to_charts.setdefault(c["data"].get("notecount"), []).append(c)
            for p, pc in alts["pure"][:30]:
                for f, fc in alts["far"][:30]:
                    for n, charts in notes_to_charts.items():
                        if not n or p + f > n or not score_consistent(score, p, f, n):
                            continue
                        l = n - p - f
                        lc = next((c for v, c in alts["lost"] if v == l), 1.0)  # 読めた候補になければ罰則
                        for c in charts:
                            cost = pc + fc + lc
                            if c["id"] not in fits or cost < fits[c["id"]][0]:
                                fits[c["id"]] = (cost, p, f, l)

        # 曲名のあいまい一致 (隠れて途中までしか読めない前提で partial も使う) と
        # 判定数の読みの無理のなさ (コスト) を合わせて順位づけする
        def title_score(c):
            return max(max(fuzz.ratio(raw["title"], nm), fuzz.partial_ratio(raw["title"], nm) - 5)
                       for nm in c["names"])

        def total(c):
            return title_score(c) - (200 * fits[c["id"]][0] if c["id"] in fits else 100)

        pool = [c for c in cands if c["id"] in fits] if fits else cands
        ranked = sorted(pool, key=total, reverse=True)
        best = ranked[0] if ranked else None
        margin = total(ranked[0]) - total(ranked[1]) if len(ranked) > 1 else 100

        if best and best["id"] in fits:
            _, pure, far, lost = fits[best["id"]]
        clear = self._clear(raw["clear"], far, lost)
        # 判定数が譜面と矛盾せず、曲名もある程度一致し、次点と差がある場合のみ自動確定
        confident = (bool(best) and best["id"] in fits and title_score(best) >= 60 and margin >= 15)
        return Result(best, score, high, clear, pure, far, lost, confident,
                      [(c["title"], c["difficulty"], round(total(c))) for c in ranked[:5]], raw)

    @staticmethod
    def _clear(ocr, far, lost):
        o = ocr.upper().replace(" ", "")
        if "LOST" in o or o.startswith("TRACKL"):
            return "TL"
        if lost == 0:
            return "PM" if far == 0 else "FR"
        return "TC"


if __name__ == "__main__":
    # 正解データで評価 (数字テンプレートは leave-one-out)
    from core.digits import as_text, load_gt
    gt = load_gt()
    imgs = {r["file"]: cv2.imread(os.path.join(ROOT, "data/results_raw", r["file"])) for r in gt}
    reader = DigitReader()
    for r in gt:
        for key in FIELDS:
            if r[key] and int(r[key]) > 0:
                reader.add(imgs[r["file"]], key, as_text(key, r[key]), r["file"])
    parser = ResultParser(reader)
    stats = {"chart": 0, "score": 0, "counts": 0, "clear": 0, "all": 0, "confident": 0, "confident_wrong": 0}
    for r in gt:
        res = parser.parse(imgs[r["file"]], exclude_source=r["file"])
        ok = {
            "chart": bool(res.chart) and res.chart["title"] == r["title"] and res.chart["difficulty"] == r["difficulty"],
            "score": res.score == int(r["score"]),
            "counts": (res.pure, res.far, res.lost) == (int(r["pure"]), int(r["far"]), int(r["lost"])),
            "clear": res.clear == r["clear"],
        }
        for k, v in ok.items():
            stats[k] += v
        all_ok = all(ok.values())
        stats["all"] += all_ok
        stats["confident"] += res.confident
        stats["confident_wrong"] += res.confident and not all_ok
        if not all_ok or not res.confident:
            print(f"{'OK ' if all_ok else 'NG '}{'確定' if res.confident else '要確認'} {r['file'][20:44]} "
                  f"want={r['title']}/{r['difficulty']}/{r['score']}/{r['clear']} "
                  f"got={res.chart and res.chart['title']}/{res.score}/{res.clear} "
                  f"counts={res.pure},{res.far},{res.lost} cands={res.candidates[:3]}")
    n = len(gt)
    print(f"\n譜面 {stats['chart']}/{n}  スコア {stats['score']}/{n}  判定数 {stats['counts']}/{n}  "
          f"クリア {stats['clear']}/{n}  全項目 {stats['all']}/{n}")
    print(f"自動確定 {stats['confident']}/{n}  (うち誤り {stats['confident_wrong']})")
