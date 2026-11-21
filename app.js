// Voynich page boundaries: viewer and editor (static, no server). Internal coordinates = pixels of the display image;
// data files use scan pixels: display = (scan - scan_x0/y0) * scale.
const $ = id => document.getElementById(id), cv = $('cv'), ctx = cv.getContext('2d');
const SIDES = ['top', 'right', 'bottom', 'left'], CI = {top: [0, 1], right: [1, 2], bottom: [2, 3], left: [3, 0]};
const SRC = {'human': 'marked by a human', 'opus': 'Opus (AI), not reviewed', 'opus+human-checked': 'Opus (AI), checked by a human',
  'opus+human-corrected': 'Opus (AI), corrected by a human'};
const HSRC = {'human-checked': 'holes checked by a human', 'human': 'holes marked by a human', 'human-not-checked': 'holes not checked yet',
  'opus': 'holes marked by Opus, not reviewed', 'opus-none-marked': 'holes not checked yet (Opus marked none)'};
const LCOL = {two_runs_agree: '#ff3b30', human_confirmed: '#ff9f0a', human_corrected: '#ffd60a', human_drawn: '#ff6a3d', unclear: '#ff2d92'};
const LNAME = {two_runs_agree: 'two GPT runs agree', human_confirmed: 'confirmed by a human', human_corrected: 'corrected by a human',
  human_drawn: 'drawn by a human', unclear: 'unclear'};
let LINES = [], VIEW = 'pages', PG = null;
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
  ctx.save(); ctx.translate(view.x, view.y); ctx.scale(view.z, view.z); ctx.filter = $('l-con').checked ? 'contrast(1.8) brightness(1.1)' : 'none';
  if (img.complete) ctx.drawImage(img, 0, 0); ctx.restore(); ctx.filter = 'none'; if (hideAll) return;
  const path = (pts, close) => { pts.forEach((p, i) => { const s = toScr(p); i ? ctx.lineTo(...s) : ctx.moveTo(...s) }); if (close) ctx.closePath() };
  const line = (pts, col, w, close, dash) => { if (pts.length < 2) return; ctx.beginPath(); path(pts, close); ctx.setLineDash(dash || []); ctx.strokeStyle = col; ctx.lineWidth = w; ctx.stroke(); ctx.setLineDash([]) };
  ctx.beginPath(); ctx.rect(-10, -10, r.width + 20, r.height + 20); path(outline(S), true); S.holes.forEach(h => { if (h.length >= 3) path(h, true) });
  ctx.fillStyle = VIEW === 'lines' ? '#0c0d10' : `rgba(110,110,110,${$('l-fill').value / 100})`; ctx.fill('evenodd');   // lines view: only the page itself
  if (VIEW !== 'pages') { ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.globalAlpha = VIEW === 'all' ? .55 : 1;
    (LW || LINES).forEach((l, i) => { if (l.deleted) return; const p = l.pts.map(s2d); if (p.length > 1) line(p, (LE.on && LE.sel === i) ? '#ffffff' : (LCOL[l.status] || '#fff'), VIEW === 'all' ? 1.5 : 3.5, false) }); ctx.globalAlpha = 1;
    if (LE.on) drawLineEdit(line) }
  if (VIEW === 'lines') return;
  if (editing && $('l-pub').checked && PUB) { line(outline(PUB), 'rgba(92,200,255,.9)', 1, true); PUB.holes.forEach(h => line(h, 'rgba(92,200,255,.9)', 1, true)) }
  line(outline(S), 'rgba(255,255,255,.95)', 1, true); S.holes.forEach((h, i) => line(h, i === selHole ? '#ffb340' : 'rgba(255,255,255,.95)', 1, true));
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
cv.addEventListener('wheel', e => { e.preventDefault(); const f = Math.exp(-e.deltaY * 0.0015), x = e.offsetX, y = e.offsetY;
  view.x = x - (x - view.x) * f; view.y = y - (y - view.y) * f; view.z *= f; draw() }, {passive: false});
function fit() { const r = cv.getBoundingClientRect(); if (!img.width) return;
  let x0 = 0, y0 = 0, w = img.width, h = img.height;
  if (VIEW === 'lines' && S) { const o = outline(S), xs = o.map(p => p[0]), ys = o.map(p => p[1]); x0 = Math.min(...xs); y0 = Math.min(...ys); w = Math.max(...xs) - x0; h = Math.max(...ys) - y0 }
  const z = Math.min(r.width / w, r.height / h) * 0.96; view = {z, x: (r.width - w * z) / 2 - x0 * z, y: (r.height - h * z) / 2 - y0 * z}; draw() }
window.addEventListener('keydown', e => { if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
  if (e.key === ' ') { if (!hideAll) { hideAll = true; draw() } e.preventDefault(); return }
  if (!editing && (e.key === '1' || e.key === '2' || e.key === '3')) { setView(['pages', 'lines', 'all'][+e.key - 1]); return }
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
$('b-dl-page').onclick = async () => { if (!E) return; saveJson(await (await fetch(`data/pages/${E.image}.json`)).json(), `${E.image}.json`) };
$('b-dl-all').onclick = async () => { const b = $('b-dl-all'), t = b.textContent; b.disabled = true; let n = 0;
  const all = await Promise.all(INDEX.map(async p => { const j = await (await fetch(`data/pages/${p.image}.json`)).json(); b.textContent = `loading ${++n}/${INDEX.length}`; return j }));
  saveJson({format: 'voynich-page-boundaries/1', coords: 'scan pixels', pages: all}, 'voynich-page-boundaries.json'); b.textContent = t; b.disabled = false };
// ---------- pages ----------
function linesHtml() { const c = {}; LINES.forEach(l => c[l.status] = (c[l.status] || 0) + 1);
  return `<div><b>Row lines:</b> ${LINES.length}</div>` + Object.keys(LNAME).filter(k => c[k]).map(k =>
    `<div><span style="color:${LCOL[k]};font-weight:700">━━</span> ${LNAME[k]}: ${c[k]}</div>`).join('') +
    `<div class="keys" style="margin-top:6px">Drawn by GPT-5.5 twice (two independent runs), registered onto the scan and clipped to the page. Lines both runs agree on are kept; lines drawn by only one run were decided by a human.</div>` }
function renderProv() { if (!PG) return;
  $('provh').textContent = VIEW === 'pages' ? 'Page outline: who marked it and how' : VIEW === 'lines' ? 'Row lines: where they come from' : 'Page outline and row lines';
  $('prov').innerHTML = VIEW === 'pages' ? provHtml(PG) : VIEW === 'lines' ? `<div><b>Page:</b> ${(PG.labels || {}).title || ''}</div>` + linesHtml() : provHtml(PG) + '<hr style="border-color:#323846">' + linesHtml() }
function setView(v) { VIEW = v; if (v !== 'pages' && editing) { editing = false; sel = null; drawHole = null }
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.v === v)); $('b-edit').style.display = v === 'pages' ? '' : 'none';
  $('lb-edit').style.display = v === 'lines' ? '' : 'none'; if (v !== 'lines' && LE.on) lineEdit(false);
  setFilters(); renderList(); renderProv(); refresh(); fit() }
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
  all: [['', 'all pages'], ['panel', 'foldout panels'], ['holes', 'pages with holes'], ['l-human', 'some lines decided by a human']]};
function setFilters() { const keep = $('flt').value; $('flt').innerHTML = FLT[VIEW].map(([v, t]) => `<option value="${v}">${t}</option>`).join('');
  $('flt').value = FLT[VIEW].some(([v]) => v === keep) ? keep : '' }
const nHuman = p => { const s = p.lines_by_status || {}; return (s.human_confirmed || 0) + (s.human_corrected || 0) + (s.human_drawn || 0) };
function keepPage(p, f) {
  if (!f) return true; if (f === 'panel') return p.kind === 'foldout panel'; if (f === 'holes') return p.holes > 0;
  if (f === 'unclear') return p.status === 'unclear'; if (f === 'mine') return !!lsGet('edit:' + p.image);
  if (f === 'l-human') return nHuman(p) > 0; if (f === 'l-unclear') return (p.lines_by_status || {}).unclear > 0; if (f === 'l-none') return !p.lines;
  return p.boundary_source === f }
function badge(p) {
  const ob = `<span class="badge src-${p.boundary_source}">${p.boundary_source}</span>`;
  const lb = `<span class="badge" style="background:#4a2416;color:#ffb38a">${p.lines || 0} lines${nHuman(p) ? ' · ✓' + nHuman(p) : ''}${(p.lines_by_status || {}).unclear ? ' · ?' + p.lines_by_status.unclear : ''}</span>`;
  return VIEW === 'pages' ? ob : VIEW === 'lines' ? lb : `<span style="display:flex;gap:4px">${lb}${ob}</span>` }
function renderList() { const f = $('flt').value;
  pages = INDEX.filter(p => keepPage(p, f));
  $('list').innerHTML = pages.map((p, i) => `<div data-i="${i}" class="${E && p.image === E.image ? 'cur' : ''}"><span>${p.folio}${VIEW !== 'lines' && p.holes ? ' ⬡' + p.holes : ''}${lsGet('edit:' + p.image) ? ' <span class="mine">✎</span>' : ''}</span>${badge(p)}</div>`).join('');
  document.querySelectorAll('#list div[data-i]').forEach(d => d.onclick = () => go(+d.dataset.i));
  cur = E ? pages.findIndex(p => p.image === E.image) : -1; $('prog').textContent = `${pages.length} pages` }
$('flt').onchange = () => { renderList(); if (cur < 0 && pages.length) go(0) };
async function go(i) { if (i < 0 || i >= pages.length) return; E = pages[i]; cur = i;
  const pg = await (await fetch(`data/pages/${E.image}.json`)).json();
  try { const LD = await (await fetch(`data/lines/${E.image}.json`)).json(); LINES = LD.lines; LXH = LD.xheight || 18 } catch (e) { LINES = []; LXH = 18 }
  linesLoaded();
  PUB = stateFromPage(pg); const ed = lsGet('edit:' + E.image);
  S = ed ? stateFromPage({boundary: ed, holes: ed.holes}) : JSON.parse(JSON.stringify(PUB)); $('note').value = ed && ed.note || '';
  undo = []; sel = null; selHole = -1; drawHole = null;
  $('task').textContent = `${E.folio} — ${E.title || ''}`; PG = pg; renderProv();
  history.replaceState(null, '', '#' + E.folio);
  img = new Image(); img.onload = () => { fit(); refresh() }; img.src = E.display.file; renderList(); refresh() }
window.addEventListener('resize', fit);
(async () => { INDEX = await (await fetch('data/index.json')).json(); setFilters(); renderList();
  const want = decodeURIComponent(location.hash.slice(1)); const k = pages.findIndex(p => p.folio === want || p.image === want); go(k >= 0 ? k : 0) })();

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
