"""プレイ記録の保存と B50 の計算 (SQLite)。

記録は全部残し、B50 は毎回計算する。譜面は Tachi の ID ではなく
ゲーム内の曲ID (inGameStrID) + 難易度 で持つ (Tachi 側の ID 変更に左右されないように)。
"""
import sqlite3
from dataclasses import dataclass

from core.charts import load_charts
from core.potential import B50_SIZE, play_potential, total_potential

SCHEMA = """
CREATE TABLE IF NOT EXISTS plays (
    id         INTEGER PRIMARY KEY,
    user_id    TEXT NOT NULL,
    song_id    TEXT NOT NULL,            -- inGameStrID
    difficulty TEXT NOT NULL,            -- Past/Present/Future/Eternal/Beyond
    score      INTEGER NOT NULL,
    clear      TEXT,                     -- TC/FR/PM/TL。NULL = 不明 (HIGH SCORE 欄から拾った記録など)
    pure       INTEGER,
    far        INTEGER,
    lost       INTEGER,
    played_at  TEXT NOT NULL,            -- ISO8601。ベスト枠画像由来は画像の生成日
    source     TEXT NOT NULL,            -- screenshot / high_score / arcaea_online / manual
    image_hash TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- 同じ記録の二重登録を防ぐ (同じスクショを2回貼る、送信中と送信後を両方撮る など)
CREATE UNIQUE INDEX IF NOT EXISTS plays_dedupe ON plays (
    user_id, song_id, difficulty, score, source, IFNULL(pure, -1), IFNULL(far, -1), IFNULL(lost, -1)
);
CREATE INDEX IF NOT EXISTS plays_user ON plays (user_id, played_at);
"""

# クリア種別の強さ (表示用の「最高クリア」に使う)
CLEAR_RANK = {"TL": 0, "TC": 1, "FR": 2, "PM": 3}


@dataclass
class Best:
    chart: dict
    score: int
    clear: str | None
    potential: float
    played_at: str


class Store:
    def __init__(self, path):
        self.conn = sqlite3.connect(path)
        self.conn.row_factory = sqlite3.Row
        self.conn.executescript(SCHEMA)
        self._by_key = {(c["data"]["inGameStrID"], c["difficulty"]): c for c in load_charts().values()}

    def add_play(self, user_id, chart, score, clear, played_at, source,
                 pure=None, far=None, lost=None, image_hash=None):
        """登録できたらその play id、重複で無視したら None"""
        cur = self.conn.execute(
            "INSERT OR IGNORE INTO plays (user_id, song_id, difficulty, score, clear, pure, far, lost,"
            " played_at, source, image_hash) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (user_id, chart["data"]["inGameStrID"], chart["difficulty"], score, clear,
             pure, far, lost, played_at, source, image_hash))
        self.conn.commit()
        return cur.lastrowid if cur.rowcount == 1 else None

    def delete_plays(self, user_id, play_ids):
        self.conn.executemany("DELETE FROM plays WHERE user_id=? AND id=?", [(user_id, i) for i in play_ids])
        self.conn.commit()

    def has_image(self, user_id, image_hash):
        return self.conn.execute("SELECT 1 FROM plays WHERE user_id=? AND image_hash=?",
                                 (user_id, image_hash)).fetchone() is not None

    def bests(self, user_id, at=None):
        """譜面ごとに、単曲ポテンシャルが最大のプレイを返す (at 指定でその時点まで)"""
        q = "SELECT * FROM plays WHERE user_id=?"
        args = [user_id]
        if at:
            q += " AND played_at <= ?"
            args.append(at)
        best = {}
        for r in self.conn.execute(q, args):
            chart = self._by_key.get((r["song_id"], r["difficulty"]))
            if chart is None:
                continue
            # clear 不明の記録はクリア扱い (HIGH SCORE 欄の記録はほぼクリア済みのため)
            pot = play_potential(chart["constant"], r["score"], r["clear"] or "TC")
            key = (r["song_id"], r["difficulty"])
            cur = best.get(key)
            if cur is None or (pot, r["score"]) > (cur.potential, cur.score):
                best[key] = Best(chart, r["score"], r["clear"], pot, r["played_at"])
        return sorted(best.values(), key=lambda b: (b.potential, b.score), reverse=True)

    def b50(self, user_id, at=None):
        top = self.bests(user_id, at)[:B50_SIZE]
        return top, total_potential([b.potential for b in top])
