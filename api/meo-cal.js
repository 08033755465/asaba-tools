// カレンダー用：MEO投稿スケジュールの「日ごとの件数だけ」を返す（読み取り専用・2026-10-01）
//   GET /api/meo-cal  →  { ok, at, days: { 'YYYY-MM-DD': { n:予定数, ok:投稿済み, ng:取消・誤投稿 } } }
//   ・タイトルや本文などの中身は返さない（件数のみ）。書き込みはしない
//   ・取りやめ（retired）は数えない。投稿済みは実際に投稿した日（postedDate）で数える＝ツールの表示と同じ
//   ・CDNで5分キャッシュ（Firestoreを読むのは最大5分に1回）
const M = require('../lib/meo');

function shift(ds, n) { const d = new Date(ds + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  try {
    const today = M.todayISO(), from = shift(today, -62), to = shift(today, 120);
    const list = await M.listDocs('studio_schedule');
    const days = {};
    for (const s of list) {
      const st = s.postStatus || (s.posted === true ? 'posted' : '');
      if (st === 'retired') continue;
      const d = String((st === 'posted' && s.postedDate) ? s.postedDate : (s.date || '')).slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || d < from || d > to) continue;
      const o = days[d] || (days[d] = { n: 0, ok: 0, ng: 0 });
      o.n++;
      if (st === 'posted') o.ok++;
      else if (st === 'canceled' || st === 'mistake') o.ng++;
    }
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    res.status(200).json({ ok: true, at: new Date().toISOString(), days });
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(500).json({ ok: false, error: String(e && e.message ? e.message : e).slice(0, 200) });
  }
};
