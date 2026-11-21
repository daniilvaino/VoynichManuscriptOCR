// Voynich page boundaries: viewer and editor (static, no server). Internal coordinates = pixels of the display image;
// data files use scan pixels: display = (scan - scan_x0/y0) * scale.
const $ = id => document.getElementById(id), cv = $('cv'), ctx = cv.getContext('2d');
const SIDES = ['top', 'right', 'bottom', 'left'], CI = {top: [0, 1], right: [1, 2], bottom: [2, 3], left: [3, 0]};
const SRC = {'human': 'marked by a human', 'opus': 'Opus (AI), not reviewed', 'opus+human-checked': 'Opus (AI), checked by a human',
  'opus+human-corrected': 'Opus (AI), corrected by a human'};
const HSRC = {'human-checked': 'holes checked by a human', 'human': 'holes marked by a human', 'human-not-checked': 'holes not checked yet',
  'opus': 'holes marked by Opus, not reviewed', 'opus-none-marked': 'holes not checked yet (Opus marked none)'};
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
  ctx.fillStyle = `rgba(110,110,110,${$('l-fill').value / 100})`; ctx.fill('evenodd');
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
function fit() { const r = cv.getBoundingClientRect(); if (!img.width) return; const z = Math.min(r.width / img.width, r.height / img.height) * 0.96;
  view = {z, x: (r.width - img.width * z) / 2, y: (r.height - img.height * z) / 2}; draw() }
window.addEventListener('keydown', e => { if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
  if (e.key === ' ') { if (!hideAll) { hideAll = true; draw() } e.preventDefault(); return }
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
function provHtml(pg) { const p = pg.provenance, rows = [['Boundary', SRC[p.boundary_source] || p.boundary_source], ['Status', p.status],
  ['Holes', `${pg.holes.length} · ${HSRC[p.holes_source] || p.holes_source || '—'}`]];
  if (p.opus_confidence) rows.push(['Opus confidence', p.opus_confidence]); if (p.opus_note) rows.push(['Opus note', p.opus_note]);
  if (p.human_note) rows.push(['Human note', p.human_note]); if (p.saved_at) rows.push(['Human saved', p.saved_at]);
  return rows.map(([k, v]) => `<div><b>${k}:</b> ${String(v).replace(/</g, '&lt;')}</div>`).join('') }
function renderList() { const f = $('flt').value;
  pages = INDEX.filter(p => !f || (f === 'holes' ? p.holes > 0 : f === 'unclear' ? p.status === 'unclear' : f === 'mine' ? !!lsGet('edit:' + p.image) : p.boundary_source === f));
  $('list').innerHTML = pages.map((p, i) => `<div data-i="${i}" class="${E && p.image === E.image ? 'cur' : ''}"><span>${p.folio}${p.holes ? ' ⬡' + p.holes : ''}${lsGet('edit:' + p.image) ? ' <span class="mine">✎</span>' : ''}</span><span class="badge src-${p.boundary_source}">${p.boundary_source}</span></div>`).join('');
  document.querySelectorAll('#list div[data-i]').forEach(d => d.onclick = () => go(+d.dataset.i));
  cur = E ? pages.findIndex(p => p.image === E.image) : -1; $('prog').textContent = `${pages.length} pages` }
$('flt').onchange = () => { renderList(); if (cur < 0 && pages.length) go(0) };
async function go(i) { if (i < 0 || i >= pages.length) return; E = pages[i]; cur = i;
  const pg = await (await fetch(`data/pages/${E.image}.json`)).json();
  PUB = stateFromPage(pg); const ed = lsGet('edit:' + E.image);
  S = ed ? stateFromPage({boundary: ed, holes: ed.holes}) : JSON.parse(JSON.stringify(PUB)); $('note').value = ed && ed.note || '';
  undo = []; sel = null; selHole = -1; drawHole = null;
  $('task').textContent = `${E.folio} (${E.image})`; $('prov').innerHTML = provHtml(pg);
  history.replaceState(null, '', '#' + E.folio);
  img = new Image(); img.onload = () => { fit(); refresh() }; img.src = E.display.file; renderList(); refresh() }
window.addEventListener('resize', fit);
(async () => { INDEX = await (await fetch('data/index.json')).json(); renderList();
  const want = decodeURIComponent(location.hash.slice(1)); const k = pages.findIndex(p => p.folio === want || p.image === want); go(k >= 0 ? k : 0) })();
