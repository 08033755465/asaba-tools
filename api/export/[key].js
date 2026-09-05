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
  const id = req.query.id; if (!id) { res.status(400).send('id が必要です'); return; }
  try {
    const s = await M.getDoc('studio_schedule', id);
    if (!s) { res.status(404).send('予定が見つかりません: ' + id); return; }
    const { STORES } = await M.loadStores();
    const rows = M.buildRowsFrom(s, STORES);
    const fmt = req.query.fmt === 'csv' ? 'csv' : 'xlsx';
    const name = `【あさば様】一括投稿_${M.mmddFrom(s)}.${fmt}`;
    const ascii = `asaba_post_${M.mmddFrom(s)}.${fmt}`;
    res.setHeader('Content-Disposition', `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`);
    res.setHeader('Cache-Control', 'no-store');
    if (fmt === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.status(200).send(M.csvFrom(rows));
    } else {
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.status(200).send(M.xlsxFrom(rows));
    }
  } catch (e) {
    res.status(500).send('出力エラー: ' + (e && e.message ? e.message : String(e)));
  }
};
