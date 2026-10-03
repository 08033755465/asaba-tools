---
description: MEO投稿の月次本文生成（サンプル承認済みの予定を19店舗へ展開→チェック→保存→画像名登録→月サマリー）
argument-hint: <YYYY-MM> [予定ID] [--dry-run]
---

# /meo-month — 月の本文を19店舗に展開する

引数：`$ARGUMENTS`

- 1つ目：対象月 `YYYY-MM`（必須。無ければ聞き返して止まる）
- `--dry-run` があれば：**保存・画像名登録を一切しない**。生成結果とチェック結果を表示するだけ
- それ以外の語（`--dry-run` でも月でもない）は予定IDとして扱い、その予定だけを対象にする

使うのは MEO投稿ツールのコネクタ（MCP）のツールだけ。ルールの正本は **アプリの定例指示（list_rules）と get_writing_guide** で、このファイルにはルール本文を書かない。

## 手順

### 0. 対象を決める
1. `list_schedules`（month）で月の予定を取る。予定ID指定があればその1件だけ
2. `postStatus` が retired（今後未使用）の予定は除外
3. **`sampleApproved` が true でない予定はスキップ**し、「サンプル未承認のためスキップ」として最後に報告する
4. 対象が0件ならその旨を報告して終わる

### 1. 予定ごとにくり返す
1. `get_writing_guide`（id）を呼び、`guide`（指示文）・`keys`（保存キー）・`usage`（店舗ごとの直近3予定の使用履歴）・`sample`（代表店舗のお手本）・`gyotaiGroups`（業態ごとの店舗ID）を読む。**guide の内容に必ず従う**
2. 本文を生成する
   - `sample` があれば、型の構成と温度感をそろえる「お手本」として読む。**文章の丸写しはしない**
   - `usage` を見て、店舗ごとに **直近と違うUSP・読み手・締め** を選ぶ。託児は直近3回で触れていれば今回は触れない
   - **A投稿（abType: A）**：店舗ごとに1本ずつ（keys の店舗IDごと）
   - **B投稿（abType: B）**：**業態ごとに1本だけ生成**し、`gyotaiGroups` の同じ業態の全店舗キーへ同じ文面を入れる（19回生成しない）
   - カテゴリ共通（keys が seitai_seikotsu / pilates）の予定はそのキーで1本ずつ
3. `--dry-run` のとき：生成結果と `check_text`（contents）のチェック結果を表示して次の予定へ（保存しない）
4. 本実行：`save_contents`（id・contents・mode は "replace"・**meta**）で保存する
   - meta はキーごとに `{usp, childcare, reader, closing}`（使った強み／託児に触れたか true・false／想定した読み手／使った締め＝後押しフレーズ集の番号 or 自由記述）
5. 返ってきた `issues`（NG語・電話番号・横棒・AI調の言い回し）と `check`（文字数・絵文字数）を確認する
   - 指摘のある店舗**だけ**書き直し、`save_contents`（mode: "merge"、そのキーの contents と meta だけ）で再保存
   - 1店舗あたり最大3回。3回で直らなければ「NG残り」として記録して次へ
6. 画像名：予定の `imageTitle` が空なら、月の最後にまとめて `set_images_bulk`（month、overwrite は付けない）で命名規則どおりに登録する（dry-run では `dry_run: true` で結果だけ見る）

### 2. 月のサマリーを表示
表で出す：

| 予定日 | A/B | 型 | キャッチ | 保存件数 | NG残り | 画像ステータス | USP使用状況 |
|---|---|---|---|---|---|---|---|

- 画像ステータスは `list_schedules` の `imageStatusLabel`（未設定／名前のみ／準備OK）
- USP使用状況：店舗ごとに今回使ったUSPを短く。前回と同じになった店舗があれば ⚠️ を付ける
- スキップした予定（サンプル未承認など）と理由
- NG残りがあれば店舗名と指摘を一覧で
- 最後に「まとめ出力は アプリの📦まとめて出力 か export_files（month, onlyImageReady）で」と案内する
