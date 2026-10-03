# asaba-tools（あさばグループ MEO運用ツール）

- 構成：`studio.html`（MEO投稿 統合ツール）／`thumbnail/`（サムネツール）／`api/mcp/[key].js`（claude.ai カスタムコネクタ）／`api/export/[key].js`（GMO一括投稿ファイル）／`lib/meo.js`（サーバー側の共通ロジック）
- データは Firestore（`artifacts/asaba-thumbnail/public/data/*`）。アプリとMCPで同じデータを読み書きする
- 画面に機能を足したら、同じ操作をMCPツールでもできるようにする（studio.html と lib/meo.js の同名関数はそろえる）
- 既存の `export_file` / `set_image` / `save_contents` の挙動は変えない（後方互換）

## 投稿本文を書くとき（/meo-month など）
- **必ず MEOコネクタの `get_writing_guide` を読んでから書く**。文章ルールの正本はアプリの定例指示（`list_rules`）と `get_writing_guide` だけ。このファイルにルール本文を書き写さない
- 画像指示文を書くときは `get_image_guide` を読む
