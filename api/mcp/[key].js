// MEO投稿 統合ツール MCPサーバー（Streamable HTTP・JSON-RPC）
// claude.ai のカスタムコネクタとして登録すると、スマホ/PCのClaudeチャットから予定・本文・店舗・出力ファイルを操作できる。
//
//   URL: https://<host>/api/mcp/<MCP_KEY>   ← MCP_KEY は Vercel の環境変数（URLに含めた秘密キーが認証）
//
// 対応メソッド: initialize / notifications/* (202) / ping / tools/list / tools/call / resources/list / prompts/list
const crypto = require('crypto');
const M = require('../../lib/meo');

const SERVER_INFO = { name: 'asaba-meo-post-studio', version: '2026-09-05.1' };

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Authorization, Mcp-Session-Id, MCP-Protocol-Version, Last-Event-ID');
  res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');
}
function keyOk(given) {
  const want = process.env.MCP_KEY || '';
  if (!want || !given) return false;
  const a = Buffer.from(String(given)), b = Buffer.from(want);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ===== ツール定義 =====
const S = (props, required = []) => ({ type: 'object', properties: props, required, additionalProperties: false });
const str = (d) => ({ type: 'string', description: d });
const bool = (d) => ({ type: 'boolean', description: d });
const TOOLS = [
  { name: 'list_stores', description: '店舗の一覧（有効店舗）。店舗ID(gmo)・店名・業態・エリア・営業時間・予約リンク・強み・客層など要約を返す。', inputSchema: S({ include_inactive: bool('無効店舗も含める') }) },
  { name: 'get_store', description: '店舗マスタの全項目（リンク帳 linkBank を含む）。store には店舗ID か 店名（部分一致可）を渡す。', inputSchema: S({ store: str('店舗ID または 店名') }, ['store']) },
  { name: 'update_store', description: '店舗マスタを部分更新する。fields に変更したい項目だけを渡す（例 {"phone":"04-...","hours":"月〜土 9:20〜18:30"}）。', inputSchema: S({ store: str('店舗ID または 店名'), fields: { type: 'object', description: '更新する項目', additionalProperties: true } }, ['store', 'fields']) },
  { name: 'list_schedules', description: '投稿予定の一覧。month（"2026-09"）または from/to（YYYY-MM-DD）で絞る。省略時は今月。', inputSchema: S({ month: str('対象月 YYYY-MM'), from: str('開始日 YYYY-MM-DD'), to: str('終了日 YYYY-MM-DD'), include_past: bool('過去すべて') }) },
  { name: 'get_schedule', description: '予定1件の全項目。with_contents=true で保存済み本文も返す。', inputSchema: S({ id: str('予定ID'), with_contents: bool('本文も返す') }, ['id']) },
  { name: 'create_schedule', description: '投稿予定を新規作成する。date必須。time省略時は abType A=16:00 / B=07:00。scope は category_common（整体整骨＋Peaceの2本）か per_store（店舗別）。storeIds 省略時は全店。', inputSchema: S({
    title: str('テーマ／共通タイトル'), catchTitle: str('キャッチコピー（GMOのタイトル欄）'), date: str('投稿日 YYYY-MM-DD'), time: str('投稿時間 HH:MM'), abType: str('配信枠 A/B'),
    kw: str('狙うキーワード'), context: str('今回の文脈・特別指示'), imageMemo: str('画像メモ（「人物なし」で情景のみ）'), formatId: str('投稿の型 f_season/f_symptom/f_story/f_rhythm/f_menu'),
    postType: str('最新情報/イベント/クーポン'), btnType: str('予約/詳細/今すぐ電話/なし など'), scope: str('category_common または per_store'), storeIds: { type: 'array', items: { type: 'string' }, description: '対象店舗IDの配列' },
    timing: str('scheduled または immediate'), evStart: str('掲載開始日'), evEnd: str('掲載終了日'), evStartTime: str('開始時間 HH:MM'), evEndTime: str('終了時間 HH:MM') }, ['title', 'date']) },
  { name: 'update_schedule', description: '予定を部分更新する（本文以外）。fields に変更項目だけを渡す。', inputSchema: S({ id: str('予定ID'), fields: { type: 'object', description: '更新する項目', additionalProperties: true } }, ['id', 'fields']) },
  { name: 'delete_schedule', description: '予定を削除する。', inputSchema: S({ id: str('予定ID') }, ['id']) },
  { name: 'get_writing_guide', description: '本文を書く前に必ず呼ぶ。その予定の指示文（テーマ・型の構成・厳守ルール・定例指示・NG語・対象店舗のプロフィール・保存時のキー）を返す。', inputSchema: S({ id: str('予定ID') }, ['id']) },
  { name: 'save_contents', description: '本文を予定に保存する。contents は {キー: 本文} の形。キーは店舗ID（店舗別）か seitai_seikotsu / pilates（カテゴリ共通）。mode=merge で一部だけ差し替え、既定は replace。保存後に各本文のチェック結果を返す。', inputSchema: S({ id: str('予定ID'), contents: { type: 'object', description: '{キー: 本文}', additionalProperties: { type: 'string' } }, mode: str('replace または merge') }, ['id', 'contents']) },
  { name: 'check_text', description: '本文のチェック（文字数・絵文字数・NG語・電話番号・横棒・AI調の言い回し）。text か contents のどちらか。', inputSchema: S({ text: str('本文'), contents: { type: 'object', additionalProperties: { type: 'string' } } }) },
  { name: 'set_image', description: '予定に画像名を設定する（GMOで通る安全な名前に自動変換）。ギャラリーに同名があるかも返す。', inputSchema: S({ id: str('予定ID'), imageTitle: str('画像名（例 秋バテ_09-07.jpg）') }, ['id', 'imageTitle']) },
  { name: 'list_gallery', description: 'チームギャラリーの画像名を検索する。', inputSchema: S({ q: str('検索語'), limit: { type: 'integer' } }) },
  { name: 'export_file', description: 'GMO一括投稿ファイル（xlsx/csv）のダウンロードURLを返す。出力前に本文の空き・NG語をチェックし、履歴に記録して予定を出力済みにする。', inputSchema: S({ id: str('予定ID'), fmt: str('xlsx または csv'), force: bool('NGがあっても出力する') }, ['id']) },
  { name: 'set_post_status', description: '予定の投稿状態を記録する。status: posted（投稿済）/ canceled（取消）/ mistake（誤投稿）/ retired（今後未使用）/ 空文字でリセット。', inputSchema: S({ id: str('予定ID'), status: str('posted/canceled/mistake/retired/""'), postedDate: str('実際の投稿日 YYYY-MM-DD'), note: str('メモ') }, ['id', 'status']) },
  { name: 'list_rules', description: '定例指示（毎回の指示文に自動で付く注意事項）の一覧。', inputSchema: S({}) },
  { name: 'add_rule', description: '定例指示を追加する。type は post（投稿文）か image（画像）。', inputSchema: S({ body: str('指示の文面'), type: str('post または image') }, ['body']) },
  { name: 'delete_rule', description: '定例指示を削除する。', inputSchema: S({ id: str('定例指示ID') }, ['id']) },
];

// ===== ツール本体 =====
const TIME_DEFAULT = { A: '16:00', B: '07:00' };
function pick(obj, keys) { const o = {}; keys.forEach(k => { if (obj[k] !== undefined) o[k] = obj[k]; }); return o; }
async function getSched(id) { const s = await M.getDoc('studio_schedule', id); if (!s) throw new Error(`予定 ${id} が見つかりません`); return s; }
function checkContents(contents) {
  const out = {};
  for (const [k, v] of Object.entries(contents || {})) { const r = M.validate(v); out[k] = { chars: r.chars, emoji: r.emoji, ng: r.ng, phone: r.phone, dash: r.dash, claim: r.claim, privacy: r.privacy, aiPhrases: r.aiPhrases, ok: r.ok && !r.aiPhrases.length }; }
  return out;
}

async function callTool(name, a, ctx) {
  a = a || {};
  switch (name) {
    case 'list_stores': {
      const { STORES } = await M.loadStores({ includeInactive: !!a.include_inactive });
      return { count: STORES.length, stores: STORES.map(M.storeSummary) };
    }
    case 'get_store': {
      const { STORES } = await M.loadStores({ includeInactive: true });
      const s = M.findStore(STORES, a.store); if (!s) throw new Error(`店舗が見つかりません: ${a.store}`);
      return s._m;
    }
    case 'update_store': {
      const { STORES } = await M.loadStores({ includeInactive: true });
      const s = M.findStore(STORES, a.store); if (!s) throw new Error(`店舗が見つかりません: ${a.store}`);
      const fields = { ...(a.fields || {}) }; delete fields.id;
      await M.mergeDoc('studio_stores', s._m.id, { ...fields, updatedAt: Date.now(), updatedBy: 'claude-mcp' });
      return { ok: true, store: s.name, updated: Object.keys(fields) };
    }
    case 'list_schedules': {
      const all = await M.listDocs('studio_schedule');
      let from = a.from || '', to = a.to || '';
      if (a.month) { from = a.month + '-01'; to = a.month + '-31'; }
      if (!from && !to && !a.include_past) { const m = M.todayISO().slice(0, 7); from = m + '-01'; to = m + '-31'; }
      const list = all.filter(s => (!from || (s.date || '') >= from) && (!to || (s.date || '') <= to)).sort((x, y) => (x.date || '').localeCompare(y.date || '') || (x.time || '').localeCompare(y.time || ''));
      return { count: list.length, schedules: list.map(M.schedSummary) };
    }
    case 'get_schedule': {
      const s = await getSched(a.id);
      const out = { ...s };
      if (!a.with_contents) { out.contentsKeys = Object.keys(s.contents || {}); delete out.contents; delete out.overrides; }
      delete out.imageUrl;
      return out;
    }
    case 'create_schedule': {
      const { STORES } = await M.loadStores();
      const id = M.uid();
      const ab = (a.abType || 'A').toUpperCase();
      const rec = { id, title: a.title, catchTitle: a.catchTitle || '', themeTitle: a.title, date: a.date, time: a.time || TIME_DEFAULT[ab] || '16:00', abType: ab,
        kw: a.kw || '', context: a.context || '', imageMemo: a.imageMemo || '', imageTitle: '', imageId: '', imageUrl: '',
        postType: a.postType || '最新情報', btnType: a.btnType || '', formatId: a.formatId || '', evStart: a.evStart || '', evEnd: a.evEnd || '', evStartTime: a.evStartTime || '', evEndTime: a.evEndTime || '',
        timing: a.timing || 'scheduled', scope: a.scope || 'category_common', storeIds: (a.storeIds && a.storeIds.length) ? a.storeIds.map(String) : STORES.map(s => s.gmo),
        contents: {}, overrides: {}, done: false, posted: false, postStatus: '', postedDate: '', postedAt: '', postNote: '', createdBy: 'claude-mcp' };
      await M.setDoc('studio_schedule', id, rec);
      return { ok: true, schedule: M.schedSummary(rec), next: `本文を書くなら get_writing_guide {"id":"${id}"} を呼んでください` };
    }
    case 'update_schedule': {
      const s = await getSched(a.id);
      const fields = pick(a.fields || {}, M.SCHED_FIELDS.filter(k => k !== 'contents' && k !== 'overrides'));
      if (fields.imageTitle) fields.imageTitle = M.safeImgName(fields.imageTitle);
      if (fields.storeIds) fields.storeIds = fields.storeIds.map(String);
      await M.mergeDoc('studio_schedule', s.id, fields);
      return { ok: true, updated: Object.keys(fields), schedule: M.schedSummary({ ...s, ...fields }) };
    }
    case 'delete_schedule': {
      const s = await getSched(a.id);
      await M.deleteDoc('studio_schedule', s.id);
      return { ok: true, deleted: M.schedSummary(s) };
    }
    case 'get_writing_guide': {
      const s = await getSched(a.id);
      const { STORES, catLabel } = await M.loadStores();
      const g = await M.writingGuide(s, STORES, catLabel);
      return { schedule: M.schedSummary(s), format: g.formatName, keys: g.keys, guide: g.text };
    }
    case 'save_contents': {
      const s = await getSched(a.id);
      const { STORES } = await M.loadStores();
      const incoming = {}; for (const [k, v] of Object.entries(a.contents || {})) incoming[String(k)] = String(v || '').trim();
      const keys = Object.keys(incoming); if (!keys.length) throw new Error('contents が空です');
      const perStore = keys.every(k => /^\d+$/.test(k));
      const unknown = perStore ? keys.filter(k => !STORES.some(st => st.gmo === k)) : keys.filter(k => !['seitai_seikotsu', 'pilates', 'other'].includes(k));
      if (unknown.length) throw new Error(`不明なキー: ${unknown.join(', ')}（店舗IDか seitai_seikotsu/pilates を使ってください）`);
      // merge でも「店舗別」と「カテゴリ共通」のキーは混ぜない（今回のキー種別に合わせて残す）
      const keep = {}; if (a.mode === 'merge') for (const [k, v] of Object.entries(s.contents || {})) { if (/^\d+$/.test(k) === perStore) keep[k] = v; }
      const contents = { ...keep, ...incoming };
      const fields = { contents };
      if (perStore) { fields.scope = 'per_store'; fields.storeIds = Object.keys(contents); }
      else { fields.scope = 'category_common'; if (!(s.storeIds || []).length) fields.storeIds = STORES.map(st => st.gmo); }
      await M.mergeDoc('studio_schedule', s.id, fields);
      const check = checkContents(incoming);
      const issues = Object.entries(check).filter(([, v]) => !v.ok).map(([k, v]) => ({ key: k, ng: v.ng, phone: v.phone, dash: v.dash, aiPhrases: v.aiPhrases }));
      return { ok: true, saved: keys.length, scope: fields.scope, totalContents: Object.keys(contents).length, check, issues, note: issues.length ? '指摘のある本文を直して save_contents（mode:"merge"）で再保存してください' : 'すべてチェックOKです' };
    }
    case 'check_text': {
      if (a.contents) return checkContents(a.contents);
      return M.validate(a.text || '');
    }
    case 'set_image': {
      const s = await getSched(a.id);
      const safe = M.safeImgName(a.imageTitle);
      const gal = await M.listDocs('shared_thumbnails');
      const hit = gal.find(g => M.safeImgName((g.folderName || g.titleText || '') + '.jpg') === safe);
      await M.mergeDoc('studio_schedule', s.id, { imageTitle: safe, imageId: hit ? hit.id : (s.imageId || '') });
      return { ok: true, imageTitle: safe, changed: safe !== a.imageTitle, inGallery: !!hit, note: hit ? 'ギャラリーに同名の画像があります' : 'ギャラリーに同名がありません。GMOにアップする画像名をこの名前に合わせてください' };
    }
    case 'list_gallery': {
      const gal = await M.listDocs('shared_thumbnails');
      const q = String(a.q || '').toLowerCase();
      const list = gal.filter(g => !q || ((g.folderName || '') + (g.titleText || '')).toLowerCase().includes(q)).sort((x, y) => (y.createdAt || 0) - (x.createdAt || 0)).slice(0, a.limit || 30);
      return { count: list.length, images: list.map(g => ({ id: g.id, name: M.safeImgName((g.folderName || g.titleText || '') + '.jpg'), linkedScheduleTitle: g.linkedScheduleTitle || '', createdAt: g.createdAt ? new Date(g.createdAt).toISOString().slice(0, 10) : '' })) };
    }
    case 'export_file': {
      const s = await getSched(a.id);
      const { STORES } = await M.loadStores();
      const rows = M.buildRowsFrom(s, STORES);
      const errs = [];
      if (!(s.title || '').trim()) errs.push('タイトルが未入力です');
      if (s.timing !== 'immediate' && !s.date) errs.push('投稿日が未確定です');
      if (!rows.length) errs.push('対象店舗がありません');
      rows.forEach(r => { const c = r[M.COL.CONTENT]; if (!String(c || '').trim()) { errs.push(`${r[M.COL.STORE_NAME]}：本文が空です`); return; } const v = M.validate(c); if (v.ng.length) errs.push(`${r[M.COL.STORE_NAME]}：NGワード（${v.ng.map(n => n.word).join('、')}）`); if (v.phone) errs.push(`${r[M.COL.STORE_NAME]}：電話番号あり`); });
      if (errs.length && !a.force) return { ok: false, errors: errs, note: '直してから再実行するか、force:true で出力してください' };
      const fmt = a.fmt === 'csv' ? 'csv' : 'xlsx';
      const url = `${ctx.origin}/api/export/${ctx.key}?id=${encodeURIComponent(s.id)}&fmt=${fmt}`;
      await M.addDoc('studio_posts', { schedId: s.id, title: s.title || '', catchTitle: s.catchTitle || '', date: s.date || '', time: s.time || '', abType: s.abType || '', kw: s.kw || '', postType: s.postType || '最新情報', timing: s.timing || 'scheduled', scope: s.scope || 'category_common', storeIds: s.storeIds || [], contents: s.contents || {}, overrides: s.overrides || {}, imageTitle: M.safeImgName(s.imageTitle || ''), imageId: s.imageId || '', createdAt: Date.now(), source: 'claude-mcp' });
      await M.mergeDoc('studio_schedule', s.id, { done: true });
      return { ok: true, url, fileName: `【あさば様】一括投稿_${M.mmddFrom(s)}.${fmt}`, rows: rows.length, columns: rows[0].length, warnings: errs, imageTitle: M.safeImgName(s.imageTitle || ''), note: 'このURLを開くとファイルがダウンロードされます。画像はGMOのライブラリに同じ名前で先にアップしてください' };
    }
    case 'set_post_status': {
      const s = await getSched(a.id);
      const st = a.status || ''; const isRet = st === 'retired';
      const fields = { postStatus: st, posted: st === 'posted', postedDate: (st && !isRet) ? (a.postedDate || M.todayISO()) : '', postedAt: (st && !isRet) ? M.nowStr() : '', postNote: a.note !== undefined ? a.note : (s.postNote || '') };
      await M.mergeDoc('studio_schedule', s.id, fields);
      return { ok: true, schedule: M.schedSummary({ ...s, ...fields }) };
    }
    case 'list_rules': {
      const rules = await M.listDocs('studio_rules');
      return { count: rules.length, rules: rules.map(r => ({ id: r.id, type: r.type, enabled: r.enabled !== false, body: r.body })) };
    }
    case 'add_rule': {
      const id = 'rule_' + Date.now().toString(36);
      const rec = { id, type: a.type === 'image' ? 'image' : 'post', body: a.body, enabled: true, createdAt: Date.now() };
      await M.setDoc('studio_rules', id, rec);
      return { ok: true, rule: rec };
    }
    case 'delete_rule': {
      await M.deleteDoc('studio_rules', a.id);
      return { ok: true, deleted: a.id };
    }
    default:
      throw new Error(`不明なツール: ${name}`);
  }
}

// ===== JSON-RPC =====
function rpcResult(id, result) { return { jsonrpc: '2.0', id, result }; }
function rpcError(id, code, message) { return { jsonrpc: '2.0', id, error: { code, message } }; }
async function handleMessage(msg, ctx) {
  const { id, method, params } = msg || {};
  if (!method) return rpcError(id ?? null, -32600, 'Invalid Request');
  if (method.startsWith('notifications/')) return null;           // 202
  switch (method) {
    case 'initialize':
      return rpcResult(id, { protocolVersion: (params && params.protocolVersion) || '2025-06-18', capabilities: { tools: { listChanged: false } }, serverInfo: SERVER_INFO,
        instructions: 'あさばグループのMEO投稿ツールです。本文を書く前に get_writing_guide を必ず呼び、ルールと店舗プロフィールに従って書き、save_contents で保存してください。出力ファイルは export_file でURLを取得します。' });
    case 'ping': return rpcResult(id, {});
    case 'tools/list': return rpcResult(id, { tools: TOOLS });
    case 'resources/list': return rpcResult(id, { resources: [] });
    case 'prompts/list': return rpcResult(id, { prompts: [] });
    case 'tools/call': {
      const name = params && params.name, args = (params && params.arguments) || {};
      if (!TOOLS.some(t => t.name === name)) return rpcError(id, -32602, `Unknown tool: ${name}`);
      try {
        const out = await callTool(name, args, ctx);
        return rpcResult(id, { content: [{ type: 'text', text: JSON.stringify(out, null, 1) }], structuredContent: (out && typeof out === 'object' && !Array.isArray(out)) ? out : undefined });
      } catch (e) {
        return rpcResult(id, { content: [{ type: 'text', text: 'エラー: ' + (e && e.message ? e.message : String(e)) }], isError: true });
      }
    }
    default: return rpcError(id, -32601, `Method not found: ${method}`);
  }
}

// Content-Type が application/json 以外でも JSON-RPC を受け付ける（Buffer/文字列/未パース の全ケース）
async function readBody(req) {
  let b = req.body;
  if (b === undefined || b === null) {
    b = await new Promise((resolve) => { const chunks = []; req.on('data', c => chunks.push(c)); req.on('end', () => resolve(Buffer.concat(chunks))); req.on('error', () => resolve(null)); });
  }
  if (Buffer.isBuffer(b)) b = b.toString('utf8');
  if (typeof b === 'string') { try { return JSON.parse(b); } catch (e) { return null; } }
  return b;
}
module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  const key = req.query && req.query.key;
  if (!keyOk(key)) { res.status(401).json({ error: 'unauthorized' }); return; }
  if (req.method === 'GET') { res.setHeader('Allow', 'POST'); res.status(405).json({ error: 'SSE stream is not offered; use POST' }); return; }
  if (req.method === 'DELETE') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).end(); return; }
  let body = await readBody(req);
  if (!body) { res.status(400).json(rpcError(null, -32700, 'Parse error')); return; }
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const ctx = { key, origin: `${proto}://${req.headers.host}` };
  try {
    if (Array.isArray(body)) {
      const outs = (await Promise.all(body.map(m => handleMessage(m, ctx)))).filter(Boolean);
      if (!outs.length) { res.status(202).end(); return; }
      res.status(200).json(outs); return;
    }
    const out = await handleMessage(body, ctx);
    if (out === null) { res.status(202).end(); return; }
    res.status(200).json(out);
  } catch (e) {
    res.status(500).json(rpcError(body && body.id != null ? body.id : null, -32603, 'Internal error: ' + (e && e.message ? e.message : String(e))));
  }
};
