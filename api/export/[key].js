// GMO一括投稿ファイルの配信（MCPの export_file が返すURLの実体）
//   GET /api/export/<MCP_KEY>?id=<予定ID>&fmt=xlsx|csv
const crypto = require('crypto');
const M = require('../../lib/meo');

function keyOk(given) {
  const want = process.env.MCP_KEY || '';
  if (!want || !given) return false;
  const a = Buffer.from(String(given)), b = Buffer.from(want);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = async (req, res) => {
  if (!keyOk(req.query && req.query.key)) { res.status(401).send('unauthorized'); return; }
  const id = req.query.id;
  const ids = String(req.query.ids || '').split(',').map(x => x.trim()).filter(Boolean);
  if (!id && !ids.length) { res.status(400).send('id または ids が必要です'); return; }
  try {
    const { STORES } = await M.loadStores();
    const tpl = await M.loadBulkTemplate();
    const fmt = req.query.fmt === 'csv' ? 'csv' : 'xlsx';
    let rows, name, ascii;
    if (ids.length) {
      // まとめ出力：複数予定の行を日付順に連結して1ファイルにする（MCPの export_files が返すURL）
      const scheds = [];
      for (const x of ids) { const s = await M.getDoc('studio_schedule', x); if (!s) { res.status(404).send('予定が見つかりません: ' + x); return; } scheds.push(s); }
      rows = M.buildRowsMulti(scheds, STORES, tpl);
      const base = M.bulkFileBase(scheds, /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : '');
      name = `${base}.${fmt}`;
      const ds = M.sortScheds(scheds).map(s => (s.date || '').slice(5)).filter(Boolean);
      ascii = `asaba_post_bulk_${ds.length ? ds[0] + '_' + ds[ds.length - 1] : 'all'}.${fmt}`;
    } else {
      const s = await M.getDoc('studio_schedule', id);
      if (!s) { res.status(404).send('予定が見つかりません: ' + id); return; }
      rows = M.buildRowsFrom(s, STORES, tpl);
      name = `あさば様_一括投稿_${M.mmddFrom(s)}.${fmt}`;
      ascii = `asaba_post_${M.mmddFrom(s)}.${fmt}`;
    }
    res.setHeader('Content-Disposition', `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`);
    res.setHeader('Cache-Control', 'no-store');
    if (fmt === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.status(200).send(M.csvFrom(rows, tpl));
    } else {
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.status(200).send(M.xlsxFrom(rows, tpl));
    }
  } catch (e) {
    res.status(500).send('出力エラー: ' + (e && e.message ? e.message : String(e)));
  }
};
