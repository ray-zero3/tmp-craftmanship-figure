# Recursive Echo

## Project Overview
AIとの協働によるコード制作のプロセスログを可視化する作品。
Sol LeWittのコンセプチュアルアートの系譜を暗黙的に引用しつつ、AIと人間の作者性を問う。

## Target Exhibition
- **展覧会**: AI ART meets Art Fair (https://art-marche.jp/ai-art-award/)
- **締切**: 2026年3月31日
- **サイズ制限**: 2D作品は最大100cm×100cm
- **展示場所**: ホテル客室ブース
- **提出物**: ステートメント、使用AI・技術、AIの使用範囲、高品質画像3点

## Decided Specifications

### Format
- **サイズ**: 30×30cm（300dpi → 3543×3543px）
- **素材**: 紙1枚
- **色**: モノクロ（白黒の点描）

### Data
- **ログ**: 既存ログ（craftsmanship展の制作過程）＋今回のリバイス作業のログを重ねる
- **ログファイル**: `.craftlog/merged.jsonl`
### Visual Rules — Flowing Layout
ログを `ai_prompt` イベントの発生タイミングでサイクルに分割し、各サイクルから3種のセルを生成してフローイングレイアウトで配置する。

- **3種のセル**:
  1. **Prompt（injection）**: 白とグレーの中間色のgap。プロンプト長に応じて微かに幅が変わる（重みは通常セルの約4%）
  2. **AI実装**: 黒背景＋白い点描。密度はAIによる変更量に比例
  3. **Human実装**: 白背景＋黒い点描。密度は人間による変更量に比例
- **レイアウト**: セルは左→右に流れ、行を折り返す。行の高さは均等。セル幅は `log1p(totalChars)` に比例
- **点描の濃淡**: `pow(log1p(chars)/log1p(maxChars), 3.0)` — べき乗3.0で強いコントラスト。最大2500ドット/参照面積
- **分離表示**: 3パネル（Prompt | AI | Human）で各レイヤーを個別に確認可能

### Concept (3 Axes)
1. **プログラムを書かないプログラマー** — 自分の手が離れていく実感
2. **AIから影響を受けている自覚** — 指示者が実行者に教育される逆転
3. **Sol LeWittへの暗黙の参照** — 明言せず、「指示→実行」の構造自体がフックになるようにする

## Undecided
- [ ] タイトル（「Recursive Echo」を継続するか変更するか）
- [ ] ステートメント
- [ ] 提出用画像3点の構成
- [ ] 凡例の文体

## Tech Stack
- p5.js (canvas drawing, instance mode)
- Vite (build tool)
- sharp, pdfkit (高解像度エクスポート用)

### Commands
- `npm run dev` — ローカル開発サーバー起動
- `npm run build` — `dist/` にビルド出力
- `bash merge.sh` — `.craftlog/S_*.jsonl` を `merged.jsonl` に統合

### Output Directories
- `dist/` — Viteビルド出力（git未追跡）
- `docs/` — 過去の展示資料

### Source Files
- `src/layers.js` — コア描画モジュール。buildCycles, computeFlowLayout, drawCellMotif, drawCycleGrid, drawCycleGridSeparated
- `src/visualization.js` — データ読み込み、p5スケッチ生成、30cmエクスポート
- `src/main.js` — エントリーポイント。Combined/Layers表示切替、エクスポートボタン
- `src/config.js` — サイズ定数（PREVIEW_SIZE=800, SQUARE_30CM=3543）
- `src/helpers.js` — JSONL解析、サマリー生成
- `src/lewitt.js` — 旧可視化モジュール（現在未使用）
- `merge-craftlog.js` — ログマージスクリプト本体
- `merge.sh` — マージ実行用シェルスクリプト
