# Arcaea B50

Arcaea のリザルト画面のスクショから、ベスト枠 (B50) とポテンシャルを計算する Web アプリ (PWA)。
解析も記録の保存もすべてブラウザ内で行い、サーバーには何も送りません。

## 使い方

1. アプリを開き、スマホなら「ホーム画面に追加」
2. リザルト画面のスクショを「スクショを追加」から選ぶ (Android はギャラリーの共有メニューからも送れます)
3. 譜面・スコア・判定数を自動で読み取り、B50 を更新

記録はそのブラウザにだけ保存されます。設定からバックアップ (JSON) を書き出しておいてください。

現在対応している画面比率は 2340×1080 (19.5:9) のみです。

## 仕組み

- **ポテンシャル (v7)**: 単曲 = 定数 + スコア係数 + 0.2 (TRACK LOST 以外)、総合 = (2 × 上位10 + 11〜50位) / 60 を小数第3位で切り捨て。
  Arcaea Online のベスト枠画像 18 枚で全枠一致を確認 (`scripts/verify.py`)。
- **譜面定数**: [Tachi](https://github.com/zkldi/Tachi) の seeds (Unlicense) + 画像で確認した補正 (`data/overrides.csv`)。
- **スクショ解析**: 数字は固定フォントのテンプレート照合、難易度・曲名は Tesseract。
  譜面は曲名に頼らず「PURE+FAR+LOST = ノーツ数」と「スコア = 10M × (PURE + FAR/2) / ノーツ数 + 大PURE数」で特定する。

## 開発

```sh
cd web
npm install
npm run dev        # 開発サーバー
npm run data       # data/tachi + data/overrides.csv から public/data/charts.json を生成
npm run eval       # 正解データで解析精度を評価 (手元の data/results_* が必要)
```

`core/` `scripts/` は Python 版のプロトタイプ・検証用ツールです。
