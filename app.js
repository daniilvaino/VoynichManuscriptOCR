// Voynich MS 408: Interactive Atlas, Reading Transcript, Split Compare & Annotation Studio.
// Internal coordinates = display image px; data files = scan px: display = (scan - scan_x0/y0) * scale.
const $ = id => document.getElementById(id), cv = $('cv'), ctx = cv.getContext('2d');
const SIDES = ['top', 'right', 'bottom', 'left'], CI = {top: [0, 1], right: [1, 2], bottom: [2, 3], left: [3, 0]};
const SRC = {'human': 'marked by a human', 'opus': 'AI draft (Claude Opus), not reviewed', 'opus+human-checked': 'AI outline, verified by a human',
  'opus+human-corrected': 'AI outline, corrected by a human'};
const SRC_SHORT = {'human': 'Human', 'opus': 'AI draft', 'opus+human-checked': 'Verified', 'opus+human-corrected': 'Corrected'};
const HSRC = {'human-checked': 'holes checked by a human', 'human': 'holes marked by a human', 'human-not-checked': 'holes not checked yet',
  'opus': 'holes marked by AI, not reviewed', 'opus-none-marked': 'holes not checked yet'};
const LCOL = {two_runs_agree: '#ff453a', human_confirmed: '#ff453a', human_corrected: '#ff453a', human_drawn: '#ff453a', unclear: '#ff453a', red_tick: '#ff453a'};
const LNAME = {two_runs_agree: 'two AI runs agree', human_confirmed: 'verified by human', human_corrected: 'corrected by human',
  human_drawn: 'drawn by human', unclear: 'unclear'};
const RCOL = {agree: '#46c97a', partial: '#ffd60a', weak: '#ff8a2a', no_zl: '#c77dff', none: '#c77dff'};
const RNAME = {agree: 'Matches ZL (≥80%)', partial: 'Partial match (50–80%)', weak: 'Weak match (<50%)', no_zl: 'New / no ZL match'};
const SECS = [
  ['', 'All', '#948d81'],
  ['herbal', 'Herbal', '#46c97a'],
  ['stars (recipes)', 'Recipes', '#f2a93b'],
  ['biological (bathing)', 'Bathing', '#38bdf8'],
  ['pharmaceutical', 'Pharma', '#c084fc'],
  ['zodiac', 'Zodiac', '#f472b6'],
  ['cosmological', 'Cosmo', '#fb923c'],
  ['astronomical', 'Astro', '#818cf8'],
  ['text only', 'Text', '#a8a29e'],
  ['__foldout', 'Foldouts', '#d9a354']
];
const SEC_META = Object.fromEntries(SECS.filter(([k]) => k && !k.startsWith('__')).map(([k, lbl, col]) => [k, {lbl, col}]));

let ROWS = {rows: [], lines_not_in_rows: []}, ROWOF = [], RSEL = -1, RHOV = -1;
let trFilter = 'all', trShowGlyphs = true;
let LINES = [], VIEW = 'lines', PG = null, INKT = {}, MK = {objects: [], not_found: []}, MSEL = -1, MHOV = -1;
const MCOL = {folio_number: '#4ea1ff', quire_mark: '#3ecf72', pencil_letter: '#b0b8c8', colour_note: '#ff8fd0', marginalia: '#7fd1ff', month_name: '#b98cff',
  alphabet_column: '#00e5ff', ex_libris: '#9ff0bf', red_tick: '#ff2d55', red_spot: '#ff6b6b', scribble: '#e0a060', dirt: '#8a7a60', voynich_text: '#ff4fd8', other: '#ffffff',
  under_paint: '#ffb340', show_through: '#a0a8ff'};

let INDEX = [], pages = [], cur = -1, E = null, PUB = null, S = null, img = new Image();
let undo = [], redo = [], mode = 'edit', drawHole = null, sel = null, selHole = -1, editing = false;
let hideAll = false, view = {z: 1, x: 0, y: 0}, drag = null, animId = null;
let inspTab = 'layers', activeSec = '', atlasSec = '';
window.spaceDown = false;

// Split-Screen Wipe Comparator state (used by Ink & Drawings)
const WIPE = {on: false, ratio: 0.5, dragging: false, raf: 0, rect: null, cache: null};
let imgCache = {washed: null, hiCon: null}, drawRaf = 0;
function scheduleDraw() { if (!drawRaf) drawRaf = requestAnimationFrame(() => { drawRaf = 0; draw(); }); }
window.scheduleDraw = scheduleDraw;

const LS = k => 'vpb:' + k, lsGet = k => { try { return JSON.parse(localStorage.getItem(LS(k))) } catch (e) { return null } },
  lsSet = (k, v) => { try { v === null ? localStorage.removeItem(LS(k)) : localStorage.setItem(LS(k), JSON.stringify(v)) } catch (e) {} };
const isTextTarget = el => el && (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || (el.tagName === 'INPUT' && !['checkbox', 'radio', 'range'].includes(el.type)));
const isAnyEditing = () => editing || LE.on || (typeof DR !== 'undefined' && DR.isOn());

// ---------- Smooth Camera Animation ----------
function animateView(target, ms = 240) {
  if (animId) cancelAnimationFrame(animId);
  const start = {...view}, t0 = performance.now();
  const ease = t => 1 - Math.pow(1 - t, 3);
  function step(now) {
    const k = Math.min(1, (now - t0) / ms), e = ease(k);
    view = {
      z: start.z + (target.z - start.z) * e,
      x: start.x + (target.x - start.x) * e,
      y: start.y + (target.y - start.y) * e
    };
    draw();
    if (k < 1) animId = requestAnimationFrame(step); else animId = null;
  }
  animId = requestAnimationFrame(step);
}

// ---------- On-Canvas Floating Action Pill (for Holes / Splines / Magnetic Lasso) ----------
let daHandlers = null;
window.setDrawAction = function (text, onFinish, onUndo, onCancel) {
  const pill = $('draw-action-pill');
  if (!text) { pill.classList.remove('show'); daHandlers = null; return; }
  $('draw-action-text').textContent = text;
  $('da-finish').style.display = onFinish ? '' : 'none';
  $('da-undo').style.display = onUndo ? '' : 'none';
  daHandlers = {onFinish, onUndo, onCancel};
  pill.classList.add('show');
};
$('da-finish').onclick = () => daHandlers && daHandlers.onFinish && daHandlers.onFinish();
$('da-undo').onclick = () => daHandlers && daHandlers.onUndo && daHandlers.onUndo();
$('da-cancel').onclick = () => daHandlers && daHandlers.onCancel && daHandlers.onCancel();

// ---------- Split-Screen Wipe Comparator ----------
function canWipe() { return (VIEW === 'ink' || VIEW === 'draw') && !isAnyEditing(); }
function positionWipeBar(w) {
  const width = w || $('wrap').clientWidth || 1;
  const x = Math.round(width * WIPE.ratio);
  $('wipe-bar').style.transform = `translate3d(${x}px, 0, 0)`;
}
function setWipe(on) {
  WIPE.on = on && canWipe();
  WIPE.cache = null;
  syncWipeUI();
  draw();
}
function syncWipeUI() {
  const show = WIPE.on && canWipe();
  if (!show) { WIPE.on = false; WIPE.dragging = false; WIPE.cache = null; }
  $('wipe-bar').classList.toggle('show', show);
  $('wipe-lbl-l').classList.toggle('show', show);
  $('wipe-lbl-r').classList.toggle('show', show);
  $('wipe-lbl-r').textContent = VIEW === 'ink' ? 'Extracted ink' : 'Drawing mask';
  if (show) positionWipeBar();
  if ($('b-wipe-ink')) $('b-wipe-ink').classList.toggle('on', show && VIEW === 'ink');
  if ($('b-wipe-draw')) $('b-wipe-draw').classList.toggle('on', show && VIEW === 'draw');
}
window.toggleWipe = () => setWipe(!WIPE.on);
window.syncWipeUI = syncWipeUI;
$('b-wipe-ink').onclick = () => setWipe(!WIPE.on);
{
  const bar = $('wipe-bar');
  const flushWipe = () => {
    WIPE.raf = 0;
    if (!WIPE.on || !canWipe()) return;
    const w = (WIPE.rect && WIPE.rect.width) || $('wrap').clientWidth || 1;
    positionWipeBar(w);
    if (WIPE.cache) blitWipeCache(); else draw();
  };
  const startDrag = e => {
    e.stopPropagation();
    e.preventDefault();
    WIPE.dragging = true;
    WIPE.rect = $('wrap').getBoundingClientRect();
    buildWipeCache();
  };
  const moveAt = clientX => {
    const r = WIPE.rect || $('wrap').getBoundingClientRect();
    WIPE.ratio = Math.max(0.04, Math.min(0.96, (clientX - r.left) / Math.max(1, r.width)));
    if (!WIPE.raf) WIPE.raf = requestAnimationFrame(flushWipe);
  };
  const endDrag = () => {
    if (!WIPE.dragging) return;
    WIPE.dragging = false;
    WIPE.rect = null;
    WIPE.cache = null;
    if (WIPE.raf) { cancelAnimationFrame(WIPE.raf); WIPE.raf = 0; }
    positionWipeBar();
    draw();
  };
  bar.addEventListener('mousedown', startDrag);
  bar.addEventListener('touchstart', startDrag, {passive: false});
  window.addEventListener('mousemove', e => { if (WIPE.dragging) moveAt(e.clientX); });
  window.addEventListener('touchmove', e => { if (WIPE.dragging && e.touches[0]) moveAt(e.touches[0].clientX); }, {passive: true});
  window.addEventListener('mouseup', endDrag);
  window.addEventListener('touchend', endDrag);
  window.addEventListener('touchcancel', endDrag);
  window.addEventListener('blur', endDrag);
}

// ---------- Sidebars, Popovers, Modals ----------
const isMobile = () => window.innerWidth <= 900;
function closeMobileDrawers() { document.body.classList.remove('mobile-left-open', 'mobile-right-open'); syncPanelBtns(); }
function syncPanelBtns() {
  const leftOpen = isMobile() ? document.body.classList.contains('mobile-left-open') : !document.body.classList.contains('left-closed');
  const rightOpen = isMobile() ? document.body.classList.contains('mobile-right-open') : !document.body.classList.contains('right-closed');
  $('b-toggle-left').classList.toggle('active', leftOpen);
  $('b-toggle-right').classList.toggle('active', rightOpen);
}
function toggleLeft() {
  if (isMobile()) {
    const open = !document.body.classList.contains('mobile-left-open');
    document.body.classList.toggle('mobile-left-open', open);
    if (open) document.body.classList.remove('mobile-right-open');
  } else {
    document.body.classList.toggle('left-closed');
    requestAnimationFrame(() => setTimeout(draw, 210));
  }
  syncPanelBtns();
}
function toggleRight() {
  if (isMobile()) {
    const open = !document.body.classList.contains('mobile-right-open');
    document.body.classList.toggle('mobile-right-open', open);
    if (open) document.body.classList.remove('mobile-left-open');
  } else {
    document.body.classList.toggle('right-closed');
    requestAnimationFrame(() => setTimeout(draw, 210));
  }
  syncPanelBtns();
}
$('b-toggle-left').onclick = toggleLeft;
$('b-toggle-right').onclick = toggleRight;
$('drawer-scrim').onclick = closeMobileDrawers;
if (window.innerWidth <= 1160 && window.innerWidth > 900) document.body.classList.add('left-closed');
syncPanelBtns();

function syncSliderLabels() {
  const set = (id, txt) => { const el = $(id); if (el) el.textContent = txt; };
  set('v-fill', $('l-fill').value + '%');
  set('v-ink', $('l-ink').value + '%');
  set('v-bg', $('l-bg').value + '%');
  set('v-lw', $('l-lw').value);
  set('v-lnink', $('l-lnink-a').value + '%');
  set('v-abg', $('a-bg').value + '%');
  set('v-adraw', $('a-draw-a').value + '%');
  set('v-aink', $('a-ink-a').value + '%');
  set('v-alines', $('a-lines-a').value + '%');
  set('v-alw', $('a-lw').value);
  $('b-view-pop').classList.toggle('has-mod', $('l-con').checked || +$('l-fill').value !== 50);
}

function positionPopover(btn, pop) {
  const r = btn.getBoundingClientRect();
  pop.style.top = (r.bottom + 6) + 'px';
  const pw = pop.offsetWidth || 260;
  pop.style.left = Math.max(8, Math.min(window.innerWidth - pw - 8, r.right - pw)) + 'px';
}
function togglePopover(btn, pop) {
  const was = pop.classList.contains('open');
  document.querySelectorAll('.pop-panel.open').forEach(p => p.classList.remove('open'));
  if (!was) { pop.classList.add('open'); positionPopover(btn, pop); }
}
$('b-view-pop').onclick = e => { e.stopPropagation(); togglePopover($('b-view-pop'), $('view-pop')); };
$('b-mkleg').onclick = e => { e.stopPropagation(); togglePopover($('b-mkleg'), $('mkleg-pop')); };
document.addEventListener('click', e => {
  if (!e.target.closest('.pop-panel') && !e.target.closest('#b-view-pop') && !e.target.closest('#b-mkleg')) {
    document.querySelectorAll('.pop-panel.open').forEach(p => p.classList.remove('open'));
  }
});

// Guide & Shortcuts Modal
function openKeys(show, tab) {
  $('keys-modal').classList.toggle('open', show);
  if (show && tab) setHelpTab(tab);
}
function setHelpTab(tab) {
  $('htab-guide').classList.toggle('on', tab === 'guide');
  $('htab-keys').classList.toggle('on', tab === 'keys');
  $('help-guide').style.display = tab === 'guide' ? '' : 'none';
  $('help-keys').style.display = tab === 'keys' ? '' : 'none';
}
$('b-keys').onclick = () => openKeys(true, 'guide');
$('keys-close').onclick = () => openKeys(false);
$('htab-guide').onclick = () => setHelpTab('guide');
$('htab-keys').onclick = () => setHelpTab('keys');
$('keys-modal').onclick = e => { if (e.target === $('keys-modal')) openKeys(false); };

// Visual Folio Atlas Modal
function openAtlas(show) {
  $('atlas-modal').classList.toggle('open', show);
  if (show) {
    renderAtlasPills();
    renderAtlasGrid();
    setTimeout(() => $('atlas-search').focus(), 40);
  }
}
$('b-atlas').onclick = () => openAtlas(true);
$('folio-pill').onclick = () => openAtlas(true);
$('atlas-close').onclick = () => openAtlas(false);
$('atlas-modal').onclick = e => { if (e.target === $('atlas-modal')) openAtlas(false); };
$('atlas-search').oninput = () => renderAtlasGrid();

function renderAtlasPills() {
  const pills = [
    ...SECS,
    ['__spectral', 'Multispectral', '#d9a354']
  ];
  $('atlas-pills').innerHTML = pills.map(([k, lbl]) => {
    const cnt = INDEX.filter(p => matchSection(p, k)).length;
    return `<button class="sec-pill${atlasSec === k ? ' on' : ''}" data-asec="${esc(k)}" type="button">${lbl} <span style="opacity:.65">${cnt}</span></button>`;
  }).join('');
  $('atlas-pills').querySelectorAll('[data-asec]').forEach(b => b.onclick = () => {
    atlasSec = b.dataset.asec;
    renderAtlasPills();
    renderAtlasGrid();
  });
}
function matchSection(p, k) {
  if (!k) return true;
  if (k === '__foldout') return p.kind === 'foldout panel';
  if (k === '__spectral') return (p.ink || []).includes('spectral');
  return p.section === k;
}
function renderAtlasGrid() {
  const q = ($('atlas-search').value || '').trim().toLowerCase();
  const items = INDEX.filter(p => matchSection(p, atlasSec) && matchQuery(p, q));
  $('atlas-cnt').textContent = `· ${items.length} of ${INDEX.length} folios`;
  $('atlas-grid').innerHTML = items.map(p => {
    const sm = SEC_META[p.section] || {lbl: p.section || '', col: '#948d81'};
    const hasSpec = (p.ink || []).includes('spectral');
    return `<div class="atlas-item${E && p.image === E.image ? ' cur' : ''}" data-aimg="${esc(p.image)}">
      <div class="atlas-thumb">
        <img loading="lazy" decoding="async" src="${esc(p.display.file)}" alt="${esc(p.folio)}">
        ${p.kind === 'foldout panel' ? '<span class="atlas-fold-tag">Foldout</span>' : ''}
        ${hasSpec ? '<span class="atlas-spec-tag">38-band</span>' : ''}
      </div>
      <div class="atlas-info">
        <div class="atlas-row1">
          <span class="atlas-folio">${esc(p.folio)} <span class="pnum">#${pnum(p)}</span></span>
          <span class="atlas-sec"><span class="sec-dot" style="background:${sm.col}"></span>${esc(sm.lbl)}</span>
        </div>
        <div class="atlas-stats">
          ${p.rows ? `<span>${p.rows} rows</span>` : ''}
          ${p.drawing ? '<span>✿ drawing</span>' : ''}
          ${p.marks ? `<span>${p.marks} mark${p.marks > 1 ? 's' : ''}</span>` : ''}
          ${p.holes ? `<span>⬡${p.holes}</span>` : ''}
        </div>
      </div>
    </div>`;
  }).join('') || '<div class="keys">No matching folios.</div>';
  $('atlas-grid').querySelectorAll('[data-aimg]').forEach(el => el.onclick = () => {
    goToImage(el.dataset.aimg);
    openAtlas(false);
  });
}

// My Edits Hub Modal
function countLocalEdits() {
  let n = 0;
  INDEX.forEach(p => {
    if (lsGet('edit:' + p.image)) n++;
    if (lsGet('draw:' + p.image)) n++;
    if (lsGet('edit-lines:' + p.image)) n++;
  });
  $('my-edits-cnt').textContent = n;
  $('b-my-edits').classList.toggle('show', n > 0);
  return n;
}
window.countLocalEdits = countLocalEdits;

function openMyEdits(show) {
  $('edits-modal').classList.toggle('open', show);
  if (show) renderMyEdits();
}
$('b-my-edits').onclick = () => openMyEdits(true);
$('edits-close').onclick = () => openMyEdits(false);
$('edits-modal').onclick = e => { if (e.target === $('edits-modal')) openMyEdits(false); };

function renderMyEdits() {
  const rows = [];
  INDEX.forEach(p => {
    const eb = lsGet('edit:' + p.image), ed = lsGet('draw:' + p.image), el = lsGet('edit-lines:' + p.image);
    if (eb) rows.push({p, kind: 'pages', label: 'Boundary & holes', at: eb.edited_at, key: 'edit:' + p.image});
    if (ed) rows.push({p, kind: 'draw', label: 'Drawing mask', at: ed.edited_at, key: 'draw:' + p.image});
    if (el) rows.push({p, kind: 'lines', label: 'Row lines', at: el.edited_at, key: 'edit-lines:' + p.image});
  });
  if (!rows.length) {
    $('edits-list').innerHTML = '<div class="keys">No local edits saved in this browser yet.</div>';
    return;
  }
  $('edits-list').innerHTML = rows.map(r => `<div class="edit-item">
    <div class="edit-item-meta">
      <div class="edit-item-title">${esc(r.p.folio)} <span class="badge b-wa">${r.label}</span></div>
      <div class="keys">${esc(r.p.title || '')}${r.at ? ' · ' + new Date(r.at).toLocaleString() : ''}</div>
    </div>
    <div class="btn-row">
      <button data-ejump="${esc(r.p.image)}" data-eview="${r.kind}" type="button">Open</button>
      <button data-edrop="${esc(r.key)}" class="btn-danger" type="button">Drop</button>
    </div>
  </div>`).join('') + `<div class="btn-row" style="margin-top:10px;padding-top:10px;border-top:1px solid var(--bd)">
    <button id="me-dl-b" type="button">Download boundary edits</button>
    <button id="me-dl-d" type="button">Download drawing masks</button>
    <button id="me-dl-l" type="button">Download line edits</button>
  </div>`;
  $('edits-list').querySelectorAll('[data-ejump]').forEach(b => b.onclick = () => {
    openMyEdits(false);
    if (VIEW !== b.dataset.eview) setView(b.dataset.eview);
    goToImage(b.dataset.ejump);
  });
  $('edits-list').querySelectorAll('[data-edrop]').forEach(b => b.onclick = () => {
    if (!confirm('Drop this saved local edit?')) return;
    lsSet(b.dataset.edrop, null);
    countLocalEdits(); renderList(); renderMyEdits();
    if (E && b.dataset.edrop.endsWith(':' + E.image)) goToImage(E.image);
  });
  $('me-dl-b').onclick = () => $('b-download').click();
  $('me-dl-d').onclick = () => $('d-dlall') && $('d-dlall').click();
  $('me-dl-l').onclick = () => $('lb-download').click();
}

// Inspector Tabs (Tab 6 Studio)
function setInspTab(tab) {
  inspTab = tab;
  $('itab-layers').classList.toggle('on', tab === 'layers');
  $('itab-info').classList.toggle('on', tab === 'info');
  syncInspPanes();
}
function syncInspPanes() {
  const isAll = VIEW === 'all';
  $('insp-tabs').classList.toggle('show', isAll);
  $('allbox').classList.toggle('show', isAll && inspTab === 'layers');
  $('prov-card').style.display = (isAll && inspTab === 'layers') ? 'none' : '';
}
$('itab-layers').onclick = () => setInspTab('layers');
$('itab-info').onclick = () => setInspTab('info');
$('b-open-layers').onclick = () => {
  setInspTab('layers');
  if (isMobile()) { document.body.classList.add('mobile-right-open'); document.body.classList.remove('mobile-left-open'); }
  else document.body.classList.remove('right-closed');
  syncPanelBtns();
};

// ---------- Geometry ----------
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
const D = () => E.display, s2d = p => [+((p[0] - D().scan_x0) * D().scale).toFixed(1), +((p[1] - D().scan_y0) * D().scale).toFixed(1)],
  d2s = p => [+(p[0] / D().scale + D().scan_x0).toFixed(1), +(p[1] / D().scale + D().scan_y0).toFixed(1)];
function stateFromPage(pg) { const b = pg.boundary, c = [b.top[0], b.right[0], b.bottom[0], b.left[0]].map(s2d), mids = {}, types = {};
  SIDES.forEach(s => { mids[s] = b[s].slice(1, -1).map(s2d); types[s] = mids[s].length ? 'spline' : 'straight' });
  return {corners: c, mids, types, holes: (pg.holes || []).map(h => h.map(s2d))} }
function stateToScan(st) { const o = {}; SIDES.forEach(s => o[s] = sidePts(st, s).map(d2s)); o.holes = st.holes.filter(h => h.length >= 3).map(h => h.map(d2s)); return o }

// ---------- Drawing ----------
function getFilteredImg(mode) {
  if (mode === 'raw' || !img.complete || !img.naturalWidth) return img;
  if (!imgCache[mode]) {
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const g = c.getContext('2d');
    g.filter = mode === 'washed'
      ? 'grayscale(1) sepia(0.55) saturate(1.6) contrast(0.22) brightness(1.62)'
      : 'contrast(1.8) brightness(1.1)';
    g.drawImage(img, 0, 0);
    imgCache[mode] = c;
  }
  return imgCache[mode];
}

function drawScan(r, rawOnly, g = ctx) {
  g.save(); g.translate(view.x, view.y); g.scale(view.z, view.z);
  const inkStyle = !rawOnly && VIEW === 'ink';
  const mode = inkStyle ? 'washed' : $('l-con').checked ? 'hiCon' : 'raw';
  if (!rawOnly && (VIEW === 'ink' || VIEW === 'all')) {
    g.fillStyle = '#f9f6ee';
    g.fillRect(0, 0, img.width || 0, img.height || 0);
    g.globalAlpha = (VIEW === 'all' ? $('a-bg').value : $('l-bg').value) / 100;
  }
  if (img.complete && img.naturalWidth) g.drawImage(getFilteredImg(mode), 0, 0);
  g.globalAlpha = 1; g.restore();
}

function pathOn(g, pts, close) {
  pts.forEach((p, i) => { const s = toScr(p); i ? g.lineTo(...s) : g.moveTo(...s); });
  if (close) g.closePath();
}
function lineOn(g, pts, col, w, close, dash) {
  if (pts.length < 2) return;
  g.beginPath(); pathOn(g, pts, close); g.setLineDash(dash || []);
  g.strokeStyle = col; g.lineWidth = w; g.stroke(); g.setLineDash([]);
}
function maskOutsideOn(g, r, col) {
  g.beginPath(); g.rect(-10, -10, r.width + 20, r.height + 20);
  pathOn(g, outline(S), true);
  S.holes.forEach(h => { if (h.length >= 3) pathOn(g, h, true); });
  g.fillStyle = col; g.fill('evenodd');
}

function renderWipeHalf(g, r, isRight) {
  drawScan(r, !isRight, g);
  maskOutsideOn(g, r, VIEW === 'ink' ? '#100f0e' : `rgba(18,16,14,${$('l-fill').value / 100})`);
  if (VIEW === 'ink') {
    lineOn(g, outline(S), 'rgba(217,163,84,0.28)', 1, true);
    if (isRight) {
      const src = (document.querySelector('input[name=inksrc]:checked') || {}).value || 'stage1';
      if ($('l-inkon').checked && INKT[src]) {
        g.save(); g.globalAlpha = +$('l-ink').value / 100;
        g.translate(view.x, view.y); g.scale(view.z, view.z); g.drawImage(INKT[src], 0, 0); g.restore();
      }
    }
  } else if (isRight && VIEW === 'draw' && typeof DR !== 'undefined') {
    DR.render(g, view, toScr);
  }
}

function buildWipeCache() {
  if (!S || !WIPE.on || !canWipe() || hideAll) { WIPE.cache = null; return; }
  const r = cv.getBoundingClientRect();
  if (!r.width || !r.height) { WIPE.cache = null; return; }
  const dpr = devicePixelRatio || 1;
  const pw = Math.round(r.width * dpr), ph = Math.round(r.height * dpr);
  const makeHalf = isRight => {
    const c = document.createElement('canvas');
    c.width = pw; c.height = ph;
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    renderWipeHalf(g, r, isRight);
    return c;
  };
  WIPE.cache = {w: r.width, h: r.height, pw, ph, dpr, left: makeHalf(false), right: makeHalf(true)};
}

function blitWipeCache() {
  const c = WIPE.cache;
  if (!c || cv.width !== c.pw || cv.height !== c.ph) { WIPE.cache = null; draw(); return; }
  const splitX = Math.round(c.w * WIPE.ratio);
  const splitPx = Math.max(0, Math.min(c.pw, Math.round(splitX * c.dpr)));
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, c.pw, c.ph);
  if (splitPx > 0) ctx.drawImage(c.left, 0, 0, splitPx, c.ph, 0, 0, splitPx, c.ph);
  if (splitPx < c.pw) ctx.drawImage(c.right, splitPx, 0, c.pw - splitPx, c.ph, splitPx, 0, c.pw - splitPx, c.ph);
}

function draw() {
  const r = cv.getBoundingClientRect();
  if (!r.width || !r.height) return;
  const pw = Math.round(r.width * devicePixelRatio), ph = Math.round(r.height * devicePixelRatio);
  if (cv.width !== pw || cv.height !== ph) { cv.width = pw; cv.height = ph }
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  ctx.clearRect(0, 0, r.width, r.height);
  if ($('z-pct')) $('z-pct').textContent = Math.round(view.z * 100) + '%';
  if (!S) return;

  const line = (pts, col, w, close, dash) => lineOn(ctx, pts, col, w, close, dash);
  const maskOutside = col => maskOutsideOn(ctx, r, col);

  // If Split Compare is active on Ink or Drawings, draw raw original on left & overlay on right!
  const wiping = WIPE.on && canWipe() && !hideAll;
  if (wiping) {
    positionWipeBar(r.width);
    if (WIPE.dragging && WIPE.cache) { blitWipeCache(); return; }
    const splitX = Math.round(r.width * WIPE.ratio);
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, splitX, r.height); ctx.clip();
    renderWipeHalf(ctx, r, false);
    ctx.restore();

    ctx.save(); ctx.beginPath(); ctx.rect(splitX, 0, r.width - splitX, r.height); ctx.clip();
    renderWipeHalf(ctx, r, true);
    ctx.restore();
    return;
  }

  drawScan(r, hideAll);
  if (hideAll) return;

  const ALL = VIEW === 'all', A = id => $(id).checked;
  if (!ALL || A('a-page')) {
    maskOutside((VIEW === 'ink' || VIEW === 'lines') ? '#100f0e' : `rgba(18,16,14,${$('l-fill').value / 100})`);
  }
  if (VIEW === 'ink') line(outline(S), 'rgba(217,163,84,0.28)', 1, true);
  if (VIEW === 'draw') { if (typeof DR !== 'undefined') DR.render(ctx, view, toScr); return }

  const src = ALL ? $('a-inksrc').value : (document.querySelector('input[name=inksrc]:checked') || {}).value || 'stage1';
  const inkOn = VIEW === 'ink' ? A('l-inkon') : VIEW === 'lines' ? A('l-lnink') : ALL ? A('a-ink') : false;
  if (inkOn && INKT[src]) { ctx.save(); ctx.globalAlpha = (ALL ? +$('a-ink-a').value : VIEW === 'lines' ? +$('l-lnink-a').value : +$('l-ink').value) / 100;
    ctx.translate(view.x, view.y); ctx.scale(view.z, view.z); ctx.drawImage(INKT[src], 0, 0); ctx.restore() }
  if (VIEW === 'ink') return;
  if (ALL && A('a-draw') && typeof DR !== 'undefined') DR.render(ctx, view, toScr, true);

  if (VIEW === 'lines' || (ALL && A('a-lines'))) { ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.globalAlpha = ALL ? +$('a-lines-a').value / 100 : 1;
    const dircol = !LE.on && (ALL ? A('a-dircol') : A('l-dircol')), lw = ALL ? +$('a-lw').value : +$('l-lw').value, lsrc = LW || LINES, revOf = {};
    if (dircol) ROWS.rows.forEach(rw => rw.pieces.forEach(pc => { revOf[pc.i] = !!pc.rev }));
    lsrc.forEach((l, i) => { if (l.deleted) return; const p = l.pts.map(s2d); if (p.length < 2) return;
      const rIdx = ROWOF[i], rw = ROWS.rows[rIdx];
      const isSel = !LE.on && rw && rIdx === RSEL;
      const isHov = !LE.on && rw && rIdx === RHOV && !isSel;
      const dash = dircol && (!rw || rw.status === 'no_zl') ? [lw * 2.5, lw * 2] : null;
      if ((LE.on && LE.sel === i) || isSel) {
        line(p, 'rgba(217,163,84,0.52)', lw + 6, false, null);
        line(p, '#fff3cf', Math.max(1.8, lw), false, dash);
        return;
      }
      if (isHov) {
        line(p, 'rgba(217,163,84,0.38)', lw + 5, false, null);
      }
      const w = isHov ? lw + 0.8 : lw;
      if (!dircol || !(i in revOf)) { line(p, LCOL[l.status] || '#fff', w, false, dash); return }
      const q = revOf[i] ? p.slice().reverse() : p;
      for (let k = 1; k < q.length; k++) { const a = q[Math.max(0, k - 2)], b = q[Math.min(q.length - 1, k + 1)]; line([q[k - 1], q[k]], dirColour(b[0] - a[0], b[1] - a[1]), w, false, dash) } });
    ctx.globalAlpha = 1;
    if (!LE.on) drawRows(ALL, lw);
    if (LE.on) drawLineEdit(line) }
  if (VIEW === 'lines') return;

  if (editing && $('l-pub').checked && PUB) { line(outline(PUB), 'rgba(88,166,255,.9)', 1, true); PUB.holes.forEach(h => line(h, 'rgba(88,166,255,.9)', 1, true)) }
  if (!ALL || A('a-page')) { line(outline(S), 'rgba(255,250,240,.92)', 1.2, true); S.holes.forEach((h, i) => line(h, i === selHole ? '#f2a93b' : 'rgba(255,250,240,.88)', 1.2, true)) }
  if (VIEW === 'marks' || (ALL && A('a-marks'))) drawMarks(line);
  if (VIEW === 'marks') return;
  if (!editing) return;
  const hr = Math.max(1.8, Math.min(3.2, 1.8 + view.z * 0.7));
  if (drawHole) { line(drawHole, '#fff', 1.2, false, [4, 3]); drawHole.forEach(p => dot(p, '#fff', hr)) }
  SIDES.forEach(s => S.types[s] !== 'straight' && S.mids[s].forEach((p, i) => dot(p, '#fff', hr, sel && sel.k === 'm' && sel.s === s && sel.i === i)));
  S.corners.forEach((p, i) => dot(p, '#d9a354', hr + 1.2, sel && sel.k === 'c' && sel.i === i));
  S.holes.forEach((h, hi) => h.forEach((p, i) => dot(p, '#f5efe2', Math.max(1.6, hr - 0.3), sel && sel.k === 'h' && sel.h === hi && sel.i === i)));
}
function dot(p, col, r, on) { const s = toScr(p); ctx.beginPath(); ctx.arc(s[0], s[1], on ? r + 2 : r, 0, 7); ctx.fillStyle = col; ctx.fill();
  ctx.strokeStyle = on ? '#f2a93b' : 'rgba(0,0,0,.78)'; ctx.lineWidth = on ? 2 : 1; ctx.stroke() }

function refresh() {
  draw();
  if (S) {
    const N = {top: 'Top', right: 'Right', bottom: 'Bottom', left: 'Left'};
    SIDES.forEach(s => { const b = $('s-' + s); b.textContent = `${N[s]}: ${S.types[s] === 'straight' ? 'straight' : 'spline (' + S.mids[s].length + ')'}`; b.classList.toggle('on', S.types[s] !== 'straight') });
    $('holes').innerHTML = 'Holes: ' + (S.holes.length ? S.holes.map((h, i) => `#${i + 1} <button data-h="${i}" style="padding:1px 6px;font-size:11px">×</button>`).join(' ') : 'none');
    document.querySelectorAll('[data-h]').forEach(b => b.onclick = () => { snap(); S.holes.splice(+b.dataset.h, 1); selHole = -1; persist(); refresh() });
  }

  $('b-edit').textContent = editing ? '✓ Done editing' : '✎ Edit boundary';
  $('b-edit').classList.toggle('on', editing);
  $('m-edit').classList.toggle('on', mode === 'edit');
  $('m-hole').classList.toggle('on', mode === 'hole');
  $('b-undo').disabled = !undo.length;
  $('b-redo').disabled = !redo.length;
  document.body.classList.toggle('editing', editing);

  if (VIEW === 'pages') {
    if (editing && mode === 'hole' && drawHole && drawHole.length) {
      setDrawAction(`Drawing hole · ${drawHole.length} pt${drawHole.length > 1 ? 's' : ''}`, drawHole.length >= 3 ? closeHole : null, () => { drawHole.pop(); if (!drawHole.length) drawHole = null; refresh(); }, () => { drawHole = null; refresh(); });
    } else if (!LE.on && !(typeof DR !== 'undefined' && DR.isOn())) setDrawAction(null);
    $('hint').textContent = !editing ? 'Drag to pan · Ctrl+wheel zooms · G opens Atlas'
      : mode === 'hole' ? 'Click around hole · Space+drag pans'
      : 'Drag points · click side to add · right-click deletes · Space+drag pans';
  } else if (VIEW === 'draw' && typeof DR !== 'undefined') {
    DR.hint();
  } else if (VIEW === 'lines') {
    updateLineHint();
  } else {
    setDrawAction(null);
    $('hint').textContent = {marks: 'Click an object on the scan or list to inspect', ink: 'Press C or Compare to drag split curtain', all: 'Click any object or row line to inspect'}[VIEW] || '';
  }

  countLocalEdits();
  const myBound = E && !!lsGet('edit:' + E.image);
  $('b-submit').disabled = !window.REPO || !myBound;
  $('b-submit').title = !window.REPO ? 'repository not configured yet (config.js)' : myBound ? 'opens a pre-filled GitHub issue' : 'edit the page first';
  $('b-prev').disabled = cur <= 0;
  $('b-next').disabled = cur < 0 || cur >= pages.length - 1;
  syncWipeUI();
}

// ---------- Outline Editing (with Undo + Redo) ----------
function snap() { undo.push(JSON.stringify(S)); if (undo.length > 200) undo.shift(); redo = []; }
function doUndo() { if (undo.length) { redo.push(JSON.stringify(S)); S = JSON.parse(undo.pop()); sel = null; selHole = -1; persist(); refresh() } }
function doRedo() { if (redo.length) { undo.push(JSON.stringify(S)); S = JSON.parse(redo.pop()); sel = null; selHole = -1; persist(); refresh() } }
$('b-undo').onclick = doUndo;
$('b-redo').onclick = doRedo;
function persist() { lsSet('edit:' + E.image, {image: E.image, folio: E.folio, scan: E.scan, ...stateToScan(S), note: $('note').value, edited_at: new Date().toISOString()}); renderList(); countLocalEdits(); }
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
cv.addEventListener('mousedown', e => {
  const x = e.offsetX, y = e.offsetY;
  // Universal Space+drag pan (works in EVERY edit mode on laptop trackpads!)
  if (e.button === 1 || (window.spaceDown && isAnyEditing()) || !editing) {
    drag = {pan: 1, x, y, vx: view.x, vy: view.y};
    if (window.spaceDown) document.body.classList.add('panning');
    return;
  }
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
window.addEventListener('mouseup', () => {
  document.body.classList.remove('panning');
  if (drag && drag.pt) { persist(); refresh() }
  drag = null;
});

// Touch pan + pinch-to-zoom
{ let tState = null;
  cv.addEventListener('touchstart', e => {
    if (isAnyEditing()) return;
    if (e.touches.length === 1) { const t = e.touches[0]; tState = {mode: 'pan', x: t.clientX, y: t.clientY, vx: view.x, vy: view.y}; }
    else if (e.touches.length === 2) {
      e.preventDefault();
      const r = cv.getBoundingClientRect(), a = e.touches[0], b = e.touches[1];
      const cx = (a.clientX + b.clientX) / 2 - r.left, cy = (a.clientY + b.clientY) / 2 - r.top;
      tState = {mode: 'pinch', d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), cx, cy, vz: view.z, vx: view.x, vy: view.y};
    }
  }, {passive: false});
  cv.addEventListener('touchmove', e => {
    if (!tState) return; e.preventDefault();
    if (tState.mode === 'pan' && e.touches.length === 1) {
      const t = e.touches[0]; view.x = tState.vx + t.clientX - tState.x; view.y = tState.vy + t.clientY - tState.y; draw();
    } else if (tState.mode === 'pinch' && e.touches.length === 2) {
      const a = e.touches[0], b = e.touches[1], d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      const f = Math.max(0.15, Math.min(12, tState.vz * (d / Math.max(1, tState.d)))) / tState.vz;
      view.z = tState.vz * f; view.x = tState.cx - (tState.cx - tState.vx) * f; view.y = tState.cy - (tState.cy - tState.vy) * f; draw();
    }
  }, {passive: false});
  cv.addEventListener('touchend', () => { tState = null });
}

cv.addEventListener('wheel', e => { e.preventDefault();
  if (e.ctrlKey) { const f = Math.exp(-e.deltaY * 0.0015), x = e.offsetX, y = e.offsetY; view.x = x - (x - view.x) * f; view.y = y - (y - view.y) * f; view.z *= f }
  else { const k = e.deltaMode === 1 ? 30 : e.deltaMode === 2 ? cv.height : 1; let dx = e.deltaX * k, dy = e.deltaY * k; if (e.shiftKey && !dx) { dx = dy; dy = 0 } view.x -= dx; view.y -= dy }
  draw() }, {passive: false});

function zoomCenter(factor) {
  const r = cv.getBoundingClientRect(), cx = r.width / 2, cy = r.height / 2;
  const nz = Math.max(0.1, Math.min(16, view.z * factor)), f = nz / view.z;
  view.x = cx - (cx - view.x) * f; view.y = cy - (cy - view.y) * f; view.z = nz; draw();
}
$('z-in').onclick = () => zoomCenter(1.28);
$('z-out').onclick = () => zoomCenter(1 / 1.28);
$('z-fit').onclick = () => fit();
$('z-pct').onclick = () => fit();

function fit() { const r = cv.getBoundingClientRect(); if (!img.width || !r.width || !r.height) return;
  let x0 = 0, y0 = 0, w = img.width, h = img.height;
  if ((VIEW === 'lines' || VIEW === 'ink') && S) { const o = outline(S), xs = o.map(p => p[0]), ys = o.map(p => p[1]); x0 = Math.min(...xs); y0 = Math.min(...ys); w = Math.max(...xs) - x0; h = Math.max(...ys) - y0 }
  const hudPad = 50, availH = Math.max(120, r.height - hudPad);
  const z = Math.min(r.width / w, availH / h) * 0.94;
  view = {z, x: (r.width - w * z) / 2 - x0 * z, y: (availH - h * z) / 2 - y0 * z}; draw() }

window.addEventListener('keydown', e => {
  if ($('atlas-modal').classList.contains('open')) { if (e.key === 'Escape') openAtlas(false); return; }
  if ($('edits-modal').classList.contains('open')) { if (e.key === 'Escape') openMyEdits(false); return; }
  if ($('keys-modal').classList.contains('open')) { if (e.key === 'Escape') openKeys(false); return; }
  if (isTextTarget(e.target)) { if (e.key === 'Escape') e.target.blur(); return; }

  // Space: pans when editing (trackpad-friendly!), peeks scan when viewing
  if (e.key === ' ') {
    e.preventDefault();
    if (isAnyEditing()) {
      window.spaceDown = true;
      document.body.classList.add('space-pan');
    } else if (!hideAll) {
      hideAll = true; $('b-hide').classList.add('active'); draw();
    }
    return;
  }
  if (e.key.toLowerCase() === 'v' && !e.ctrlKey && !e.metaKey) {
    if (!hideAll) { hideAll = true; $('b-hide').classList.add('active'); draw(); }
    return;
  }
  if (e.key === '?' || (e.shiftKey && e.key === '/')) { openKeys(true, 'keys'); e.preventDefault(); return; }
  if (e.key.toLowerCase() === 'g' && !e.ctrlKey && !isAnyEditing()) { openAtlas(true); e.preventDefault(); return; }
  if (e.key.toLowerCase() === 'c' && !e.ctrlKey && canWipe()) { setWipe(!WIPE.on); return; }
  if (e.key === '/' && !e.ctrlKey && !e.metaKey && !isAnyEditing()) {
    if (isMobile()) { document.body.classList.add('mobile-left-open'); syncPanelBtns(); }
    else if (document.body.classList.contains('left-closed')) toggleLeft();
    $('qsearch').focus(); $('qsearch').select(); e.preventDefault(); return;
  }
  if (e.key === '[' && !isAnyEditing()) { toggleLeft(); return; }
  if (e.key === ']' && !isAnyEditing()) { toggleRight(); return; }
  if ((e.key === '+' || e.key === '=') && !e.ctrlKey) { zoomCenter(1.25); return; }
  if (e.key === '-' && !e.ctrlKey) { zoomCenter(1 / 1.25); return; }
  if (!isAnyEditing() && '123456'.includes(e.key) && e.key.length === 1) { setView(TABS[+e.key - 1]); return }
  if (e.key === 'Enter' && VIEW === 'draw' && !isAnyEditing()) { go(cur + 1); return }
  if (e.key === 'ArrowRight') { go(cur + 1); return }
  if (e.key === 'ArrowLeft') { go(cur - 1); return }
  if (e.key.toLowerCase() === 'f' && !isAnyEditing()) { fit(); return }
  if (!editing) return;
  if (e.ctrlKey && e.key.toLowerCase() === 'z' && !e.shiftKey) { doUndo(); e.preventDefault(); return }
  if (e.ctrlKey && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { doRedo(); e.preventDefault(); return }
  if (e.key === 'Enter' && mode === 'hole') { closeHole(); return }
  if (e.key === 'Escape') { if (drawHole) { drawHole = null; refresh(); } else { editing = false; sel = null; refresh(); } return }
  if (e.key.toLowerCase() === 'e') setMode('edit');
  else if (e.key.toLowerCase() === 'h') setMode('hole');
  else if (e.key === 'Delete' || e.key === 'Backspace') { if (sel) delPoint(sel); else if (selHole >= 0) { snap(); S.holes.splice(selHole, 1); selHole = -1; persist(); refresh() } }
});
window.addEventListener('keyup', e => {
  if (e.key === ' ') {
    window.spaceDown = false;
    document.body.classList.remove('space-pan', 'panning');
    if (hideAll) { hideAll = false; $('b-hide').classList.remove('active'); draw(); }
  }
  if (e.key.toLowerCase() === 'v' && hideAll) { hideAll = false; $('b-hide').classList.remove('active'); draw(); }
});
{ const b = $('b-hide'), on = () => { hideAll = true; b.classList.add('active'); draw() }, off = () => { if (hideAll) { hideAll = false; b.classList.remove('active'); draw() } };
  b.addEventListener('mousedown', on); b.addEventListener('mouseup', off); b.addEventListener('mouseleave', off);
  b.addEventListener('touchstart', e => { e.preventDefault(); on() }); b.addEventListener('touchend', off) }

const TABS = ['pages', 'draw', 'marks', 'ink', 'lines', 'all'];
const SIDE = ['allopt', 'mkopt'].map(id => ({el: $(id), parent: $(id).parentNode, next: $(id).nextSibling}));
function sidePanel(onSide) {
  SIDE.forEach(o => { if (onSide) $('allslot').appendChild(o.el); else o.parent.insertBefore(o.el, o.next) });
  $('all-bar-hint').style.display = onSide ? '' : 'none';
  if (onSide) setInspTab('layers');
  else syncInspPanes();
}

function setMode(m) { mode = m; drawHole = null; refresh() }
$('m-edit').onclick = () => setMode('edit'); $('m-hole').onclick = () => setMode('hole');
$('b-edit').onclick = () => { editing = !editing; sel = null; drawHole = null; refresh() };
$('b-prev').onclick = () => go(cur - 1);
$('b-next').onclick = () => go(cur + 1);

SIDES.forEach(s => $('s-' + s).onclick = () => { snap(); if (S.types[s] === 'straight') { S.types[s] = 'spline'; const [a, b] = CI[s], A = S.corners[a], B = S.corners[b];
  S.mids[s] = [[+((A[0] + B[0]) / 2).toFixed(1), +((A[1] + B[1]) / 2).toFixed(1)]] } else { S.types[s] = 'straight'; S.mids[s] = [] } persist(); refresh() });
$('note').oninput = () => persist();
$('b-reset').onclick = () => { if (!confirm('Drop your edit of this page?')) return; lsSet('edit:' + E.image, null); S = JSON.parse(JSON.stringify(PUB)); $('note').value = ''; undo = []; redo = []; renderList(); refresh() };
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
  const all = await Promise.all(INDEX.map(async p => { const j = await (await fetch(`data/pages/${p.image}.json`, {cache: 'no-cache'})).json(); b.textContent = `Loading ${++n}/${INDEX.length}…`; return j }));
  saveJson({format: 'voynich-page-boundaries/1', coords: 'scan pixels', pages: all}, 'voynich-page-boundaries.json'); b.textContent = t; b.disabled = false };

// ---------- Inspector: Interactive Reading Transcript & Provenance ----------
function methodBox(title, bodyHtml) {
  return `<details class="method-box"><summary>${title}</summary><div class="method-body">${bodyHtml}</div></details>`;
}

function rowEvaText(r) {
  const vals = Object.values(r.zl_text || {});
  if (vals.length) return vals.join(' ');
  return r.pieces.map(pc => pc.reading || pc.words || '').filter(Boolean).join(' ');
}

function rfocus(idx) {
  const r = ROWS.rows[idx]; if (!r) return;
  const src = LW || LINES;
  const pts = [];
  r.pieces.forEach(pc => { const l = src[pc.i]; if (l && !l.deleted) l.pts.forEach(q => pts.push(s2d(q))); });
  if (!pts.length) return;
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const x0 = Math.min(...xs), y0 = Math.min(...ys), x1 = Math.max(...xs), y1 = Math.max(...ys);
  const w = Math.max(x1 - x0, 120), h = Math.max(y1 - y0, 40);
  const rect = cv.getBoundingClientRect();
  const z = Math.max(view.z, Math.min(rect.width * 0.72 / w, (rect.height - 60) * 0.45 / h, 2.2));
  animateView({z, x: rect.width / 2 - (x0 + w / 2) * z, y: (rect.height - 50) / 2 - (y0 + h / 2) * z});
}

function linesHtml() {
  const R = ROWS.rows || [];
  const rc = {agree: 0, partial: 0, weak: 0, no_zl: 0};
  R.forEach(r => { if (r.status in rc) rc[r.status]++; else rc.no_zl++; });
  const keepRow = r => trFilter === 'all' ? true : trFilter === 'partial' ? (r.status === 'partial' || r.status === 'weak') : r.status === trFilter;
  const shown = R.map((r, i) => ({r, i})).filter(({r}) => keepRow(r));

  const fltBtn = (k, lbl, cnt) => (k === 'all' || cnt > 0) ? `<button class="tr-flt${trFilter === k ? ' on' : ''}" data-trf="${k}" type="button">${lbl} ${cnt}</button>` : '';
  const toolbar = `<div class="tr-toolbar">
    <div class="tr-filters">
      ${fltBtn('all', 'All', R.length)}
      ${fltBtn('agree', 'Matched', rc.agree)}
      ${fltBtn('partial', 'Partial', rc.partial + rc.weak)}
      ${fltBtn('no_zl', 'New', rc.no_zl)}
    </div>
    <div class="tr-actions">
      <button id="b-tr-script" type="button" title="Toggle Voynich script glyphs">${trShowGlyphs ? 'EVA only' : 'Glyphs'}</button>
      <button id="b-copy-eva" type="button" title="Copy entire page EVA transliteration">Copy EVA</button>
    </div>
  </div>`;

  const list = shown.length ? `<div class="tr-list">${shown.map(({r, i}) => {
    const isSel = i === RSEL, isHov = i === RHOV;
    const locus = r.loci.length ? r.loci.join(' + ') : `Row ${r.id.split(':').pop()}`;
    const txt = rowEvaText(r);
    const col = RCOL[r.status] || '#c77dff';
    return `<div class="tr-row${isSel ? ' cur' : ''}${isHov ? ' hov' : ''}" data-r="${i}">
      <div class="tr-row-head">
        <span class="tr-locus"><span class="tr-dot" style="background:${col}" title="${RNAME[r.status] || r.status}"></span>${esc(locus)}</span>
        <span class="keys nowrap">${r.agree != null ? Math.round(r.agree * 100) + '%' : 'no ZL'}${isSel ? ` <button class="mk-close" id="row-x" title="Collapse (Esc)" style="margin-left:4px">×</button>` : ''}</span>
      </div>
      ${txt ? (trShowGlyphs ? `<div class="tr-glyphs">${VG.eva(txt)}</div>` : '') + `<div class="tr-eva">${esc(txt)}</div>` : '<div class="keys">No text reading recorded</div>'}
      ${isSel ? `<div class="tr-detail">${rowDetailHtml(r, txt)}</div>` : ''}
    </div>`;
  }).join('')}</div>` : '<div class="keys" style="padding:8px 0">No text rows on this folio.</div>';

  const summary = `<div class="kv-list" style="margin-top:10px;padding-top:8px;border-top:1px solid var(--bd)">
    <div class="kv-row"><span class="kv-k">Row lines</span><span class="kv-v">${LINES.length} segments → ${R.length} reading rows</span></div>
    <div class="kv-row"><span class="kv-k">Direction</span><span class="kv-v"><b style="color:#ff0040">→</b> <b style="color:#80ff00">↓</b> <b style="color:#00ffff">←</b> <b style="color:#8000ff">↑</b></span></div>
  </div>`;

  const method = methodBox('Methodology: row lines &amp; ZL alignment',
    `Lines were drawn independently twice by GPT-5.5 and verified/corrected by human review and Ryan Allen's glyph map. <b>ZL</b> is the Zandbergen-Landini standard Voynich transliteration. Hover any row in the transcript to highlight it on the parchment; click to zoom in and compare our OCR reading against ZL.`);
  return toolbar + list + summary + method;
}

const pct = a => a == null ? '—' : `<span class="nowrap">${Math.round(a * 100)}%</span>`;
const GEOMN = {line: 'straight row', steep: 'steep / radial row', ring: 'circular ring', curve: 'curved label'};
const DSRC = {zl_order: 'ZL word order', zl_code: 'ZL direction code', manual: 'human review', owner: 'owner', auto: 'geometry & reader', object: 'parent object', geometry: 'geometry'};

function rowDetailHtml(r, txt) {
  const st = `<span class="badge" style="background:${RCOL[r.status]}26;color:${RCOL[r.status]}">${RNAME[r.status] || r.status}</span>`;
  const agreeWith = (d, name) => d ? (d === r.dir ? `${name} agrees` : `${name} opposite`) : '';
  const dirTxt = !r.dir_source ? 'stored point order' : `${DSRC[r.dir_source] || r.dir_source}` +
    [agreeWith(r.dir_zl_order, 'ZL'), agreeWith(r.dir_reader, 'OCR'), r.conf_fwd != null ? `conf ${(r.dir === 'fwd' ? r.conf_fwd : r.conf_rev).toFixed(2)} vs ${(r.dir === 'fwd' ? r.conf_rev : r.conf_fwd).toFixed(2)}` : ''].filter(Boolean).map(x => ' · ' + x).join('');
  const pcs = r.pieces.map((pc, k) => `<div class="eva-box">
    <div class="keys">${k + 1}. seg #${pc.i + 1}${pc.rev ? ' (reversed)' : ''} → ${pc.loci.length ? esc(pc.loci.join(', ')) : '<b>no ZL</b>'}${pc.w.length ? ' w.' + pc.w.map(w => w[0] === w[1] ? w[0] + 1 : `${w[0] + 1}–${w[1] + 1}`).join(', ') : ''} · ${pct(pc.agree)}</div>
    <div style="margin-top:3px"><span class="keys">ZL:</span> ${pc.words ? VG.eva(pc.words) + ` <span class="vg-c">${esc(pc.words)}</span>` : '—'}</div>
    <div><span class="keys">OCR:</span> ${pc.reading ? VG.eva(pc.reading) + ` <span class="vg-c">${esc(pc.reading)}</span>` : '—'}</div>
  </div>`).join('');
  return `<div style="display:flex;align-items:center;justify-content:space-between;gap:6px;flex-wrap:wrap;margin-bottom:6px">
      <span>${st}</span>
      ${txt ? `<button data-copy-row="${esc(txt)}" type="button" style="padding:2px 7px;font-size:11px">Copy line</button>` : ''}
    </div>
    <div class="keys"><b>Shape &amp; direction:</b> ${GEOMN[r.geom] || 'row'} · ${dirTxt}</div>
    <div class="mkd-l">Segments in reading order (${r.pieces.length})</div>${pcs}`;
}

// Bi-directional Transcript Event Delegation
document.addEventListener('click', e => {
  if (e.target.id === 'row-x') { e.stopPropagation(); RSEL = -1; renderProv(); draw(); return; }
  const flt = e.target.closest('[data-trf]');
  if (flt) { trFilter = flt.dataset.trf; renderProv(); return; }
  if (e.target.id === 'b-tr-script') { trShowGlyphs = !trShowGlyphs; renderProv(); return; }
  if (e.target.id === 'b-copy-eva') {
    const allTxt = (ROWS.rows || []).map(r => `${r.loci.join('+') || r.id.split(':').pop()}\t${rowEvaText(r)}`).join('\n');
    navigator.clipboard && navigator.clipboard.writeText(allTxt).then(() => {
      e.target.textContent = '✓ Copied'; setTimeout(() => { e.target.textContent = 'Copy EVA'; }, 1400);
    });
    return;
  }
  const cp = e.target.closest('[data-copy-row]');
  if (cp) {
    e.stopPropagation();
    navigator.clipboard && navigator.clipboard.writeText(cp.dataset.copyRow).then(() => {
      cp.textContent = '✓ Copied'; setTimeout(() => { cp.textContent = 'Copy line'; }, 1200);
    });
    return;
  }
  const rowEl = e.target.closest('.tr-row[data-r]');
  if (rowEl && !e.target.closest('.tr-detail') && !e.target.closest('button')) {
    const idx = +rowEl.dataset.r;
    RSEL = (RSEL === idx) ? -1 : idx;
    renderProv();
    if (RSEL >= 0) rfocus(RSEL); else draw();
  }
});
document.addEventListener('mouseover', e => {
  const rowEl = e.target.closest && e.target.closest('.tr-row[data-r]');
  if (rowEl) {
    const idx = +rowEl.dataset.r;
    if (RHOV !== idx) { RHOV = idx; draw(); }
  }
});
document.addEventListener('mouseout', e => {
  const rowEl = e.target.closest && e.target.closest('.tr-row[data-r]');
  if (rowEl && (!e.relatedTarget || !rowEl.contains(e.relatedTarget))) {
    if (RHOV !== -1) { RHOV = -1; draw(); }
  }
});

function drawRows(all, lw) {
  const arrows = all ? $('a-arrows').checked : $('l-arrows').checked, bridges = !all && $('l-bridges').checked;
  if (!arrows && !bridges) return;
  const src = LW || LINES, placedLabels = [];
  ROWS.rows.forEach((r, rIdx) => {
    const segs = r.pieces.map(pc => { const l = src[pc.i]; if (!l || l.deleted || l.pts.length < 2) return null; const p = l.pts.map(q => toScr(s2d(q))); return pc.rev ? p.reverse() : p }).filter(Boolean);
    if (!segs.length) return;
    if (bridges) for (let k = 0; k + 1 < segs.length; k++) { const a = segs[k].at(-1), b = segs[k + 1][0]; ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.setLineDash([5, 4]); ctx.strokeStyle = '#58a6ff'; ctx.lineWidth = 1.6; ctx.stroke(); ctx.setLineDash([]) }
    if (arrows) segs.forEach(p => chevrons(p, Math.max(3.8, lw * 1.3)));
    if (bridges) {
      const p = segs[0], len = segs.reduce((t, q) => t + q.slice(1).reduce((u, x, j) => u + Math.hypot(x[0] - q[j][0], x[1] - q[j][1]), 0), 0);
      if (len > 85 || rIdx === RSEL || rIdx === RHOV) {
        const t = r.loci.length ? r.loci.join(' + ') : 'no ZL';
        ctx.font = '600 10.5px Inter,system-ui,sans-serif';
        const w = ctx.measureText(t).width + 10, h = 16;
        let x = p[0][0] - w - 5, y = p[0][1] - h / 2;
        for (let tries = 0; tries < 4; tries++) {
          const hit = placedLabels.find(b => Math.abs(b.x - x) < (b.w + w) * 0.5 && Math.abs(b.y - y) < h - 1);
          if (!hit) break; y = hit.y + h + 1;
        }
        placedLabels.push({x, y, w, h});
        const active = rIdx === RSEL || rIdx === RHOV;
        ctx.fillStyle = active ? '#d9a354' : r.loci.length ? 'rgba(20,34,56,.88)' : 'rgba(68,22,82,.9)';
        ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, y, w, h, 4); else ctx.rect(x, y, w, h); ctx.fill();
        ctx.fillStyle = active ? '#17120a' : r.loci.length ? '#9fd0ff' : '#e9c8ff';
        ctx.fillText(t, x + 5, y + 11.5);
      }
    }
  });
}
function dirColour(dx, dy) {
  const a = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360, h = a < 90 ? -15 + a * 105 / 90 : a < 270 ? a : 270 + (a - 270) * 75 / 90;
  return `hsl(${(h + 360) % 360},92%,54%)` }
function chevrons(p, sz) {
  const M = []; let acc = 46;
  for (let k = 1; k < p.length; k++) { const [x0, y0] = p[k - 1], [x1, y1] = p[k], d = Math.hypot(x1 - x0, y1 - y0); if (!d) continue; let t = 0;
    while (t + (88 - acc) <= d) { t += 88 - acc; acc = 0; M.push([x0 + (x1 - x0) * t / d, y0 + (y1 - y0) * t / d, (x1 - x0) / d, (y1 - y0) / d]) } acc += d - t }
  for (let k = p.length - 1; k > 0; k--) { const [x0, y0] = p[k - 1], [x1, y1] = p[k], d = Math.hypot(x1 - x0, y1 - y0); if (d) { M.push([x1, y1, (x1 - x0) / d, (y1 - y0) / d]); break } }
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const [x, y, ux, uy] of M) { const bx = -ux * sz, by = -uy * sz, nx = -uy * sz * .68, ny = ux * sz * .68; ctx.beginPath(); ctx.moveTo(x + bx + nx, y + by + ny); ctx.lineTo(x, y); ctx.lineTo(x + bx - nx, y + by - ny);
    ctx.strokeStyle = 'rgba(0,0,0,.78)'; ctx.lineWidth = 3; ctx.stroke(); ctx.strokeStyle = 'rgba(255,255,255,.94)'; ctx.lineWidth = 1.5; ctx.stroke() } }
function rpick(x, y) { let best = -1, bd = 9; (LW || LINES).forEach((l, i) => { if (l.deleted || ROWOF[i] === undefined) return; const p = l.pts.map(q => toScr(s2d(q)));
  for (let k = 0; k < p.length - 1; k++) { const d = dseg([x, y], p[k], p[k + 1]); if (d < bd) { bd = d; best = ROWOF[i] } } }); return best }
{ let down = null; cv.addEventListener('mousedown', e => { down = [e.offsetX, e.offsetY] });
  cv.addEventListener('mouseup', e => { const ok = (VIEW === 'lines' || (VIEW === 'all' && $('a-lines').checked && down && mpick(e.offsetX, e.offsetY) < 0)) && !LE.on && down && Math.hypot(e.offsetX - down[0], e.offsetY - down[1]) < 4; down = null;
    if (!ok) return; const k = rpick(e.offsetX, e.offsetY); if (k !== RSEL) { RSEL = k; if (VIEW === 'all' && k >= 0) setInspTab('info'); renderProv(); draw();
      const el = document.querySelector(`.tr-row[data-r="${k}"]`); if (el) el.scrollIntoView({block: 'nearest', behavior: 'smooth'}); } });
  cv.addEventListener('mousemove', e => { if (VIEW !== 'lines' || LE.on || e.buttons) return; const k = rpick(e.offsetX, e.offsetY), r = ROWS.rows[k];
    if (k !== RHOV) {
      RHOV = k;
      document.querySelectorAll('.tr-row.hov').forEach(el => el.classList.remove('hov'));
      const el = k >= 0 && document.querySelector(`.tr-row[data-r="${k}"]`);
      if (el) el.classList.add('hov');
      draw();
    }
    cv.title = r ? `${r.loci.join(' + ') || 'no ZL match'} · ${RNAME[r.status] || r.status} · ${r.agree == null ? '—' : Math.round(r.agree * 100) + '%'}` : '';
    cv.style.cursor = r ? 'pointer' : '';
  });
}
window.addEventListener('keydown', e => { if (e.key === 'Escape' && (VIEW === 'lines' || VIEW === 'all') && RSEL >= 0 && !LE.on && MSEL < 0) { RSEL = -1; renderProv(); draw() } });

function renderProv() {
  if (!PG) return;
  $('provh').textContent = {pages: 'Page outline & provenance', lines: 'Interactive reading transcript', ink: 'Ink extraction', marks: 'Marginalia & objects', all: 'Transcript & page info', draw: 'Illustration mask'}[VIEW];
  $('inkopt').style.display = VIEW === 'ink' ? '' : 'none';
  $('inkh').style.display = (E && (E.ink || []).includes('hisam')) ? '' : 'none';
  $('inkg').style.display = (E && (E.ink || []).includes('hisam_m4g')) ? '' : 'none';
  $('inkr').style.display = (E && (E.ink || []).includes('hisam_raw')) ? '' : 'none';
  $('inks').style.display = (E && (E.ink || []).includes('spectral')) ? '' : 'none';
  { const c = document.querySelector('input[name=inksrc]:checked'); if (c && E && !(E.ink || []).includes(c.value)) document.querySelector('input[name=inksrc][value=stage1]').checked = true }
  const activeInk = (document.querySelector('input[name=inksrc]:checked') || {}).value || 'stage1';
  const inkMeta = {
    stage1: ['Simple ink', 'Universal baseline mask — captures all dark ink and drawing outlines via brightness thresholding (Stage 1 Sauvola). Paint is not removed.'],
    hisam: ['Hi-SAM', 'Neural text-segmentation mask (SAM-TS-L, 768px windows, logit > −2). Focuses on handwriting and suppresses illustrations.'],
    hisam_raw: ['Hi-SAM soft', 'Unthresholded grayscale probability (sigmoid of logit). Useful for inspecting faint strokes and model confidence without a hard cutoff.'],
    hisam_m4g: ['Hi-SAM best', 'Cleanest AI text mask — Hi-SAM logit > −4 keeping only ink components touching a hand-trained NAFNet (man3) model.'],
    spectral: ['Multispectral (38 bands)', 'Linear discriminant across 38 registered spectral bands — reveals faded or invisible ink on the 10 published multispectral folios.']
  };
  const [inkTitle, inkDesc] = inkMeta[activeInk] || inkMeta.stage1;
  const inkTxt = `<div class="kv-list">
      <div class="kv-row"><span class="kv-k">Folio</span><span class="kv-v">${esc((PG.labels || {}).title || '')}</span></div>
      <div class="kv-row"><span class="kv-k">Active layer</span><span class="kv-v"><b style="color:var(--ac)">${inkTitle}</b></span></div>
    </div>
    <div class="eva-box" style="margin-top:8px"><div class="keys" style="color:var(--tx-dim)">${inkDesc}</div></div>
    <div class="keys" style="margin-top:8px">Click <b>⇄ Compare</b> (or <kbd>C</kbd>) to drag a split curtain between the raw parchment and this ink layer.</div>` +
    methodBox('All available sources on this folio',
      ['stage1', 'hisam', 'hisam_raw', 'hisam_m4g', 'spectral'].filter(k => (E.ink || []).includes(k)).map(k => `<div style="margin-bottom:4px"><b>${inkMeta[k][0]}:</b> ${inkMeta[k][1]}</div>`).join(''));
  $('prov').innerHTML = VIEW === 'pages' ? provHtml(PG) : VIEW === 'lines' ? linesHtml() : VIEW === 'ink' ? inkTxt : VIEW === 'marks' ? marksHtml() : VIEW === 'draw' ? DR.provHtml() : allHtml();
}
function allHtml() {
  const hr = '<hr style="border:none;border-top:1px solid var(--bd);margin:12px 0">';
  return linesHtml() + hr + marksHtml() + hr + provHtml(PG) + hr + (typeof DR !== 'undefined' ? DR.summaryHtml() : '');
}

function setView(v) {
  VIEW = v; lsSet('lastView', v);
  if (v !== 'pages' && editing) { editing = false; sel = null; drawHole = null }
  if (v !== 'lines' && LE.on) lineEdit(false);
  if (v !== 'draw' && typeof DR !== 'undefined' && DR.isOn()) DR.setOn(false);
  if (!canWipe()) WIPE.on = false;
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
  $('b-edit').style.display = v === 'pages' ? '' : 'none';
  $('lb-edit').style.display = v === 'lines' ? '' : 'none';
  $('mkopt').style.display = v === 'marks' || v === 'all' ? '' : 'none';
  $('allopt').style.display = v === 'all' ? '' : 'none';
  sidePanel(v === 'all');
  $('pgopt').style.display = v === 'pages' ? '' : 'none';
  $('lnopt').style.display = v === 'lines' ? '' : 'none';
  $('dropt').style.display = v === 'draw' ? '' : 'none';
  $('dtools').style.display = v === 'draw' ? '' : 'none';
  $('dbox').style.display = v === 'draw' ? '' : 'none';
  syncNextUnrevBtn();
  setFilters(); renderList(); renderProv(); refresh();
}
document.querySelectorAll('#tabs button').forEach(b => b.onclick = () => setView(b.dataset.v));

function provHtml(pg) {
  const p = pg.provenance, L = pg.labels || {};
  const rows = [
    ['Folio', (L.title || '') + (L.position ? ' · ' + L.position : '')],
    ['Boundary', `<span class="badge src-${p.boundary_source}">${SRC_SHORT[p.boundary_source] || p.boundary_source}</span> <span class="keys">${esc(SRC[p.boundary_source] || p.boundary_source)}</span>`],
    ['Status', esc(p.status)],
    ['Holes', `${pg.holes.length} · <span class="keys">${esc(HSRC[p.holes_source] || p.holes_source || '—')}</span>`]
  ];
  if (p.opus_confidence) rows.push(['Confidence', esc(p.opus_confidence)]);
  if (p.human_note) rows.push(['Human note', esc(p.human_note)]);
  if (p.saved_at) rows.push(['Saved', `<span class="nowrap">${esc(p.saved_at)}</span>`]);
  let out = '<div class="kv-list">' + rows.map(([k, v]) => `<div class="kv-row"><span class="kv-k">${k}</span><span class="kv-v">${v}</span></div>`).join('') + '</div>';
  if (p.opus_note) out += methodBox('AI boundary note (Claude Opus)', esc(p.opus_note));
  return out;
}

// ---------- Left Navigator: Sections, Filters & Next Unreviewed ----------
function renderSecPills() {
  $('sec-pills').innerHTML = SECS.map(([k, lbl, col]) =>
    `<button class="sec-pill${activeSec === k ? ' on' : ''}" data-sec="${esc(k)}" type="button">${k && !k.startsWith('__') ? `<span style="width:6px;height:6px;border-radius:50%;background:${col};flex-shrink:0"></span>` : ''}${lbl}</button>`
  ).join('');
  $('sec-pills').querySelectorAll('[data-sec]').forEach(b => b.onclick = () => {
    activeSec = b.dataset.sec;
    renderSecPills();
    renderList();
  });
}

function syncNextUnrevBtn() {
  const b = $('b-next-unrev');
  const labels = {
    pages: 'Next AI draft →',
    draw: 'Next unreviewed →',
    lines: 'Next unreviewed →',
    marks: 'Next unclear →',
    ink: 'Next spectral →',
    all: 'Next foldout →'
  };
  b.textContent = labels[VIEW] || 'Next →';
}
$('b-next-unrev').onclick = () => {
  const pred = p => {
    if (VIEW === 'pages') return p.boundary_source === 'opus';
    if (VIEW === 'draw') return p.drawing === 'ai-start';
    if (VIEW === 'lines') return nHuman(p) === 0 && (p.lines || 0) > 0;
    if (VIEW === 'marks') return !!(p.marks_by_type || {}).unclear || !!(p.marks_by_type || {}).ai_unreviewed;
    if (VIEW === 'ink') return (p.ink || []).includes('spectral');
    return p.kind === 'foldout panel';
  };
  const start = Math.max(0, INDEX.findIndex(p => E && p.image === E.image));
  for (let step = 1; step <= INDEX.length; step++) {
    const cand = INDEX[(start + step) % INDEX.length];
    if (pred(cand)) { goToImage(cand.image); return; }
  }
};

const FLT = {
  pages: [['', 'All statuses'], ['panel', 'Foldout panels'], ['opus', 'Needs review (AI draft)'], ['opus+human-checked', 'Verified by human'],
          ['opus+human-corrected', 'Corrected by human'], ['human', 'Marked by human'], ['holes', 'Pages with holes'], ['unclear', 'Status: unclear'], ['mine', 'Edited by me']],
  lines: [['', 'All pages'], ['panel', 'Foldout panels'], ['l-human', 'Human-reviewed lines'], ['l-unclear', 'Some lines unclear'], ['l-none', 'No row lines'],
          ['r-noz', 'Has rows without ZL match'], ['r-weak', 'Has weak ZL agreement'], ['r-ring', 'Pages with text rings']],
  ink: [['', 'All pages'], ['panel', 'Foldout panels'], ['spectral', 'Multispectral ink (38-band)'], ['hisam', 'AI Text ink (Hi-SAM)']],
  marks: [['', 'All pages'], ['m-any', 'Pages with objects'], ['m-unclear', 'Objects still unclear'], ['m-ai', 'Unreviewed AI finds'], ['g:hidden', 'Under paint & show-through'], ['g:numbers', 'Folio & quire numbers'], ['g:notes', 'Later notes & marginalia'], ['g:alphabets', 'Alphabet columns'], ['g:red', 'Red symbols & spots'], ['g:other', 'Other marks'], ...Object.keys(MCOL).map(k => ['m:' + k, 'Type: ' + (k === 'red_spot' ? 'red spot' : k.replace('_', ' '))])],
  all: [['', 'All pages'], ['panel', 'Foldout panels'], ['holes', 'Pages with holes'], ['l-human', 'Human-reviewed lines']],
  draw: [['', 'Pages with illustrations'], ['d:ai-start', 'Needs review (AI only)'], ['d:human', 'Finished by human'], ['d:human-rough', 'Human (approximate)'], ['d:human-partial', 'Partly corrected'], ['d-mine', 'Edited by me'], ['d-all', 'All pages']]
};
function setFilters() { const keep = $('flt').value; $('flt').innerHTML = FLT[VIEW].map(([v, t]) => `<option value="${v}">${t}</option>`).join('');
  $('flt').value = FLT[VIEW].some(([v]) => v === keep) ? keep : '' }
const nHuman = p => { const s = p.lines_by_status || {}; return (s.human_confirmed || 0) + (s.human_corrected || 0) + (s.human_drawn || 0) };
function keepPage(p, f) {
  if (!matchSection(p, activeSec)) return false;
  if (!f) return VIEW === 'draw' ? !!p.drawing : true;
  if (f === 'd-all') return true;
  if (f.startsWith('d:')) return p.drawing === f.slice(2);
  if (f === 'd-mine') return !!lsGet('draw:' + p.image);
  if (f === 'panel') return p.kind === 'foldout panel';
  if (f === 'holes') return p.holes > 0;
  if (f === 'unclear') return p.status === 'unclear';
  if (f === 'mine') return !!lsGet('edit:' + p.image);
  if (f === 'hisam') return (p.ink || []).includes('hisam');
  if (f === 'spectral') return (p.ink || []).includes('spectral');
  if (f === 'm-any') return p.marks > 0;
  if (f === 'm-unclear') return !!(p.marks_by_type || {}).unclear;
  if (f.startsWith('m:')) return !!(p.marks_by_type || {})[f.slice(2)];
  if (f.startsWith('g:')) return Object.keys(p.marks_by_type || {}).some(t => MGROUP_OF[t] === f.slice(2));
  if (f === 'r-noz') return ((p.rows_by_status || {}).no_zl || 0) > 0;
  if (f === 'r-weak') return ((p.rows_by_status || {}).weak || 0) > 0;
  if (f === 'r-ring') return (p.rings || 0) > 0;
  if (f === 'm-ai') return !!(p.marks_by_type || {}).ai_unreviewed;
  if (f === 'l-human') return nHuman(p) > 0;
  if (f === 'l-unclear') return (p.lines_by_status || {}).unclear > 0;
  if (f === 'l-none') return !p.lines;
  return p.boundary_source === f;
}

function badge(p) {
  const ob = `<span class="badge src-${p.boundary_source}" title="${esc(SRC[p.boundary_source] || p.boundary_source)}">${SRC_SHORT[p.boundary_source] || p.boundary_source}</span>`;
  const nz = (p.rows_by_status || {}).no_zl || 0, nh = nHuman(p);
  const lb = `<span class="badge ${nh ? 'b-ok' : 'b-ln'}" title="${p.rows || 0} reading rows · ${p.lines || 0} line segments${nh ? ` · ${nh} verified` : ''}${nz ? ` · ${nz} new/no ZL` : ''}">${p.rows || p.lines || 0} rows${nh ? ' ✓' : ''}</span>`;
  if (VIEW === 'draw') return p.drawing ? `<span class="badge dsrc-${p.drawing}">${{'human': 'Human', 'human-rough': 'Human ≈', 'human-partial': 'Partial', 'ai-start': 'AI draft'}[p.drawing]}</span>${lsGet('draw:' + p.image) ? ' <span class="mine" title="Edited by you">✎</span>' : ''}` : '';
  if (VIEW === 'all') return `<span style="display:inline-flex;gap:3px;align-items:center">${p.drawing ? `<span class="badge dsrc-${p.drawing}" title="Drawing mask">✿</span>` : ''}${p.marks ? `<span class="badge b-obj" title="${p.marks} objects">${p.marks}</span>` : ''}<span class="badge src-${p.boundary_source}" title="${p.rows || 0} rows">${p.rows || 0}</span></span>`;
  if (VIEW === 'marks') return p.marks ? `<span class="badge b-obj">${p.marks} mark${p.marks > 1 ? 's' : ''}${(p.marks_by_type || {}).unclear ? ' ?' : ''}</span>` : '';
  if (VIEW === 'ink') {
    const hasSpec = (p.ink || []).includes('spectral'), hasHisam = (p.ink || []).includes('hisam');
    return `<span class="badge ${hasSpec ? 'b-ink-spec' : 'b-ink'}" title="${hasSpec ? 'Includes 38-band multispectral ink map' : 'Simple ink + AI Hi-SAM ink'}">${hasSpec ? '38-band' : hasHisam ? 'Hi-SAM' : 'Simple ink'}</span>`;
  }
  return VIEW === 'pages' ? ob : VIEW === 'lines' ? lb : ob;
}

// scan number in the Beinecke series (our scan files 003.jpg ...): #179; a foldout panel cut from one scan: #121.2
// (2026-11-28, owner; replaces PR #3 by iandifilippo: the two f101v images had one link)
function pnum(p) { const [s, part] = p.image.split('_'); return String(parseInt(s, 10)) + (part && part[0] === 'P' ? '.' + (parseInt(part.slice(1), 10) + 1) : '') }
let SEARCH = {}; const PTEXT = {};   // data/search.json: ZL text, loci and objects per page (full-text search)
function pageText(p) { return PTEXT[p.image] || (PTEXT[p.image] = [p.folio, '#' + pnum(p), p.image, p.title, p.section, p.kind, SEARCH[p.image]].filter(Boolean).join(' ').toLowerCase()) }
function matchQuery(p, q) { return !q || q.split(/\s+/).filter(Boolean).every(w => pageText(p).includes(w)) }
function findPage(list, want) {   // a link: scan number (#179, #121.2, also 003), image id, or folio (old links)
  want = (want || '').replace(/^#/, ''); const m = want.match(/^0*(\d+)(?:\.(\d+))?$/);
  if (m) { const k = list.findIndex(p => pnum(p) === m[1] + (m[2] ? '.' + m[2] : '')); if (k >= 0) return k;
    if (!m[2]) { const k2 = list.findIndex(p => pnum(p) === m[1] + '.1'); if (k2 >= 0) return k2 } }
  let k = list.findIndex(p => p.image === want); if (k < 0) k = list.findIndex(p => p.folio === want); return k }

function renderList() {
  const f = $('flt').value;
  const q = ($('qsearch').value || '').trim().toLowerCase();
  $('qsearch-x').classList.toggle('show', !!q);
  pages = INDEX.filter(p => keepPage(p, f) && matchQuery(p, q));
  $('list').innerHTML = pages.map((p, i) => {
    const edited = lsGet('edit:' + p.image) || lsGet('edit-lines:' + p.image) || lsGet('draw:' + p.image);
    const sm = SEC_META[p.section] || {lbl: p.section || '', col: '#948d81'};
    return `<div class="pitem${E && p.image === E.image ? ' cur' : ''}" data-i="${i}" role="option" aria-selected="${E && p.image === E.image ? 'true' : 'false'}" title="${esc(p.folio + ' #' + pnum(p) + (p.title ? ' — ' + p.title : ''))}">
      <span class="pitem-left"><span class="sec-dot" style="background:${sm.col}" title="${esc(sm.lbl)}"></span><span class="pfolio">${esc(p.folio)}</span><span class="pnum" title="scan number in the Beinecke series">#${pnum(p)}</span>${p.holes ? `<span class="phole" title="${p.holes} parchment hole${p.holes > 1 ? 's' : ''}">⬡${p.holes}</span>` : ''}${edited ? '<span class="mine" title="Edited in this browser">✎</span>' : ''}</span>
      ${badge(p)}
    </div>`;
  }).join('') || '<div class="keys" style="padding:12px 6px;text-align:center">No matching folios</div>';
  document.querySelectorAll('#list .pitem[data-i]').forEach(d => d.onclick = () => { go(+d.dataset.i); if (isMobile()) closeMobileDrawers(); });
  cur = E ? pages.findIndex(p => p.image === E.image) : -1;
  $('prog').textContent = pages.length === INDEX.length ? `${INDEX.length} pages` : `${pages.length} of ${INDEX.length}`;

  const showBanner = !!E && cur < 0;
  $('out-filter-banner').classList.toggle('show', showBanner);
  if (showBanner) $('out-filter-msg').textContent = `Viewing ${E.folio} (outside current filter)`;
  $('b-prev').disabled = cur <= 0;
  $('b-next').disabled = cur < 0 || cur >= pages.length - 1;
}

$('flt').onchange = () => { renderList(); if (cur < 0 && pages.length) go(0) };
$('qsearch').oninput = () => renderList();
$('qsearch-x').onclick = () => { $('qsearch').value = ''; renderList(); $('qsearch').focus(); };
$('b-show-all').onclick = () => { activeSec = ''; $('qsearch').value = ''; $('flt').value = VIEW === 'draw' ? 'd-all' : ''; renderSecPills(); renderList(); };

async function goToImage(imgId) {
  let idx = pages.findIndex(p => p.image === imgId);
  if (idx < 0) {
    activeSec = ''; $('qsearch').value = ''; $('flt').value = VIEW === 'draw' ? 'd-all' : '';
    renderSecPills(); renderList();
    idx = pages.findIndex(p => p.image === imgId);
  }
  if (idx >= 0) go(idx);
}

async function go(i) {
  if (i < 0 || i >= pages.length) return;
  E = pages[i]; cur = i;
  const pg = await (await fetch(`data/pages/${E.image}.json`, {cache: 'no-cache'})).json();
  try { const LD = await (await fetch(`data/lines/${E.image}.json`, {cache: 'no-cache'})).json(); LINES = LD.lines; LXH = LD.xheight || 18 } catch (e) { LINES = []; LXH = 18 }
  linesLoaded(); INKT = {}; MSEL = -1; MHOV = -1; MK = {objects: [], not_found: []}; ROWS = {rows: [], lines_not_in_rows: []}; ROWOF = []; RSEL = -1; RHOV = -1; trFilter = 'all';
  try { const r = await fetch(`data/rows/${E.image}.json`, {cache: 'no-cache'}); if (r.ok) ROWS = await r.json() } catch (e) {}
  ROWS.rows.forEach((r, k) => r.pieces.forEach(pc => ROWOF[pc.i] = k));
  if (E.marks) try { const r = await fetch(`data/marks/${E.image}.json`, {cache: 'no-cache'}); if (r.ok) MK = await r.json() } catch (e) {}   // pages without objects have no file (no 404)
  (E.ink || []).forEach(k => { const im = new Image(); im.onload = () => { const c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
    const g = c.getContext('2d'); g.drawImage(im, 0, 0); g.globalCompositeOperation = 'source-in'; g.fillStyle = '#121110'; g.fillRect(0, 0, c.width, c.height);
    INKT[k] = c; draw() }; im.src = `img/ink_${k}/${E.image}.png` });
  if (typeof DR !== 'undefined') DR.load();
  PUB = stateFromPage(pg); const ed = lsGet('edit:' + E.image);
  S = ed ? stateFromPage({boundary: ed, holes: ed.holes}) : JSON.parse(JSON.stringify(PUB)); $('note').value = ed && ed.note || '';
  undo = []; redo = []; sel = null; selHole = -1; drawHole = null;
  $('folio-code').textContent = E.folio;
  $('task').innerHTML = `<span class="pnum">#${pnum(E)}</span>` + (E.title ? ' · ' + esc(E.title) : '');
  $('folio-pill').title = `${E.folio} #${pnum(E)}${E.title ? ' — ' + E.title : ''} (Click to open Atlas)`;
  PG = pg; renderProv();
  history.replaceState(null, '', '#' + pnum(E));
  VG.ready.then(() => { renderProv(); draw() });
  imgCache = {washed: null, hiCon: null};
  WIPE.cache = null;
  img = new Image(); img.onload = () => { imgCache = {washed: null, hiCon: null}; fit(); refresh() }; img.src = E.display.file;
  renderList();
  const activeItem = document.querySelector('#list .pitem.cur');
  if (activeItem) activeItem.scrollIntoView({block: 'nearest'});
  refresh();
}
window.addEventListener('resize', () => { if (!isMobile()) closeMobileDrawers(); syncPanelBtns(); fit(); });

(async () => {
  INDEX = await (await fetch('data/index.json', {cache: 'no-cache'})).json();
  renderSecPills();
  const savedV = lsGet('lastView');
  VIEW = TABS.includes(savedV) ? savedV : 'lines'; // Start on Read & Lines so visitors immediately see Voynich OCR + live transcript!
  setView(VIEW);
  syncSliderLabels();
  const want = decodeURIComponent(location.hash.slice(1));
  let k = findPage(pages, want);
  if (k < 0 && want) { activeSec = ''; $('qsearch').value = ''; renderSecPills(); renderList(); k = findPage(pages, want) }
  fetch('data/search.json', {cache: 'no-cache'}).then(r => r.ok ? r.json() : {}).then(j => { SEARCH = j; for (const x in PTEXT) delete PTEXT[x]; if ($('qsearch').value) renderList() }).catch(() => {});
  // If landing fresh with no hash, open f7r (iconic herbal folio with text, drawing, and objects) or f1r? Wait: f1r is folio 1 (classic opening) and has 28 full text rows + 13 marginalia objects + 27 holes + multispectral ink!
  go(k >= 0 ? k : 0);
})();

// ---------- Row-Line Editing (with Undo + Redo + Floating Action Pill) ----------
let LW = null, LXH = 18; const LE = {on: false, mode: 'sel', sel: -1, drag: -1, draw: [], undo: [], redo: []};
function sparse(P, step) { const o = [P[0]]; let acc = 0; for (let i = 1; i < P.length; i++) { acc += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]);
  if (acc >= step) { o.push(P[i]); acc = 0 } } if (o.at(-1) !== P.at(-1)) o.push(P.at(-1)); return o.map(p => p.slice()) }
function lrebuild(l) { l.pts = l.ctrl.length > 2 ? catmull(l.ctrl, 8) : l.ctrl.map(p => p.slice()) }
function linesLoaded() {
  const ed = lsGet('edit-lines:' + E.image); LW = null; LE.sel = -1; LE.draw = []; LE.undo = []; LE.redo = [];
  if (!ed && !LE.on) return; LW = LINES.map(l => ({...l, pts: l.pts.map(p => p.slice())}));
  if (!ed) return;
  (ed.deleted || []).forEach(i => { if (LW[i]) LW[i].deleted = true });
  Object.entries(ed.changed || {}).forEach(([i, c]) => { if (LW[i]) Object.assign(LW[i], {pts: c.pts, ctrl: c.ctrl, status: c.status, changed: true}) });
  (ed.added || []).forEach(a => LW.push({...a, added: true})) }
function lpersist() { const ed = {image: E.image, folio: E.folio, scan: E.scan, coords: 'scan pixels', deleted: [], changed: {}, added: [], edited_at: new Date().toISOString()};
  LW.forEach((l, i) => { if (l.added) { if (!l.deleted) ed.added.push({pts: l.pts, ctrl: l.ctrl, status: l.status, source: 'human (site)'}) }
    else if (l.deleted) ed.deleted.push(i); else if (l.changed) ed.changed[i] = {pts: l.pts, ctrl: l.ctrl, status: l.status} });
  const empty = !ed.deleted.length && !ed.added.length && !Object.keys(ed.changed).length; lsSet('edit-lines:' + E.image, empty ? null : ed); renderList(); countLocalEdits(); lrender() }
function updateLineHint() {
  if (VIEW !== 'lines') return;
  $('hint').textContent = !LE.on
    ? 'Hover or click any row in the transcript or scan'
    : LE.mode === 'sel' ? 'Select: click line, drag squares · Del deletes · Space+drag pans'
    : LE.mode === 'spl' ? 'Spline: click points along row · Enter finishes · Space+drag pans'
    : 'Straight: click start and end · Space+drag pans';
}
function lineEdit(on) {
  LE.on = on;
  document.body.classList.toggle('ledit', on);
  $('lb-edit').classList.toggle('on', on);
  $('lb-edit').textContent = on ? '✓ Done editing' : '✎ Edit lines';
  if (on && !LW) LW = LINES.map(l => ({...l, pts: l.pts.map(p => p.slice())}));
  LE.sel = -1; LE.draw = []; setDrawAction(null); lrender(); updateLineHint(); draw();
}
function lmode(m) { LE.mode = m; LE.draw = []; ['sel', 'spl', 'str'].forEach(k => $('lm-' + k).classList.toggle('on', k === m)); setDrawAction(null); lrender(); updateLineHint(); draw() }
function lsnap() { LE.undo.push(JSON.stringify(LW)); if (LE.undo.length > 100) LE.undo.shift(); LE.redo = []; }
function ldoUndo() { if (LE.undo.length) { LE.redo.push(JSON.stringify(LW)); LW = JSON.parse(LE.undo.pop()); LE.sel = -1; lpersist(); draw() } }
function ldoRedo() { if (LE.redo.length) { LE.undo.push(JSON.stringify(LW)); LW = JSON.parse(LE.redo.pop()); LE.sel = -1; lpersist(); draw() } }
$('lb-undo').onclick = ldoUndo;
$('lb-redo').onclick = ldoRedo;

function lrender() {
  $('lb-undo').disabled = !LE.undo.length;
  $('lb-redo').disabled = !LE.redo.length;
  if (!LE.on) { setDrawAction(null); return; }
  if (LE.draw.length) {
    setDrawAction(
      LE.mode === 'spl' ? `Spline · ${LE.draw.length} pt${LE.draw.length > 1 ? 's' : ''}` : 'Straight line · 1 pt',
      LE.mode === 'spl' && LE.draw.length >= 2 ? lfinish : null,
      () => { LE.draw.pop(); lrender(); draw(); },
      () => { LE.draw = []; lrender(); draw(); }
    );
  } else setDrawAction(null);
  const l = LW && LW[LE.sel];
  $('lsel').innerHTML = l ? `Selected line #${LE.sel + 1}: ${LNAME[l.status] || l.status}${l.changed ? ' · edited' : ''}${l.added ? ' · new' : ''}` :
    (LE.mode === 'sel' ? 'Click a line on the scan to select it' : LE.mode === 'spl' ? `Spline: ${LE.draw.length} points` : 'Straight: click two points');
  $('lb-submit').disabled = !window.REPO || !lsGet('edit-lines:' + E.image);
  updateLineHint();
}
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
  LW.push({ctrl: c, pts: c.length > 2 ? catmull(c, 8) : c, status: 'human_drawn', source: 'human (site)', added: true}); LE.sel = LW.length - 1; lpersist() } LE.draw = []; lrender(); draw() }
cv.addEventListener('mousedown', e => { if (!LE.on) return;
  if (e.button === 1 || window.spaceDown) { drag = {pan: 1, x: e.offsetX, y: e.offsetY, vx: view.x, vy: view.y}; if (window.spaceDown) document.body.classList.add('panning'); e.stopImmediatePropagation(); return }
  e.stopImmediatePropagation(); const x = e.offsetX, y = e.offsetY;
  if (e.button === 2) { const k = lctrlAt(x, y); if (k >= 0) { const l = LW[LE.sel]; if (l.ctrl.length <= 2) return; lsnap(); l.ctrl.splice(k, 1); lrebuild(l); l.changed = true; lpersist(); draw() } return }
  if (LE.mode === 'spl') { LE.draw.push(scanAt(x, y)); lrender(); draw(); return }
  if (LE.mode === 'str') { LE.draw.push(scanAt(x, y)); if (LE.draw.length === 2) lfinish(); else { lrender(); draw(); } return }
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
window.addEventListener('keydown', e => { if (!LE.on || isTextTarget(e.target)) return; const k = e.key.toLowerCase();
  if (k === ' ' || k === 'v' || k === 'arrowleft' || k === 'arrowright' || k === 'f') return;
  e.stopImmediatePropagation();
  if (e.ctrlKey && (k === 'z' || k === 'я') && !e.shiftKey) { ldoUndo(); e.preventDefault(); return }
  if (e.ctrlKey && (k === 'y' || k === 'н' || ((k === 'z' || k === 'я') && e.shiftKey))) { ldoRedo(); e.preventDefault(); return }
  if (k === 'enter') { if (LE.mode === 'spl') lfinish(); return }
  if (k === 'escape') { if (LE.draw.length || LE.sel >= 0) { LE.draw = []; LE.sel = -1; lrender(); draw(); } else lineEdit(false); return }
  if ((k === 'delete' || k === 'backspace') && LE.sel >= 0) { lsnap(); LW[LE.sel].deleted = true; LE.sel = -1; lpersist(); draw(); e.preventDefault(); return }
  if (k === 'u' && LE.sel >= 0) { lsnap(); const l = LW[LE.sel]; l.status = l.status === 'unclear' ? 'human_confirmed' : 'unclear'; l.changed = true; lpersist(); draw(); return }
  if (k === 's') lmode('sel'); else if (k === 'p') lmode('spl'); else if (k === 'l') lmode('str') }, true);
$('lb-edit').onclick = () => lineEdit(!LE.on); $('lm-sel').onclick = () => lmode('sel'); $('lm-spl').onclick = () => lmode('spl'); $('lm-str').onclick = () => lmode('str');
$('lb-reset').onclick = () => { if (!confirm('Drop your line edits of this page?')) return; lsSet('edit-lines:' + E.image, null);
  LW = LINES.map(l => ({...l, pts: l.pts.map(p => p.slice())})); LE.sel = -1; LE.undo = []; LE.redo = []; renderList(); countLocalEdits(); lrender(); draw() };
$('lb-download').onclick = () => { const all = INDEX.map(p => lsGet('edit-lines:' + p.image)).filter(Boolean); if (!all.length) { alert('No line edits in this browser.'); return }
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify({format: 'voynich-row-lines/edit-1', coords: 'scan pixels', pages: all}, null, 1)], {type: 'application/json'}));
  a.download = `row-line-edits-${all.length}.json`; a.click() };
$('lb-submit').onclick = () => { const ed = lsGet('edit-lines:' + E.image); if (!ed || !window.REPO) return;
  const slim = {...ed, changed: Object.fromEntries(Object.entries(ed.changed).map(([i, c]) => [i, {ctrl: c.ctrl, status: c.status}])), added: ed.added.map(a => ({ctrl: a.ctrl, status: a.status}))};
  const body = 'Row-line edit from the site (control points; each line is a Catmull-Rom spline through them).\n\n```json\n' +
    JSON.stringify({format: 'voynich-row-lines/edit-1', coords: 'scan pixels', pages: [slim]}) + '\n```\n';
  if (body.length > 7000) { alert('This edit is too large for a GitHub issue link. Please use "Download edits" and attach the file to an issue.'); return }
  window.open(`https://github.com/${window.REPO}/issues/new?labels=lines-edit&title=${encodeURIComponent('[lines] ' + E.folio + ' (' + E.image + ')')}&body=${encodeURIComponent(body)}`, '_blank') };

document.querySelectorAll('input[name=inksrc]').forEach(r => r.onchange = () => { if (VIEW === 'ink') renderProv(); draw(); });
$('l-inklines').onchange = draw;

// ---------- Objects / Marginalia ----------
const MGROUPS = [
  ['numbers', 'Numbers', 'Folio and quire numbers', '#4ea1ff', ['folio_number', 'quire_mark']],
  ['notes', 'Notes', 'Later notes: pencil, colour notes, months, marginalia, ex libris, scribbles', '#ff8fd0', ['pencil_letter', 'colour_note', 'marginalia', 'month_name', 'ex_libris', 'scribble']],
  ['alphabets', 'Alphabets', 'Alphabets / key-like columns', '#00e5ff', ['alphabet_column']],
  ['red', 'Red', 'Red ticks (GC birds) and red spots', '#ff2d55', ['red_tick', 'red_spot']],
  ['hidden', 'Under paint', 'Under paint and show-through (AI finds; opposite side of leaf)', '#ffb340', ['under_paint', 'show_through']],
  ['other', 'Other', 'Voynich writing outside transliterations, dirt, other', '#ff4fd8', ['voynich_text', 'dirt', 'other']]
];
const MGROUP_OF = Object.fromEntries(MGROUPS.flatMap(([g, , , , ts]) => ts.map(t => [t, g])));
let MSYM = null;
const mshape = o => o.poly && o.poly.length > 2 ? o.poly : [[o.bbox[0], o.bbox[1]], [o.bbox[2], o.bbox[1]], [o.bbox[2], o.bbox[3]], [o.bbox[0], o.bbox[3]]];
const esc = t => String(t || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const mshown = o => { const c = $('mg-' + (MGROUP_OF[o.type] || 'other')); return !c || c.checked };
const mnames = () => $('mk-names').checked;
function mlabel(s, t, col, on, right, eva) {
  const g = eva && !/[a-z]{6,}/.test(t) ? t.replace(/[^a-z]/g, '') : '', tt = g ? `(Eva ${t})` : t;
  ctx.font = '16px EVA2'; const gw = g ? ctx.measureText(g).width + 4 : 0; ctx.font = '600 11px Inter,system-ui,sans-serif';
  const w = gw + ctx.measureText(tt).width + 8, h = g ? 20 : 16, x = right ? s[0] - w - 2 : s[0];
  ctx.fillStyle = on ? '#ffffff' : col;
  ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, s[1] - h - 1, w, h, 3); else ctx.rect(x, s[1] - h - 1, w, h); ctx.fill();
  ctx.fillStyle = '#0c0b0a';
  if (g) { ctx.font = '16px EVA2'; ctx.fillText(g, x + 4, s[1] - 5); ctx.font = '600 11px Inter,system-ui,sans-serif' } ctx.fillText(tt, x + 4 + gw, s[1] - 5) }
function drawMarks(line) { const all = VIEW === 'all';
  MK.objects.forEach((o, i) => { if (!mshown(o)) return; const on = i === MSEL || i === MHOV, col = MCOL[o.type] || '#ffffff', p = mshape(o).map(s2d), sy = o.symbols;
    if (on && !sy) { ctx.beginPath(); p.forEach((q, k) => { const s = toScr(q); k ? ctx.lineTo(...s) : ctx.moveTo(...s) }); ctx.closePath(); ctx.fillStyle = col + '30'; ctx.fill() }
    if (sy) { ctx.globalAlpha = on ? .9 : .55; line(p, on ? '#ffffff' : col, 1, true, o.status === 'unclear' ? [6, 4] : null); ctx.globalAlpha = 1;
      sy.forEach((y, k) => { const a = s2d([y.bbox[0], y.bbox[1]]), b = s2d([y.bbox[2], y.bbox[3]]), hov = MSYM && MSYM[0] === i && MSYM[1] === k;
        line([a, [b[0], a[1]], b, [a[0], b[1]]], hov ? '#ffffff' : col, hov ? 2.5 : 1.4, true, y.status === 'unclear' ? [4, 3] : null);
        const tall = (b[1] - a[1]) * view.z >= 10;
        if (hov || ((mnames() || on) && tall && !all)) mlabel(toScr([a[0], b[1]]), y.label, col, hov, o.text.startsWith('col 1'), o.symbol_script === 'EVA') }) }
    else line(p, on ? '#ffffff' : col, all ? 1.2 : on ? 3 : 2, true, o.status === 'unclear' ? [6, 4] : null);
    if (on || (mnames() && !all)) mlabel(toScr(s2d([o.bbox[0], o.bbox[1]])), o.type_label + (o.status === 'unclear' ? ' ?' : ''), col, on) }) }
function mpick(x, y) { if (VIEW === 'all' && !$('a-marks').checked) return -1; const t = d2s(toImg(x, y)), pad = 6 / view.z / D().scale; let best = -1, ba = Infinity, sym = null;
  const inb = b => t[0] >= b[0] - pad && t[0] <= b[2] + pad && t[1] >= b[1] - pad && t[1] <= b[3] + pad;
  MK.objects.forEach((o, i) => { if (!mshown(o)) return; const b = o.bbox, a = (b[2] - b[0]) * (b[3] - b[1]);
    (o.symbols || []).forEach((y, k) => { const c = y.bbox, ca = (c[2] - c[0]) * (c[3] - c[1]); if (inb(c) && ca < ba) { ba = ca; best = i; sym = [i, k] } });
    const inside = o.poly && o.poly.length > 2 ? inPoly(t, o.poly) : inb(b);
    if (inside && a < ba) { ba = a; best = i; sym = null } }); MSYM = sym; return best }
function mscroll() { const c = document.querySelector('.mk.cur'); if (c) c.scrollIntoView({block: 'nearest', behavior: 'smooth'}) }
function mfocus(i) { const o = MK.objects[i]; if (!o) return; MSEL = i; const r = cv.getBoundingClientRect(), a = s2d([o.bbox[0], o.bbox[1]]), b = s2d([o.bbox[2], o.bbox[3]]);
  const w = Math.max(b[0] - a[0], 20), h = Math.max(b[1] - a[1], 20), z = Math.min(r.width * .45 / w, (r.height - 50) * (o.symbols ? .85 : .45) / h, 6);
  if (VIEW === 'all') setInspTab('info'); renderProv(); mscroll();
  animateView({z, x: r.width / 2 - (a[0] + w / 2) * z, y: (r.height - 50) / 2 - (a[1] + h / 2) * z}); }

function marksHtml() {
  const O = MK.objects, hidden = O.filter(o => !mshown(o)).length;
  const selectedHtml = (MSEL >= 0 && O[MSEL] && mshown(O[MSEL])) ? `<div class="mk cur" data-m="${MSEL}" style="margin-top:0;margin-bottom:8px">${mdetail(O[MSEL])}</div>` : '';
  const items = O.map((o, i) => (!mshown(o) || i === MSEL) ? '' : `<div class="mk" data-m="${i}">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:6px">
      <span><span style="color:${MCOL[o.type] || '#fff'};font-weight:700">■</span> <b style="color:var(--tx)">${esc(o.type_label)}</b></span>
      <span class="badge" style="${o.status === 'unclear' ? 'background:rgba(236,72,153,.2);color:#f9a8d4' : o.status.startsWith('AI') ? 'background:rgba(242,169,59,.2);color:#fcd34d' : 'background:rgba(70,201,122,.16);color:#7ee3a6'}">${esc(o.status)}</span>
    </div>
    <div class="keys" style="color:var(--tx-dim);margin-top:2px">${VG.auto(o.text)}</div>
    ${o.symbols ? `<div class="keys">${o.symbols.length} symbols (${esc(o.symbol_script)}): ${o.symbols.map(y => { const l = o.symbol_script === 'EVA' ? VG.evaLabel(y.label) : esc(y.label); return y.status === 'unclear' ? `<i>${l}</i>` : l }).join(' · ')}</div>` : ''}
    <div class="keys">by ${esc(o.found_by)} · ${o.reviewed_by === 'owner' ? 'reviewed' : esc(o.reviewed_by)}${o.poly ? ' · outline' : ''}${[].concat(o.evidence || []).map((v, k) => ` · <a style="color:var(--ac)" href="${esc(v)}" target="_blank">evidence${[].concat(o.evidence).length > 1 ? ' ' + (k + 1) : ''}</a>`).join('')}</div></div>`).join('');
  const nf = (MK.not_found || []).map(n => `<div class="keys">• <b>${esc(n.expected)}</b> — ${esc(n.result)}</div>`).join('');
  const method = methodBox('Methodology: objects &amp; marginalia',
    `Non-main-text marks: folio numbers, quire marks, later notes, month names, alphabet columns, red symbols/spots, under-paint AI finds, and show-through from the opposite side of the leaf. Dashed outlines indicate unclear readings.`);
  return selectedHtml +
    `<div class="kv-list" style="margin-bottom:6px">
      <div class="kv-row"><span class="kv-k">Folio</span><span class="kv-v">${esc((PG.labels || {}).title || '')}</span></div>
      <div class="kv-row"><span class="kv-k">Objects</span><span class="kv-v">${O.length}${hidden ? ` <span class="keys">(${hidden} hidden by filter)</span>` : ''}</span></div>
    </div>` +
    (items || (!selectedHtml ? '<div class="keys">No objects marked on this page.</div>' : '')) +
    (nf ? `<div style="margin-top:8px"><b style="color:var(--mu)">Expected but not found</b></div>${nf}` : '') + method;
}
document.addEventListener('click', e => { const d = e.target.closest && e.target.closest('[data-m]'); if (d && !e.target.closest('a') && !e.target.closest('.mkd')) mfocus(+d.dataset.m) });
{ let down = null; cv.addEventListener('mousedown', e => { down = [e.offsetX, e.offsetY] });
  cv.addEventListener('mouseup', e => { if (!down || (VIEW !== 'marks' && VIEW !== 'all') || isAnyEditing()) { down = null; return }
    if (Math.hypot(e.offsetX - down[0], e.offsetY - down[1]) < 4) { MSEL = mpick(e.offsetX, e.offsetY); if (VIEW === 'all' && MSEL >= 0) setInspTab('info'); renderProv(); draw(); mscroll() } down = null });
  cv.addEventListener('mousemove', e => { if ((VIEW !== 'marks' && VIEW !== 'all') || e.buttons) return; const old = JSON.stringify(MSYM), h = mpick(e.offsetX, e.offsetY);
    if (h !== MHOV || JSON.stringify(MSYM) !== old) { MHOV = h; const o = MK.objects[h], y = o && MSYM ? o.symbols[MSYM[1]] : null;
      cv.title = y ? `${o.text.slice(0, 5)} symbol: ${y.label}${y.status === 'unclear' ? ' (unclear)' : ''}` : o ? `${o.type_label} (${o.status}): ${o.text}` : ''; cv.style.cursor = h >= 0 ? 'pointer' : ''; draw() } }) }

{
  const box = $('mkgroups');
  box.innerHTML = MGROUPS.map(([g, shortName, fullDesc, col]) =>
    `<label class="chip-check" title="${esc(fullDesc)}"><input type="checkbox" id="mg-${g}" checked><span class="cdot" style="background:${col}"></span>${shortName}</label>`
  ).join('');
  $('mkleg-content').innerHTML = Object.entries(MCOL).map(([t, c]) =>
    `<span><i style="background:${c}"></i>${t === 'red_spot' ? 'red spot' : t.replace('_', ' ')}</span>`
  ).join('') + `<span><i style="background:none;border:1px dashed #ccc"></i>dashed = unclear</span>`;
  [...MGROUPS.map(([g]) => 'mg-' + g), 'mk-names'].forEach(id => {
    const c = $(id), k = 'opt:' + id, v = lsGet(k);
    if (v !== null) c.checked = v;
    c.onchange = () => { lsSet(k, c.checked); if (MSEL >= 0 && !mshown(MK.objects[MSEL] || {})) MSEL = -1; renderProv(); draw() };
  });
}

['l-con', 'l-fill', 'l-lw', 'l-ink', 'l-bg', 'l-inkon', 'l-pub', 'l-lnink', 'l-lnink-a', 'l-arrows', 'l-bridges', 'l-dircol', 'a-arrows', 'a-dircol', 'a-bg', 'a-page', 'a-draw', 'a-draw-a', 'a-draw-s', 'a-marks', 'a-ink', 'a-ink-a', 'a-inksrc', 'a-lines', 'a-lines-a', 'a-lw'].forEach(id => {
  const c = $(id), k = 'opt:' + id, v = lsGet(k), box = c.type === 'checkbox', rng = c.type === 'range';
  if (v !== null) box ? c.checked = v : c.value = v;
  if (rng) {
    c.addEventListener('input', () => { syncSliderLabels(); allSync(); scheduleDraw(); });
    c.addEventListener('change', () => { lsSet(k, c.value); });
  } else {
    c.addEventListener('change', () => {
      lsSet(k, box ? c.checked : c.value); syncSliderLabels(); allSync(); if (VIEW === 'all') renderProv(); draw();
    });
  }
});
function allSync() { if (typeof DR !== 'undefined') { const s = $('a-draw-s'); if (!s.value) s.value = 'mask'; DR.setAll(s.value, +$('a-draw-a').value) } }

// ---------- Object Detail Card ----------
function mcrop(src, bb, maxW, maxH, padF = .18, white = false) {
  if (!src || (src.complete === false) || !(src.width)) return null;
  const a = s2d([bb[0], bb[1]]), b = s2d([bb[2], bb[3]]), pad = Math.max(4, padF * Math.max(b[0] - a[0], b[1] - a[1]));
  const x0 = Math.max(0, a[0] - pad), y0 = Math.max(0, a[1] - pad), x1 = Math.min(src.width, b[0] + pad), y1 = Math.min(src.height, b[1] + pad), w = x1 - x0, h = y1 - y0;
  if (w < 2 || h < 2) return null; const sc = Math.min(maxW / w, maxH / h, 10), c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * sc)); c.height = Math.max(1, Math.round(h * sc)); const g = c.getContext('2d'); g.imageSmoothingQuality = 'high';
  if (white) { g.fillStyle = '#ffffff'; g.fillRect(0, 0, c.width, c.height) } g.drawImage(src, x0, y0, w, h, 0, 0, c.width, c.height); return c.toDataURL('image/jpeg', .9) }
function mdetail(o) { const W = 310, parts = [];
  const scan = mcrop(img, o.bbox, W, 240); if (scan) parts.push(`<div class="mkd-l">Scan crop</div><img class="mkd-i" src="${scan}">`);
  if (INKT.spectral) { const sp = mcrop(INKT.spectral, o.bbox, W, 240, .18, true); if (sp) parts.push(`<div class="mkd-l">Multispectral ink (38 bands)</div><img class="mkd-i" src="${sp}">`) }
  const tmp = document.createElement('div'); tmp.innerHTML = VG.auto(o.text); const gl = [...tmp.querySelectorAll('.vg')].map(e => e.outerHTML);
  if (gl.length) parts.push(`<div class="mkd-l">Characters named</div><div class="mkd-g">${gl.join(' ')}</div>`);
  if (o.symbols) { const rows = o.symbols.map(y => { const c = mcrop(img, y.bbox, 70, 34, .12);
      const r = o.symbol_script === 'EVA' ? VG.evaLabel(y.label) : esc(y.label);
      return `<div class="mkd-s${y.status === 'unclear' ? ' unc' : ''}">${c ? `<img src="${c}">` : '<span></span>'}<span>${r}</span></div>` }).join('');
    parts.push(`<div class="mkd-l">Symbols (top to bottom)</div><div class="mkd-sy">${rows}</div>`) }
  if (o.status && o.status !== 'confirmed') parts.push(`<div class="mkd-l">Status</div><div class="keys">${esc(o.status)} · found by ${esc(o.found_by)}${o.confidence ? ' · confidence ' + esc(o.confidence) : ''}${o.other_side ? ' · other side: ' + esc(o.other_side) : ''}</div>`);
  if (o.match) parts.push(`<div class="mkd-l">Opposite side match</div><div class="keys">NCC ${o.match.ncc} at shift ${esc(o.match.shift_px.join(', '))} px — ${esc(o.match.how)}</div>`);
  if (o.reasoning) parts.push(`<div class="mkd-l">Reasoning</div><div class="keys">${VG.auto(o.reasoning)}</div>`);
  if (o.summary_ru) parts.push(`<div class="mkd-l">Summary (Russian)</div><div class="keys">${esc(o.summary_ru)}</div>`);
  [].concat(o.evidence || []).forEach((v, k, a) => parts.push(`<div class="mkd-l">Evidence${a.length > 1 ? ' ' + (k + 1) + '/' + a.length : ''}</div><a href="${esc(v)}" target="_blank"><img class="mkd-i" src="${esc(v)}"></a>`));
  return `<div class="mkd"><div class="mk-head"><b style="color:var(--tx)"><span style="color:${MCOL[o.type] || '#fff'}">■</span> ${esc(o.type_label)}</b><button id="mkd-x" class="mk-close" title="Close (Esc)">×</button></div>
    <div class="keys" style="color:var(--tx)">${VG.auto(o.text)}</div>${parts.join('')}</div>` }
document.addEventListener('click', e => { if (e.target.id === 'mkd-x') { MSEL = -1; renderProv(); draw() } });
window.addEventListener('keydown', e => { if (e.key === 'Escape' && (VIEW === 'marks' || VIEW === 'all') && MSEL >= 0 && !editing && !LE.on) { MSEL = -1; renderProv(); draw() } });
