"""ベスト枠画像から書き起こしたCSVと、定数データ + 計算式を突き合わせる。

usage:
  python3 scripts/verify.py            # data/records/index.csv の全画像を検証
  python3 scripts/verify.py -v FILE    # 指定したCSVを1枠ずつ表示
"""
import csv
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from core.charts import find_by_title_level
from core.potential import play_potential, total_potential

RECORDS = Path(__file__).resolve().parent.parent / "data/records"
CLEAR = {"C": "TC", "F": "FR", "P": "PM", "L": "TL"}  # ベスト枠画像のバッジ文字


def verify(path, version, shown_total=None, verbose=False):
    tol = 0.006 if version == "v6" else 0.0006  # 表示桁の半分 + 誤差
    rows = list(csv.DictReader(open(path)))
    pots, ng = [], []
    for r in rows:
        score, shown, clear = int(r["score"]), float(r["potential"]), CLEAR[r["clear"]]
        implied = shown - play_potential(0, score, clear, version)
        chart = find_by_title_level(r["title"], r["level"], implied)
        if chart is None:
            ng.append(f"#{r['rank']} {r['title']}: 譜面が見つからない (implied {implied:.3f})")
            continue
        calc = play_potential(chart["constant"], score, clear, version)
        pots.append(calc)
        ok = abs(shown - calc) < tol
        line = (f"#{r['rank']:>2} {'OK' if ok else 'NG'} {r['title'][:24]:<24} "
                f"{chart['difficulty'][:3]} const={chart['constant']:<5} "
                f"shown={shown:.3f} calc={calc:.5f} implied={implied:.3f}")
        if verbose:
            print(line)
        if not ok:
            ng.append(line)

    result = f"{Path(path).name:<22} {version} 単曲 {len(rows) - len(ng)}/{len(rows)}"
    if version == "v7" and shown_total is not None:
        calc_total = total_potential(pots)
        mark = "OK" if abs(calc_total - shown_total) < 1e-9 else "NG"
        result += f"  総合 {mark} (表示 {shown_total:.3f} / 計算 {calc_total:.3f})"
    elif version == "v6":
        result += "  総合 - (Recent込みのため検算不可)"
    print(result)
    for line in ng:
        print("    " + line)
    return not ng


if __name__ == "__main__":
    if len(sys.argv) >= 3 and sys.argv[1] == "-v":
        path = Path(sys.argv[2])
        idx = {r["file"]: r for r in csv.DictReader(open(RECORDS / "index.csv"))}
        meta = idx.get(path.name, {"version": "v7", "total": None})
        total = float(meta["total"]) if meta["total"] else None
        verify(path, meta["version"], total, verbose=True)
    else:
        all_ok = True
        for r in csv.DictReader(open(RECORDS / "index.csv")):
            all_ok &= verify(RECORDS / r["file"], r["version"], float(r["total"]))
        sys.exit(0 if all_ok else 1)
