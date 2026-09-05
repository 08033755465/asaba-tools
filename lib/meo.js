// MEO投稿 統合ツールの共通ロジック（サーバー側）
// studio.html の同名関数を移植したもの。Firestore は REST API＋匿名認証で読み書きする。
// アプリ（studio.html）と同じデータを同じ形で扱うので、チャットから保存したものがそのままアプリに出る。

const FIREBASE = {
  apiKey: 'AIzaSyBPIHl3RIZD4YA1RGdYJ4f_4E5PyPORw8E',
  projectId: 'thumbnail-tool-e3de6',
};
const APP_ID = 'asaba-thumbnail';
const DOCS = `https://firestore.googleapis.com/v1/projects/${FIREBASE.projectId}/databases/(default)/documents`;
const BASE = `artifacts/${APP_ID}/public/data`;

// ===== 匿名認証トークン（1時間有効。関数インスタンス内でキャッシュ） =====
let tokenCache = { idToken: '', exp: 0 };
async function idToken() {
  if (tokenCache.idToken && Date.now() < tokenCache.exp - 60_000) return tokenCache.idToken;
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FIREBASE.apiKey}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ returnSecureToken: true }),
  });
  const j = await r.json();
  if (!j.idToken) throw new Error('匿名認証に失敗: ' + JSON.stringify(j).slice(0, 200));
  tokenCache = { idToken: j.idToken, exp: Date.now() + (Number(j.expiresIn || 3600) * 1000) };
  return j.idToken;
}

// ===== Firestore の値 ⇔ JS の値 =====
function enc(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(enc) } };
  if (typeof v === 'object') {
    const fields = {};
    for (const [k, x] of Object.entries(v)) if (x !== undefined) fields[k] = enc(x);
    return { mapValue: { fields } };
  }
  return { stringValue: String(v) };
}
function dec(v) {
  if (!v || typeof v !== 'object') return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(dec);
  if ('mapValue' in v) return decFields(v.mapValue.fields || {});
  return null;
}
function decFields(fields) { const o = {}; for (const [k, x] of Object.entries(fields || {})) o[k] = dec(x); return o; }
function encFields(obj) { const fields = {}; for (const [k, x] of Object.entries(obj || {})) if (x !== undefined) fields[k] = enc(x); return fields; }

async function fsFetch(path, opt = {}) {
  const t = await idToken();
  const r = await fetch(path.startsWith('http') ? path : `${DOCS}/${path}`, {
    ...opt, headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json', ...(opt.headers || {}) },
  });
  const text = await r.text();
  let j = {}; try { j = text ? JSON.parse(text) : {}; } catch (e) { j = { raw: text }; }
  if (!r.ok) throw new Error(`Firestore ${opt.method || 'GET'} ${path} → ${r.status}: ${(j.error && j.error.message) || text.slice(0, 200)}`);
  return j;
}
// コレクション全件（__ 始まりのdocは除外＝アプリと同じルール）
async function listDocs(coll) {
  const out = []; let pageToken = '';
  do {
    const j = await fsFetch(`${BASE}/${coll}?pageSize=300${pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : ''}`);
    for (const d of (j.documents || [])) {
      const id = d.name.split('/').pop();
      if (id.startsWith('__')) continue;
      out.push({ id, ...decFields(d.fields) });
    }
    pageToken = j.nextPageToken || '';
  } while (pageToken);
  return out;
}
async function getDoc(coll, id) {
  try { const d = await fsFetch(`${BASE}/${coll}/${encodeURIComponent(id)}`); return { id, ...decFields(d.fields) }; }
  catch (e) { if (/→ 404/.test(e.message)) return null; throw e; }
}
async function setDoc(coll, id, obj) {           // 全置換（setDoc相当）
  const { id: _i, ...rest } = obj;
  return fsFetch(`${BASE}/${coll}/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ fields: encFields(rest) }) });
}
async function mergeDoc(coll, id, obj) {         // 部分更新（setDoc merge相当）
  const { id: _i, ...rest } = obj;
  const keys = Object.keys(rest);
  if (!keys.length) return null;
  const mask = keys.map(k => 'updateMask.fieldPaths=' + encodeURIComponent(k)).join('&');
  return fsFetch(`${BASE}/${coll}/${encodeURIComponent(id)}?${mask}`, { method: 'PATCH', body: JSON.stringify({ fields: encFields(rest) }) });
}
async function addDoc(coll, obj) {
  const j = await fsFetch(`${BASE}/${coll}`, { method: 'POST', body: JSON.stringify({ fields: encFields(obj) }) });
  return j.name.split('/').pop();
}
async function deleteDoc(coll, id) { return fsFetch(`${BASE}/${coll}/${encodeURIComponent(id)}`, { method: 'DELETE' }); }

// ===== 店舗（studio_stores ＋ 業態テンプレ studio_gyotai） =====
const CAT_FALLBACK = { '整骨院': 'seitai_seikotsu', '整体院': 'seitai_seikotsu', 'ピラティス': 'pilates' };
const CAT_LABEL_DEFAULT = { seitai_seikotsu: '整体整骨グループ', pilates: 'マシンピラティス（Peace）' };
function linksOf(m) { return Array.isArray(m && m.linkBank) ? m.linkBank : []; }
function activeLink(m, use) { return linksOf(m).find(l => l.use === use && l.active && l.url) || null; }
function ensureLinkBank(st) {
  if (!Array.isArray(st.linkBank)) st.linkBank = [];
  if (!st.linkBank.length && st.reserveUrl) {
    st.linkBank.push({ id: 'lk_' + Math.random().toString(36).slice(2, 9), use: '予約', label: '予約リンク（登録済み）', url: st.reserveUrl, active: true, from: '', to: '', note: '', createdAt: Date.now(), updatedAt: Date.now() });
  }
  const hit = activeLink(st, '予約'); if (hit) st.reserveUrl = hit.url;
  return st;
}
async function loadStores({ includeInactive = false } = {}) {
  const [master, gyotai] = await Promise.all([listDocs('studio_stores'), listDocs('studio_gyotai')]);
  const catOf = (g) => { const t = gyotai.find(x => x.name === g); return (t && t.groupKey) || CAT_FALLBACK[g] || 'other'; };
  const catLabel = { ...CAT_LABEL_DEFAULT };
  gyotai.forEach(g => { if (g.groupKey) catLabel[g.groupKey] = g.groupLabel || g.name; });
  const act = master.filter(s => (includeInactive || s.isActive !== false) && s.name && s.gmoId).sort((a, b) => (a.order || 0) - (b.order || 0));
  const STORES = act.map(s => { ensureLinkBank(s); return { gmo: String(s.gmoId), name: s.name, cat: catOf(s.gyotai), gyotai: s.gyotai || '', usp: s.usp || '', area: s.area || '', url: s.reserveUrl || '', _m: s }; });
  return { STORES, catLabel, master };
}
function findStore(STORES, q) {
  const s = String(q || '').trim();
  return STORES.find(x => x.gmo === s) || STORES.find(x => x.name === s) || STORES.find(x => x.name.includes(s)) || STORES.find(x => (x._m.area || '') && s.includes(x._m.area)) || null;
}
function storeSummary(s) {
  const m = s._m || {};
  const lk = activeLink(m, '予約');
  return { gmo: s.gmo, name: s.name, gyotai: s.gyotai, cat: s.cat, area: s.area, access: m.access || '', hours: m.hours || '', closedDays: m.closedDays || '',
    reserveUrl: (lk && lk.url) || m.reserveUrl || '', webUrl: m.webUrl || '', phone: m.phone || '', usp: s.usp, target: m.target || '', troubles: m.troubles || '', keywords: m.keywords || '', nearbyAreas: m.nearbyAreas || '', price: m.price || '', parking: [m.parking, m.parkingNote].filter(Boolean).join('：'), memo: m.memo || '', reviewCount: m.reviewCount || '', rating: m.rating || '' };
}

// ===== 出力（GMO 52列様式） =====
const HEADERS = ["店舗ID","店舗名","投稿タイプ","下書き保存","即時投稿","予約投稿日","予約投稿時間","Google繰り返し投稿日","Google繰り返し投稿時間","Google繰り返し設定_繰り返し","Google繰り返し設定_間隔","Google繰り返し設定_曜日（週 選択時）","Google繰り返し設定_日付（月_日付 選択時）","Google繰り返し設定_週指定（月_曜日 選択時）","Google繰り返し投稿終了日（省略可）","Y_掲載期間の設定（Yahoo!記載欄）の予約投稿日","Y_掲載期間の設定（Yahoo!記載欄）の予約投稿時間","Y_掲載期間の設定（Yahoo!記載欄）の予約投稿終了日","Y_掲載期間の設定（Yahoo!記載欄）の予約投稿終了時間","Y_概要タブ掲載期間の設定（Yahoo!記載欄）の予約投稿日","Y_概要タブ掲載期間の設定（Yahoo!記載欄）の予約投稿時間","Y_概要タブ掲載期間の設定（Yahoo!記載欄）の予約投稿終了日","Y_概要タブ掲載期間の設定（Yahoo!記載欄）の予約投稿終了時間","A_掲載期間の設定（Apple記載欄）の予約投稿日 ","A_掲載期間の設定（Apple記載欄）の予約投稿終了日","タイトル(GoogleとSNSは任意入力、Yahoo!は必須）","投稿内容","投稿内容２","画像","クーポンコード（省略可）","特典利用へのリンク","利用規約","ボタンの追加","ボタンURL","A_アクションボタン（Apple）","ハッシュタグ","開始日","開始時間","終了日","終了時間","Facebook","Instagram","X（旧Twitter）","Yahoo!","Apple","エキテン","エ_投稿カテゴリー","エ_掲載開始日（エキテン記載欄）","エ_掲載開始時間（エキテン記載欄）","エ_掲載終了日（エキテン記載欄）","エ_掲載終了時間（エキテン記載欄）","エ_タイムライン通知"];
const COL = { STORE_ID:0, STORE_NAME:1, POST_TYPE:2, IMMEDIATE:4, SDATE:5, STIME:6, TITLE:25, CONTENT:26, IMAGE:28, BTYPE:32, BURL:33, EV_SDATE:36, EV_STIME:37, EV_EDATE:38, EV_ETIME:39 };
const BTN_TYPES = ['予約','オンライン注文','購入','詳細','登録','今すぐ電話','なし'];

function todayISO() { const d = new Date(Date.now() + 9 * 3600 * 1000); return d.toISOString().slice(0, 10); } // JST
function uid() { return Math.random().toString(36).slice(2, 9); }
function fmtDate(d) { const [y, m, dd] = String(d).split('-'); return `${y}/${m}/${dd}`; }
function fmtTime(t) { const [h, m] = String(t).split(':'); return `${parseInt(h, 10)}:${m}`; }
function hoursRange(m) {
  const t = String((m && m.hours) || '').replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
  const hit = t.match(/(\d{1,2}:\d{2})\s*[〜～~\-]\s*(\d{1,2}:\d{2})/);
  return hit ? { st: hit[1], et: hit[2] } : { st: '9:00', et: '18:00' };
}
function monthEndOf(dateStr) {
  const [y, m] = String(dateStr || todayISO()).split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
}
function safeImgName(name) {
  if (!name) return '';
  let s = String(name).normalize('NFC').trim();
  s = s.replace(/[\\/:*?"<>|]/g, '_');
  s = s.replace(/[：／＊？＜＞｜「」【】（）　]/g, '_');
  s = s.replace(/[、。！？・，．～〜＆＃％＄＠＋＝；'‘’“”『』〈〉《》〔〕［］｛｝!,;#%&+=@'`\[\]{}]/g, '_');
  s = s.replace(/_+/g, '_').replace(/^[_.]+|[_.]+$/g, '');
  const m = s.match(/^(.+?)(\.(?:jpe?g|png|gif|webp))$/i);
  s = m ? m[1] + m[2].toLowerCase() : s + '.jpg';
  return s || 'image.jpg';
}
function btnFor(d, s) {
  const m = s._m || {};
  const type = (d && d.btnType) || m.btnType || '予約';
  if (type === 'なし' || type === '今すぐ電話') return { type, url: '' };
  const hit = activeLink(m, type);
  const url = (hit && hit.url) || (type === '詳細' ? (m.webUrl || '') : '') || m.reserveUrl || s.url || '';
  return { type, url };
}
function exportStoresFrom(d, STORES) {
  if (d.storeIds && d.storeIds.length) return STORES.filter(s => d.storeIds.includes(s.gmo));
  if ((d.scope || 'category_common') !== 'category_common') { const ids = Object.keys(d.contents || {}); return STORES.filter(s => ids.includes(s.gmo)); }
  return STORES.slice();
}
function contentFromFor(d, store) { return (d.scope || 'category_common') === 'category_common' ? ((d.contents || {})[store.cat] || '') : ((d.contents || {})[store.gmo] || ''); }
function buildRowsFrom(d, STORES) {
  const rows = [];
  exportStoresFrom(d, STORES).forEach(s => {
    const ov = (d.overrides || {})[s.gmo] || {};
    const timing = ov.timing || d.timing;
    const immediate = timing === 'immediate';
    const date = ov.date !== undefined ? ov.date : d.date;
    const time = ov.time !== undefined ? ov.time : d.time;
    const c = new Array(HEADERS.length).fill('');
    c[COL.STORE_ID] = s.gmo; c[COL.STORE_NAME] = s.name; c[COL.POST_TYPE] = d.postType || '最新情報';
    if (immediate) c[COL.IMMEDIATE] = '○'; else { c[COL.SDATE] = date ? fmtDate(date) : ''; c[COL.STIME] = time ? fmtTime(time) : ''; }
    c[COL.TITLE] = d.title || '';
    c[COL.CONTENT] = ov.content !== undefined ? ov.content : contentFromFor(d, s);
    c[COL.IMAGE] = safeImgName(ov.imageTitle !== undefined ? ov.imageTitle : (d.imageTitle || ''));
    const b = btnFor(d, s); c[COL.BTYPE] = b.type; c[COL.BURL] = b.url;
    if (d.postType === 'イベント' || d.postType === 'クーポン') {
      const hr = hoursRange(s._m || {});
      const evs = d.evStart || date || todayISO();
      const eve = d.evEnd || monthEndOf(evs);
      c[COL.EV_SDATE] = fmtDate(evs); c[COL.EV_STIME] = fmtTime(d.evStartTime || hr.st);
      c[COL.EV_EDATE] = fmtDate(eve); c[COL.EV_ETIME] = fmtTime(d.evEndTime || hr.et);
      // SNS列（40-45,51）は空欄のまま（✕を入れると画像エラーになった実績あり）
    }
    rows.push(c);
  });
  return rows;
}
function mmddFrom(d) { const src = (d && d.date) || todayISO(); const [, m, dd] = src.split('-'); return `${m}-${dd}`; }
function csvFrom(rows) {
  const q = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  return '﻿' + [HEADERS.map(q).join(',')].concat(rows.map(r => r.map(q).join(','))).join('\r\n') + '\r\n';
}
function xlsxFrom(rows) {
  const XLSX = require('xlsx');
  const aoa = [HEADERS.slice()].concat(rows.map(r => r.map((v, i) => {
    if (v == null || v === '') return null;
    if (i === COL.STORE_ID && /^\d+$/.test(String(v))) return Number(v);
    return v;
  })));
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = HEADERS.map((_, i) => i === COL.CONTENT ? { wch: 60 } : (i === COL.STORE_NAME || i === COL.TITLE ? { wch: 26 } : { wch: 14 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  // bookSST:true＝sharedStrings形式。既定の t="str" だとGMOが店舗名を認識しない
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', bookSST: true });
}

// ===== 本文チェック（studio.html の validate と同じ） =====
const NG = [["治す","整える"],["治る","変わる"],["治療","施術・アプローチ"],["完治","卒業"],["根治","根本にアプローチ"],["改善する","整えていく"],["改善します","サポートします"],["効きます","働きかけます"],["必ず","（削除）"],["絶対に良くなる","（削除）"],["診断","チェック・分析"],["医学的効果","（削除）"],
  ["根本改善","根本にアプローチ"],["根本から","土台から"],["疾患","状態"],["再発しにくい","繰り返しにくい"],
  ["治ります","変わります"],["効果があります","働きかけます"],["改善されます","整っていきます"],["無料になります","（条件を明記）"]];
const CLAIM_RE = /(年間|月間|累計)?\s*[0-9０-９][0-9０-９,，]*\s*(件|名|人|例)(以上)?(の)?\s*(実績|症例|対応|施術)/;
const PRIVACY_RE = /[0-9０-９]{2,3}\s*(kg|ｋｇ|キロ|cm|ｃｍ|センチ)/i;
const EMOJI_RE = /\p{Extended_Pictographic}/gu, DASH_RE = /――|——|--|ーー|─/g, PHONE_RE = /0\d{1,4}-\d{1,4}-\d{3,4}/;
const AI_PHRASES = ['だからこそ', 'なんです', 'んです', 'どき'];
function validate(t) {
  t = t || '';
  const chars = Array.from(t.replace(/\n/g, '')).length, emoji = (t.match(EMOJI_RE) || []).length,
    ng = NG.filter(n => t.includes(n[0])), dash = [...new Set(t.match(DASH_RE) || [])], phone = PHONE_RE.test(t),
    claim = (t.match(CLAIM_RE) || [])[0] || '', privacy = (t.match(PRIVACY_RE) || [])[0] || '',
    ai = AI_PHRASES.filter(p => t.includes(p));
  return { chars, emoji, ng: ng.map(n => ({ word: n[0], replace: n[1] })), dash, phone, claim, privacy, aiPhrases: ai,
    charOk: chars >= 250 && chars <= 400, emojiOk: emoji >= 2 && emoji <= 3, ok: !ng.length && !dash.length && !phone };
}

// ===== 生成ルール・型（studio.html の RULES / FORMAT_SEED と同じ内容） =====
const RULES = `【文体・トーン】
・結論を冒頭に出さない。「だからこそ」を多用しない。
・「〜んです／〜なんです／〜ないんです」は使わない。
・横棒（——／ーー／──）で間を表現しない。間・余韻はその一文を『』で囲む。
・です・ます調ベース＋時々くだけた表現（〜ですよね／〜ってありませんか）。共感優先・温かめ。段落は短く。
・冒頭の入り口は毎回変える（悩みの状況描写／季節の情景／問いかけ／共感のひと言／意外な気づき）。

【法令（薬機法・あはき法）】効果の断定はNG。
・「治す・治療・改善する・完治・根治・必ず・診断・医学的効果」等は使わない。
・言い換え例：整える／アプローチする／サポートする／働きかける／変わる。
・セルフケア提案は「体の使い方・日常習慣」の範囲に留める。

【業態別の言葉（混同しない）】
・整骨院＝骨格・骨盤矯正、AI姿勢分析、国家資格、整形外科医療連携
・整体院＝体のバランス、卒業型セルフケア、体の使い方の指導
・Peace（ピラティス）＝インナーマッスル、体幹、呼吸、マシンピラティスで習慣化

【構成・分量】
{{構成本文}}
・各250〜400字。絵文字は1投稿2〜3個。
・「初めての方には特別価格の初回体験あり」の趣旨を毎回自然に織り込む（末尾に唐突はNG）。
・CTAは毎回パターンを変える。電話番号（数字）は本文に書かない。LINE予約を主軸の導線にする。
・地名は文脈に自然に。共通投稿は無理に入れない/代表数店に留める。`;
const DEFAULT_STRUCTURE = '・①悩みの状況描写 ②なぜ起きるかの視点 ③今日からのセルフケア1つ ④業態別ベネフィット ⑤店舗の強みをさりげなく ⑥来院ハードルを下げる情報 ⑦自然なCTA';
const FORMAT_SEED = [
  { id: 'f_season', name: '型1 季節×症状「気づき」型', structure: '①【季節の状況＋不調を1行に圧縮したタイトル】\n②季節特有の生活シーンの描写\n③その生活が体に起こす変化\n④自院の向き合い方\n⑤立地の通いやすさ\n⑥相談ハードルを下げる締め' },
  { id: 'f_symptom', name: '型2 症状名「解説」型＋チェックリスト', structure: '①「◯◯にある店名です」で開始\n②【症状名とは？】の短い説明\n③当てはまる人のチェックリスト4項目\n④その症状が起きる生活背景\n⑤自院のアプローチ\n⑥アクセス・営業時間を末尾に固定' },
  { id: 'f_story', name: '型3 来院者エピソード「物語」型', structure: '①日常の一場面をタイトルに\n②悩みの描写\n③会話の再現\n④体の状態とその背景\n⑤今日からできる具体的な提案\n⑥前向きな締め＋エリア名' },
  { id: 'f_rhythm', name: '型4 悩み提起→原因→解決「縦リズム」型（最推奨）', structure: '①問いかけ型のタイトル\n②読者の心の声を「」で2〜3行\n③原因の解説を短い改行でリズムよく\n④◎や・で3つ列挙\n⑤まとめの1行\n⑥自院のアプローチ\n⑦相談を促す一文' },
  { id: 'f_menu', name: '型5 メニュー訴求「箇条書き」型', structure: '①【メニュー名】\n②▶ベネフィットを3〜4行\n③補足の一言\n④CTA' },
];
async function loadFormats() {
  try { const f = await listDocs('studio_formats'); if (f.length) return f.filter(x => x.enabled !== false).sort((a, b) => (a.order || 0) - (b.order || 0)); } catch (e) {}
  return FORMAT_SEED;
}
function structureText(f) {
  if (!f) return DEFAULT_STRUCTURE;
  return `・この投稿は「${f.name}」の構成で書いてください。\n` + String(f.structure || '').split('\n').map(l => '　' + l).join('\n') +
    (f.why ? `\n・この型が効く理由：${f.why}` : '') + (f.caution ? `\n・⚠️この型の注意：${f.caution}` : '');
}
function rulesText(f) { return RULES.replace('{{構成本文}}', structureText(f)); }
function storeProfileLine(s) {
  const m = s._m || {}; const bits = [];
  if (s.usp) bits.push('強み:' + s.usp);
  if (m.target) bits.push('客層:' + m.target);
  if (m.troubles) bits.push('多い悩み:' + m.troubles);
  if (m.customerWords) bits.push('お客様の言葉:' + m.customerWords);
  if (m.access || s.area) bits.push('立地:' + (m.access || s.area));
  if (m.landmarks) bits.push('目印:' + m.landmarks);
  if (m.keywords) bits.push('検索上位ワード:' + m.keywords);
  if (m.nearbyAreas) bits.push('周辺地域:' + m.nearbyAreas);
  if (m.price) bits.push('料金・特典:' + m.price);
  if (m.hours) bits.push('営業:' + m.hours + (m.closedDays ? ('（定休:' + m.closedDays + '）') : ''));
  if (m.parking || m.parkingNote) bits.push('駐車場:' + [m.parking, m.parkingNote].filter(Boolean).join(' '));
  if (m.memo) bits.push('メモ:' + m.memo);
  return `- ${s.name}【ID ${s.gmo}／${s.gyotai}】 ${bits.join(' ／ ')}`;
}
// 予定1件ぶんの「指示文」（アプリの DEFAULT_TPL_BODY_FULL と同じ構成）
async function writingGuide(sched, STORES, catLabel) {
  const [formats, rules] = await Promise.all([loadFormats(), listDocs('studio_rules')]);
  const f = formats.find(x => x.id === sched.formatId) || null;
  const list = exportStoresFrom(sched, STORES);
  const perStore = (sched.scope || 'category_common') !== 'category_common';
  let keys, targetDesc, fmt = '';
  if (perStore) {
    keys = list.map(s => ({ key: s.gmo, label: s.name }));
    targetDesc = `店舗別（下記${list.length}店舗をそれぞれ1本ずつ）`;
    fmt = list.map(s => `"${s.gmo}": （${s.name} の本文）`).join('\n');
  } else {
    const cats = [...new Set(list.map(s => s.cat))];
    keys = cats.map(c => ({ key: c, label: (catLabel[c] || c) + ' 共通' }));
    targetDesc = `カテゴリ共通（${keys.map(k => k.label).join(' ＋ ')}）`;
    fmt = keys.map(k => `"${k.key}": （${k.label}の本文）`).join('\n');
  }
  const dateStr = sched.timing === 'immediate' ? '即時投稿' : (sched.date ? sched.date.replace(/-/g, '/') : '（日付未定）');
  const postRules = rules.filter(r => r.enabled && r.type === 'post').map(r => '・' + r.body).join('\n') || '（なし）';
  const text = `# あさばグループ MEO投稿 作成依頼

## テーマ / 共通タイトルの軸
${sched.themeTitle || sched.title || '（テーマ未入力）'}
盛り込みたいキーワード：${sched.kw || ''}
共通タイトルはこの案を使用（より良くできるなら微調整OK・文字数は同程度で）：「${sched.catchTitle || sched.title || ''}」

## 今回の文脈・特別指示（テーマより優先で全体に反映）
${sched.context || '（なし）'}

## 作成対象
${targetDesc}
投稿タイプ：${sched.postType || '最新情報'} ／ 投稿予定：${dateStr}${sched.imageMemo ? `\n画像メモ：${sched.imageMemo}` : ''}

## 店舗プロフィール（この内容を各店の本文に反映する）
${list.map(storeProfileLine).join('\n')}

## 厳守ルール
${rulesText(f)}

## 定例指示（毎回適用）
${postRules}

## NGワード（含めない）
${NG.map(n => `「${n[0]}」→「${n[1]}」`).join('、')}

## 保存のしかた
本文が書けたら save_contents ツールを、予定ID "${sched.id}" と、次のキーで呼ぶ（値は本文の文字列。タイトル行は入れない）：
${fmt}
保存後に返るチェック結果（NG語・電話番号・横棒・文字数）を確認し、指摘があれば直して再保存する。`;
  return { text, keys, formatName: f ? f.name : '（型なし）' };
}

// ===== 予定 =====
const SCHED_FIELDS = ['title','catchTitle','themeTitle','date','time','abType','kw','context','imageMemo','imageTitle','imageId','postType','btnType','formatId','evStart','evEnd','evStartTime','evEndTime','timing','scope','storeIds','contents','overrides','done','posted','postStatus','postedDate','postedAt','postNote'];
function schedSummary(s) {
  return { id: s.id, date: s.date || '', time: s.time || '', abType: s.abType || '', title: s.title || '', catchTitle: s.catchTitle || '', postType: s.postType || '最新情報',
    formatId: s.formatId || '', kw: s.kw || '', imageMemo: s.imageMemo || '', imageTitle: s.imageTitle || '', scope: s.scope || 'category_common', storeCount: (s.storeIds || []).length,
    contentsCount: Object.keys(s.contents || {}).length, timing: s.timing || 'scheduled', done: !!s.done, postStatus: s.postStatus || '', postedDate: s.postedDate || '' };
}
function nowStr() { return new Date(Date.now() + 9 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 16); }

module.exports = {
  listDocs, getDoc, setDoc, mergeDoc, addDoc, deleteDoc,
  loadStores, findStore, storeSummary, loadFormats, writingGuide,
  HEADERS, COL, BTN_TYPES, buildRowsFrom, exportStoresFrom, contentFromFor, csvFrom, xlsxFrom, mmddFrom,
  safeImgName, validate, NG, uid, todayISO, nowStr, schedSummary, SCHED_FIELDS,
};
