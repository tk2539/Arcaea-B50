"""譜面データ (Tachi seeds) と定数補正 (data/overrides.csv) の読み込み。"""
import csv
import json
import os
import unicodedata
from functools import lru_cache

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def norm(s):
    return unicodedata.normalize("NFKC", s).lower().replace(" ", "")


@lru_cache(maxsize=1)
def load_charts():
    """chart id -> chart。各 chart に title / names / constant を足して返す"""
    songs = {s["id"]: s for s in json.load(open(os.path.join(ROOT, "data/tachi/songs-arcaea.json")))}
    overrides = {
        (o["inGameStrID"], o["difficulty"]): float(o["constant"])
        for o in csv.DictReader(open(os.path.join(ROOT, "data/overrides.csv")))
    }
    charts = {}
    for c in json.load(open(os.path.join(ROOT, "data/tachi/charts-arcaea.json"))):
        s = songs[c["songID"]]
        c["title"] = s["title"]
        c["artist"] = s.get("artist", "")
        c["pack"] = s.get("data", {}).get("songPack", "")
        c["names"] = [s["title"], *s.get("altTitles", []), *s.get("searchTerms", [])]
        c["constant"] = overrides.get((c["data"]["inGameStrID"], c["difficulty"]), c["levelNum"])
        charts[c["id"]] = c
    return charts


def find_by_title_level(title, level, implied_constant=None):
    """ベスト枠画像の (途中で切れた) 曲名とレベル表記から譜面を探す。
    同名で複数あれば、画像から逆算した定数に最も近いものを返す。"""
    t = norm(title)
    cands = [c for c in load_charts().values()
             if norm(c["title"]).startswith(t) and c["level"] == level]
    if implied_constant is None or len(cands) <= 1:
        return cands[0] if cands else None
    return min(cands, key=lambda c: abs(c["constant"] - implied_constant))
