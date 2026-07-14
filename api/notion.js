// MEO運用ツール ⇔ Notion 連携プロキシ（Vercel サーバーレス関数）
// ブラウザから直接 Notion API は叩けない（CORS・トークン露出）ため、
// この関数がサーバー側で Notion トークンを保持して中継する。
//
// 必要な環境変数（Vercel の Project Settings → Environment Variables で設定）:
//   NOTION_TOKEN … Notion インテグレーションの内部トークン（ntn_… / secret_…）
//   APP_SECRET   … 任意。設定すると x-app-secret ヘッダー一致を必須にして外部からの悪用を防ぐ
//
// リクエスト（POST, JSON）:
//   { op:'query',  ds:'<data_source_id>', body:{...} }       → 一覧取得
//   { op:'create', ds:'<data_source_id>', properties:{...} } → ページ作成
//   { op:'update', pageId:'<page_id>',    properties:{...} } → ページ更新
//   { op:'ping' }                                            → 疎通確認
//   { op:'icon_upload', pageId, propertyName, filename, dataUrl } → 画像をNotionへアップロードしFilesプロパティに設定

const NOTION_API = 'https://api.notion.com/v1';
const NOTION_VERSION = '2025-09-03'; // data_source エンドポイント対応バージョン

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-app-secret');
}

async function notion(path, method, body) {
  const r = await fetch(NOTION_API + path, {
    method,
    headers: {
      'Authorization': 'Bearer ' + process.env.NOTION_TOKEN,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch (e) { data = { raw: text }; }
  return { status: r.status, data };
}

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'POSTのみ対応しています' }); return; }

  if (!process.env.NOTION_TOKEN) {
    res.status(500).json({ error: 'NOTION_TOKEN が未設定です（Vercel の環境変数を確認してください）' });
    return;
  }
  if (process.env.APP_SECRET && req.headers['x-app-secret'] !== process.env.APP_SECRET) {
    res.status(401).json({ error: '認証エラー（x-app-secret が一致しません）' });
    return;
  }

  let p = req.body;
  if (typeof p === 'string') { try { p = JSON.parse(p); } catch (e) { p = {}; } }
  p = p || {};

  try {
    if (p.op === 'ping') {
      const out = await notion('/users/me', 'GET');
      res.status(out.status).json(out.data);
      return;
    }
    if (p.op === 'query') {
      if (!p.ds) { res.status(400).json({ error: 'ds（data_source_id）が必要です' }); return; }
      const out = await notion('/data_sources/' + p.ds + '/query', 'POST', p.body || {});
      res.status(out.status).json(out.data);
      return;
    }
    if (p.op === 'create') {
      if (!p.ds) { res.status(400).json({ error: 'ds（data_source_id）が必要です' }); return; }
      const out = await notion('/pages', 'POST', {
        parent: { type: 'data_source_id', data_source_id: p.ds },
        properties: p.properties || {},
      });
      res.status(out.status).json(out.data);
      return;
    }
    if (p.op === 'update') {
      if (!p.pageId) { res.status(400).json({ error: 'pageId が必要です' }); return; }
      const out = await notion('/pages/' + p.pageId, 'PATCH', { properties: p.properties || {} });
      res.status(out.status).json(out.data);
      return;
    }
    if (p.op === 'icon_upload') {
      if (!p.pageId) { res.status(400).json({ error: 'pageId が必要です' }); return; }
      if (!p.dataUrl) { res.status(400).json({ error: 'dataUrl が必要です' }); return; }
      const propName = p.propertyName || 'アプリアイコン';
      // dataUrl → Buffer
      const m = /^data:(image\/(png|jpeg));base64,(.+)$/.exec(p.dataUrl);
      if (!m) { res.status(400).json({ error: 'dataUrl は image/png または image/jpeg の base64 で指定してください' }); return; }
      const mime = m[1];
      const ext = m[2] === 'jpeg' ? 'jpg' : 'png';
      const buf = Buffer.from(m[3], 'base64');
      const filename = (p.filename && String(p.filename).replace(/[^\w\-. ぁ-んァ-ヶ一-龠]/g, '_')) || ('icon.' + ext);

      // 1) file_upload を作成（single_part 前提。5MB以内）
      const create = await notion('/file_uploads', 'POST', { mode: 'single_part', filename, content_type: mime });
      if (create.status >= 300) { res.status(create.status).json({ error: 'file_upload作成失敗', detail: create.data }); return; }
      const uploadId = create.data.id;
      const uploadUrl = create.data.upload_url;

      // 2) upload_url にファイルを multipart で送信
      const boundary = '----NotionUpload' + Math.random().toString(16).slice(2);
      const pre = Buffer.from(
        '--' + boundary + '\r\n' +
        'Content-Disposition: form-data; name="file"; filename="' + filename + '"\r\n' +
        'Content-Type: ' + mime + '\r\n\r\n', 'utf8');
      const post = Buffer.from('\r\n--' + boundary + '--\r\n', 'utf8');
      const body = Buffer.concat([pre, buf, post]);
      const up = await fetch(uploadUrl, {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + process.env.NOTION_TOKEN,
          'Notion-Version': NOTION_VERSION,
          'Content-Type': 'multipart/form-data; boundary=' + boundary,
        },
        body,
      });
      const upText = await up.text();
      let upJson; try { upJson = JSON.parse(upText); } catch (e) { upJson = { raw: upText }; }
      if (!up.ok) { res.status(up.status).json({ error: 'アップロード失敗', detail: upJson }); return; }

      // 3) ページのプロパティを更新（既存のファイル配列は置き換え）
      const patch = {
        properties: {
          [propName]: {
            files: [
              {
                type: 'file_upload',
                name: filename,
                file_upload: { id: uploadId },
              }
            ]
          }
        }
      };
      const out = await notion('/pages/' + p.pageId, 'PATCH', patch);
      res.status(out.status).json(out.data);
      return;
    }
    res.status(400).json({ error: '不明な op です: ' + p.op });
  } catch (e) {
    res.status(500).json({ error: '中継エラー: ' + (e && e.message ? e.message : String(e)) });
  }
};
