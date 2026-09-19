"""正解データ (data/results_gt) から数字テンプレートを作り data/digit_templates.npz に保存する。

usage: python scripts/build_templates.py
"""
import os
import sys

import cv2

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from core.digits import FIELDS, DigitReader, as_text, load_gt

if __name__ == "__main__":
    reader = DigitReader()
    for r in load_gt():
        img = cv2.imread(os.path.join(ROOT, "data/results_raw", r["file"]))
        for key in FIELDS:
            if r[key] and int(r[key]) > 0:
                reader.add(img, key, as_text(key, r[key]), r["file"])
    out = os.path.join(ROOT, "data/digit_templates.npz")
    reader.save(out)
    print({font: len(t) for font, t in reader.templates.items()}, "->", out)
