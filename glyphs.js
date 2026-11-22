// voyglyph: draw one Voynich character from a transliteration code (same catalogue as tools/glyphs/voyglyph.py).
// VG.get(scheme, code, {cap}) -> catalogue entry; VG.html(scheme, code, {cap}) -> glyph + "(code)";
// VG.eva(str) -> an Eva string in the Eva font; VG.auto(text) -> escaped text with every "EVA x", "EVA @NNN",
// "GC2a @NNN", "GC NNN", "v101 @NNN", "ZL @NNN" replaced by the glyph followed by the code in brackets.
// Schemes: sta (only the f1r symbols Yx Yy Yz), eva (zl, it, rf), v101 (gc), currier (cd), fsg (fg), bennett. Fonts: Eva-2 (EVA2.ttf) and v101 (voynich.ttf)
// from voynich.nu; where a font has no glyph, a crop of the voynich.nu table or of the scan (data/glyphs.json).
const VG = (() => {
  const st = document.createElement('style');
  st.textContent = `@font-face{font-family:EVA2;src:url(fonts/EVA2.ttf)}@font-face{font-family:v101;src:url(fonts/voynich.ttf)}
.vg{white-space:nowrap}.vg-g{font-size:1.35em;line-height:1;color:var(--tx,#000);vertical-align:-.1em}.vg-i{height:1.7em;vertical-align:-.45em}.vg-t{filter:invert(.9)}.vg-n{vertical-align:middle}
.vg-c{color:var(--mu,#777);font-size:.92em}`;
  document.head.appendChild(st);
  let CAT = {}, HIST = {};
  const ready = fetch('data/glyphs.json', {cache: 'no-cache'}).then(r => r.json()).then(j => { CAT = j.glyphs; HIST = j.hist })
    .then(() => Promise.all(['16px EVA2', '16px v101'].map(f => document.fonts.load(f)))).catch(() => {});
  const esc = t => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const norm = s => ({gc: 'v101', v: 'v101', zl: 'eva', it: 'eva', rf: 'eva', vt: 'eva', cd: 'currier', fg: 'fsg'})[s.toLowerCase()] || s.toLowerCase();
  function get(scheme, code, o = {}) { if (/^sta$/i.test(scheme)) return CAT[`sta:${code}`] || null; const s = norm(scheme), m = String(code).match(/^@?(\d{2,3});?$/);
    if (HIST[s]) { const e = HIST[s][code]; return e ? {kind: 'eva_string', font: 'EVA2', text: e, label: `${scheme} ${code} = Eva ${e}`} : null }
    if (m) return CAT[`${s}:@${+m[1]}`] || null;
    if (s === 'eva' && String(code).length > 1) return {kind: 'font', font: 'EVA2', char: String(code), label: `Eva ${code}`};
    return CAT[`${s}:${o.cap && s === 'eva' ? String(code).toUpperCase() : code}`] || null }
  function glyphHtml(g) { if (!g) return '';
    if (g.kind === 'img') return `<img class="${g.from === 'drawing' ? 'vg-n vg-t' : 'vg-i' + (g.from === 'voynich.nu table' ? ' vg-t' : '')}" src="${esc(g.src)}" alt="${esc(g.label)}" title="${esc(g.label + (g.what ? ' — ' + g.what : ''))}">`;
    return `<span class="vg-g" style="font-family:${g.font}" title="${esc(g.label)}">${esc(g.char || g.text)}</span>` }
  const wrap = (g, code) => `<span class="vg">${glyphHtml(g)} <span class="vg-c">(${esc(code)})</span></span>`;
  function html(scheme, code, o = {}) { const g = get(scheme, code, o); return g ? wrap(g, o.label || `${scheme} ${code}`) : esc(o.label || `${scheme} ${code}`) }
  const eva = str => `<span class="vg-g" style="font-family:EVA2" title="Eva ${esc(str)}">${esc(str)}</span>`;
  function auto(text) { let t = esc(text);
    t = t.replace(/\s*\(v101 glyph \d+\)/g, '');   // said again by the glyph
    t = t.replace(/\b(GC2a|GC|v101)\s?@?(\d{3});?/g, (w, s, n) => { const g = get('v101', n); return g ? wrap(g, `${s} @${n}`) : w });
    t = t.replace(/\b(ZL|EVA|Eva)\s@(\d{3});?/g, (w, s, n) => { const g = get('eva', n); return g ? wrap(g, `${s} @${n}`) : w });
    t = t.replace(/\bSTA\s(Y[a-z])\b/g, (w, k) => { const g = get('sta', k); return g ? wrap(g, `STA ${k}`) : w });
    t = t.replace(/\b(EVA|Eva)\s([a-zA-Z']{1,8})\b/g, (w, s, x) => `<span class="vg">${eva(x)} <span class="vg-c">(${s} ${x})</span></span>`);
    return t }
  function evaLabel(label) {   // alphabet labels in Eva: 'iin', 'a?', 'k? / g?' -> glyphs + (Eva ...); words like 'majuscule' stay text
    if (/[a-z]{6,}/.test(label) || !/[a-z]/.test(label)) return esc(label);
    return `<span class="vg">${esc(label).replace(/[a-z]+/g, x => eva(x))} <span class="vg-c">(Eva ${esc(label)})</span></span>` }
  return {ready, get, html, eva, auto, evaLabel, glyphHtml};
})();
