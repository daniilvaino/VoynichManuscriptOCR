// Voynich page boundaries: viewer and editor (static, no server). Internal coordinates = pixels of the display image;
// data files use scan pixels: display = (scan - scan_x0/y0) * scale.
const $ = id => document.getElementById(id), cv = $('cv'), ctx = cv.getContext('2d');
const SIDES = ['top', 'right', 'bottom', 'left'], CI = {top: [0, 1], right: [1, 2], bottom: [2, 3], left: [3, 0]};
const SRC = {'human': 'marked by a human', 'opus': 'Opus (AI), not reviewed', 'opus+human-checked': 'Opus (AI), checked by a human',
  'opus+human-corrected': 'Opus (AI), corrected by a human'};
const HSRC = {'human-checked': 'holes checked by a human', 'human': 'holes marked by a human', 'human-not-checked': 'holes not checked yet',
  'opus': 'holes marked by Opus, not reviewed', 'opus-none-marked': 'holes not checked yet (Opus marked none)'};
const LCOL = {two_runs_agree: '#ff3b30', human_confirmed: '#ff3b30', human_corrected: '#ff3b30', human_drawn: '#ff3b30', unclear: '#ff3b30', red_tick: '#ff3b30'};   // one colour for every row line; the status is in the text
const LNAME = {two_runs_agree: 'two GPT runs agree', human_confirmed: 'confirmed by a human', human_corrected: 'corrected by a human',
  human_drawn: 'drawn by a human', unclear: 'unclear'};
let LINES = [], VIEW = 'pages', PG = null, INKT = {}, MK = {objects: [], not_found: []}, MSEL = -1, MHOV = -1;
const MCOL = {folio_number: '#4ea1ff', quire_mark: '#3ecf72', pencil_letter: '#b0b8c8', colour_note: '#ff8fd0', marginalia: '#7fd1ff', month_name: '#b98cff',
  alphabet_column: '#00e5ff', ex_libris: '#9ff0bf', red_tick: '#ff2d55', red_spot: '#ff6b6b', scribble: '#e0a060', dirt: '#8a7a60', voynich_text: '#ff4fd8', other: '#ffffff'};
let INDEX = [], pages = [], cur = -1, E = null, PUB = null, S = null, img = new Image(), undo = [], mode = 'edit', drawHole = null,
  sel = null, selHole = -1, editing = false, hideAll = false, view = {z: 1, x: 0, y: 0}, drag = null;
const LS = k => 'vpb:' + k, lsGet = k => { try { return JSON.parse(localStorage.getItem(LS(k))) } catch (e) { return null } },
  lsSet = (k, v) => { try { v === null ? localStorage.removeItem(LS(k)) : localStorage.setItem(LS(k), JSON.stringify(v)) } catch (e) {} };
// ---------- geometry ----------
function catmull(p, n = 14) {
  if (p.length < 3) return p.map(q => q.slice());
  const q = [[2 * p[0][0] - p[1][0], 2 * p[0][1] - p[1][1]], ...p, [2 * p.at(-1)[0] - p.at(-2)[0], 2 * p.at(-1)[1] - p.at(-2)[1]]], o = [];
  for (let i = 1; i < q.length - 2; i++) { const [a, b, c, d] = [q[i - 1], q[i], q[i + 1], q[i + 2]];
    for (let k = 0; k < n; k++) { const t = k / n, t2 = t * t, t3 = t2 * t;
      o.push([0, 1].map(j => 0.5 * (2 * b[j] + (-a[j] + c[j]) * t + (2 * a[j] - 5 * b[j] + 4 * c[j] - d[j]) * t2 + (-a[j] + 3 * b[j] - 3 * c[j] + d[j]) * t3))) } }
  o.push(p.at(-1).slice()); return o }
const sidePts = (st, s) => { const [a, b] = CI[s]; return [st.corners[a], ...(st.types[s] === 'straight' ? [] : st.mids[s]), st.corners[b]] };
const sideCurve = (st, s) => { const p = sidePts(st, s); return st.types[s] === 'straight' ? p : catmull(p) };
const outline = st => [].concat(...SIDES.map(s => sideCurve(st, s).slice(0, -1)));
const toScr = p => [p[0] * view.z + view.x, p[1] * view.z + view.y], toImg = (x, y) => [(x - view.x) / view.z, (y - view.y) / view.z];
function dseg(p, a, b) { const dx = b[0] - a[0], dy = b[1] - a[1], l = dx * dx + dy * dy; let t = l ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l : 0;
  t = Math.max(0, Math.min(1, t)); return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy) }
function inPoly(p, poly) { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j];
  if ((a[1] > p[1]) != (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) c = !c } return c }
// scan px <-> display px
const D = () => E.display, s2d = p => [+((p[0] - D().scan_x0) * D().scale).toFixed(1), +((p[1] - D().scan_y0) * D().scale).toFixed(1)],
  d2s = p => [+(p[0] / D().scale + D().scan_x0).toFixed(1), +(p[1] / D().scale + D().scan_y0).toFixed(1)];
function stateFromPage(pg) { const b = pg.boundary, c = [b.top[0], b.right[0], b.bottom[0], b.left[0]].map(s2d), mids = {}, types = {};
  SIDES.forEach(s => { mids[s] = b[s].slice(1, -1).map(s2d); types[s] = mids[s].length ? 'spline' : 'straight' });
  return {corners: c, mids, types, holes: (pg.holes || []).map(h => h.map(s2d))} }
function stateToScan(st) { const o = {}; SIDES.forEach(s => o[s] = sidePts(st, s).map(d2s)); o.holes = st.holes.filter(h => h.length >= 3).map(h => h.map(d2s)); return o }
// ---------- drawing ----------
function draw() {
  const r = cv.getBoundingClientRect(); if (cv.width !== r.width * devicePixelRatio) { cv.width = r.width * devicePixelRatio; cv.height = r.height * devicePixelRatio }
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0); ctx.clearRect(0, 0, r.width, r.height); if (!S) return;
  ctx.save(); ctx.translate(view.x, view.y); ctx.scale(view.z, view.z); ctx.filter = VIEW === 'ink' ? 'grayscale(1) sepia(0.55) saturate(1.6) contrast(0.22) brightness(1.62)' : $('l-con').checked ? 'contrast(1.8) brightness(1.1)' : 'none';   // ink view: washed-out scan as in atomtool
  if (VIEW === 'ink' || VIEW === 'all') { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, img.width || 0, img.height || 0); ctx.globalAlpha = (VIEW === 'all' ? $('a-bg').value : $('l-bg').value) / 100 }   // fade the page image towards white
  if (img.complete) ctx.drawImage(img, 0, 0); ctx.filter = 'none';
  ctx.globalAlpha = 1; ctx.restore(); ctx.filter = 'none'; if (hideAll) return;
  const path = (pts, close) => { pts.forEach((p, i) => { const s = toScr(p); i ? ctx.lineTo(...s) : ctx.moveTo(...s) }); if (close) ctx.closePath() };
  const line = (pts, col, w, close, dash) => { if (pts.length < 2) return; ctx.beginPath(); path(pts, close); ctx.setLineDash(dash || []); ctx.strokeStyle = col; ctx.lineWidth = w; ctx.stroke(); ctx.setLineDash([]) };
  ctx.beginPath(); ctx.rect(-10, -10, r.width + 20, r.height + 20); path(outline(S), true); S.holes.forEach(h => { if (h.length >= 3) path(h, true) });
  const ALL = VIEW === 'all', A = id => $(id).checked;   // all layers: every layer has its own switch and settings
  if (!ALL || A('a-page')) { ctx.fillStyle = VIEW === 'ink' ? '#ffffff' : VIEW === 'lines' ? '#0c0d10' : `rgba(110,110,110,${$('l-fill').value / 100})`; ctx.fill('evenodd') }   // lines view: only the page itself
  if (VIEW === 'draw') { if (typeof DR !== 'undefined') DR.render(ctx, view, toScr); return }   // tab 2: drawing masks (draw.js)
  const src = ALL ? $('a-inksrc').value : (document.querySelector('input[name=inksrc]:checked') || {}).value || 'stage1';
  const inkOn = VIEW === 'ink' ? A('l-inkon') : VIEW === 'lines' ? A('l-lnink') : ALL ? A('a-ink') : false;
  if (inkOn && INKT[src]) { ctx.save(); ctx.globalAlpha = (ALL ? +$('a-ink-a').value : VIEW === 'lines' ? +$('l-lnink-a').value : +$('l-ink').value) / 100;
    ctx.translate(view.x, view.y); ctx.scale(view.z, view.z); ctx.drawImage(INKT[src], 0, 0); ctx.restore() }
  if (VIEW === 'ink') return;   // tab 4: ink only
  if (ALL && A('a-draw') && typeof DR !== 'undefined') DR.render(ctx, view, toScr, true);
  if (VIEW === 'lines' || (ALL && A('a-lines'))) { ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.globalAlpha = ALL ? +$('a-lines-a').value / 100 : 1;
    (LW || LINES).forEach((l, i) => { if (l.deleted) return; const p = l.pts.map(s2d); if (p.length > 1) line(p, (LE.on && LE.sel === i) ? '#ffffff' : (LCOL[l.status] || '#fff'), ALL ? +$('a-lw').value : +$('l-lw').value, false) }); ctx.globalAlpha = 1;
    if (LE.on) drawLineEdit(line) }
  if (VIEW === 'lines') return;
  if (editing && $('l-pub').checked && PUB) { line(outline(PUB), 'rgba(92,200,255,.9)', 1, true); PUB.holes.forEach(h => line(h, 'rgba(92,200,255,.9)', 1, true)) }
  if (!ALL || A('a-page')) { line(outline(S), 'rgba(255,255,255,.95)', 1, true); S.holes.forEach((h, i) => line(h, i === selHole ? '#ffb340' : 'rgba(255,255,255,.95)', 1, true)) }
  if (VIEW === 'marks' || (ALL && A('a-marks'))) drawMarks(line); if (VIEW === 'marks') return;
  if (!editing) return;
  if (drawHole) { line(drawHole, '#fff', 1, false, [4, 3]); drawHole.forEach(p => dot(p, '#fff', 2.5)) }
  SIDES.forEach(s => S.types[s] !== 'straight' && S.mids[s].forEach((p, i) => dot(p, '#fff', 2.5, sel && sel.k === 'm' && sel.s === s && sel.i === i)));
  S.corners.forEach((p, i) => dot(p, '#4ea1ff', 3.5, sel && sel.k === 'c' && sel.i === i));
  S.holes.forEach((h, hi) => h.forEach((p, i) => dot(p, '#fff', 2.5, sel && sel.k === 'h' && sel.h === hi && sel.i === i)));
}
function dot(p, col, r, on) { const s = toScr(p); ctx.beginPath(); ctx.arc(s[0], s[1], on ? r + 2 : r, 0, 7); ctx.fillStyle = col; ctx.fill();
  ctx.strokeStyle = on ? '#ffb340' : 'rgba(0,0,0,.7)'; ctx.lineWidth = on ? 2 : 1; ctx.stroke() }
function refresh() { draw(); const N = {top: 'Top', right: 'Right', bottom: 'Bottom', left: 'Left'};
  SIDES.forEach(s => { const b = $('s-' + s); b.textContent = `${N[s]}: ${S.types[s] === 'straight' ? 'straight' : 'spline (' + S.mids[s].length + ')'}`; b.classList.toggle('on', S.types[s] !== 'straight') });
  $('holes').innerHTML = 'Holes: ' + (S.holes.length ? S.holes.map((h, i) => `#${i + 1} <button data-h="${i}">delete</button>`).join(' ') : 'none');
  document.querySelectorAll('[data-h]').forEach(b => b.onclick = () => { snap(); S.holes.splice(+b.dataset.h, 1); selHole = -1; refresh() });
  $('hint').textContent = !editing ? 'viewing — press ✎ Edit to change the boundary' : mode === 'hole' ? (drawHole ? `hole: ${drawHole.length} points — Enter closes, Esc cancels` : 'click around the hole') : 'drag points; click a side to add a point; right-click a point to delete';
  if (VIEW === 'draw' && typeof DR !== 'undefined') DR.hint();
  else if (VIEW !== 'pages') $('hint').textContent = {marks: 'click an object on the page or in the list to open its card', ink: 'ink masks; choose the source above', lines: 'press ✎ Edit lines to change the row lines', all: 'layers are switched and set up in the panel on the right · click an object to open its card'}[VIEW] || '';
  $('m-edit').classList.toggle('on', mode === 'edit'); $('m-hole').classList.toggle('on', mode === 'hole');
  $('b-edit').classList.toggle('on', editing); document.body.classList.toggle('editing', editing);
  const mine = !!lsGet('edit:' + E.image); $('dirty').style.display = mine ? 'inline' : 'none';
  $('b-submit').disabled = !window.REPO || !mine; $('b-submit').title = !window.REPO ? 'repository not configured yet (config.js)' : mine ? 'opens a pre-filled GitHub issue' : 'edit the page first' }
// ---------- editing ----------
function snap() { undo.push(JSON.stringify(S)); if (undo.length > 200) undo.shift() }
function persist() { lsSet('edit:' + E.image, {image: E.image, folio: E.folio, scan: E.scan, ...stateToScan(S), note: $('note').value, edited_at: new Date().toISOString()}); renderList() }
function hitPoint(x, y) { let best = null, bd = 9;
  S.corners.forEach((p, i) => { const s = toScr(p), d = Math.hypot(s[0] - x, s[1] - y); if (d < bd) { bd = d; best = {k: 'c', i} } });
  SIDES.forEach(s => S.types[s] !== 'straight' && S.mids[s].forEach((p, i) => { const q = toScr(p), d = Math.hypot(q[0] - x, q[1] - y); if (d < bd) { bd = d; best = {k: 'm', s, i} } }));
  S.holes.forEach((h, hi) => h.forEach((p, i) => { const q = toScr(p), d = Math.hypot(q[0] - x, q[1] - y); if (d < bd) { bd = d; best = {k: 'h', h: hi, i} } })); return best }
function hitSide(x, y) { let best = null, bd = 8;
  SIDES.forEach(s => { const c = sideCurve(S, s).map(toScr); for (let i = 0; i < c.length - 1; i++) { const d = dseg([x, y], c[i], c[i + 1]); if (d < bd) { bd = d; best = {s, ci: i} } } });
  if (!best) return null; const per = S.types[best.s] === 'straight' ? 1 : 14; return {s: best.s, gap: Math.min(Math.floor(best.ci / per), sidePts(S, best.s).length - 2)} }
const getP = h => h.k === 'c' ? S.corners[h.i] : h.k === 'm' ? S.mids[h.s][h.i] : S.holes[h.h][h.i];
function delPoint(h) { if (h.k === 'c') return; snap(); if (h.k === 'm') S.mids[h.s].splice(h.i, 1);
  else { S.holes[h.h].splice(h.i, 1); if (S.holes[h.h].length < 3) S.holes.splice(h.h, 1) } sel = null; persist(); refresh() }
function closeHole() { if (drawHole && drawHole.length >= 3) { snap(); S.holes.push(drawHole.map(p => p.map(v => +v.toFixed(1)))); persist() } drawHole = null; refresh() }
cv.addEventListener('contextmenu', e => e.preventDefault());
cv.addEventListener('mousedown', e => { const x = e.offsetX, y = e.offsetY;
  if (e.button === 1 || !editing) { drag = {pan: 1, x, y, vx: view.x, vy: view.y}; return }
  if (e.button === 2) { const h = hitPoint(x, y); if (h) delPoint(h); return }
  if (mode === 'hole') { const t = toImg(x, y); if (!drawHole) drawHole = [];
    if (drawHole.length >= 3) { const f = toScr(drawHole[0]); if (Math.hypot(f[0] - x, f[1] - y) < 9) { closeHole(); return } }
    drawHole.push(t); refresh(); return }
  const h = hitPoint(x, y); if (h) { sel = h; selHole = -1; snap(); drag = {pt: h}; refresh(); return }
  const sd = hitSide(x, y);
  if (sd) { snap(); const t = toImg(x, y); if (S.types[sd.s] === 'straight') { S.types[sd.s] = 'spline'; S.mids[sd.s] = [] }
    S.mids[sd.s].splice(sd.gap, 0, t); sel = {k: 'm', s: sd.s, i: sd.gap}; drag = {pt: sel}; refresh(); return }
  const t = toImg(x, y); selHole = S.holes.findIndex(hh => hh.length > 2 && inPoly(t, hh)); sel = null; drag = {pan: 1, x, y, vx: view.x, vy: view.y}; refresh() });
window.addEventListener('mousemove', e => { if (!drag) return; const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
  if (drag.pan) { view.x = drag.vx + x - drag.x; view.y = drag.vy + y - drag.y; draw(); return }
  const t = toImg(x, y), p = getP(drag.pt); p[0] = +t[0].toFixed(1); p[1] = +t[1].toFixed(1); draw() });
window.addEventListener('mouseup', () => { if (drag && drag.pt) { persist(); refresh() } drag = null });
cv.addEventListener('wheel',e=>{e.preventDefault();   // Ctrl+wheel = zoom; wheel = up/down; tilt wheel or Shift+wheel = left/right (same in all tools)
  if(e.ctrlKey){const f=Math.exp(-e.deltaY*0.0015),x=e.offsetX,y=e.offsetY;view.x=x-(x-view.x)*f;view.y=y-(y-view.y)*f;view.z*=f}
  else{const k=e.deltaMode===1?30:e.deltaMode===2?cv.height:1;let dx=e.deltaX*k,dy=e.deltaY*k;if(e.shiftKey&&!dx){dx=dy;dy=0}view.x-=dx;view.y-=dy}
  draw()},{passive:false});
function fit() { const r = cv.getBoundingClientRect(); if (!img.width) return;
  let x0 = 0, y0 = 0, w = img.width, h = img.height;
  if ((VIEW === 'lines' || VIEW === 'ink') && S) { const o = outline(S), xs = o.map(p => p[0]), ys = o.map(p => p[1]); x0 = Math.min(...xs); y0 = Math.min(...ys); w = Math.max(...xs) - x0; h = Math.max(...ys) - y0 }
  const z = Math.min(r.width / w, r.height / h) * 0.96; view = {z, x: (r.width - w * z) / 2 - x0 * z, y: (r.height - h * z) / 2 - y0 * z}; draw() }
window.addEventListener('keydown', e => { if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
  if (e.key === ' ') { if (!hideAll) { hideAll = true; draw() } e.preventDefault(); return }
  if (!editing && '123456'.includes(e.key) && e.key.length === 1) { setView(TABS[+e.key - 1]); return }
  if (e.key === 'Enter' && VIEW === 'draw') { go(cur + 1); return }
  if (e.key === 'ArrowRight') { go(cur + 1); return } if (e.key === 'ArrowLeft') { go(cur - 1); return } if (e.key === 'f') { fit(); return }
  if (!editing) return;
  if (e.ctrlKey && e.key === 'z') { if (undo.length) { S = JSON.parse(undo.pop()); sel = null; selHole = -1; persist(); refresh() } e.preventDefault(); return }
  if (e.key === 'Enter' && mode === 'hole') { closeHole(); return }
  if (e.key === 'Escape') { drawHole = null; refresh(); return }
  if (e.key === 'e') setMode('edit'); else if (e.key === 'h') setMode('hole');
  else if (e.key === 'Delete' || e.key === 'Backspace') { if (sel) delPoint(sel); else if (selHole >= 0) { snap(); S.holes.splice(selHole, 1); selHole = -1; persist(); refresh() } } });
window.addEventListener('keyup', e => { if (e.key === ' ') { hideAll = false; draw() } });
{ const b = $('b-hide'), on = () => { hideAll = true; draw() }, off = () => { if (hideAll) { hideAll = false; draw() } };
  b.addEventListener('mousedown', on); b.addEventListener('mouseup', off); b.addEventListener('mouseleave', off);
  b.addEventListener('touchstart', e => { e.preventDefault(); on() }); b.addEventListener('touchend', off) }
const TABS = ['pages', 'draw', 'marks', 'ink', 'lines', 'all'];
// all layers: every switch lives in the side panel (moved there and back, handlers stay attached)
const SIDE = ['allopt', 'mkopt'].map(id => ({el: $(id), parent: $(id).parentNode, next: $(id).nextSibling}));
function sidePanel(onSide) { SIDE.forEach(o => { if (onSide) $('allslot').appendChild(o.el); else o.parent.insertBefore(o.el, o.next) });
  $('allbox').style.display = onSide ? '' : 'none'; $('thisrow').style.display = onSide ? 'none' : ''; const was = cv.getBoundingClientRect().width; requestAnimationFrame(() => cv.getBoundingClientRect().width !== was ? fit() : draw()) }   // two columns on the right: page info / object card, then the layer settings   // tab order = keys 1..6
function setMode(m) { mode = m; drawHole = null; refresh() }
$('m-edit').onclick = () => setMode('edit'); $('m-hole').onclick = () => setMode('hole');
$('b-edit').onclick = () => { editing = !editing; sel = null; drawHole = null; refresh() };
SIDES.forEach(s => $('s-' + s).onclick = () => { snap(); if (S.types[s] === 'straight') { S.types[s] = 'spline'; const [a, b] = CI[s], A = S.corners[a], B = S.corners[b];
  S.mids[s] = [[+((A[0] + B[0]) / 2).toFixed(1), +((A[1] + B[1]) / 2).toFixed(1)]] } else { S.types[s] = 'straight'; S.mids[s] = [] } persist(); refresh() });
['l-pub', 'l-con'].forEach(i => $(i).onchange = draw); $('l-fill').oninput = draw; $('note').oninput = () => persist();
$('b-reset').onclick = () => { if (!confirm('Drop your edit of this page?')) return; lsSet('edit:' + E.image, null); S = JSON.parse(JSON.stringify(PUB)); $('note').value = ''; undo = []; renderList(); refresh() };
$('b-download').onclick = () => { const all = INDEX.map(p => lsGet('edit:' + p.image)).filter(Boolean); if (!all.length) { alert('No edited pages in this browser.'); return }
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify({format: 'voynich-page-boundaries/edit-1', coords: 'scan pixels', pages: all}, null, 1)], {type: 'application/json'}));
  a.download = `page-boundary-edits-${all.length}.json`; a.click() };
$('b-submit').onclick = () => { const ed = lsGet('edit:' + E.image); if (!ed || !window.REPO) return;
  const body = 'Boundary edit from the page-boundary site.\n\n```json\n' + JSON.stringify({format: 'voynich-page-boundaries/edit-1', coords: 'scan pixels', pages: [ed]}) + '\n```\n';
  window.open(`https://github.com/${window.REPO}/issues/new?labels=boundary-edit&title=${encodeURIComponent('[boundary] ' + E.folio + ' (' + E.image + ')')}&body=${encodeURIComponent(body)}`, '_blank') };
function saveJson(obj, name) { const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 1)], {type: 'application/json'})); a.download = name; a.click() }
$('b-dl-page').onclick = async () => { if (!E) return; saveJson(await (await fetch(`data/pages/${E.image}.json`, {cache: 'no-cache'})).json(), `${E.image}.json`) };
$('b-dl-all').onclick = async () => { const b = $('b-dl-all'), t = b.textContent; b.disabled = true; let n = 0;
  const all = await Promise.all(INDEX.map(async p => { const j = await (await fetch(`data/pages/${p.image}.json`, {cache: 'no-cache'})).json(); b.textContent = `loading ${++n}/${INDEX.length}`; return j }));
  saveJson({format: 'voynich-page-boundaries/1', coords: 'scan pixels', pages: all}, 'voynich-page-boundaries.json'); b.textContent = t; b.disabled = false };
// ---------- pages ----------
function linesHtml() { const c = {}; LINES.forEach(l => c[l.status] = (c[l.status] || 0) + 1);
  return `<div><b><span style="color:#ff3b30">━━</span> Row lines:</b> ${LINES.length}</div>` + Object.keys(LNAME).filter(k => c[k]).map(k =>
    `<div>· ${LNAME[k]}: ${c[k]}</div>`).join('') +
    `<div class="keys" style="margin-top:6px">Drawn by GPT-5.5 twice (two independent runs), registered onto the scan and clipped to the page. Lines both runs agree on are kept; lines drawn by only one run were decided by a human.</div>` }
function renderProv() { if (!PG) return;
  $('provh').textContent = {pages: 'Page outline: who marked it and how', lines: 'Row lines: where they come from', ink: 'Ink and row lines: where they come from', marks: 'Objects: marks that are not the main text', all: 'All layers: this page', draw: 'Drawings: who selected what'}[VIEW];
  $('inkopt').style.display = VIEW === 'ink' ? '' : 'none'; $('inkh').style.display = (E && (E.ink || []).includes('hisam')) ? '' : 'none'; $('inkg').style.display = (E && (E.ink || []).includes('hisam_m4g')) ? '' : 'none'; $('inkr').style.display = (E && (E.ink || []).includes('hisam_raw')) ? '' : 'none'; $('inks').style.display = (E && (E.ink || []).includes('spectral')) ? '' : 'none';
  { const c = document.querySelector('input[name=inksrc]:checked'); if (c && E && !(E.ink || []).includes(c.value)) document.querySelector('input[name=inksrc][value=stage1]').checked = true }
  const inkTxt = `<div><b>Page:</b> ${(PG.labels || {}).title || ''}</div><div><span style="color:#000;background:#fff;font-weight:700">██</span> ink</div>
    <div class="keys" style="margin-top:6px"><b>Stage 1 mask</b>: blue channel with the parchment background flattened, adaptive (Sauvola) threshold with hysteresis; paint is not removed. <b>Hi-SAM</b>: text-segmentation model (SAM-TS-L, HierText weights, not fine-tuned), windows of 768 px with stride 576 averaged, mask = logit above -2; a second variant (block 14g final pack) uses logit above -4 and keeps only components touching the ink of a NAFNet model trained on hand masks (man3). A third view shows Hi-SAM's raw probability (sigmoid of the logit) with no threshold and no gating. All Hi-SAM variants on every page and foldout panel (19 pilot pages from the block-14 runs, the rest from the same settings run on all 204 scans). Both are clipped to the page.${(E.ink || []).includes('spectral') ? ' <b>Multispectral ink map</b> (only the 10 pages with published multispectral images): 38 spectral bands registered onto this scan, one linear discriminant (LDA) trained to separate ink from parchment; shows ink that is faded or invisible in colour. The spectral images themselves are not published here.' : ''}</div>`;
  $('prov').innerHTML = VIEW === 'pages' ? provHtml(PG) : VIEW === 'lines' ? `<div><b>Page:</b> ${(PG.labels || {}).title || ''}</div>` + linesHtml() : VIEW === 'ink' ? inkTxt : VIEW === 'marks' ? marksHtml() : VIEW === 'draw' ? DR.provHtml() : allHtml() }
function allHtml() { const hr = '<hr style="border-color:#323846">';
  return provHtml(PG) + hr + (typeof DR !== 'undefined' ? DR.summaryHtml() : '') + hr + linesHtml() + hr + marksHtml() }
function setView(v) { VIEW = v; if (v !== 'pages' && editing) { editing = false; sel = null; drawHole = null }
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.v === v)); $('b-edit').style.display = v === 'pages' ? '' : 'none';
  $('lb-edit').style.display = v === 'lines' ? '' : 'none'; $('mkopt').style.display = v === 'marks' || v === 'all' ? '' : 'none'; $('allopt').style.display = v === 'all' ? '' : 'none'; sidePanel(v === 'all'); $('pgopt').style.display = v === 'pages' ? '' : 'none'; $('lnopt').style.display = v === 'lines' ? '' : 'none'; if (v !== 'lines' && LE.on) lineEdit(false);
  $('dropt').style.display = v === 'draw' ? '' : 'none'; $('dtools').style.display = v === 'draw' ? '' : 'none'; $('dbox').style.display = v === 'draw' ? '' : 'none'; if (v !== 'draw' && typeof DR !== 'undefined' && DR.isOn()) DR.setOn(false);
  setFilters(); renderList(); renderProv(); refresh() }   // zoom and position stay as they are
document.querySelectorAll('#tabs button').forEach(b => b.onclick = () => setView(b.dataset.v));
function provHtml(pg) { const p = pg.provenance, L = pg.labels || {}, rows = [['Page', (L.title || '') + (L.position ? ' · ' + L.position : '')],
  ['Boundary', SRC[p.boundary_source] || p.boundary_source], ['Status', p.status],
  ['Holes', `${pg.holes.length} · ${HSRC[p.holes_source] || p.holes_source || '—'}`]];
  if (p.opus_confidence) rows.push(['Opus confidence', p.opus_confidence]); if (p.opus_note) rows.push(['Opus note', p.opus_note]);
  if (p.human_note) rows.push(['Human note', p.human_note]); if (p.saved_at) rows.push(['Human saved', p.saved_at]);
  return rows.map(([k, v]) => `<div><b>${k}:</b> ${String(v).replace(/</g, '&lt;')}</div>`).join('') }
const FLT = {
  pages: [['', 'all pages'], ['panel', 'foldout panels'], ['human', 'outline marked by a human'], ['opus+human-checked', 'Opus, checked by a human'],
          ['opus+human-corrected', 'Opus, corrected by a human'], ['opus', 'Opus, not reviewed'], ['holes', 'pages with holes'], ['unclear', 'outline status: unclear'], ['mine', 'edited by me']],
  lines: [['', 'all pages'], ['panel', 'foldout panels'], ['l-human', 'some lines decided by a human'], ['l-unclear', 'some lines unclear'], ['l-none', 'no row lines']],
  ink: [['', 'all pages'], ['panel', 'foldout panels'], ['hisam', 'pages with Hi-SAM ink'], ['spectral', 'pages with a multispectral ink map']],
  marks: [['', 'all pages'], ['m-any', 'pages with objects'], ['m-unclear', 'objects still unclear'], ['g:numbers', 'group: folio and quire numbers'], ['g:notes', 'group: later notes'], ['g:alphabets', 'group: alphabets'], ['g:red', 'group: red'], ['g:other', 'group: other'], ...Object.keys(MCOL).map(k => ['m:' + k, 'type: ' + (k === 'red_spot' ? 'red' : k.replace('_', ' '))])],
  all: [['', 'all pages'], ['panel', 'foldout panels'], ['holes', 'pages with holes'], ['l-human', 'some lines decided by a human']],
  draw: [['', 'pages with drawing masks'], ['d:human', 'marked by a human'], ['d:human-rough', 'marked by a human, imprecise'], ['d:human-partial', 'partly corrected by a human'], ['d:ai-start', 'AI only (not reviewed)'], ['d-mine', 'edited by me'], ['d-all', 'all pages']]};
function setFilters() { const keep = $('flt').value; $('flt').innerHTML = FLT[VIEW].map(([v, t]) => `<option value="${v}">${t}</option>`).join('');
  $('flt').value = FLT[VIEW].some(([v]) => v === keep) ? keep : '' }
const nHuman = p => { const s = p.lines_by_status || {}; return (s.human_confirmed || 0) + (s.human_corrected || 0) + (s.human_drawn || 0) };
function keepPage(p, f) {
  if (!f) return VIEW === 'draw' ? !!p.drawing : true; if (f === 'd-all') return true; if (f.startsWith('d:')) return p.drawing === f.slice(2); if (f === 'd-mine') return !!lsGet('draw:' + p.image);
  if (f === 'panel') return p.kind === 'foldout panel'; if (f === 'holes') return p.holes > 0;
  if (f === 'unclear') return p.status === 'unclear'; if (f === 'mine') return !!lsGet('edit:' + p.image);
  if (f === 'hisam') return (p.ink || []).includes('hisam'); if (f === 'spectral') return (p.ink || []).includes('spectral');
  if (f === 'm-any') return p.marks > 0; if (f === 'm-unclear') return !!(p.marks_by_type || {}).unclear; if (f.startsWith('m:')) return !!(p.marks_by_type || {})[f.slice(2)];
  if (f.startsWith('g:')) return Object.keys(p.marks_by_type || {}).some(t => MGROUP_OF[t] === f.slice(2));
  if (f === 'l-human') return nHuman(p) > 0; if (f === 'l-unclear') return (p.lines_by_status || {}).unclear > 0; if (f === 'l-none') return !p.lines;
  return p.boundary_source === f }
function badge(p) {
  const ob = `<span class="badge src-${p.boundary_source}">${p.boundary_source}</span>`;
  const lb = `<span class="badge" style="background:#4a2416;color:#ffb38a">${p.lines || 0} lines${nHuman(p) ? ' · ✓' + nHuman(p) : ''}${(p.lines_by_status || {}).unclear ? ' · ?' + p.lines_by_status.unclear : ''}</span>`;
  if (VIEW === 'draw') return p.drawing ? `<span class="badge dsrc-${p.drawing}">${{'human': 'human', 'human-rough': 'human ≈', 'human-partial': 'human, partly', 'ai-start': 'AI only'}[p.drawing]}</span>${lsGet('draw:' + p.image) ? ' <span class="mine">✎</span>' : ''}` : '';
  if (VIEW === 'all') return `<span style="display:flex;gap:4px">${p.drawing ? `<span class="badge dsrc-${p.drawing}" title="drawing mask">✿</span>` : ''}${p.marks ? `<span class="badge" style="background:#14424d;color:#9fe6f0" title="objects">${p.marks}</span>` : ''}<span class="badge src-${p.boundary_source}">${p.lines || 0} lines</span></span>`;
  if (VIEW === 'marks') return p.marks ? `<span class="badge" style="background:#14424d;color:#9fe6f0">${p.marks} object${p.marks > 1 ? 's' : ''}${(p.marks_by_type || {}).unclear ? ' · ?' + p.marks_by_type.unclear : ''}</span>` : '';
  if (VIEW === 'ink') return `<span class="badge" style="background:#26381a;color:#c8f08a">${((p.ink || []).includes('hisam') ? 'stage 1 + Hi-SAM ×3' : 'stage 1') + ((p.ink || []).includes('spectral') ? ' + spectral' : '')}</span>`;
  return VIEW === 'pages' ? ob : VIEW === 'lines' ? lb : `<span style="display:flex;gap:4px">${lb}${ob}</span>` }
function renderList() { const f = $('flt').value;
  pages = INDEX.filter(p => keepPage(p, f));
  $('list').innerHTML = pages.map((p, i) => `<div data-i="${i}" class="${E && p.image === E.image ? 'cur' : ''}"><span>${p.folio}${INDEX.filter(q => q.folio === p.folio).length > 1 ? ' · ' + p.image.split('_')[0] : ''}${VIEW !== 'lines' && p.holes ? ' ⬡' + p.holes : ''}${lsGet('edit:' + p.image) ? ' <span class="mine">✎</span>' : ''}</span>${badge(p)}</div>`).join('');
  document.querySelectorAll('#list div[data-i]').forEach(d => d.onclick = () => go(+d.dataset.i));
  cur = E ? pages.findIndex(p => p.image === E.image) : -1; $('prog').textContent = `${pages.length} pages` }
$('flt').onchange = () => { renderList(); if (cur < 0 && pages.length) go(0) };
async function go(i) { if (i < 0 || i >= pages.length) return; E = pages[i]; cur = i;
  const pg = await (await fetch(`data/pages/${E.image}.json`, {cache: 'no-cache'})).json();
  try { const LD = await (await fetch(`data/lines/${E.image}.json`, {cache: 'no-cache'})).json(); LINES = LD.lines; LXH = LD.xheight || 18 } catch (e) { LINES = []; LXH = 18 }
  linesLoaded(); INKT = {}; MSEL = -1; MHOV = -1; MK = {objects: [], not_found: []};
  try { const r = await fetch(`data/marks/${E.image}.json`, {cache: 'no-cache'}); if (r.ok) MK = await r.json() } catch (e) {}
  (E.ink || []).forEach(k => { const im = new Image(); im.onload = () => { const c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
    const g = c.getContext('2d'); g.drawImage(im, 0, 0); g.globalCompositeOperation = 'source-in'; g.fillStyle = '#000000'; g.fillRect(0, 0, c.width, c.height);
    INKT[k] = c; draw() }; im.src = `img/ink_${k}/${E.image}.png` });
  if (typeof DR !== 'undefined') DR.load();
  PUB = stateFromPage(pg); const ed = lsGet('edit:' + E.image);
  S = ed ? stateFromPage({boundary: ed, holes: ed.holes}) : JSON.parse(JSON.stringify(PUB)); $('note').value = ed && ed.note || '';
  undo = []; sel = null; selHole = -1; drawHole = null;
  $('task').textContent = `${E.folio} — ${E.title || ''}`; PG = pg; renderProv();
  history.replaceState(null, '', '#' + (INDEX.filter(p => p.folio === E.folio).length > 1 ? E.image : E.folio)); VG.ready.then(() => { renderProv(); draw() });
  img = new Image(); img.onload = () => { fit(); refresh() }; img.src = E.display.file; renderList(); refresh() }
window.addEventListener('resize', fit);
(async () => { INDEX = await (await fetch('data/index.json', {cache: 'no-cache'})).json(); setFilters(); renderList();
  const want = decodeURIComponent(location.hash.slice(1)); let k = pages.findIndex(p => p.image === want); if (k < 0) k = pages.findIndex(p => p.folio === want); go(k >= 0 ? k : 0) })();

// ---------- row-line editing (lines view) ----------
let LW = null, LXH = 18; const LE = {on: false, mode: 'sel', sel: -1, drag: -1, draw: [], undo: []};
function sparse(P, step) { const o = [P[0]]; let acc = 0; for (let i = 1; i < P.length; i++) { acc += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]);
  if (acc >= step) { o.push(P[i]); acc = 0 } } if (o.at(-1) !== P.at(-1)) o.push(P.at(-1)); return o.map(p => p.slice()) }
function lrebuild(l) { l.pts = l.ctrl.length > 2 ? catmull(l.ctrl, 8) : l.ctrl.map(p => p.slice()) }
function linesLoaded() {   // working copy = published lines + this browser's edits
  const ed = lsGet('edit-lines:' + E.image); LW = null; LE.sel = -1; LE.draw = []; LE.undo = [];
  if (!ed && !LE.on) return; LW = LINES.map(l => ({...l, pts: l.pts.map(p => p.slice())}));
  if (!ed) return;
  (ed.deleted || []).forEach(i => { if (LW[i]) LW[i].deleted = true });
  Object.entries(ed.changed || {}).forEach(([i, c]) => { if (LW[i]) Object.assign(LW[i], {pts: c.pts, ctrl: c.ctrl, status: c.status, changed: true}) });
  (ed.added || []).forEach(a => LW.push({...a, added: true})) }
function lpersist() { const ed = {image: E.image, folio: E.folio, scan: E.scan, coords: 'scan pixels', deleted: [], changed: {}, added: [], edited_at: new Date().toISOString()};
  LW.forEach((l, i) => { if (l.added) { if (!l.deleted) ed.added.push({pts: l.pts, ctrl: l.ctrl, status: l.status, source: 'human (site)'}) }
    else if (l.deleted) ed.deleted.push(i); else if (l.changed) ed.changed[i] = {pts: l.pts, ctrl: l.ctrl, status: l.status} });
  const empty = !ed.deleted.length && !ed.added.length && !Object.keys(ed.changed).length; lsSet('edit-lines:' + E.image, empty ? null : ed); renderList(); lrender() }
function lineEdit(on) { LE.on = on; document.body.classList.toggle('ledit', on); $('lb-edit').classList.toggle('on', on);
  if (on && !LW) LW = LINES.map(l => ({...l, pts: l.pts.map(p => p.slice())})); LE.sel = -1; LE.draw = []; lrender(); draw() }
function lmode(m) { LE.mode = m; LE.draw = []; ['sel', 'spl', 'str'].forEach(k => $('lm-' + k).classList.toggle('on', k === m)); lrender(); draw() }
function lsnap() { LE.undo.push(JSON.stringify(LW)); if (LE.undo.length > 100) LE.undo.shift() }
function lrender() { if (!LE.on) return; const l = LW && LW[LE.sel];
  $('lsel').innerHTML = l ? `selected line #${LE.sel + 1}: ${LNAME[l.status] || l.status}${l.changed ? ' · edited' : ''}${l.added ? ' · new' : ''}` :
    (LE.mode === 'sel' ? 'click a line to select it' : LE.mode === 'spl' ? `spline: ${LE.draw.length} points — Enter finishes` : 'straight: click two points');
  $('lb-submit').disabled = !window.REPO || !lsGet('edit-lines:' + E.image) }
function drawLineEdit(line) { const l = LW && LW[LE.sel];
  if (l && !l.deleted) { if (!l.ctrl) l.ctrl = sparse(l.pts, 1.4 * LXH);
    l.ctrl.forEach(q => { const s = toScr(s2d(q)); ctx.fillStyle = '#ffd60a'; ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.fillRect(s[0] - 4, s[1] - 4, 8, 8); ctx.strokeRect(s[0] - 4, s[1] - 4, 8, 8) }) }
  if (LE.draw.length) { line(LE.draw.map(s2d), '#ffffff', 2, false, [5, 4]); LE.draw.forEach(q => dot(s2d(q), '#fff', 3)) } }
const scanAt = (x, y) => d2s(toImg(x, y));
function lpick(x, y) { let best = -1, bd = 9; (LW || []).forEach((l, i) => { if (l.deleted) return; const p = l.pts.map(q => toScr(s2d(q)));
  for (let k = 0; k < p.length - 1; k++) { const d = dseg([x, y], p[k], p[k + 1]); if (d < bd) { bd = d; best = i } } }); return best }
function lctrlAt(x, y) { const l = LW && LW[LE.sel]; if (!l || !l.ctrl) return -1; let k = -1, bd = 8;
  l.ctrl.forEach((q, j) => { const s = toScr(s2d(q)), d = Math.hypot(s[0] - x, s[1] - y); if (d < bd) { bd = d; k = j } }); return k }
function lfinish() { if (LE.draw.length >= 2) { lsnap(); const c = LE.draw.map(p => p.slice());
  LW.push({ctrl: c, pts: c.length > 2 ? catmull(c, 8) : c, status: 'human_drawn', source: 'human (site)', added: true}); LE.sel = LW.length - 1; lpersist() } LE.draw = []; draw() }
cv.addEventListener('mousedown', e => { if (!LE.on) return; e.stopImmediatePropagation(); const x = e.offsetX, y = e.offsetY;
  if (e.button === 2) { const k = lctrlAt(x, y); if (k >= 0) { const l = LW[LE.sel]; if (l.ctrl.length <= 2) return; lsnap(); l.ctrl.splice(k, 1); lrebuild(l); l.changed = true; lpersist(); draw() } return }
  if (e.button === 1) { drag = {pan: 1, x, y, vx: view.x, vy: view.y}; return }
  if (LE.mode === 'spl') { LE.draw.push(scanAt(x, y)); lrender(); draw(); return }
  if (LE.mode === 'str') { LE.draw.push(scanAt(x, y)); if (LE.draw.length === 2) lfinish(); else draw(); return }
  const k = lctrlAt(x, y); if (k >= 0) { lsnap(); LE.drag = k; return }
  const l = LW[LE.sel];
  if (l && !l.deleted && l.ctrl) { const p = l.pts.map(q => toScr(s2d(q))); let near = false; for (let i = 0; i < p.length - 1; i++) if (dseg([x, y], p[i], p[i + 1]) < 8) near = true;
    if (near) { const c = l.ctrl.map(q => toScr(s2d(q))); let j = 0, bd = 1e9; for (let i = 0; i < c.length - 1; i++) { const d = dseg([x, y], c[i], c[i + 1]); if (d < bd) { bd = d; j = i } }
      lsnap(); l.ctrl.splice(j + 1, 0, scanAt(x, y)); lrebuild(l); l.changed = true; LE.drag = j + 1; draw(); return } }
  const i = lpick(x, y); LE.sel = i; if (i < 0) drag = {pan: 1, x, y, vx: view.x, vy: view.y}; lrender(); draw() }, true);
window.addEventListener('mousemove', e => { if (!LE.on || LE.drag < 0) return; const r = cv.getBoundingClientRect(), l = LW[LE.sel];
  l.ctrl[LE.drag] = scanAt(e.clientX - r.left, e.clientY - r.top); lrebuild(l); l.changed = true; draw() }, true);
window.addEventListener('mouseup', () => { if (LE.on && LE.drag >= 0) { LE.drag = -1; lpersist(); draw() } }, true);
cv.addEventListener('dblclick', () => { if (LE.on && LE.mode === 'spl') lfinish() });
window.addEventListener('keydown', e => { if (!LE.on || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return; const k = e.key.toLowerCase();
  if (k === ' ' || k === 'arrowleft' || k === 'arrowright' || k === 'f') return;   // handled by the viewer
  e.stopImmediatePropagation();
  if (e.ctrlKey && (k === 'z' || k === 'я')) { if (LE.undo.length) { LW = JSON.parse(LE.undo.pop()); LE.sel = -1; lpersist(); draw() } e.preventDefault(); return }
  if (k === 'enter') { if (LE.mode === 'spl') lfinish(); return }
  if (k === 'escape') { LE.draw = []; LE.sel = -1; lrender(); draw(); return }
  if ((k === 'delete' || k === 'backspace') && LE.sel >= 0) { lsnap(); LW[LE.sel].deleted = true; LE.sel = -1; lpersist(); draw(); e.preventDefault(); return }
  if (k === 'u' && LE.sel >= 0) { lsnap(); const l = LW[LE.sel]; l.status = l.status === 'unclear' ? 'human_confirmed' : 'unclear'; l.changed = true; lpersist(); draw(); return }
  if (k === 's') lmode('sel'); else if (k === 'p') lmode('spl'); else if (k === 'l') lmode('str') }, true);
$('lb-edit').onclick = () => lineEdit(!LE.on); $('lm-sel').onclick = () => lmode('sel'); $('lm-spl').onclick = () => lmode('spl'); $('lm-str').onclick = () => lmode('str');
$('lb-reset').onclick = () => { if (!confirm('Drop your line edits of this page?')) return; lsSet('edit-lines:' + E.image, null);
  LW = LINES.map(l => ({...l, pts: l.pts.map(p => p.slice())})); LE.sel = -1; renderList(); lrender(); draw() };
$('lb-download').onclick = () => { const all = INDEX.map(p => lsGet('edit-lines:' + p.image)).filter(Boolean); if (!all.length) { alert('No line edits in this browser.'); return }
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify({format: 'voynich-row-lines/edit-1', coords: 'scan pixels', pages: all}, null, 1)], {type: 'application/json'}));
  a.download = `row-line-edits-${all.length}.json`; a.click() };
$('lb-submit').onclick = () => { const ed = lsGet('edit-lines:' + E.image); if (!ed || !window.REPO) return;
  const slim = {...ed, changed: Object.fromEntries(Object.entries(ed.changed).map(([i, c]) => [i, {ctrl: c.ctrl, status: c.status}])), added: ed.added.map(a => ({ctrl: a.ctrl, status: a.status}))};
  const body = 'Row-line edit from the site (control points; each line is a Catmull-Rom spline through them).\n\n```json\n' +
    JSON.stringify({format: 'voynich-row-lines/edit-1', coords: 'scan pixels', pages: [slim]}) + '\n```\n';
  if (body.length > 7000) { alert('This edit is too large for a GitHub issue link. Please use "Download my line edits" and attach the file to an issue.'); return }
  window.open(`https://github.com/${window.REPO}/issues/new?labels=lines-edit&title=${encodeURIComponent('[lines] ' + E.folio + ' (' + E.image + ')')}&body=${encodeURIComponent(body)}`, '_blank') };

document.querySelectorAll('input[name=inksrc]').forEach(r => r.onchange = draw); $('l-ink').oninput = draw; $('l-bg').oninput = draw; $('l-inklines').onchange = draw;

// ---------- objects (marks that are not the main text) ----------
const MGROUPS = [['numbers', 'folio and quire numbers', ['folio_number', 'quire_mark']],
  ['notes', 'later notes (pencil, colour notes, months, marginalia, ex libris, scribbles)', ['pencil_letter', 'colour_note', 'marginalia', 'month_name', 'ex_libris', 'scribble']],
  ['alphabets', 'alphabets / key-like columns', ['alphabet_column']], ['red', 'red (GC birds, red spots)', ['red_tick', 'red_spot']],
  ['other', 'other (Voynich writing outside the transliterations, dirt, other)', ['voynich_text', 'dirt', 'other']]];
const MGROUP_OF = Object.fromEntries(MGROUPS.flatMap(([g, , ts]) => ts.map(t => [t, g])));
let MSYM = null;   // hovered symbol [object index, symbol index]
const mshape = o => o.poly && o.poly.length > 2 ? o.poly : [[o.bbox[0], o.bbox[1]], [o.bbox[2], o.bbox[1]], [o.bbox[2], o.bbox[3]], [o.bbox[0], o.bbox[3]]];
const esc = t => String(t || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const mshown = o => { const c = $('mg-' + (MGROUP_OF[o.type] || 'other')); return !c || c.checked };
const mnames = () => $('mk-names').checked;
function mlabel(s, t, col, on, right, eva) {   // eva: draw the Eva glyphs first (Eva-2 font), then the code in brackets
  const g = eva && !/[a-z]{6,}/.test(t) ? t.replace(/[^a-z]/g, '') : '', tt = g ? `(Eva ${t})` : t;
  ctx.font = '16px EVA2'; const gw = g ? ctx.measureText(g).width + 4 : 0; ctx.font = '11px system-ui,sans-serif';
  const w = gw + ctx.measureText(tt).width + 8, h = g ? 19 : 15, x = right ? s[0] - w - 2 : s[0];
  ctx.fillStyle = on ? '#ffffff' : col; ctx.fillRect(x, s[1] - h - 1, w, h); ctx.fillStyle = '#08111f';
  if (g) { ctx.font = '16px EVA2'; ctx.fillText(g, x + 4, s[1] - 5); ctx.font = '11px system-ui,sans-serif' } ctx.fillText(tt, x + 4 + gw, s[1] - 5) }
function drawMarks(line) { const all = VIEW === 'all';
  MK.objects.forEach((o, i) => { if (!mshown(o)) return; const on = i === MSEL || i === MHOV, col = MCOL[o.type] || '#ffffff', p = mshape(o).map(s2d), sy = o.symbols;
    if (on && !sy) { ctx.beginPath(); p.forEach((q, k) => { const s = toScr(q); k ? ctx.lineTo(...s) : ctx.moveTo(...s) }); ctx.closePath(); ctx.fillStyle = col + '30'; ctx.fill() }
    if (sy) { ctx.globalAlpha = on ? .9 : .55; line(p, on ? '#ffffff' : col, 1, true, o.status === 'unclear' ? [6, 4] : null); ctx.globalAlpha = 1;   // thin outer frame
      sy.forEach((y, k) => { const a = s2d([y.bbox[0], y.bbox[1]]), b = s2d([y.bbox[2], y.bbox[3]]), hov = MSYM && MSYM[0] === i && MSYM[1] === k;
        line([a, [b[0], a[1]], b, [a[0], b[1]]], hov ? '#ffffff' : col, hov ? 2.5 : 1.4, true, y.status === 'unclear' ? [4, 3] : null);
        const tall = (b[1] - a[1]) * view.z >= 10;   // symbol names only once the boxes are big enough on screen
        if (hov || ((mnames() || on) && tall && !all)) mlabel(toScr([a[0], b[1]]), y.label, col, hov, o.text.startsWith('col 1'), o.symbol_script === 'EVA') }) }
    else line(p, on ? '#ffffff' : col, all ? 1.2 : on ? 3 : 2, true, o.status === 'unclear' ? [6, 4] : null);
    if (on || (mnames() && !all)) mlabel(toScr(s2d([o.bbox[0], o.bbox[1]])), o.type_label + (o.status === 'unclear' ? ' ?' : ''), col, on) }) }
function mpick(x, y) { if (VIEW === 'all' && !$('a-marks').checked) return -1; const t = d2s(toImg(x, y)), pad = 6 / view.z / D().scale; let best = -1, ba = Infinity, sym = null;   // smallest object under the cursor wins
  const inb = b => t[0] >= b[0] - pad && t[0] <= b[2] + pad && t[1] >= b[1] - pad && t[1] <= b[3] + pad;
  MK.objects.forEach((o, i) => { if (!mshown(o)) return; const b = o.bbox, a = (b[2] - b[0]) * (b[3] - b[1]);
    (o.symbols || []).forEach((y, k) => { const c = y.bbox, ca = (c[2] - c[0]) * (c[3] - c[1]); if (inb(c) && ca < ba) { ba = ca; best = i; sym = [i, k] } });
    const inside = o.poly && o.poly.length > 2 ? inPoly(t, o.poly) : inb(b);
    if (inside && a < ba) { ba = a; best = i; sym = null } }); MSYM = sym; return best }
function mscroll() { const c = document.querySelector('.mk.cur'); if (c) c.scrollIntoView({block: 'start', behavior: 'smooth'}) }
function mfocus(i) { const o = MK.objects[i]; if (!o) return; MSEL = i; const r = cv.getBoundingClientRect(), a = s2d([o.bbox[0], o.bbox[1]]), b = s2d([o.bbox[2], o.bbox[3]]);
  const w = Math.max(b[0] - a[0], 20), h = Math.max(b[1] - a[1], 20), z = Math.min(r.width * .45 / w, r.height * (o.symbols ? .9 : .45) / h, 6);
  view = {z, x: r.width / 2 - (a[0] + w / 2) * z, y: r.height / 2 - (a[1] + h / 2) * z}; renderProv(); draw(); mscroll() }
function marksHtml() { const O = MK.objects, hidden = O.filter(o => !mshown(o)).length;
  const items = O.map((o, i) => !mshown(o) ? '' : i === MSEL ? `<div class="mk cur" data-m="${i}">${mdetail(o)}</div>` : `<div class="mk" data-m="${i}"><span style="color:${MCOL[o.type] || '#fff'};font-weight:700">■</span> <b style="color:var(--tx)">${esc(o.type_label)}</b>
    <span class="badge" style="${o.status === 'unclear' ? 'background:#5a1f3c;color:#ffb3d9' : 'background:#1d4d32;color:#9ff0bf'}">${esc(o.status)}</span>
    <div class="keys">${VG.auto(o.text)}</div>${o.symbols ? `<div class="keys">${o.symbols.length} symbols marked (${esc(o.symbol_script)}): ${o.symbols.map(y => { const l = o.symbol_script === 'EVA' ? VG.evaLabel(y.label) : esc(y.label); return y.status === 'unclear' ? `<i>${l}</i>` : l }).join(' · ')}</div>` : ''}
    <div class="keys">found by ${esc(o.found_by)} · reviewed by ${esc(o.reviewed_by)}${o.poly ? ' · outline' : ''}${o.evidence ? ` · <a style="color:var(--ac)" href="${esc(o.evidence)}" target="_blank">evidence image</a>` : ''}</div></div>`).join('');
  const nf = (MK.not_found || []).map(n => `<div class="keys">• <b>${esc(n.expected)}</b> — ${esc(n.result)}</div>`).join('');
  return `<div><b>Page:</b> ${esc((PG.labels || {}).title || '')}</div><div><b>Objects:</b> ${O.length}${hidden ? ` (${hidden} hidden by the group filter)` : ''}</div>` + (items || '<div class="keys">no objects marked on this page</div>') +
    (nf ? `<div style="margin-top:8px"><b>Expected but not found:</b></div>${nf}` : '') +
    `<div class="keys" style="margin-top:8px">Everything on the page that is not the main Voynich text and not a drawing: folio numbers, quire marks, later notes, month names, key-like letter columns, red symbols and red spots (many red spots are offsets of paint from the facing page). Found by Opus (AI) from the scans and the notes on voynich.nu, then every object was checked by a human (boxes moved or redrawn where needed). Alphabet columns with marked symbols have a thin outer frame and one box per symbol (italic / dashed = unclear reading). Dashed = still unclear. Coordinates are scan pixels; data in <code>data/marks/&lt;image&gt;.json</code>.</div>` }
document.addEventListener('click', e => { const d = e.target.closest && e.target.closest('[data-m]'); if (d && !e.target.closest('a') && !e.target.closest('.mkd')) mfocus(+d.dataset.m) });
{ let down = null; cv.addEventListener('mousedown', e => { down = [e.offsetX, e.offsetY] });
  cv.addEventListener('mouseup', e => { if (!down || (VIEW !== 'marks' && VIEW !== 'all') || editing || LE.on) { down = null; return }
    if (Math.hypot(e.offsetX - down[0], e.offsetY - down[1]) < 4) { MSEL = mpick(e.offsetX, e.offsetY); renderProv(); draw();
      mscroll() } down = null });
  cv.addEventListener('mousemove', e => { if ((VIEW !== 'marks' && VIEW !== 'all') || e.buttons) return; const old = JSON.stringify(MSYM), h = mpick(e.offsetX, e.offsetY);
    if (h !== MHOV || JSON.stringify(MSYM) !== old) { MHOV = h; const o = MK.objects[h], y = o && MSYM ? o.symbols[MSYM[1]] : null;
      cv.title = y ? `${o.text.slice(0, 5)} symbol: ${y.label}${y.status === 'unclear' ? ' (unclear)' : ''}` : o ? `${o.type_label} (${o.status}): ${o.text}` : ''; cv.style.cursor = h >= 0 ? 'pointer' : ''; draw() } }) }
{ const box = $('mkgroups'); box.innerHTML = MGROUPS.map(([g, n, ts]) => `<label><input type="checkbox" id="mg-${g}" checked> ${n}</label>`).join('') +
    `<span class="mkleg">${Object.entries(MCOL).map(([t, c]) => `<span><i style="background:${c}"></i>${t === 'red_spot' ? 'red' : t.replace('_', ' ')}</span>`).join('')}<span><i style="background:none;border:1px dashed #ccc"></i>dashed = unclear</span></span>`;
  [...MGROUPS.map(([g]) => 'mg-' + g), 'mk-names'].forEach(id => { const c = $(id), k = 'opt:' + id, v = lsGet(k); if (v !== null) c.checked = v;
    c.onchange = () => { lsSet(k, c.checked); if (MSEL >= 0 && !mshown(MK.objects[MSEL] || {})) MSEL = -1; renderProv(); draw() } }) }

// view and layer settings are remembered in this browser
['l-con', 'l-fill', 'l-lw', 'l-ink', 'l-bg', 'l-inkon', 'l-pub', 'l-lnink', 'l-lnink-a', 'a-bg', 'a-page', 'a-draw', 'a-draw-a', 'a-draw-s', 'a-marks', 'a-ink', 'a-ink-a', 'a-inksrc', 'a-lines', 'a-lines-a', 'a-lw'].forEach(id => { const c = $(id), k = 'opt:' + id, v = lsGet(k), box = c.type === 'checkbox';
  if (v !== null) box ? c.checked = v : c.value = v; c.addEventListener(box || c.tagName === 'SELECT' ? 'change' : 'input', () => { lsSet(k, box ? c.checked : c.value); allSync(); if (VIEW === 'all') renderProv(); draw() }) });
function allSync() { if (typeof DR !== 'undefined') DR.setAll($('a-draw-s').value, +$('a-draw-a').value) }

// ---------- object card: what is shown beside the page when an object is selected ----------
function mcrop(src, bb, maxW, maxH, padF = .18, white = false) {   // crop of a display-frame image around a scan-px box, as a data URL
  if (!src || (src.complete === false) || !(src.width)) return null;
  const a = s2d([bb[0], bb[1]]), b = s2d([bb[2], bb[3]]), pad = Math.max(4, padF * Math.max(b[0] - a[0], b[1] - a[1]));
  const x0 = Math.max(0, a[0] - pad), y0 = Math.max(0, a[1] - pad), x1 = Math.min(src.width, b[0] + pad), y1 = Math.min(src.height, b[1] + pad), w = x1 - x0, h = y1 - y0;
  if (w < 2 || h < 2) return null; const sc = Math.min(maxW / w, maxH / h, 10), c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * sc)); c.height = Math.max(1, Math.round(h * sc)); const g = c.getContext('2d'); g.imageSmoothingQuality = 'high';
  if (white) { g.fillStyle = '#ffffff'; g.fillRect(0, 0, c.width, c.height) } g.drawImage(src, x0, y0, w, h, 0, 0, c.width, c.height); return c.toDataURL('image/jpeg', .9) }
function mdetail(o) { const W = 300, parts = [];
  const scan = mcrop(img, o.bbox, W, 260); if (scan) parts.push(`<div class="mkd-l">scan</div><img class="mkd-i" src="${scan}">`);
  if (INKT.spectral) { const sp = mcrop(INKT.spectral, o.bbox, W, 260, .18, true); if (sp) parts.push(`<div class="mkd-l">multispectral ink map (38 bands)</div><img class="mkd-i" src="${sp}">`) }
  const tmp = document.createElement('div'); tmp.innerHTML = VG.auto(o.text); const gl = [...tmp.querySelectorAll('.vg')].map(e => e.outerHTML);
  if (gl.length) parts.push(`<div class="mkd-l">characters named in the text</div><div class="mkd-g">${gl.join(' ')}</div>`);
  if (o.symbols) { const rows = o.symbols.map(y => { const c = mcrop(img, y.bbox, 70, 34, .12);
      const r = o.symbol_script === 'EVA' ? VG.evaLabel(y.label) : esc(y.label);
      return `<div class="mkd-s${y.status === 'unclear' ? ' unc' : ''}">${c ? `<img src="${c}">` : '<span></span>'}<span>${r}</span></div>` }).join('');
    parts.push(`<div class="mkd-l">symbols, top to bottom (scan → reading)</div><div class="mkd-sy">${rows}</div>`) }
  if (o.evidence) parts.push(`<div class="mkd-l">evidence</div><a href="${esc(o.evidence)}" target="_blank"><img class="mkd-i" src="${esc(o.evidence)}"></a>`);
  return `<div class="mkd"><div style="display:flex;justify-content:space-between;gap:6px"><b style="color:var(--tx)"><span style="color:${MCOL[o.type] || '#fff'}">■</span> ${esc(o.type_label)}</b><button id="mkd-x" title="close (Esc)" style="padding:0 8px">×</button></div>
    <div class="keys" style="color:var(--tx)">${VG.auto(o.text)}</div>${parts.join('')}</div>` }
document.addEventListener('click', e => { if (e.target.id === 'mkd-x') { MSEL = -1; renderProv(); draw() } });
window.addEventListener('keydown', e => { if (e.key === 'Escape' && (VIEW === 'marks' || VIEW === 'all') && MSEL >= 0 && !editing && !LE.on) { MSEL = -1; renderProv(); draw() } });
