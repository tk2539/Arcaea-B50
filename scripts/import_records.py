"""手持ちの記録を DB に取り込む。

  - data/records/*.csv   : Arcaea Online のベスト枠画像の書き起こし (played_at = 画像の生成日)
  - data/results_gt/*.csv: リザルト画面スクショの正解データ (played_at = スクショのファイル名の日時)

usage: python3 scripts/import_records.py USER_ID [DB_PATH]
"""
import csv
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from core.charts import load_charts
from core.charts import find_by_title_level
from core.db import Store
from core.potential import play_potential

CLEAR = {"C": "TC", "F": "FR", "P": "PM", "L": "TL"}


def screenshot_time(filename):
    m = re.search(r"(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})", filename)
    return "{}-{}-{}T{}:{}:{}".format(*m.groups()) if m else None


def import_arcaea_online(store, user):
    added = 0
    for meta in csv.DictReader(open(ROOT / "data/records/index.csv")):
        date = meta["file"][:10]
        for r in csv.DictReader(open(ROOT / "data/records" / meta["file"])):
            score, clear = int(r["score"]), CLEAR[r["clear"]]
            implied = float(r["potential"]) - play_potential(0, score, clear, meta["version"])
            chart = find_by_title_level(r["title"], r["level"], implied)
            added += bool(store.add_play(user, chart, score, clear, f"{date}T00:00:00", "arcaea_online"))
    return added


def import_screenshots(store, user):
    charts = load_charts().values()
    added = 0
    for p in sorted((ROOT / "data/results_gt").glob("labels_*.csv")):
        for r in csv.DictReader(open(p)):
            chart = next(c for c in charts if c["title"] == r["title"] and c["difficulty"] == r["difficulty"])
            at = screenshot_time(r["file"])
            added += bool(store.add_play(user, chart, int(r["score"]), r["clear"], at, "screenshot",
                                    int(r["pure"]), int(r["far"]), int(r["lost"]), image_hash=r["file"]))
            if int(r["high_score"]) > 0:
                added += bool(store.add_play(user, chart, int(r["high_score"]), None, at, "high_score"))
    return added


if __name__ == "__main__":
    user = sys.argv[1]
    store = Store(sys.argv[2] if len(sys.argv) > 2 else ROOT / "data/arcaea.db")
    print("Arcaea Online:", import_arcaea_online(store, user), "件追加")
    print("スクショ:", import_screenshots(store, user), "件追加")
