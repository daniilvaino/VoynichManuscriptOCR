// Tab 2: drawing masks. Viewer (Split Compare, AI vs Human diff) and browser editor:
// Brush, Eraser, Lasso, Magnetic lasso (OpenCV.js Intelligent Scissors), Restore brush, Pan (Space or H).
const DR = (() => {
  const SRCNAME = {'human': 'marked by a human (finished)', 'human-rough': 'marked by a human (approximate in places)',
    'human-partial': 'partly corrected by a human', 'ai-start': 'AI draft: SAM 3 ∩ GPT/Gemini (not reviewed)'};
  const SRCCOL = {'human': [70, 201, 122], 'human-rough': [70, 201, 122], 'human-partial': [255, 214, 10], 'ai-start': [88, 166, 255]};
  const MINE = [242, 169, 59];
  const LAYER = {start: 'AI consensus (SAM 3 ∩ GPT/Gemini)', sam3: 'SAM 3', ai: 'GPT / Gemini', mask: 'published mask'};
  let INFO = {pages: {}}, P = null, W = 0, H = 0, M = null, L = {}, ocFill = null, ogFill = null, oidFill = null, ocEdge = null, ogEdge = null, oidEdge = null, dirtyAll = true;
  let on = false, tool = 'brush', bs = 24, op = 'add', rsrc = 'ai', radd = false, show = 'mask', alpha = 45, undo = [], redo = [];
  let allShow = 'mask', allAlpha = 35, cShow = show, cAlpha = alpha, painted = '';
  let stroke = null, lasso = null, mag = null, mouse = [0, 0], mouseIn = false, bpop = null, sizeDrag = null, imgPix = null, ready = null;
  const $ = id => document.getElementById(id), BSMAX = 200;
  const key = () => 'draw:' + E.image;
  ready = fetch('data/drawings.json', {cache: 'no-cache'}).then(r => r.ok ? r.json() : {pages: {}}).then(j => INFO = j).catch(() => {});

  // ---------- data ----------
  const loadBits = src => new Promise(ok => { const im = new Image(); im.onload = () => { const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d'); g.drawImage(im, 0, 0, W, H); const d = g.getImageData(0, 0, W, H).data, b = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) b[i] = d[i * 4] > 127 && d[i * 4 + 3] > 0 ? 1 : 0; ok(b) }; im.onerror = () => ok(null); im.src = src });
  async function load() {
    await ready; P = INFO.pages[E.image] || null; L = {}; M = null; undo = []; redo = []; lasso = null; magReset(); imgPix = null;
    W = E.display.w; H = E.display.h;
    ocFill = document.createElement('canvas'); ocFill.width = W; ocFill.height = H; ogFill = ocFill.getContext('2d'); oidFill = ogFill.createImageData(W, H);
    ocEdge = document.createElement('canvas'); ocEdge.width = W; ocEdge.height = H; ogEdge = ocEdge.getContext('2d'); oidEdge = ogEdge.createImageData(W, H);
    dirtyAll = true; painted = '';
    if (!P) { panel(); return }
    const im = E.image;
    for (const k of P.layers) loadBits(`img/draw_${k}/${im}.png`).then(b => { if (E.image !== im) return; L[k] = b; if (k === 'mask' && !M) { M = mineOrPub(); } dirtyAll = true; draw(); panel() });
  }
  function mineOrPub() { const m = lsGet(key()); if (m && m.png) { const im = E.image; loadBits(m.png).then(b => { if (E.image === im && b) { M = b; dirtyAll = true; draw(); panel() } }) }
    return L.mask ? L.mask.slice() : new Uint8Array(W * H) }
  function save() { if (!M) return; const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d'), id = g.createImageData(W, H);
    for (let i = 0; i < W * H; i++) { const v = M[i] ? 255 : 0; id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = v; id.data[i * 4 + 3] = 255 } g.putImageData(id, 0, 0);
    const png = c.toDataURL('image/png'); try { localStorage.setItem(LS(key()), JSON.stringify({image: E.image, folio: E.folio, frame: 'display image', w: W, h: H, png, edited_at: new Date().toISOString()})) }
    catch (e) { alert('Your browser storage is full: download your masks and reset some pages.') } renderList(); if (typeof countLocalEdits === 'function') countLocalEdits(); panel() }
  const mine = () => !!lsGet(key());
  const snapU = () => { undo.push(M.slice()); if (undo.length > 40) undo.shift(); redo = [] };

  // ---------- overlay (split fill + edge layers so opacity slider is pure GPU globalAlpha, zero pixel loops) ----------
  function paintRect(x0, y0, x1, y1) {
    if (!M && !L.mask) return; x0 = Math.max(0, x0 | 0); y0 = Math.max(0, y0 | 0); x1 = Math.min(W, Math.ceil(x1)); y1 = Math.min(H, Math.ceil(y1));
    const df = oidFill.data, de = oidEdge.data, src = P ? P.source : 'ai-start', sh = cShow;
    const curM = M || L.mask, pubCol = (on || mine()) ? MINE : SRCCOL[src];
    const edge = (m, i, x) => m[i] && (x === 0 || x === W - 1 || !m[i - 1] || !m[i + 1] || !m[i - W] || !m[i + W]);
    for (let y = Math.max(1, y0); y < Math.min(H - 1, y1); y++) for (let x = x0; x < x1; x++) {
      const i = y * W + x, o = i * 4; let c = null, isE = false;
      if (sh === 'mask' || on) { if (curM[i]) { c = pubCol; isE = edge(curM, i, x) } }
      else if (sh === 'origin') {
        if (P && P.source !== 'ai-start' && L.start && curM) {
          const h = curM[i], s = L.start[i];
          if (h && s) { c = [70, 201, 122]; isE = edge(curM, i, x) } else if (h) { c = [255, 214, 10]; isE = edge(curM, i, x) }
          else if (s) { c = [255, 59, 48]; isE = edge(L.start, i, x) } }
        else if (L.sam3 && L.ai) { const s = L.sam3[i], g = L.ai[i];
          if (s && g) c = [88, 166, 255]; else if (s) c = [255, 140, 0]; else if (g) c = [255, 61, 255] } }
      else { const m = L[sh]; if (m && m[i]) { c = {start: [33, 212, 255], sam3: [255, 140, 0], ai: [255, 61, 255]}[sh]; isE = edge(m, i, x) } }
      if (c) {
        if (isE) { de[o] = c[0]; de[o + 1] = c[1]; de[o + 2] = c[2]; de[o + 3] = 255; df[o + 3] = 0 }
        else { df[o] = c[0]; df[o + 1] = c[1]; df[o + 2] = c[2]; df[o + 3] = 255; de[o + 3] = 0 }
      } else { df[o + 3] = 0; de[o + 3] = 0 } }
    ogFill.putImageData(oidFill, 0, 0, x0, y0, x1 - x0, y1 - y0);
    ogEdge.putImageData(oidEdge, 0, 0, x0, y0, x1 - x0, y1 - y0) }

  function render(ctx, view, toScr, isAll) {
    if (!P) return;
    cShow = isAll ? allShow : show; cAlpha = isAll ? allAlpha : alpha;
    if (!on && cShow === 'none') return;
    const k = cShow + '|' + on + '|' + mine();
    if (k !== painted) { dirtyAll = true; painted = k }
    if (dirtyAll) { paintRect(0, 0, W, H); dirtyAll = false }
    ctx.save(); ctx.translate(view.x, view.y); ctx.scale(view.z, view.z); ctx.imageSmoothingEnabled = false;
    if (cAlpha > 0) { ctx.globalAlpha = cAlpha / 100; ctx.drawImage(ocFill, 0, 0) }
    ctx.globalAlpha = 1;
    ctx.drawImage(ocEdge, 0, 0);
    if (!isAll && on && tool === 'restore' && L[rsrc]) { if (!L['_e' + rsrc]) L['_e' + rsrc] = edgeCanvas(L[rsrc]); ctx.drawImage(L['_e' + rsrc], 0, 0) }
    ctx.restore();
    if (isAll || !on || window.spaceDown) return;
    if ((['brush', 'eraser', 'restore'].includes(tool) && (mouseIn || bpop)) || sizeDrag) {
      const c = sizeDrag ? toScr(sizeDrag.c) : bpop ? toScr(bpop.c) : toScr(mouse);
      ctx.beginPath(); ctx.arc(c[0], c[1], Math.max(1, bs / 2 * view.z), 0, 7); ctx.strokeStyle = tool === 'eraser' ? '#ffffff' : '#f2a93b'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(c[0], c[1], Math.max(1, bs / 2 * view.z) + 1.5, 0, 7); ctx.stroke()
    }
    const poly = (pts, close, col) => { if (pts.length < 2) return; ctx.beginPath(); pts.forEach((p, i) => { const q = toScr(p); i ? ctx.lineTo(...q) : ctx.moveTo(...q) }); if (close) ctx.closePath();
      ctx.strokeStyle = col; ctx.lineWidth = 1.6; ctx.stroke() };
    if (lasso) poly(lasso.pts, false, lasso.op === 'sub' ? '#ff5a5a' : '#ffd23f');
    if (mag) { const pts = [].concat(...mag.segs, mag.live); poly(pts, false, mag.op === 'sub' ? '#ff5a5a' : '#ffd23f');
      mag.anchors.forEach(p => { const q = toScr(p); ctx.fillStyle = '#ffd23f'; ctx.fillRect(q[0] - 3, q[1] - 3, 6, 6) }) } }
  function edgeCanvas(m) { const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d'), id = g.createImageData(W, H), d = id.data;
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { const i = y * W + x; if (m[i] && (!m[i - 1] || !m[i + 1] || !m[i - W] || !m[i + W] || !m[i - 2] || !m[i + 2] || !m[i - 2 * W] || !m[i + 2 * W])) { d[i * 4] = 33; d[i * 4 + 1] = 212; d[i * 4 + 2] = 255; d[i * 4 + 3] = 255 } }
    g.putImageData(id, 0, 0); return c }

  // ---------- tools ----------
  function stamp(x, y, v) { const r = bs / 2;
    for (let yy = Math.max(0, Math.floor(y - r)); yy <= Math.min(H - 1, Math.ceil(y + r)); yy++) for (let xx = Math.max(0, Math.floor(x - r)); xx <= Math.min(W - 1, Math.ceil(x + r)); xx++)
      if ((xx - x) ** 2 + (yy - y) ** 2 <= r * r) { const i = yy * W + xx; M[i] = typeof v === 'number' ? v : v.add ? (M[i] | v.add[i]) : v[i] }
    paintRect(x - r - 2, y - r - 2, x + r + 3, y + r + 3) }
  function strokeTo(a, b, v) { const d = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(d / Math.max(1, bs / 4))); for (let i = 1; i <= n; i++) stamp(a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n, v) }
  function fillPoly(pts, o) { if (pts.length < 3) return; snapU(); const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(...p) : g.moveTo(...p)); g.closePath(); g.fill();
    const d = g.getImageData(0, 0, W, H).data; for (let i = 0; i < W * H; i++) if (d[i * 4 + 3] > 127) M[i] = o === 'sub' ? 0 : 1; dirtyAll = true; save(); draw() }
  function morph(grow) { snapU(); const o = M.slice(); for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { const i = y * W + x, n = o[i - 1] + o[i + 1] + o[i - W] + o[i + W];
    M[i] = grow ? (o[i] || n > 0 ? 1 : 0) : (o[i] && n === 4 ? 1 : 0) } dirtyAll = true; save(); draw() }
  function fillHoles() { snapU(); const out = new Uint8Array(W * H), st = []; for (let x = 0; x < W; x++) { st.push(x, (H - 1) * W + x) } for (let y = 0; y < H; y++) { st.push(y * W, y * W + W - 1) }
    while (st.length) { const i = st.pop(); if (out[i] || M[i]) continue; out[i] = 1; const x = i % W; if (x > 0) st.push(i - 1); if (x < W - 1) st.push(i + 1); if (i >= W) st.push(i - W); if (i < W * (H - 1)) st.push(i + W) }
    for (let i = 0; i < W * H; i++) if (!out[i]) M[i] = 1; dirtyAll = true; save(); draw() }

  // magnetic lasso
  let cvP = null;
  function getCV() { if (cvP) return cvP; hint('Loading OpenCV.js (~10 MB, once)…');
    cvP = new Promise(ok => { const s = document.createElement('script'); s.src = 'vendor/opencv.js';
      s.onload = () => { const c = window.cv, done = m => { try { m.then = undefined } catch (e) {} window.cv = m; ok(m) };
        if (c instanceof Promise) c.then(done); else if (c.Mat) done(c); else c.onRuntimeInitialized = () => done(c) }; document.head.appendChild(s) }); return cvP }
  function pix() { if (imgPix) return imgPix; const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d'); g.drawImage(img, 0, 0, W, H); imgPix = g; return g }
  function magReset() { if (mag && mag.t) mag.t.delete(); mag = null; if (typeof setDrawAction === 'function') setDrawAction(null); }
  function magSyncAction() {
    if (!mag || !mag.anchors.length) { if (typeof setDrawAction === 'function') setDrawAction(null); return; }
    setDrawAction(
      `Magnetic lasso · ${mag.anchors.length} anchor${mag.anchors.length > 1 ? 's' : ''}`,
      mag.anchors.length >= 3 ? magClose : null,
      mag.anchors.length > 1 ? () => { mag.anchors.pop(); mag.segs.pop(); mag.t.buildMap(new window.cv.Point(Math.round(mag.anchors.at(-1)[0] - mag.roi[0]), Math.round(mag.anchors.at(-1)[1] - mag.roi[1]))); magSyncAction(); draw(); } : null,
      () => { magReset(); hint(); draw(); }
    );
  }
  function magROI(ax, ay, x, y) { const cv = window.cv, r = $('cv').getBoundingClientRect(), a0 = toImg(0, 0), a1 = toImg(r.width, r.height), m = 300, cap = 2400;
    let x0 = Math.min(ax, x, a0[0]), y0 = Math.min(ay, y, a0[1]), x1 = Math.max(ax, x, a1[0]), y1 = Math.max(ay, y, a1[1]);
    x0 = Math.min(x0, Math.min(ax, x) - m); y0 = Math.min(y0, Math.min(ay, y) - m); x1 = Math.max(x1, Math.max(ax, x) + m); y1 = Math.max(y1, Math.max(ay, y) + m);
    if (x1 - x0 > cap) { const c = (ax + x) / 2; x0 = c - cap / 2; x1 = c + cap / 2 } if (y1 - y0 > cap) { const c = (ay + y) / 2; y0 = c - cap / 2; y1 = c + cap / 2 }
    x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0)); x1 = Math.min(W, Math.ceil(x1)); y1 = Math.min(H, Math.ceil(y1));
    const src = cv.matFromImageData(pix().getImageData(x0, y0, x1 - x0, y1 - y0)), rgb = new cv.Mat(); cv.cvtColor(src, rgb, cv.COLOR_RGBA2RGB); src.delete();
    if (mag.t) mag.t.delete(); const t = new cv.segmentation_IntelligentScissorsMB(); t.setEdgeFeatureCannyParameters(32, 100); t.setGradientMagnitudeMaxLimit(200);
    t.applyImage(rgb); rgb.delete(); mag.t = t; mag.roi = [x0, y0, x1 - x0, y1 - y0];
    if (mag.anchors.length) { const a = mag.anchors.at(-1); t.buildMap(new cv.Point(Math.round(a[0] - x0), Math.round(a[1] - y0))) } }
  function magFit(x, y) { const [rx, ry, rw, rh] = mag.roi, g = 8, out = (x < rx + g && rx > 0) || (y < ry + g && ry > 0) || (x > rx + rw - g && rx + rw < W) || (y > ry + rh - g && ry + rh < H);
    if (out && mag.anchors.length) { const a = mag.anchors.at(-1); magROI(a[0], a[1], x, y) } const [qx, qy, qw, qh] = mag.roi; return [Math.max(qx, Math.min(qx + qw - 1, x)), Math.max(qy, Math.min(qy + qh - 1, y))] }
  async function magClick(x, y, e) { if (!mag) { const o = e.altKey ? 'sub' : op; await getCV(); mag = {t: null, roi: null, anchors: [], segs: [], live: [], op: o}; magROI(x, y, x, y); hint('Magnetic lasso: click along outline · Enter closes') }
    const cv = window.cv; [x, y] = magFit(x, y);
    if (mag.anchors.length > 2 && Math.hypot(x - mag.anchors[0][0], y - mag.anchors[0][1]) < 8 / view.z) return magClose();
    if (mag.anchors.length) { magLive(x, y); mag.segs.push(mag.live.slice()) } mag.anchors.push([x, y]); mag.t.buildMap(new cv.Point(Math.round(x - mag.roi[0]), Math.round(y - mag.roi[1]))); mag.live = []; magSyncAction(); draw() }
  function magLive(x, y) { if (!mag || !mag.anchors.length || !mag.t) return; const cv = window.cv; [x, y] = magFit(x, y); const [rx, ry] = mag.roi, c = new cv.Mat();
    mag.t.getContour(new cv.Point(Math.round(x - rx), Math.round(y - ry)), c); const d = c.data32S, pts = []; for (let i = 0; i < d.length; i += 2) pts.push([d[i] + rx, d[i + 1] + ry]); c.delete();
    const a = mag.anchors.at(-1); if (pts.length && Math.hypot(pts[0][0] - a[0], pts[0][1] - a[1]) > Math.hypot(pts.at(-1)[0] - a[0], pts.at(-1)[1] - a[1])) pts.reverse(); mag.live = pts }
  function magClose() { if (!mag) return; magLive(...mag.anchors[0]); mag.segs.push(mag.live); const pts = [].concat(...mag.segs), o = mag.op; magReset(); fillPoly(pts, o); hint() }

  // ---------- events ----------
  const active = () => VIEW === 'draw' && on && P && M;
  const cvs = $('cv');
  cvs.addEventListener('mouseenter', () => { mouseIn = true; if (active()) draw(); });
  cvs.addEventListener('mouseleave', () => { mouseIn = false; if (active()) draw(); });
  cvs.addEventListener('mousedown', e => {
    if (!active()) return;
    // Allow trackpad panning via Pan tool OR holding Space + drag OR middle mouse button!
    if (e.button === 1 || tool === 'pan' || window.spaceDown) return;
    const x = e.offsetX, y = e.offsetY, t = toImg(x, y);
    if (bpop && e.button !== 2) bpopClose();
    e.stopImmediatePropagation(); e.preventDefault();
    if (e.button === 2) { if (['brush', 'eraser', 'restore'].includes(tool)) { if (e.altKey || e.ctrlKey) sizeDrag = {sx: e.clientX, bs0: bs, c: t}; else bpopOpen(e.clientX, e.clientY, t) }
      else if (mag && mag.anchors.length > 1) { mag.anchors.pop(); mag.segs.pop(); mag.t.buildMap(new window.cv.Point(Math.round(mag.anchors.at(-1)[0] - mag.roi[0]), Math.round(mag.anchors.at(-1)[1] - mag.roi[1]))); magSyncAction(); draw() } return }
    if (tool === 'brush' || tool === 'eraser' || tool === 'restore') { snapU(); const v = tool === 'restore' ? (L[rsrc] ? (radd ? {add: L[rsrc]} : L[rsrc]) : null) : ((tool === 'brush') !== e.ctrlKey ? 1 : 0);
      if (v === null) { hint('This layer is still loading…'); return } stroke = {last: t, v}; stamp(t[0], t[1], v); draw(); return }
    if (tool === 'lasso') { lasso = {pts: [t], op: e.altKey ? 'sub' : op}; draw(); return }
    if (tool === 'magnetic') { magClick(t[0], t[1], e); return }
  }, true);
  window.addEventListener('mousemove', e => { if (VIEW !== 'draw' || !on) return; const r = cvs.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top; mouse = toImg(x, y);
    if (sizeDrag) { bs = Math.max(1, Math.min(BSMAX, Math.round(sizeDrag.bs0 + (e.clientX - sizeDrag.sx) / view.z))); panel(); draw(); return }
    if (stroke) { strokeTo(stroke.last, mouse, stroke.v); stroke.last = mouse }
    else if (lasso) lasso.pts.push(mouse);
    else if (mag && mag.anchors.length) magLive(mouse[0], mouse[1]);
    draw() }, true);
  window.addEventListener('mouseup', () => { if (VIEW !== 'draw' || !on) return;
    if (sizeDrag) { sizeDrag = null; draw(); return }
    if (stroke) { stroke = null; save(); return }
    if (lasso) { const l = lasso; lasso = null; fillPoly(l.pts, l.op) } }, true);
  function bpopOpen(cx, cy, c) { bpopClose(); const d = document.createElement('div'); d.className = 'bpop';
    d.innerHTML = `Size <input type="range" min="1" max="${BSMAX}" value="${bs}"> <b>${bs}px</b>`; d.style.left = Math.min(innerWidth - 240, cx + 8) + 'px'; d.style.top = Math.min(innerHeight - 60, cy + 8) + 'px';
    document.body.appendChild(d); const r = d.querySelector('input'); r.oninput = () => { bs = +r.value; d.querySelector('b').textContent = bs + 'px'; panel(); draw() }; bpop = {el: d, c}; draw() }
  function bpopClose() { if (bpop) { bpop.el.remove(); bpop = null; draw() } }

  window.addEventListener('keydown', e => {
    if (VIEW !== 'draw' || isTextTarget(e.target)) return;
    const c = e.code, stop = () => { e.preventDefault(); e.stopImmediatePropagation() };
    if (c === 'Digit6' && !on) return;
    if (!on) { if (c === 'KeyD' && P) { stop(); setOn(true) } return }
    if (bpop && (c === 'Escape' || c === 'Enter')) { stop(); bpopClose(); return }
    if (e.ctrlKey && c === 'KeyZ' && !e.shiftKey) { stop(); if (undo.length) { redo.push(M.slice()); M = undo.pop(); dirtyAll = true; save(); draw() } return }
    if (e.ctrlKey && (c === 'KeyY' || (c === 'KeyZ' && e.shiftKey))) { stop(); if (redo.length) { undo.push(M.slice()); M = redo.pop(); dirtyAll = true; save(); draw() } return }
    if (e.ctrlKey || e.metaKey) return;
    if (c === 'Enter' && mag) { stop(); magClose(); return }
    if (c === 'Escape') { stop(); if (mag) { magReset(); hint(); draw() } else if (lasso) { lasso = null; draw() } else setOn(false); return }
    if (c === 'Backspace' && mag && mag.anchors.length > 1) { stop(); mag.anchors.pop(); mag.segs.pop(); mag.t.buildMap(new window.cv.Point(Math.round(mag.anchors.at(-1)[0] - mag.roi[0]), Math.round(mag.anchors.at(-1)[1] - mag.roi[1]))); magSyncAction(); draw(); return }
    const k = {KeyB: 'brush', KeyE: 'eraser', KeyF: 'lasso', KeyL: 'magnetic', KeyY: 'restore', KeyH: 'pan'}[c]; if (k) { stop(); setTool(k); return }
    if (c === 'BracketLeft' || c === 'BracketRight') { stop(); bs = c === 'BracketLeft' ? Math.max(1, Math.round(bs / 1.25)) : Math.min(BSMAX, Math.round(bs * 1.25) + 1); panel(); draw(); return }
    if (c === 'KeyA') { stop(); op = 'add'; panel(); return }
    if (c === 'KeyX') { stop(); op = 'sub'; panel(); return }
  }, true);

  // ---------- UI ----------
  function hint(t) {
    $('hint').textContent = t || (on ? {
      brush: 'Paint to add · Ctrl erases · Space+drag pans · [ ] size',
      eraser: 'Paint to erase · Ctrl adds · Space+drag pans · [ ] size',
      lasso: 'Draw loop and release · Alt cuts out · Space+drag pans',
      magnetic: 'Click along outline · Enter closes · Space+drag pans',
      restore: 'Paint to copy from chosen layer · Space+drag pans',
      pan: 'Drag to pan canvas · B returns to brush'
    }[tool] : P ? 'Click Compare (C) to wipe scan vs mask · Press D to edit' : 'No drawing mask for this page');
  }
  function setTool(t) { tool = t; if (t !== 'magnetic') magReset(); lasso = null; cvs.style.cursor = (on && t === 'pan') ? 'grab' : ''; panel(); hint(); draw() }
  function setOn(v) {
    on = v && !!P;
    if (on && !M && L.mask) M = L.mask.slice();
    document.body.classList.toggle('dedit', on);
    if ($('dropt')) $('dropt').style.display = (VIEW === 'draw' && !on) ? '' : 'none';
    if (!on) cvs.style.cursor = '';
    dirtyAll = true; magReset(); lasso = null;
    if (typeof syncWipeUI === 'function') syncWipeUI();
    panel(); hint(); draw();
  }
  function area(m) { if (!m) return 0; let n = 0; for (let i = 0; i < m.length; i++) n += m[i]; return n }

  function panel() {
    const box = $('dropt'); if (!box) return;
    if ($('dropt')) $('dropt').style.display = (VIEW === 'draw' && !on) ? '' : 'none';
    document.querySelectorAll('[data-dt]').forEach(b => b.classList.toggle('on', b.dataset.dt === tool));
    document.querySelectorAll('[data-ds]').forEach(b => { b.classList.toggle('on', b.dataset.ds === show); b.disabled = b.dataset.ds !== 'mask' && b.dataset.ds !== 'origin' && !(P && P.layers.includes(b.dataset.ds)) });
    $('d-bs').textContent = bs + 'px';
    if ($('d-bs-rng')) $('d-bs-rng').value = bs;
    if ($('d-alpha')) $('d-alpha').value = alpha;
    if ($('d-alpha-e')) $('d-alpha-e').value = alpha;
    if ($('v-dalpha')) $('v-dalpha').textContent = alpha + '%';
    if ($('v-dalpha-e')) $('v-dalpha-e').textContent = alpha + '%';
    $('d-opadd').classList.toggle('on', op === 'add'); $('d-opsub').classList.toggle('on', op === 'sub');
    $('d-rsrc').value = rsrc; $('d-radd').checked = radd;
    $('d-edit').classList.toggle('on', on);
    $('d-edit').textContent = on ? '✓ Done' : '✎ Edit mask';
    $('d-edit').disabled = !P;
    if ($('d-undo')) $('d-undo').disabled = !undo.length;
    if ($('d-redo')) $('d-redo').disabled = !redo.length;

    $('dopt-brush').classList.toggle('show', ['brush', 'eraser', 'restore'].includes(tool));
    $('dopt-lasso').classList.toggle('show', ['lasso', 'magnetic'].includes(tool));
    $('dopt-restore').classList.toggle('show', tool === 'restore');

    if (VIEW === 'draw' && typeof renderProv === 'function') $('prov').innerHTML = provHtml();
  }

  function provHtml() {
    if (!P) return `<div class="kv-list"><div class="kv-row"><span class="kv-k">Folio</span><span class="kv-v">${E ? E.folio : ''}</span></div></div><div class="keys" style="margin-top:8px">No drawing mask for this page yet. Drawing masks cover the herbal, bathing, and star pages (173 pages).</div>`;
    const col = c => `rgb(${c.join(',')})`, sw = (c, t) => `<div style="display:flex;align-items:center;gap:6px;margin-top:3px"><span style="display:inline-block;width:11px;height:11px;border-radius:3px;background:${col(c)};flex-shrink:0"></span><span>${t}</span></div>`, h = P.source !== 'ai-start';
    const rows = [
      ['Mask', `<span class="badge dsrc-${P.source}">${P.source === 'ai-start' ? 'AI draft' : P.source}</span> <span class="keys">${SRCNAME[P.source]}</span>`],
      ['AI models', `SAM 3 · ${P.ai_model || '—'}`]
    ];
    if (P.saved_at && h) rows.push(['Saved', `<span class="nowrap">${P.saved_at}</span>`]);
    if (P.owner_edits) rows.push(['Edits', `${P.owner_edits} operations`]);
    if (P.note) rows.push(['Note', P.note.replace(/</g, '&lt;')]);
    let s = '<div class="kv-list">' + rows.map(([k, v]) => `<div class="kv-row"><span class="kv-k">${k}</span><span class="kv-v">${v}</span></div>`).join('') + '</div>';
    if (mine()) s += `<div class="mine" style="margin-top:6px">✎ Edited in this browser</div>`;
    s += '<hr style="border:none;border-top:1px solid var(--bd);margin:9px 0">';
    if (on || show === 'mask') s += sw(on || mine() ? MINE : SRCCOL[P.source], on || mine() ? 'Your edited mask' : h ? 'Illustration, human-marked' : 'Illustration, AI draft');
    else if (show === 'origin') s += h ? sw([70, 201, 122], 'AI selected, human kept') + sw([255, 214, 10], 'Human added (AI missed)') + sw([255, 59, 48], 'AI selected, human removed')
      : sw([88, 166, 255], 'Both AI models agree') + sw([255, 140, 0], 'Only SAM 3') + sw([255, 61, 255], 'Only GPT / Gemini');
    else s += sw({start: [33, 212, 255], sam3: [255, 140, 0], ai: [255, 61, 255]}[show], LAYER[show]);
    if (L.mask && L.start && h) {
      const b = area(L.start); let add = 0, rem = 0;
      for (let i = 0; i < W * H; i++) { if (L.mask[i] && !L.start[i]) add++; else if (!L.mask[i] && L.start[i]) rem++ }
      s += `<div class="keys" style="margin-top:6px">vs AI consensus: <span class="nowrap">+${(100 * add / Math.max(1, b)).toFixed(1)}%</span> added, <span class="nowrap">−${(100 * rem / Math.max(1, b)).toFixed(1)}%</span> removed.</div>`;
    }
    s += `<details class="method-box"><summary>Methodology: how AI masks were made</summary><div class="method-body"><b>SAM 3</b> (Meta, prompt "drawing"): score ≥ 0.30, show-through ghosts removed, edges refined with CascadePSP. <b>GPT-5.5 / Gemini</b>: image model painted every drawing bright blue and snapped to pen outline (Gemini for bathing pages). Consensus start mask is then corrected by hand with these same tools.</div></details>`;
    return s;
  }

  function summaryHtml() {
    if (!P) return '<div><b>Drawings:</b> no mask for this page</div>';
    const col = c => `rgb(${c.join(',')})`, sw = (c, t) => `<span style="white-space:nowrap"><span style="color:${col(c)};font-weight:700">■</span> ${t}</span>`, h = P.source !== 'ai-start';
    let s = `<div><b>Drawings:</b> <span class="badge dsrc-${P.source}">${P.source}</span> <span class="keys">${SRCNAME[P.source]}</span></div><div class="keys" style="margin-top:3px">`;
    if (allShow === 'mask') s += sw(mine() ? MINE : SRCCOL[P.source], mine() ? 'your mask' : h ? 'marked by a human' : 'AI draft');
    else if (allShow === 'origin') s += h ? [sw([70, 201, 122], 'AI kept'), sw([255, 214, 10], 'human added'), sw([255, 59, 48], 'human removed')].join(' · ')
      : [sw([88, 166, 255], 'both AI'), sw([255, 140, 0], 'SAM 3'), sw([255, 61, 255], 'GPT/Gemini')].join(' · ');
    else s += sw({start: [33, 212, 255], sam3: [255, 140, 0], ai: [255, 61, 255]}[allShow], LAYER[allShow]);
    return s + '</div>';
  }

  function boxHtml() {
    return `<div class="box edit-card dedit-only"><h3>Your drawing mask</h3>
      <div class="btn-row"><button id="d-dl" class="btn-primary">Download PNG</button><button id="d-dlall" title="All masks you edited in this browser, one JSON file with PNGs">Download all</button><button id="d-reset" class="btn-danger">Reset</button></div>
      <div class="keys" style="margin-top:7px">Hold <kbd>Space</kbd> + drag (or use <b>✋ Pan</b>) to move around while zoomed in.</div></div>`;
  }

  function init() {
    const o = $('dropt');
    o.innerHTML = `<button id="b-wipe-draw" class="btn-compare" type="button" title="Drag a split curtain across the scan to compare Original vs Drawing Mask (C)">⇄ Compare</button>
      <span class="sub-sep"></span>
      <span class="seg" role="group" aria-label="Drawing mask view">
        <button data-ds="mask" title="Published mask coloured by source">Published</button>
        <button data-ds="start" title="Where SAM 3 and GPT/Gemini agree">Consensus</button>
        <button data-ds="sam3">SAM 3</button>
        <button data-ds="ai">GPT / Gemini</button>
        <button data-ds="none">Off</button>
      </span>
      <span class="slider-ctl">Fill <input type="range" id="d-alpha" min="0" max="90" value="${alpha}"><span class="sval" id="v-dalpha">${alpha}%</span></span>`;

    const t = $('dtools');
    t.innerHTML = `<button id="d-edit" class="btn-edit" title="Toggle mask editor (D)">✎ Edit mask</button>
      <span class="dedit-only-i">
        <span class="seg">
          <button data-dt="brush" title="Brush (B)">🖌 Brush</button>
          <button data-dt="eraser" title="Eraser (E)">⌫ Eraser</button>
          <button data-dt="lasso" title="Freehand lasso (F)">➰ Lasso</button>
          <button data-dt="magnetic" title="Magnetic edge-snap lasso (L)">🧲 Magnetic</button>
          <button data-dt="restore" title="Restore from AI/published layer (Y)">↺ Restore</button>
          <button data-dt="pan" title="Pan canvas on trackpad (H or hold Space)">✋ Pan</button>
        </span>
        <span class="dopt-group" id="dopt-brush">
          <span class="slider-ctl">Size <input type="range" id="d-bs-rng" min="1" max="${BSMAX}" value="${bs}"><span class="sval" id="d-bs">${bs}px</span></span>
        </span>
        <span class="dopt-group" id="dopt-lasso">
          <span class="seg"><button id="d-opadd" title="Add area (A)">+ Add</button><button id="d-opsub" title="Cut out area (X)">− Cut out</button></span>
        </span>
        <span class="dopt-group" id="dopt-restore">
          <select id="d-rsrc" title="Restore source"><option value="ai">GPT / Gemini</option><option value="sam3">SAM 3</option><option value="start">Consensus</option><option value="mask">Published</option></select>
          <label class="chip-check"><input type="checkbox" id="d-radd"><span class="cdot"></span>Only add</label>
        </span>
        <span class="slider-ctl" title="Mask opacity while painting">Opacity <input type="range" id="d-alpha-e" min="10" max="90" value="${alpha}" style="width:62px"><span class="sval" id="v-dalpha-e">${alpha}%</span></span>
        <span class="sub-sep"></span>
        <button id="d-fill" title="Fill enclosed holes inside the mask">Fill holes</button>
        <button id="d-grow" title="Expand mask by 1px">+1</button>
        <button id="d-shrink" title="Shrink mask by 1px">−1</button>
        <button id="d-undo" title="Undo (Ctrl+Z)">↶</button>
        <button id="d-redo" title="Redo (Ctrl+Y)">↷</button>
      </span>`;

    $('b-wipe-draw').onclick = () => typeof toggleWipe === 'function' && toggleWipe();
    document.querySelectorAll('[data-ds]').forEach(b => b.onclick = () => { show = b.dataset.ds; dirtyAll = true; panel(); draw() });
    document.querySelectorAll('[data-dt]').forEach(b => b.onclick = () => setTool(b.dataset.dt));
    const setAl = v => {
      alpha = +v;
      if ($('d-alpha') && $('d-alpha').value !== String(alpha)) $('d-alpha').value = alpha;
      if ($('d-alpha-e') && $('d-alpha-e').value !== String(alpha)) $('d-alpha-e').value = alpha;
      if ($('v-dalpha')) $('v-dalpha').textContent = alpha + '%';
      if ($('v-dalpha-e')) $('v-dalpha-e').textContent = alpha + '%';
      typeof scheduleDraw === 'function' ? scheduleDraw() : draw();
    };
    $('d-alpha').oninput = e => setAl(e.target.value);
    $('d-alpha-e').oninput = e => setAl(e.target.value);
    $('d-bs-rng').oninput = e => { bs = +e.target.value; $('d-bs').textContent = bs + 'px'; draw() };
    $('d-edit').onclick = () => setOn(!on);
    $('d-opadd').onclick = () => { op = 'add'; panel() }; $('d-opsub').onclick = () => { op = 'sub'; panel() };
    $('d-rsrc').onchange = e => { rsrc = e.target.value; draw() }; $('d-radd').onchange = e => { radd = e.target.checked };
    $('d-fill').onclick = () => M && fillHoles(); $('d-grow').onclick = () => M && morph(true); $('d-shrink').onclick = () => M && morph(false);
    $('d-undo').onclick = () => window.dispatchEvent(new KeyboardEvent('keydown', {code: 'KeyZ', ctrlKey: true}));
    $('d-redo').onclick = () => window.dispatchEvent(new KeyboardEvent('keydown', {code: 'KeyY', ctrlKey: true}));
    $('dbox').innerHTML = boxHtml();
    $('d-dl').onclick = () => { const m = lsGet(key()); const a = document.createElement('a'); if (m) { a.href = m.png } else { save(); a.href = lsGet(key()).png } a.download = `${E.image}_drawing_mask.png`; a.click() };
    $('d-dlall').onclick = () => { const all = INDEX.map(p => lsGet('draw:' + p.image)).filter(Boolean); if (!all.length) { alert('No edited masks in this browser.'); return }
      saveJson({format: 'voynich-drawings/edit-1', frame: 'display image of each page (img/<image>.jpg); PNG white = drawing', pages: all}, `drawing-mask-edits-${all.length}.json`) };
    $('d-reset').onclick = () => { if (!confirm('Drop your mask of this page?')) return; lsSet(key(), null); M = L.mask ? L.mask.slice() : M; undo = []; redo = []; dirtyAll = true; renderList(); if (typeof countLocalEdits === 'function') countLocalEdits(); panel(); draw() };
    panel();
  }
  return {load, render, init, panel, provHtml, summaryHtml, setOn, hint, isOn: () => on, setAll: (sh, al) => { allShow = sh; allAlpha = al }, mine: p => !!lsGet('draw:' + p.image), info: () => INFO, ready: () => ready};
})();

DR.init();
if (typeof allSync === 'function') allSync();
