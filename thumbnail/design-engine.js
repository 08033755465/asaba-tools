// サムネイルのデザイン描画エンジン（写真 → 透かし → 枠 → 文字）
// React側（index.html）から window.ThumbDesign として使う。純粋な canvas 処理だけを置く。
(function () {
  const FONTS = {
    sans:    '"Montserrat", "Helvetica Neue", Arial, sans-serif',
    serif:   '"Playfair Display", "Times New Roman", serif',
    script:  '"Dancing Script", cursive',
    jp:      '"Noto Sans JP", "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic", sans-serif',
    jpserif: '"Noto Serif JP", "Hiragino Mincho ProN", "Yu Mincho", serif',
  };
  const FONT_LABEL = { sans: '英字ゴシック', serif: '英字セリフ', jp: '日本語ゴシック', jpserif: '日本語明朝' };
  const COLOR_CHIPS = ['#ffffff', '#111111', '#2F6D80', '#E07A5F', '#f3ede3', '#5b6b3a', '#f5c518', '#c9a27e'];

  const BASE_W = 1200; // 文字サイズなどは幅1200px基準で保存し、書き出しサイズに合わせて拡縮する

  const DEFAULT = {
    template: 'none', photos: [], gap: 0,
    overlay: { type: 'none', color: '#000000', opacity: 0.3, band: { dir: 'h', pos: 0.5, size: 0.26, color: '#f3ede3', opacity: 0.88 }, gradient: { dir: 'bottom', color: '#000000', opacity: 0.75, size: 0.6 } },
    frame: { on: false, color: '#ffffff', width: 2, inset: 34 },
    title: { text: '', font: 'sans', weight: 800, size: 150, color: '#ffffff', letterSpacing: 0.08, lineHeight: 1.05, align: 'center', x: 0.5, y: 0.5, shadow: true },
    sub:   { text: '', font: 'jp', weight: 500, size: 30, color: '#ffffff', letterSpacing: 0.05, lineHeight: 1.5, align: 'center', x: 0.5, y: 0.65, shadow: true },
    label: { text: '', style: 'pill', bg: '#111111', color: '#ffffff', size: 24, letterSpacing: 0.08, align: 'center', x: 0.5, y: 0.36 },
    vtext: { on: false, text: '', font: 'jp', weight: 500, size: 26, color: '#ffffff', side: 'right', x: 0.945, y: 0.1, letterSpacing: 0.25 },
  };

  // 添付サンプルに合わせた3つのプリセット（＋従来の「なし」）
  const PRESETS = {
    none: { name: 'デザインなし', hint: '写真そのまま（従来どおり）', apply: () => ({ template: 'none', overlay: { ...DEFAULT.overlay, type: 'none' }, frame: { ...DEFAULT.frame, on: false } }) },
    single: { name: '1枚＋枠', hint: '大きな英字タイトル・細い枠・縦書き', apply: () => ({
      template: 'single', gap: 0,
      overlay: { ...DEFAULT.overlay, type: 'dark', color: '#000000', opacity: 0.15 },
      frame: { on: true, color: '#ffffff', width: 2, inset: 34 },
      title: { ...DEFAULT.title, text: 'タイトル\n{Sub}', font: 'sans', weight: 900, size: 120, color: '#ffffff', letterSpacing: 0.12, y: 0.5 },
      sub: { ...DEFAULT.sub, text: '' },
      label: { ...DEFAULT.label, text: '' },
      vtext: { ...DEFAULT.vtext, on: true, text: '縦書きテキスト', side: 'right', size: 26, color: '#ffffff' },
    }) },
    grid4: { name: 'コラージュ4枚', hint: '4枚グリッド・中央タイトル・ラベル', apply: () => ({
      template: 'grid4', gap: 0,
      overlay: { ...DEFAULT.overlay, type: 'dark', color: '#000000', opacity: 0.25 },
      frame: { ...DEFAULT.frame, on: false },
      title: { ...DEFAULT.title, text: 'タイトル', font: 'sans', weight: 800, size: 140, color: '#ffffff', letterSpacing: 0, y: 0.5 },
      sub: { ...DEFAULT.sub, text: 'サブタイトル', size: 30, color: '#ffffff', y: 0.655 },
      label: { ...DEFAULT.label, text: 'ラベル', style: 'pill', bg: '#111111', color: '#ffffff', size: 24, y: 0.35 },
      vtext: { ...DEFAULT.vtext, on: false },
    }) },
    band: { name: '帯コラージュ', hint: '4枚グリッド・中央に半透明の帯', apply: () => ({
      template: 'band', gap: 0,
      overlay: { ...DEFAULT.overlay, type: 'band', band: { dir: 'h', pos: 0.5, size: 0.26, color: '#f3ede3', opacity: 0.88 } },
      frame: { ...DEFAULT.frame, on: false },
      title: { ...DEFAULT.title, text: 'タイトル', font: 'serif', weight: 700, size: 110, color: '#5b6b3a', letterSpacing: 0.02, y: 0.5, shadow: false },
      sub: { ...DEFAULT.sub, text: 'サブタイトル', size: 26, color: '#6b7b4a', y: 0.585, shadow: false },
      label: { ...DEFAULT.label, text: 'ラベル', style: 'plain', color: '#5b6b3a', size: 22, letterSpacing: 0.35, y: 0.425 },
      vtext: { ...DEFAULT.vtext, on: false },
    }) },
    bottombar: { name: '下帯グラデ', hint: '下からの黒グラデに左寄せタイトル', apply: () => ({
      template: 'single', gap: 0,
      overlay: { ...DEFAULT.overlay, type: 'gradient', gradient: { dir: 'bottom', color: '#000000', opacity: 0.78, size: 0.62 } },
      frame: { ...DEFAULT.frame, on: false },
      label: { ...DEFAULT.label, text: 'ラベル', style: 'pill', bg: '#E07A5F', color: '#ffffff', size: 22, align: 'left', x: 0.06, y: 0.6 },
      title: { ...DEFAULT.title, text: 'タイトル', font: 'jp', weight: 800, size: 92, color: '#ffffff', letterSpacing: 0.02, align: 'left', x: 0.06, y: 0.73 },
      sub: { ...DEFAULT.sub, text: 'サブタイトル', size: 30, color: '#ffffff', align: 'left', x: 0.06, y: 0.86 },
      vtext: { ...DEFAULT.vtext, on: false },
    }) },
    split: { name: '左パネル', hint: '左半分を色パネルにして文字、右に写真', apply: () => ({
      template: 'single', gap: 0,
      overlay: { ...DEFAULT.overlay, type: 'band', band: { dir: 'v', pos: 0.24, size: 0.48, color: '#2F6D80', opacity: 0.94 } },
      frame: { ...DEFAULT.frame, on: false },
      label: { ...DEFAULT.label, text: 'ラベル', style: 'outline', color: '#ffffff', size: 22, letterSpacing: 0.2, align: 'left', x: 0.05, y: 0.2 },
      title: { ...DEFAULT.title, text: 'タイトル', font: 'jp', weight: 800, size: 84, color: '#ffffff', letterSpacing: 0.04, lineHeight: 1.2, align: 'left', x: 0.05, y: 0.48, shadow: false },
      sub: { ...DEFAULT.sub, text: 'サブタイトル', size: 28, color: '#E6F0F2', align: 'left', x: 0.05, y: 0.74, shadow: false },
      vtext: { ...DEFAULT.vtext, on: false },
    }) },
    polaroid: { name: '白フチ', hint: '太い白フチ＋下の余白に文字', apply: () => ({
      template: 'single', gap: 0,
      overlay: { ...DEFAULT.overlay, type: 'band', band: { dir: 'h', pos: 0.9, size: 0.2, color: '#ffffff', opacity: 1 } },
      frame: { on: true, color: '#ffffff', width: 40, inset: 0 },
      label: { ...DEFAULT.label, text: '' },
      title: { ...DEFAULT.title, text: 'タイトル', font: 'jpserif', weight: 700, size: 58, color: '#2b2b2b', letterSpacing: 0.06, y: 0.87, shadow: false },
      sub: { ...DEFAULT.sub, text: 'サブタイトル', font: 'jp', size: 22, color: '#777777', y: 0.945, shadow: false },
      vtext: { ...DEFAULT.vtext, on: false },
    }) },
    grid3: { name: '1＋2コラージュ', hint: '大きい1枚＋小さい2枚・大きい側に文字', apply: () => ({
      template: 'grid3', gap: 8,
      overlay: { ...DEFAULT.overlay, type: 'gradient', gradient: { dir: 'bottom', color: '#000000', opacity: 0.6, size: 0.5 } },
      frame: { ...DEFAULT.frame, on: false },
      label: { ...DEFAULT.label, text: 'ラベル', style: 'pill', bg: '#2F6D80', color: '#ffffff', size: 22, align: 'left', x: 0.04, y: 0.66 },
      title: { ...DEFAULT.title, text: 'タイトル', font: 'jp', weight: 800, size: 80, color: '#ffffff', letterSpacing: 0.02, align: 'left', x: 0.04, y: 0.78 },
      sub: { ...DEFAULT.sub, text: 'サブタイトル', size: 26, color: '#ffffff', align: 'left', x: 0.04, y: 0.9 },
      vtext: { ...DEFAULT.vtext, on: false },
    }) },
    topband: { name: '上帯ラベル', hint: '上に黒い帯とラベル、中央に大きなタイトル', apply: () => ({
      template: 'single', gap: 0,
      overlay: { ...DEFAULT.overlay, type: 'band', band: { dir: 'h', pos: 0.09, size: 0.18, color: '#111111', opacity: 0.85 } },
      frame: { ...DEFAULT.frame, on: false },
      label: { ...DEFAULT.label, text: 'ラベル', style: 'plain', color: '#ffffff', size: 26, letterSpacing: 0.35, y: 0.09 },
      title: { ...DEFAULT.title, text: 'タイトル', font: 'sans', weight: 900, size: 130, color: '#ffffff', letterSpacing: 0.06, y: 0.56 },
      sub: { ...DEFAULT.sub, text: 'サブタイトル', size: 30, color: '#ffffff', y: 0.72 },
      vtext: { ...DEFAULT.vtext, on: false },
    }) },
  };
  const PRESET_ORDER = ['none', 'single', 'grid4', 'band', 'bottombar', 'split', 'polaroid', 'grid3', 'topband'];

  function cellCount(template) { return (template === 'grid4' || template === 'band') ? 4 : template === 'grid3' ? 3 : 1; }
  function cellRects(template, W, H, gap) {
    if (cellCount(template) === 1) return [{ x: 0, y: 0, w: W, h: H }];
    if (template === 'grid3') { const g = gap || 0, bw = Math.round(W * 0.62), sw = W - bw - g, sh = (H - g) / 2; return [{ x: 0, y: 0, w: bw, h: H }, { x: bw + g, y: 0, w: sw, h: sh }, { x: bw + g, y: sh + g, w: sw, h: sh }]; }
    const g = gap || 0, cw = (W - g) / 2, ch = (H - g) / 2;
    return [{ x: 0, y: 0, w: cw, h: ch }, { x: cw + g, y: 0, w: cw, h: ch }, { x: 0, y: ch + g, w: cw, h: ch }, { x: cw + g, y: ch + g, w: cw, h: ch }];
  }
  function cellAt(template, W, H, gap, px, py) {
    const rs = cellRects(template, W, H, gap);
    const i = rs.findIndex(r => px >= r.x && px < r.x + r.w && py >= r.y && py < r.y + r.h);
    return i < 0 ? 0 : i;
  }
  // 写真をセルに cover-fit ＋ zoom・dx/dy（幅1200基準px）。はみ出しは clip、写真が足りない側は出さない
  function photoGeom(img, r, p, s) {
    const zoom = Math.max(1, (p && p.zoom) || 1);
    const scale = Math.max(r.w / img.naturalWidth, r.h / img.naturalHeight) * zoom;
    const dw = img.naturalWidth * scale, dh = img.naturalHeight * scale;
    const maxDx = (dw - r.w) / 2, maxDy = (dh - r.h) / 2;
    const dx = Math.max(-maxDx, Math.min(maxDx, ((p && p.dx) || 0) * s));
    const dy = Math.max(-maxDy, Math.min(maxDy, ((p && p.dy) || 0) * s));
    return { ox: r.x + (r.w - dw) / 2 + dx, oy: r.y + (r.h - dh) / 2 + dy, dw, dh, maxDx: maxDx / s, maxDy: maxDy / s };
  }
  function drawPhotoCell(ctx, img, r, p, s) {
    ctx.save(); ctx.beginPath(); ctx.rect(r.x, r.y, r.w, r.h); ctx.clip();
    const g = photoGeom(img, r, p, s);
    ctx.drawImage(img, g.ox, g.oy, g.dw, g.dh);
    ctx.restore();
  }
  function fontStr(weight, px, key) { return `${weight || 400} ${Math.max(1, px)}px ${FONTS[key] || FONTS.sans}`; }
  function hexA(hex, a) {
    const m = String(hex || '#000').replace('#', '');
    const n = m.length === 3 ? m.split('').map(c => c + c).join('') : m;
    const r = parseInt(n.slice(0, 2), 16) || 0, g = parseInt(n.slice(2, 4), 16) || 0, b = parseInt(n.slice(4, 6), 16) || 0;
    return `rgba(${r},${g},${b},${a})`;
  }
  // 文字間隔つきの1行描画（中央揃え）。戻り値は描画幅
  function measureSpaced(ctx, text, spacingPx) {
    const chars = Array.from(text); let w = 0;
    chars.forEach((c, i) => { w += ctx.measureText(c).width + (i < chars.length - 1 ? spacingPx : 0); });
    return w;
  }
  function drawSpaced(ctx, text, cx, y, spacingPx, align) {
    const chars = Array.from(text);
    const total = measureSpaced(ctx, text, spacingPx);
    let x = align === 'left' ? cx : align === 'right' ? cx - total : cx - total / 2;
    const prev = ctx.textAlign; ctx.textAlign = 'left';
    chars.forEach(c => { ctx.fillText(c, x, y); x += ctx.measureText(c).width + spacingPx; });
    ctx.textAlign = prev;
    return total;
  }
  function withShadow(ctx, on, s, fn) {
    ctx.save();
    if (on) { ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 14 * s; ctx.shadowOffsetY = 2 * s; }
    fn(); ctx.restore();
  }
  function roundRect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath(); ctx.moveTo(x + rr, y); ctx.arcTo(x + w, y, x + w, y + h, rr); ctx.arcTo(x + w, y + h, x, y + h, rr); ctx.arcTo(x, y + h, x, y, rr); ctx.arcTo(x, y, x + w, y, rr); ctx.closePath();
  }

  function drawTitle(ctx, t, W, H, s) {
    if (!t || !String(t.text || '').trim()) return;
    const lines = String(t.text).split('\n').map(l => l.replace(/\r/g, '')).filter((l, i, a) => l.trim() !== '' || (i > 0 && i < a.length - 1));
    const base = (t.size || 120) * s;
    const items = lines.map(l => {
      const m = l.match(/^\s*\{(.*)\}\s*$/);
      const lh = t.lineHeight || 1.05;
      if (m) return { text: m[1], font: fontStr(400, base * 0.62, 'script'), h: base * 0.62 * lh * 0.93, spacing: 0 };
      return { text: l, font: fontStr(t.weight, base, t.font), h: base * lh, spacing: (t.letterSpacing || 0) * base };
    });
    const total = items.reduce((a, it) => a + it.h, 0);
    let y = (t.y != null ? t.y : 0.5) * H - total / 2;
    const cx = (t.x != null ? t.x : 0.5) * W;
    ctx.textBaseline = 'middle';
    withShadow(ctx, t.shadow !== false, s, () => {
      ctx.fillStyle = t.color || '#fff';
      items.forEach(it => { ctx.font = it.font; drawSpaced(ctx, it.text, cx, y + it.h / 2, it.spacing, t.align); y += it.h; });
    });
  }
  function drawSub(ctx, t, W, H, s) {
    if (!t || !String(t.text || '').trim()) return;
    const px = (t.size || 30) * s, lines = String(t.text).split('\n');
    const lh = t.lineHeight || 1.5;
    const cx = (t.x != null ? t.x : 0.5) * W; let y = (t.y != null ? t.y : 0.65) * H - (lines.length - 1) * px * lh / 2;
    ctx.textBaseline = 'middle'; ctx.font = fontStr(t.weight, px, t.font);
    withShadow(ctx, t.shadow !== false, s, () => {
      ctx.fillStyle = t.color || '#fff';
      lines.forEach(l => { drawSpaced(ctx, l, cx, y, (t.letterSpacing || 0) * px, t.align); y += px * lh; });
    });
  }
  function drawLabel(ctx, t, W, H, s) {
    if (!t || !String(t.text || '').trim()) return;
    const px = (t.size || 24) * s, sp = (t.letterSpacing || 0) * px;
    ctx.font = fontStr(600, px, 'sans'); ctx.textBaseline = 'middle';
    const tw = measureSpaced(ctx, t.text, sp);
    const ax = (t.x != null ? t.x : 0.5) * W, cy = (t.y != null ? t.y : 0.36) * H;
    const padX = px * 0.9, padY = px * 0.45, bw = tw + padX * 2, bh = px + padY * 2;
    // 揃え位置から箱の左端を決める（left=箱の左端が x、right=右端が x）
    const bx = t.align === 'left' ? ax : t.align === 'right' ? ax - bw : ax - bw / 2;
    if (t.style === 'pill') { ctx.fillStyle = t.bg || '#111'; roundRect(ctx, bx, cy - bh / 2, bw, bh, bh / 2); ctx.fill(); }
    else if (t.style === 'outline') { ctx.strokeStyle = t.color || '#fff'; ctx.lineWidth = Math.max(1, 1.5 * s); roundRect(ctx, bx, cy - bh / 2, bw, bh, bh / 2); ctx.stroke(); }
    ctx.fillStyle = t.color || '#fff';
    drawSpaced(ctx, t.text, bx + bw / 2, cy, sp, 'center');
  }
  function drawVertical(ctx, t, W, H, s) {
    if (!t || !t.on || !String(t.text || '').trim()) return;
    const px = (t.size || 26) * s;
    const x = (t.side === 'left' ? (1 - (t.x != null ? t.x : 0.945)) : (t.x != null ? t.x : 0.945)) * W;
    let y = (t.y != null ? t.y : 0.1) * H + px / 2;
    ctx.font = fontStr(t.weight, px, t.font || 'jp'); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    withShadow(ctx, true, s, () => {
      ctx.fillStyle = t.color || '#fff';
      Array.from(String(t.text)).forEach(c => {
        if (c === '\n') { y += px * 0.6; return; }
        const rot = /[ー−‐-]/.test(c);
        if (rot) { ctx.save(); ctx.translate(x, y); ctx.rotate(Math.PI / 2); ctx.fillText(c, 0, 0); ctx.restore(); }
        else ctx.fillText(c, x, y);
        y += px * (1 + (t.letterSpacing || 0));
      });
    });
    ctx.textAlign = 'start';
  }

  // メイン描画。cache は { [src]: HTMLImageElement }（読み込み済み）
  function render(ctx, d, W, H, cache) {
    const s = W / BASE_W;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#e2e8f0'; ctx.fillRect(0, 0, W, H);
    const rects = cellRects(d.template, W, H, (d.gap || 0) * s);
    rects.forEach((r, i) => {
      const p = (d.photos || [])[i];
      const img = p && p.src && cache && cache[p.src];
      if (img && img.complete && img.naturalWidth) drawPhotoCell(ctx, img, r, p, s);
      else { ctx.fillStyle = i % 2 ? '#e8edf2' : '#dde4ea'; ctx.fillRect(r.x, r.y, r.w, r.h); }
    });
    if (d.template !== 'none') {
      const ov = d.overlay || {};
      if (ov.type === 'dark') { ctx.fillStyle = hexA(ov.color || '#000', ov.opacity != null ? ov.opacity : 0.3); ctx.fillRect(0, 0, W, H); }
      if (ov.type === 'gradient') {
        const gd = ov.gradient || {}; const size = gd.size != null ? gd.size : 0.6, op = gd.opacity != null ? gd.opacity : 0.75;
        const fromTop = gd.dir === 'top';
        const g = fromTop ? ctx.createLinearGradient(0, 0, 0, size * H) : ctx.createLinearGradient(0, H, 0, H - size * H);
        g.addColorStop(0, hexA(gd.color || '#000', op)); g.addColorStop(1, hexA(gd.color || '#000', 0));
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      }
      if (ov.type === 'band') {
        const b = ov.band || {}; const size = b.size != null ? b.size : 0.26, pos = b.pos != null ? b.pos : 0.5;
        ctx.fillStyle = hexA(b.color || '#f3ede3', b.opacity != null ? b.opacity : 0.88);
        if (b.dir === 'v') ctx.fillRect((pos - size / 2) * W, 0, size * W, H); else ctx.fillRect(0, (pos - size / 2) * H, W, size * H);
      }
      const f = d.frame || {};
      if (f.on) { const ins = (f.inset || 0) * s, lw = Math.max(1, (f.width || 2) * s); ctx.strokeStyle = f.color || '#fff'; ctx.lineWidth = lw; ctx.strokeRect(ins + lw / 2, ins + lw / 2, W - ins * 2 - lw, H - ins * 2 - lw); }
      drawLabel(ctx, d.label, W, H, s);
      drawTitle(ctx, d.title, W, H, s);
      drawSub(ctx, d.sub, W, H, s);
      drawVertical(ctx, d.vtext, W, H, s);
    }
    ctx.restore();
  }

  // 使うフォントを読み込んでから描画するための Promise
  function ensureFonts(d) {
    if (!document.fonts || !document.fonts.load) return Promise.resolve();
    const reqs = [];
    const add = (w, key) => reqs.push(document.fonts.load(`${w || 400} 40px ${FONTS[key] || FONTS.sans}`).catch(() => {}));
    add(d.title && d.title.weight, d.title && d.title.font); add(400, 'script');
    add(d.sub && d.sub.weight, d.sub && d.sub.font); add(600, 'sans');
    add(d.vtext && d.vtext.weight, (d.vtext && d.vtext.font) || 'jp');
    return Promise.all(reqs);
  }
  function loadImages(d) {
    const srcs = (d.photos || []).map(p => p && p.src).filter(Boolean);
    const cache = {};
    return Promise.all(srcs.map(src => new Promise(res => { const im = new Image(); im.onload = () => { cache[src] = im; res(); }; im.onerror = () => res(); im.src = src; }))).then(() => cache);
  }
  // 保存用：写真データを除いたデザイン設定
  function strip(d) { const o = JSON.parse(JSON.stringify(d || {})); o.photos = (o.photos || []).map(p => ({ zoom: p.zoom || 1, dx: p.dx || 0, dy: p.dy || 0 })); return o; }
  function merge(base, patch) { const o = JSON.parse(JSON.stringify(base)); for (const k of Object.keys(patch || {})) { o[k] = (patch[k] && typeof patch[k] === 'object' && !Array.isArray(patch[k]) && o[k] && typeof o[k] === 'object') ? { ...o[k], ...patch[k] } : patch[k]; } return o; }
  function applyPreset(d, key) {
    const p = PRESETS[key]; if (!p) return d;
    const next = merge(d, p.apply());
    const n = cellCount(next.template);
    next.photos = (d.photos || []).slice(0, n); while (next.photos.length < n) next.photos.push({ zoom: 1, dx: 0, dy: 0 });
    return next;
  }

  window.ThumbDesign = { FONTS, FONT_LABEL, COLOR_CHIPS, DEFAULT, PRESETS, PRESET_ORDER, BASE_W, cellCount, cellRects, cellAt, photoGeom, render, ensureFonts, loadImages, strip, merge, applyPreset };
})();
