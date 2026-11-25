// Tab 2: drawing masks. Viewer (who selected what: AI or a human) and a browser-only editor:
// brush, eraser, freehand lasso, magnetic lasso (OpenCV.js Intelligent Scissors), restore brush from the AI layers.
// Masks live in the display frame of the page image (img/<image>.jpg); data/drawings.json says where each mask comes from.
// Your edits stay in this browser (localStorage) until you download them.
const DR = (() => {
  const SRCNAME = {'human': 'marked by a human (page finished)', 'human-rough': 'marked by a human (finished, but imprecise in places)',
    'human-partial': 'partly corrected by a human (not finished)', 'ai-start': 'AI only: where SAM 3 and GPT/Gemini agree (not reviewed)'};
  const SRCCOL = {'human': [62, 207, 114], 'human-rough': [62, 207, 114], 'human-partial': [255, 214, 10], 'ai-start': [78, 161, 255]};
  const MINE = [255, 159, 10];
  const LAYER = {start: 'start mask (SAM 3 ∩ GPT/Gemini)', sam3: 'SAM 3', ai: 'GPT / Gemini', mask: 'published mask'};
  let INFO = {pages: {}}, P = null, W = 0, H = 0, M = null, L = {}, oc = null, og = null, oid = null, dirtyAll = true;
  let on = false, tool = 'brush', bs = 24, op = 'add', rsrc = 'ai', radd = false, show = 'mask', alpha = 45, undo = [], redo = [];
  let allShow = 'mask', allAlpha = 35, cShow = show, cAlpha = alpha, painted = '';
  let stroke = null, lasso = null, mag = null, mouse = [0, 0], bpop = null, sizeDrag = null, imgPix = null, ready = null;
  const $ = id => document.getElementById(id), BSMAX = 200;
  const key = () => 'draw:' + E.image;
  ready = fetch('data/drawings.json', {cache: 'no-cache'}).then(r => r.ok ? r.json() : {pages: {}}).then(j => INFO = j).catch(() => {});

  // ---------- data ----------
  const loadBits = src => new Promise(ok => { const im = new Image(); im.onload = () => { const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d'); g.drawImage(im, 0, 0, W, H); const d = g.getImageData(0, 0, W, H).data, b = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) b[i] = d[i * 4] > 127 && d[i * 4 + 3] > 0 ? 1 : 0; ok(b) }; im.onerror = () => ok(null); im.src = src });
  async function load() {
    await ready; P = INFO.pages[E.image] || null; L = {}; M = null; undo = []; redo = []; lasso = null; magReset(); imgPix = null;
    W = E.display.w; H = E.display.h; oc = document.createElement('canvas'); oc.width = W; oc.height = H; og = oc.getContext('2d'); oid = og.createImageData(W, H); dirtyAll = true;
    if (!P) { panel(); return }
    const im = E.image;
    for (const k of P.layers) loadBits(`img/draw_${k}/${im}.png`).then(b => { if (E.image !== im) return; L[k] = b; if (k === 'mask' && !M) { M = mineOrPub(); } dirtyAll = true; draw(); panel() });
  }
  function mineOrPub() { const m = lsGet(key()); if (m && m.png) { const im = E.image; loadBits(m.png).then(b => { if (E.image === im && b) { M = b; dirtyAll = true; draw(); panel() } }) }
    return L.mask ? L.mask.slice() : new Uint8Array(W * H) }
  function save() { if (!M) return; const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d'), id = g.createImageData(W, H);
    for (let i = 0; i < W * H; i++) { const v = M[i] ? 255 : 0; id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = v; id.data[i * 4 + 3] = 255 } g.putImageData(id, 0, 0);
    const png = c.toDataURL('image/png'); try { localStorage.setItem(LS(key()), JSON.stringify({image: E.image, folio: E.folio, frame: 'display image', w: W, h: H, png, edited_at: new Date().toISOString()})) }
    catch (e) { alert('Your browser storage is full: download your masks (Download all my masks) and reset some pages.') } renderList(); panel() }
  const mine = () => !!lsGet(key());
  const snapU = () => { undo.push(M.slice()); if (undo.length > 40) undo.shift(); redo = [] };

  // ---------- overlay ----------
  function paintRect(x0, y0, x1, y1) {
    if (!M && !L.mask) return; x0 = Math.max(0, x0 | 0); y0 = Math.max(0, y0 | 0); x1 = Math.min(W, Math.ceil(x1)); y1 = Math.min(H, Math.ceil(y1));
    const d = oid.data, a = Math.round(cAlpha * 2.55), src = P ? P.source : 'ai-start', show = cShow;
    const cur = M || L.mask, pubCol = (on || mine()) ? MINE : SRCCOL[src];
    const edge = (m, i, x) => m[i] && (x === 0 || x === W - 1 || !m[i - 1] || !m[i + 1] || !m[i - W] || !m[i + W]);
    for (let y = Math.max(1, y0); y < Math.min(H - 1, y1); y++) for (let x = x0; x < x1; x++) {
      const i = y * W + x, o = i * 4; let c = null, al = 0;
      if (show === 'mask' || on) { if (cur[i]) { c = pubCol; al = edge(cur, i, x) ? 255 : a } }
      else if (show === 'origin') {
        if (P && P.source !== 'ai-start' && L.start && cur) {   // human page: kept / added / removed against the AI start mask
          const h = cur[i], s = L.start[i];
          if (h && s) { c = [62, 207, 114]; al = edge(cur, i, x) ? 255 : a } else if (h) { c = [255, 214, 10]; al = edge(cur, i, x) ? 255 : Math.min(255, a + 40) }
          else if (s) { c = [255, 59, 48]; al = edge(L.start, i, x) ? 255 : Math.round(a * .6) } }
        else if (L.sam3 && L.ai) { const s = L.sam3[i], g = L.ai[i];   // AI page: the two AI voices
          if (s && g) { c = [78, 161, 255]; al = a } else if (s) { c = [255, 140, 0]; al = Math.min(255, a + 40) } else if (g) { c = [255, 61, 255]; al = Math.min(255, a + 40) } } }
      else { const m = L[show]; if (m && m[i]) { c = {start: [33, 212, 255], sam3: [255, 140, 0], ai: [255, 61, 255]}[show]; al = edge(m, i, x) ? 255 : a } }
      if (c) { d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = al } else d[o + 3] = 0 }
    og.putImageData(oid, 0, 0, x0, y0, x1 - x0, y1 - y0) }
  function render(ctx, view, toScr, isAll) {
    if (!P) return;
    cShow = isAll ? allShow : show; cAlpha = isAll ? allAlpha : alpha; const k = cShow + '|' + cAlpha + '|' + on + '|' + mine();
    if (k !== painted) { dirtyAll = true; painted = k }
    if (dirtyAll) { paintRect(0, 0, W, H); dirtyAll = false }
    if (isAll) { ctx.save(); ctx.translate(view.x, view.y); ctx.scale(view.z, view.z); ctx.imageSmoothingEnabled = false; ctx.drawImage(oc, 0, 0); ctx.restore(); return }
    ctx.save(); ctx.translate(view.x, view.y); ctx.scale(view.z, view.z); ctx.imageSmoothingEnabled = false; ctx.drawImage(oc, 0, 0);
    if (on && tool === 'restore' && L[rsrc]) { if (!L['_e' + rsrc]) L['_e' + rsrc] = edgeCanvas(L[rsrc]); ctx.drawImage(L['_e' + rsrc], 0, 0) }
    ctx.restore();
    if (!on) return;
    const s = toScr(mouse);
    if (['brush', 'eraser', 'restore'].includes(tool) || sizeDrag) { const c = sizeDrag ? toScr(sizeDrag.c) : bpop ? toScr(bpop.c) : s;
      ctx.beginPath(); ctx.arc(c[0], c[1], Math.max(1, bs / 2 * view.z), 0, 7); ctx.strokeStyle = tool === 'eraser' ? '#ffffff' : '#ffb340'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(c[0], c[1], Math.max(1, bs / 2 * view.z) + 1.5, 0, 7); ctx.stroke() }
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
  // magnetic lasso (OpenCV.js Intelligent Scissors; edge map of a region around the anchor and the cursor, rebuilt near its border)
  let cvP = null;
  function getCV() { if (cvP) return cvP; hint('loading OpenCV.js (about 10 MB, once)…');
    cvP = new Promise(ok => { const s = document.createElement('script'); s.src = 'vendor/opencv.js';
      s.onload = () => { const c = window.cv, done = m => { try { m.then = undefined } catch (e) {} window.cv = m; ok(m) };
        if (c instanceof Promise) c.then(done); else if (c.Mat) done(c); else c.onRuntimeInitialized = () => done(c) }; document.head.appendChild(s) }); return cvP }
  function pix() { if (imgPix) return imgPix; const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d'); g.drawImage(img, 0, 0, W, H); imgPix = g; return g }
  function magReset() { if (mag && mag.t) mag.t.delete(); mag = null }
  function magROI(ax, ay, x, y) { const cv = window.cv, r = $('cv').getBoundingClientRect(), a0 = toImg(0, 0), a1 = toImg(r.width, r.height), m = 300, cap = 2400;
    let x0 = Math.min(ax, x, a0[0]) , y0 = Math.min(ay, y, a0[1]), x1 = Math.max(ax, x, a1[0]), y1 = Math.max(ay, y, a1[1]);
    x0 = Math.min(x0, Math.min(ax, x) - m); y0 = Math.min(y0, Math.min(ay, y) - m); x1 = Math.max(x1, Math.max(ax, x) + m); y1 = Math.max(y1, Math.max(ay, y) + m);
    if (x1 - x0 > cap) { const c = (ax + x) / 2; x0 = c - cap / 2; x1 = c + cap / 2 } if (y1 - y0 > cap) { const c = (ay + y) / 2; y0 = c - cap / 2; y1 = c + cap / 2 }
    x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0)); x1 = Math.min(W, Math.ceil(x1)); y1 = Math.min(H, Math.ceil(y1));
    const src = cv.matFromImageData(pix().getImageData(x0, y0, x1 - x0, y1 - y0)), rgb = new cv.Mat(); cv.cvtColor(src, rgb, cv.COLOR_RGBA2RGB); src.delete();
    if (mag.t) mag.t.delete(); const t = new cv.segmentation_IntelligentScissorsMB(); t.setEdgeFeatureCannyParameters(32, 100); t.setGradientMagnitudeMaxLimit(200);
    t.applyImage(rgb); rgb.delete(); mag.t = t; mag.roi = [x0, y0, x1 - x0, y1 - y0];
    if (mag.anchors.length) { const a = mag.anchors.at(-1); t.buildMap(new cv.Point(Math.round(a[0] - x0), Math.round(a[1] - y0))) } }
  function magFit(x, y) { const [rx, ry, rw, rh] = mag.roi, g = 8, out = (x < rx + g && rx > 0) || (y < ry + g && ry > 0) || (x > rx + rw - g && rx + rw < W) || (y > ry + rh - g && ry + rh < H);
    if (out && mag.anchors.length) { const a = mag.anchors.at(-1); magROI(a[0], a[1], x, y) } const [qx, qy, qw, qh] = mag.roi; return [Math.max(qx, Math.min(qx + qw - 1, x)), Math.max(qy, Math.min(qy + qh - 1, y))] }
  async function magClick(x, y, e) { if (!mag) { const o = e.altKey ? 'sub' : op; await getCV(); mag = {t: null, roi: null, anchors: [], segs: [], live: [], op: o}; magROI(x, y, x, y); hint('magnetic lasso: click along the edge; click the first point or press Enter to close; Backspace removes the last point; Esc cancels') }
    const cv = window.cv; [x, y] = magFit(x, y);
    if (mag.anchors.length > 2 && Math.hypot(x - mag.anchors[0][0], y - mag.anchors[0][1]) < 8 / view.z) return magClose();
    if (mag.anchors.length) { magLive(x, y); mag.segs.push(mag.live.slice()) } mag.anchors.push([x, y]); mag.t.buildMap(new cv.Point(Math.round(x - mag.roi[0]), Math.round(y - mag.roi[1]))); mag.live = []; draw() }
  function magLive(x, y) { if (!mag || !mag.anchors.length || !mag.t) return; const cv = window.cv; [x, y] = magFit(x, y); const [rx, ry] = mag.roi, c = new cv.Mat();
    mag.t.getContour(new cv.Point(Math.round(x - rx), Math.round(y - ry)), c); const d = c.data32S, pts = []; for (let i = 0; i < d.length; i += 2) pts.push([d[i] + rx, d[i + 1] + ry]); c.delete();
    const a = mag.anchors.at(-1); if (pts.length && Math.hypot(pts[0][0] - a[0], pts[0][1] - a[1]) > Math.hypot(pts.at(-1)[0] - a[0], pts.at(-1)[1] - a[1])) pts.reverse(); mag.live = pts }
  function magClose() { if (!mag) return; magLive(...mag.anchors[0]); mag.segs.push(mag.live); const pts = [].concat(...mag.segs), o = mag.op; magReset(); fillPoly(pts, o); hint() }

  // ---------- events (capture phase: when the editor is on, the canvas belongs to the drawing tools) ----------
  const active = () => VIEW === 'draw' && on && P && M;
  const cvs = $('cv');
  cvs.addEventListener('mousedown', e => { if (!active()) return; const x = e.offsetX, y = e.offsetY, t = toImg(x, y);
    if (bpop && e.button !== 2) bpopClose();
    if (e.button === 1) return;   // middle button: pan (app)
    e.stopImmediatePropagation(); e.preventDefault();
    if (e.button === 2) { if (['brush', 'eraser', 'restore'].includes(tool)) { if (e.altKey || e.ctrlKey) sizeDrag = {sx: e.clientX, bs0: bs, c: t}; else bpopOpen(e.clientX, e.clientY, t) }
      else if (mag && mag.anchors.length > 1) { mag.anchors.pop(); mag.segs.pop(); mag.t.buildMap(new window.cv.Point(Math.round(mag.anchors.at(-1)[0] - mag.roi[0]), Math.round(mag.anchors.at(-1)[1] - mag.roi[1]))); draw() } return }
    if (tool === 'brush' || tool === 'eraser' || tool === 'restore') { snapU(); const v = tool === 'restore' ? (L[rsrc] ? (radd ? {add: L[rsrc]} : L[rsrc]) : null) : ((tool === 'brush') !== e.ctrlKey ? 1 : 0);
      if (v === null) { hint('this layer is still loading'); return } stroke = {last: t, v}; stamp(t[0], t[1], v); draw(); return }
    if (tool === 'lasso') { lasso = {pts: [t], op: e.altKey ? 'sub' : op}; draw(); return }
    if (tool === 'magnetic') { magClick(t[0], t[1], e); return } }, true);
  window.addEventListener('mousemove', e => { if (VIEW !== 'draw' || !on) return; const r = cvs.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top; mouse = toImg(x, y);
    if (sizeDrag) { bs = Math.max(1, Math.min(BSMAX, Math.round(sizeDrag.bs0 + (e.clientX - sizeDrag.sx) / view.z))); panel(); draw(); return }
    if (stroke) { strokeTo(stroke.last, mouse, stroke.v); stroke.last = mouse }
    else if (lasso) lasso.pts.push(mouse);
    else if (mag && mag.anchors.length) magLive(mouse[0], mouse[1]);
    draw() }, true);
  window.addEventListener('mouseup', e => { if (VIEW !== 'draw' || !on) return;
    if (sizeDrag) { sizeDrag = null; draw(); return }
    if (stroke) { stroke = null; save(); return }
    if (lasso) { const l = lasso; lasso = null; fillPoly(l.pts, l.op) } }, true);
  function bpopOpen(cx, cy, c) { bpopClose(); const d = document.createElement('div'); d.className = 'bpop';
    d.innerHTML = `size <input type="range" min="1" max="${BSMAX}" value="${bs}"> <b>${bs}</b> px`; d.style.left = Math.min(innerWidth - 240, cx + 8) + 'px'; d.style.top = Math.min(innerHeight - 60, cy + 8) + 'px';
    document.body.appendChild(d); const r = d.querySelector('input'); r.oninput = () => { bs = +r.value; d.querySelector('b').textContent = bs; panel(); draw() }; bpop = {el: d, c}; draw() }
  function bpopClose() { if (bpop) { bpop.el.remove(); bpop = null; draw() } }
  window.addEventListener('keydown', e => { if (VIEW !== 'draw' || e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
    const c = e.code, stop = () => { e.preventDefault(); e.stopImmediatePropagation() };
    if (c === 'Digit6' && !on) return;
    if (!on) { if (c === 'KeyD' && P) { stop(); setOn(true) } return }
    if (bpop && (c === 'Escape' || c === 'Enter')) { stop(); bpopClose(); return }
    if (e.ctrlKey && c === 'KeyZ' && !e.shiftKey) { stop(); if (undo.length) { redo.push(M.slice()); M = undo.pop(); dirtyAll = true; save(); draw() } return }
    if (e.ctrlKey && (c === 'KeyY' || (c === 'KeyZ' && e.shiftKey))) { stop(); if (redo.length) { undo.push(M.slice()); M = redo.pop(); dirtyAll = true; save(); draw() } return }
    if (e.ctrlKey || e.metaKey) return;
    if (c === 'Enter' && mag) { stop(); magClose(); return }
    if (c === 'Escape') { stop(); if (mag) { magReset(); hint(); draw() } else if (lasso) { lasso = null; draw() } else setOn(false); return }
    if (c === 'Backspace' && mag && mag.anchors.length > 1) { stop(); mag.anchors.pop(); mag.segs.pop(); mag.t.buildMap(new window.cv.Point(Math.round(mag.anchors.at(-1)[0] - mag.roi[0]), Math.round(mag.anchors.at(-1)[1] - mag.roi[1]))); draw(); return }
    const k = {KeyB: 'brush', KeyE: 'eraser', KeyF: 'lasso', KeyL: 'magnetic', KeyY: 'restore'}[c]; if (k) { stop(); setTool(k); return }
    if (c === 'BracketLeft' || c === 'BracketRight') { stop(); bs = c === 'BracketLeft' ? Math.max(1, Math.round(bs / 1.25)) : Math.min(BSMAX, Math.round(bs * 1.25) + 1); panel(); draw(); return }
    if (c === 'KeyA') { stop(); op = 'add'; panel(); return } if (c === 'KeyX') { stop(); op = 'sub'; panel(); return } }, true);

  // ---------- UI ----------
  function hint(t) { $('hint').textContent = t || (on ? {brush: 'brush: hold the left button and paint · Ctrl = erase · right-click = size · Alt/Ctrl + right-drag = size on the image · [ ] size',
    eraser: 'eraser: hold the left button · Ctrl = paint · right-click = size · Alt/Ctrl + right-drag = size', lasso: 'lasso: draw around the area with the left button held; release to close · Alt at the start = cut out',
    magnetic: 'magnetic lasso: click along the drawing\'s outline; the line sticks to the edge · click the first point or Enter to close · right-click / Backspace = remove last point · Esc cancels',
    restore: 'restore brush: where you paint, the mask becomes the chosen layer (or only gains from it, with "only add")'}[tool] : P ? 'viewing — press ✎ Edit mask (D) to change the drawing mask' : 'no drawing mask for this page') }
  function setTool(t) { tool = t; if (t !== 'magnetic') magReset(); lasso = null; panel(); hint(); draw() }
  function setOn(v) { on = v && !!P; if (on && !M && L.mask) M = L.mask.slice(); document.body.classList.toggle('dedit', on); dirtyAll = true; magReset(); lasso = null; panel(); hint(); draw() }
  function area(m) { if (!m) return 0; let n = 0; for (let i = 0; i < m.length; i++) n += m[i]; return n }
  function panel() {
    const box = $('dropt'); if (!box) return;
    document.querySelectorAll('[data-dt]').forEach(b => b.classList.toggle('on', b.dataset.dt === tool));
    document.querySelectorAll('[data-ds]').forEach(b => { b.classList.toggle('on', b.dataset.ds === show); b.disabled = b.dataset.ds !== 'mask' && b.dataset.ds !== 'origin' && !(P && P.layers.includes(b.dataset.ds)) });
    $('d-bs').textContent = bs; $('d-opadd').classList.toggle('on', op === 'add'); $('d-opsub').classList.toggle('on', op === 'sub'); $('d-rsrc').value = rsrc; $('d-radd').checked = radd;
    $('d-edit').classList.toggle('on', on); $('d-edit').disabled = !P;
    if (VIEW === 'draw' && typeof renderProv === 'function') $('prov').innerHTML = provHtml() }
  function provHtml() {
    if (!P) return `<div><b>Page:</b> ${E ? E.folio : ''}</div><div class="keys" style="margin-top:6px">No drawing mask for this page yet. Drawing masks cover the herbal, bathing and star pages (173 pages).</div>`;
    const col = c => `rgb(${c.join(',')})`, sw = (c, t) => `<div><span style="color:${col(c)};font-weight:700">██</span> ${t}</div>`, h = P.source !== 'ai-start';
    let s = `<div><b>Mask:</b> <span class="badge dsrc-${P.source}">${P.source}</span> ${SRCNAME[P.source]}</div>`;
    if (P.saved_at && h) s += `<div><b>Human saved:</b> ${P.saved_at}</div>`; if (P.note) s += `<div><b>Human note:</b> ${P.note.replace(/</g, '&lt;')}</div>`;
    if (P.owner_edits) s += `<div><b>Human edit operations:</b> ${P.owner_edits}</div>`;
    s += `<div><b>AI layers:</b> SAM 3 · ${P.ai_model || '—'}</div>`;
    if (mine()) s += `<div class="mine"><b>✎ You edited this mask</b> (saved in this browser)</div>`;
    s += '<hr style="border-color:#323846">';
    if (on || show === 'mask') s += sw(on || mine() ? MINE : SRCCOL[P.source], on || mine() ? 'your mask' : h ? 'drawing, marked by a human' : 'drawing, AI only (not reviewed)');
    else if (show === 'origin') s += h ? sw([62, 207, 114], 'AI selected it, the human kept it') + sw([255, 214, 10], 'the human added it (AI missed it)') + sw([255, 59, 48], 'AI selected it, the human removed it')
      : sw([78, 161, 255], 'both AI voices agree (SAM 3 and GPT/Gemini)') + sw([255, 140, 0], 'only SAM 3') + sw([255, 61, 255], 'only GPT / Gemini');
    else s += sw({start: [33, 212, 255], sam3: [255, 140, 0], ai: [255, 61, 255]}[show], LAYER[show]);
    if (L.mask && L.start && h) { const a = area(L.mask), b = area(L.start); let add = 0, rem = 0; for (let i = 0; i < W * H; i++) { if (L.mask[i] && !L.start[i]) add++; else if (!L.mask[i] && L.start[i]) rem++ }
      s += `<div class="keys" style="margin-top:4px">Against the AI start mask the human added ${(100 * add / Math.max(1, b)).toFixed(1)} % and removed ${(100 * rem / Math.max(1, b)).toFixed(1)} % of its area.</div>` }
    s += `<div class="keys" style="margin-top:6px"><b>How the AI masks were made.</b> <b>SAM 3</b> (Meta, text prompt "drawing"): instances with score ≥ 0.30, show-through ghosts of the other side of the leaf removed, edges refined with CascadePSP and snapped to the pen outline. <b>GPT-5.5 / Gemini</b>: the page was given to the image model with the request to paint every drawing bright blue and fill it; the blue was registered back onto the scan and snapped to the outline. Gemini was used for the bathing pages (GPT refuses them). The <b>start mask</b> is where both voices agree, plus thin bands near the agreed part. A <b>human</b> then corrected pages in an editor with the same tools you have here.</div>`;
    return s }
  function summaryHtml() {
    if (!P) return '<div><b>Drawings:</b> no mask for this page</div>';
    const col = c => `rgb(${c.join(',')})`, sw = (c, t) => `<span style="white-space:nowrap"><span style="color:${col(c)};font-weight:700">██</span> ${t}</span>`, h = P.source !== 'ai-start';
    let s = `<div><b>Drawings:</b> <span class="badge dsrc-${P.source}">${P.source}</span> ${SRCNAME[P.source]}</div><div class="keys">`;
    if (allShow === 'mask') s += sw(mine() ? MINE : SRCCOL[P.source], mine() ? 'your mask' : h ? 'marked by a human' : 'AI only');
    else if (allShow === 'origin') s += h ? [sw([62, 207, 114], 'AI, kept'), sw([255, 214, 10], 'added by the human'), sw([255, 59, 48], 'AI, removed by the human')].join(' · ')
      : [sw([78, 161, 255], 'both AI'), sw([255, 140, 0], 'only SAM 3'), sw([255, 61, 255], 'only GPT/Gemini')].join(' · ');
    else s += sw({start: [33, 212, 255], sam3: [255, 140, 0], ai: [255, 61, 255]}[allShow], LAYER[allShow]);
    return s + '</div>' }
  function boxHtml() { return `<div class="box dedit-only"><h3>Your drawing mask</h3>
    <div style="display:flex;gap:6px;flex-wrap:wrap"><button id="d-dl">Download this mask (PNG)</button><button id="d-dlall" title="all masks you edited in this browser, one JSON file with PNGs">Download all my masks</button><button id="d-reset">Reset page</button></div>
    <div class="keys" style="margin-top:6px">The PNG is in the frame of the page image (img/&lt;image&gt;.jpg); white = drawing. To contribute, attach it to a GitHub issue.</div></div>` }
  function init() {
    const o = $('dropt');
    o.innerHTML = `<label>show:</label> <button data-ds="mask" title="the published mask; colour says who made it">published mask</button> <button data-ds="origin" title="who selected what: AI vs human, or the two AI voices">who selected what</button>
      <button data-ds="start">start (AI agree)</button> <button data-ds="sam3">SAM 3</button> <button data-ds="ai">GPT / Gemini</button> <button data-ds="none">none</button>
      <label>fill <input type="range" id="d-alpha" min="0" max="90" value="${alpha}"></label>`;
    const t = $('dtools');
    t.innerHTML = `<button id="d-edit" title="D">✎ Edit mask</button>
      <span class="dedit-only-i"><button data-dt="brush" title="B">🖌 Brush</button><button data-dt="eraser" title="E">⌫ Eraser</button><button data-dt="lasso" title="F">➰ Lasso</button><button data-dt="magnetic" title="L">🧲 Magnetic lasso</button><button data-dt="restore" title="Y">↺ Restore brush</button>
      <span style="color:var(--mu)">size <b id="d-bs"></b></span> · lasso: <button id="d-opadd" title="A">add</button><button id="d-opsub" title="X">cut out</button>
      · restore from <select id="d-rsrc"><option value="ai">GPT / Gemini</option><option value="sam3">SAM 3</option><option value="start">start (AI agree)</option><option value="mask">published mask</option></select> <label><input type="checkbox" id="d-radd"> only add</label>
      · <button id="d-fill" title="fill holes inside the mask">fill holes</button><button id="d-grow">grow 1</button><button id="d-shrink">shrink 1</button><button id="d-undo" title="Ctrl+Z">↶</button><button id="d-redo" title="Ctrl+Y">↷</button></span>`;
    document.querySelectorAll('[data-ds]').forEach(b => b.onclick = () => { show = b.dataset.ds; dirtyAll = true; panel(); draw() });
    document.querySelectorAll('[data-dt]').forEach(b => b.onclick = () => setTool(b.dataset.dt));
    $('d-alpha').oninput = e => { alpha = +e.target.value; dirtyAll = true; draw() }; $('d-edit').onclick = () => setOn(!on);
    $('d-opadd').onclick = () => { op = 'add'; panel() }; $('d-opsub').onclick = () => { op = 'sub'; panel() };
    $('d-rsrc').onchange = e => { rsrc = e.target.value; draw() }; $('d-radd').onchange = e => { radd = e.target.checked };
    $('d-fill').onclick = () => M && fillHoles(); $('d-grow').onclick = () => M && morph(true); $('d-shrink').onclick = () => M && morph(false);
    $('d-undo').onclick = () => window.dispatchEvent(new KeyboardEvent('keydown', {code: 'KeyZ', ctrlKey: true})); $('d-redo').onclick = () => window.dispatchEvent(new KeyboardEvent('keydown', {code: 'KeyY', ctrlKey: true}));
    $('dbox').innerHTML = boxHtml();
    $('d-dl').onclick = () => { const m = lsGet(key()); const a = document.createElement('a'); if (m) { a.href = m.png } else { save(); a.href = lsGet(key()).png } a.download = `${E.image}_drawing_mask.png`; a.click() };
    $('d-dlall').onclick = () => { const all = INDEX.map(p => lsGet('draw:' + p.image)).filter(Boolean); if (!all.length) { alert('No edited masks in this browser.'); return }
      saveJson({format: 'voynich-drawings/edit-1', frame: 'display image of each page (img/<image>.jpg); PNG white = drawing', pages: all}, `drawing-mask-edits-${all.length}.json`) };
    $('d-reset').onclick = () => { if (!confirm('Drop your mask of this page?')) return; lsSet(key(), null); M = L.mask ? L.mask.slice() : M; undo = []; redo = []; dirtyAll = true; renderList(); panel(); draw() };
    panel() }
  return {load, render, init, panel, provHtml, summaryHtml, setOn, hint, isOn: () => on, setAll: (sh, al) => { allShow = sh; allAlpha = al }, mine: p => !!lsGet('draw:' + p.image), info: () => INFO, ready: () => ready};
})();

DR.init();
if (typeof allSync === 'function') allSync();
