"""ポテンシャル計算。

v7 (2026-08〜): 単曲 = 定数 + スコア係数 + 0.2 (TRACK LOST 以外)
               総合 = (2 × 上位10 + 11〜50位) / 60 を小数第3位で切り捨て
v6 以前:       単曲 = 定数 + スコア係数 (総合は Recent 込みなので計算しない)
Arcaea Online のベスト枠画像 18 枚で全枠一致を確認済み (scripts/verify.py)。
"""
import math

B50_TOP, B50_SIZE = 10, 50


def score_factor(score):
    if score >= 10_000_000:
        return 2.0
    if score >= 9_800_000:
        return 1.0 + (score - 9_800_000) / 200_000
    return max((score - 9_500_000) / 300_000, 0.0)  # 下限0は未検証


def play_potential(constant, score, clear, version="v7"):
    if version == "v6":
        return constant + score_factor(score)
    return constant + score_factor(score) + (0.0 if clear == "TL" else 0.2)


def total_potential(play_potentials):
    p = sorted(play_potentials, reverse=True)[:B50_SIZE]
    raw = (2 * sum(p[:B50_TOP]) + sum(p[B50_TOP:])) / (B50_SIZE + B50_TOP)
    return math.floor(raw * 1000 + 1e-9) / 1000
