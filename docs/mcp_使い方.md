# Claudeチャットから MEO投稿ツールを操作する（カスタムコネクタ）

## しくみ
- `https://meo-thumbnail-tools.vercel.app/api/mcp/<秘密キー>` が MCP サーバー
- アプリ（studio）と同じ Firestore を読み書きするので、チャットで保存 → アプリに即反映（逆も同じ）
- 秘密キーは Vercel の環境変数 `MCP_KEY`。**Vercel上は「Secret」扱いで、一度保存すると二度と画面に表示されない**
  → キー入りURLは必ず自分の手元（パスワード管理アプリ／Notionの私的ページ）に控えておくこと
- URLを人に見せない。漏れた／分からなくなったら再発行（下記）

## スマホのClaudeアプリで使う（登録は1回だけ）
コネクタはアカウント単位なので、**スマホで1回登録すればPCのClaudeでもそのまま使える**（逆も同じ）。

1. Claudeアプリ → 左上のメニュー → **設定** → **コネクタ**
2. 「カスタムコネクタを追加」
3. 名前：`MEO投稿ツール` ／ URL：控えてあるキー入りURLを貼る → 追加
4. チャット画面の「＋」（ツール）から、このコネクタが**オン**になっているか確認

### スマホで打ちやすくする（推奨）
Claudeの「**プロジェクト**」を1つ作り、プロジェクトの指示に次を貼っておく。
以降そのプロジェクト内で話しかけるだけでよくなり、毎回の前置きが要らない。

```
あさばグループのMEO投稿ツール（コネクタ）を使う。
本文を書くときは必ず先に get_writing_guide を呼び、返ってきたルール・店舗プロフィール・キーに従って書き、save_contents で保存する。
保存結果の check に指摘があれば直して mode:"merge" で再保存する。
出力は export_file でURLを受け取り、リンクを案内する。
返事は日本語で、専門用語を使わず短くまとめる。
```

### スマホでの注意
- **エクセルの受け取り**：`export_file` が返すリンクをタップ →「ファイル」アプリに保存される。GMOへの取り込みはPCで行う
- **画像の作成は不可**：サムネイル画像はサムネツール（PC）で作る。チャットからできるのは画像"名"の設定まで
- リンクにも秘密キーが入っているので、他の人に転送しない

## 秘密キーの再発行（分からなくなったとき）
ターミナルで、asaba-tools フォルダに移動して順に実行する。

```bash
openssl rand -hex 24
```
表示された文字列を控える。続けて：
```bash
npx vercel env rm MCP_KEY production --yes
npx vercel env add MCP_KEY production
npx vercel deploy --prod --yes
```
`env add` で先ほどの文字列を貼る。完了後、新しいURLは
`https://meo-thumbnail-tools.vercel.app/api/mcp/<新しい文字列>`

※再発行すると**前のURLは使えなくなる**ので、登録済みのコネクタは登録し直しになる。

## チャットでの言い方（例）
| 言い方 | 使われるツール |
|---|---|
| 9月の予定を一覧して | list_schedules |
| 9/18の予定の詳細（本文も） | get_schedule（with_contents） |
| 10/2 A枠「秋の腰痛」で予定を作って（型は縦リズム・画像は人物なし） | create_schedule |
| 9/18の本文を全店舗分書いて保存して | get_writing_guide → save_contents |
| 9/18のエクセルをちょうだい | export_file → URLをタップしてダウンロード |
| 9/18の画像名を「寒暖差_09-18.jpg」にして | set_image |
| 10/9の画像指示文を作って保存して | get_image_guide → update_schedule（fields.imagePrompt） |
| 10月の画像名を命名規則どおりに一括で入れて | set_images_bulk（month） |
| 10月の画像準備OKの分だけ1ファイルでちょうだい | export_files（month, onlyImageReady） |
| 10/6〜10/9の予定をまとめて出力 | export_files（ids） |
| 10/13のサンプル本文OK、代表店舗は八潮店で | update_schedule（sampleApproved, sampleStore） |

## 2026-10 追加分
- `update_schedule` の fields で `imagePrompt`（ChatGPTに貼る全文。末尾の固定文は自動付与）／`imageMemo`（短い要約）／`imageSource`（ai／photo）／`imageReady`（手動の準備OK）／`sampleApproved`／`sampleStore` を更新できる
- `list_schedules`・`get_schedule` は `imagePrompt`・`imageSource`・`imageStatus`（none=未設定／nameonly=名前のみ／ready=準備OK）を返す
- `save_contents` に任意の `meta`（キーごとに usp / childcare / reader / closing）を渡すと店舗ごとの使用履歴として記録。`get_writing_guide` は直近3予定の履歴（usage）・お手本（sample）・業態ごとの店舗ID（gyotaiGroups）を返す
- `export_files` は `dryRun:true` で記録・状態変更をせずに行数・列数・チェック結果だけ確認できる
- Claude Code では `/meo-month 2026-11`（`--dry-run`／予定ID指定可）で、サンプル承認済みの予定を19店舗へ展開→チェック→保存→画像名登録→月サマリーまで回せる（`.claude/commands/meo-month.md`）
| 柏の葉整骨院の電話番号を 04-7128-9491 に直して | update_store |
| 9/11を投稿済みにして | set_post_status |
| 定例指示に「〜」を追加して | add_rule |

## できないこと
- サムネ画像の作成・ギャラリーへの追加（サムネツールで従来どおり）
- ファイルのチャット添付（ダウンロードURLを開く形）

---
更新履歴
- 2026-09-19：秘密キーを再発行。スマホ登録手順・プロジェクト設定・再発行手順を追記
