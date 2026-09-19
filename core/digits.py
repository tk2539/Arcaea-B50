"""リザルト画面の数字 (スコア・判定数) を読む。

フォントが固定なので、二値化 → 連結成分で1文字ずつ切り出し → 正規化した
ビットマップを数字テンプレートと最近傍比較する。テンプレートは正解データ
(data/results_gt) から切り出して作る。
"""
import csv
import glob
import os
import sys

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from core.regions import REGIONS

GLYPH_W, GLYPH_H = 20, 30

# フィールドごとの (フォント群, 二値化しきい値)
FIELDS = {
    "score": ("score", 215),
    "high_score": ("score", 215),
    "pure": ("count", 235),
    "far": ("count", 235),
    "lost": ("count", 235),
}


def crop(img, key):
    x, y, w, h = REGIONS[key]
    return img[y:y + h, x:x + w]


def glyphs(img, key):
    """フィールド内の数字を左から順に正規化ビットマップのリストで返す"""
    _, thresh = FIELDS[key]
    g = cv2.cvtColor(crop(img, key), cv2.COLOR_BGR2GRAY)
    if FIELDS[key][0] == "score":
        # 暗い帯に明るい細字。帯の明るさが画像ごとに違うので Otsu で決める
        _, b = cv2.threshold(g, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    else:
        _, b = cv2.threshold(g, thresh, 255, cv2.THRESH_BINARY)
        # 白抜き文字は細く途切れやすいので軽くつなぐ
        b = cv2.morphologyEx(b, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    n, _, stats, _ = cv2.connectedComponentsWithStats(b, connectivity=8)
    boxes = [tuple(stats[i][:4]) for i in range(1, n) if stats[i][4] >= 8]
    if not boxes:
        return []
    max_h = max(h for _, _, _, h in boxes)
    # 帯の縁 (横長) を除外
    boxes = [bx for bx in boxes if bx[2] < 3 * max_h]
    max_h = max((h for _, _, _, h in boxes), default=0)
    # 高さが足りない成分は、数字の欠け (他の文字の枠内) なら統合、そうでなければ ' やノイズとして捨てる
    full = [list(bx) for bx in boxes if bx[3] >= 0.6 * max_h]
    for x, y, w, h in boxes:
        if h >= 0.6 * max_h:
            continue
        cx = x + w / 2
        for f in full:
            if f[0] <= cx <= f[0] + f[2] and y + h > f[1] and y < f[1] + f[3] + 2:
                nx, ny = min(f[0], x), min(f[1], y)
                f[2], f[3] = max(f[0] + f[2], x + w) - nx, max(f[1] + f[3], y + h) - ny
                f[0], f[1] = nx, ny
                break
    merged = []
    widths = sorted(f[2] for f in full)
    typical = widths[len(widths) // 2] if widths else 0
    for x, y, w, h in sorted(tuple(f) for f in full):
        # 2文字がくっついた成分は、縦の画素数が最小になる列で分割
        if typical and w > 1.6 * typical and len(full) > 1:
            cols = (b[y:y + h, x:x + w] > 0).sum(axis=0)
            lo, hi = int(w * 0.3), int(w * 0.7)
            cut = lo + int(np.argmin(cols[lo:hi]))
            merged += [(x, y, cut, h), (x + cut, y, w - cut, h)]
        else:
            merged.append((x, y, w, h))
    out = []
    for x, y, w, h in merged:
        c = b[y:y + h, x:x + w]
        # 縦横比を保ったまま枠に収める ("1" が潰れないように)
        s = min(GLYPH_W / w, GLYPH_H / h)
        c = cv2.resize(c, (max(1, round(w * s)), max(1, round(h * s))), interpolation=cv2.INTER_AREA)
        canvas = np.zeros((GLYPH_H, GLYPH_W), np.float32)
        oy, ox = (GLYPH_H - c.shape[0]) // 2, (GLYPH_W - c.shape[1]) // 2
        canvas[oy:oy + c.shape[0], ox:ox + c.shape[1]] = c / 255.0
        out.append(canvas)
    return out


class DigitReader:
    def __init__(self):
        self.templates = {"score": [], "count": []}  # [(digit, bitmap, source)]

    def save(self, path):
        arrays = {}
        for font, tpl in self.templates.items():
            arrays[f"{font}_digits"] = np.array([d for d, _, _ in tpl])
            arrays[f"{font}_bitmaps"] = np.array([g for _, g, _ in tpl], dtype=np.float32)
        np.savez_compressed(path, **arrays)

    @classmethod
    def load(cls, path):
        reader = cls()
        data = np.load(path)
        for font in reader.templates:
            reader.templates[font] = [(str(d), g, "") for d, g in
                                      zip(data[f"{font}_digits"], data[f"{font}_bitmaps"])]
        return reader

    def add(self, img, key, text, source=""):
        gs = glyphs(img, key)
        if len(gs) != len(text):
            return False
        font, _ = FIELDS[key]
        self.templates[font] += [(d, g, source) for d, g in zip(text, gs)]
        return True

    def read(self, img, key, exclude_source=None):
        font, _ = FIELDS[key]
        tpl = [t for t in self.templates[font] if t[2] != exclude_source]
        digits, worst = "", 0.0
        for g in glyphs(img, key):
            dists = [(np.abs(g - t).mean(), d) for d, t, _ in tpl]
            dist, d = min(dists)
            digits += d
            worst = max(worst, dist)
        return digits, worst


    def read_alternatives(self, img, key, exclude_source=None, per_glyph=3, limit=30):
        """読み候補を (文字列, コスト) で返す。コスト = 各文字の最良候補からの距離の増分の和"""
        import itertools
        font, _ = FIELDS[key]
        tpl = [t for t in self.templates[font] if t[2] != exclude_source]
        options = []
        for g in glyphs(img, key):
            best = {}
            for d, t, _ in tpl:
                dist = float(np.abs(g - t).mean())
                best[d] = min(best.get(d, 1e9), dist)
            ranked = sorted(best.items(), key=lambda kv: kv[1])[:per_glyph]
            base = ranked[0][1]
            options.append([(d, dist - base) for d, dist in ranked])
        if not options:
            return []
        combos = [("".join(d for d, _ in c), sum(x for _, x in c)) for c in itertools.product(*options)]
        return sorted(combos, key=lambda c: c[1])[:limit]


def load_gt():
    rows = []
    for p in sorted(glob.glob(os.path.join(os.path.dirname(__file__), "../data/results_gt/labels_*.csv"))):
        rows += list(csv.DictReader(open(p)))
    return rows


def as_text(key, v):
    return str(int(v)).zfill(8) if key in ("score", "high_score") else str(int(v))


if __name__ == "__main__":
    # leave-one-out 評価: 自分以外の画像から作ったテンプレートで読む
    root = os.path.join(os.path.dirname(__file__), "../data/results_raw")
    gt = load_gt()
    imgs = {r["file"]: cv2.imread(os.path.join(root, r["file"])) for r in gt}
    reader = DigitReader()
    for r in gt:
        for key in FIELDS:
            if r[key] and int(r[key]) > 0:
                if not reader.add(imgs[r["file"]], key, as_text(key, r[key]), r["file"]):
                    print(f"  切り出し数不一致: {r['file'][20:]} {key}={r[key]}")
    total = ok = 0
    for r in gt:
        for key in FIELDS:
            if not r[key] or int(r[key]) == 0:
                continue
            got, worst = reader.read(imgs[r["file"]], key, exclude_source=r["file"])
            want = as_text(key, r[key])
            total += 1
            ok += got == want
            if got != want:
                print(f"NG {r['file'][20:]} {key}: want={want} got={got} worst={worst:.3f}")
    print(f"{ok}/{total} 一致")
