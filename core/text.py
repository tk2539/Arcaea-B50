"""文字項目 (曲名・難易度・クリア種別・レベル) を Tesseract で読む。"""
import os
import subprocess
import sys
import tempfile

import cv2

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from core.regions import REGIONS


def tesseract(im, psm=7, whitelist=None, lang="eng"):
    args = ["tesseract", "-", "-", "--psm", str(psm), "-l", lang]
    if whitelist:
        args += ["-c", f"tessedit_char_whitelist={whitelist}"]
    ok, buf = cv2.imencode(".png", im)
    return subprocess.run(args, input=buf.tobytes(), capture_output=True).stdout.decode().strip()


def prep(img, key, invert, scale=2, thresh=None):
    x, y, w, h = REGIONS[key]
    g = cv2.cvtColor(img[y:y + h, x:x + w], cv2.COLOR_BGR2GRAY)
    g = cv2.resize(g, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
    if thresh is None:
        _, b = cv2.threshold(g, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    else:
        _, b = cv2.threshold(g, thresh, 255, cv2.THRESH_BINARY)
    if invert:
        b = 255 - b
    return cv2.copyMakeBorder(b, 16, 16, 16, 16, cv2.BORDER_CONSTANT, value=255)


def read_title(img):
    # 暗い帯に白文字 → 白文字だけ残して反転
    return tesseract(prep(img, "title", invert=True, thresh=200))


def read_difficulty(img):
    # 明るい背景に濃い文字
    return tesseract(prep(img, "difficulty", invert=False), whitelist="ABCDEFGHIJKLMNOPQRSTUVWXYZ")


def read_clear(img):
    return tesseract(prep(img, "clear", invert=False, scale=1), whitelist="ABCDEFGHIJKLMNOPQRSTUVWXYZ ")


def read_level(img):
    # 菱形の中の白い数字
    return tesseract(prep(img, "level", invert=True, thresh=200), psm=8, whitelist="0123456789+")
