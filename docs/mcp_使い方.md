# Claudeチャットから MEO投稿ツールを操作する（カスタムコネクタ）

## しくみ
- `https://meo-thumbnail-tools.vercel.app/api/mcp/<秘密キー>` が MCP サーバー
- アプリ（studio）と同じ Firestore を読み書きするので、チャットで保存 → アプリに即反映（逆も同じ）
- 秘密キーは Vercel の環境変数 `MCP_KEY`。URLを人に見せない。漏れたら `npx vercel env rm MCP_KEY production` → `env add` で再発行

## 登録（1回だけ・スマホでもPCでも）
1. Claude アプリ → 設定 → **コネクタ** → 「カスタムコネクタを追加」
2. 名前：`MEO投稿ツール`、URL：上のURL（キー入り）を貼る → 追加
3. チャット画面の「＋」や検索/ツールの設定で、このコネクタがONになっていることを確認

おすすめ：Claude の「プロジェクト」を1つ作り、指示に次を書いておく
```
あさばグループのMEO投稿ツール（コネクタ）を使う。
本文を書くときは必ず先に get_writing_guide を呼び、返ってきたルール・店舗プロフィール・キーに従って書き、save_contents で保存する。
保存結果の check に指摘があれば直して mode:"merge" で再保存する。
出力は export_file でURLを受け取り、リンクを案内する。
```

## チャットでの言い方（例）
| 言い方 | 使われるツール |
|---|---|
| 9月の予定を一覧して | list_schedules |
| 9/18の予定の詳細（本文も） | get_schedule（with_contents） |
| 10/2 A枠「秋の腰痛」で予定を作って（型は縦リズム・画像は人物なし） | create_schedule |
| 9/18の本文を全店舗分書いて保存して | get_writing_guide → save_contents |
| 9/18のエクセルをちょうだい | export_file → URLをタップしてダウンロード |
| 9/18の画像名を「寒暖差_09-18.jpg」にして | set_image |
| 柏の葉整骨院の電話番号を 04-7128-9491 に直して | update_store |
| 9/11を投稿済みにして | set_post_status |
| 定例指示に「〜」を追加して | add_rule |

## できないこと
- サムネ画像の作成・ギャラリーへの追加（サムネツールで従来どおり）
- ファイルのチャット添付（ダウンロードURLを開く形）
