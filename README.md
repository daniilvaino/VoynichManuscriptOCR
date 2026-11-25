# Voynich page annotations

Layered annotations of the Voynich manuscript (Beinecke MS 408) on its scans, each with who made it and how far it has
been checked:

1. **Page boundaries and holes**: the outline of each page's own leaf (or foldout panel) and the holes in the parchment.
2. **Row lines**: a line along the middle of every row of text, including curved, circular and radial rows and labels.
3. **Ink**: masks of the ink on every page (stage 1), Hi-SAM text masks on every page (three variants), and an ink map made from
   38 multispectral bands on the 10 pages that have published multispectral images.
4. **Objects**: everything on a page that is neither the main Voynich text nor a drawing: folio numbers, quire marks,
   later notes, month names, key-like letter columns (on f1r every letter is marked), red symbols and red spots.
   Opus (AI) found them; a human checked every one.
5. **Drawings**: a mask of the drawings on the herbal, bathing and star pages (173 pages). Each page says whether a
   human marked it or the mask is still AI-only, and the view "who selected what" colours what the AI selected, what
   the human kept, added and removed. The mask can be edited in the browser (brush, eraser, lasso, magnetic lasso,
   restore brush from the AI layers).

## Use it

Open `index.html` through any static web server (for example `python -m http.server` in this folder), or open the
GitHub Pages site of this repository.

- **Views.** The tabs at the top are:
  1. page outline and holes;
  2. drawings (who selected what: AI or a human; editable);
  3. objects;
  4. ink;
  5. row lines over the ink (editable);
  6. all layers: every layer has its own switch and settings, objects can be clicked.

  The page list is on the left. The settings for the open layer are under the tabs. Click an object to open its card, which shows a close-up of the scan, the multispectral map if the page has one, the Voynich characters named in its text, and the evidence.
- **View.** The grey area is outside the page and inside holes. Use `←`/`→` to move between pages and hold `Space` to see the bare scan. The panel on the right says who marked the page and how.
- **Edit.** Press **✎ Edit**, then:
  - drag points to move them;
  - click a side to add a point;
  - right-click a point to delete it;
  - switch a side between a straight line and a spline;
  - outline holes with **⬡ Hole**.

  Your edits stay in your browser. Send them as a GitHub issue (**Submit**), or download them all as one JSON file.

## What is in the data

| | |
|---|---|
| `data/index.json` | every page: image id, folio, scan file, the scan region shown, provenance summary |
| `data/pages/<image>.json` | boundary (four spline sides), holes, provenance and labels of one page, in pixels of the scan file |
| `data/lines/<image>.json` | row lines of one page with their status (layer 2) |
| `img/ink_<source>/<image>.png` | ink layer of one page, display frame, alpha = ink (layer 3) |
| `data/marks/<image>.json` | objects of one page: type, reading, status, box or outline (layer 4) |
| `data/drawings.json` | drawing masks: per page where the mask comes from (human or AI), AI model, layers (tab 2) |
| `img/draw_<layer>/<image>.png` | drawing masks in the display frame, white = drawing: `mask` (published), `start`, `sam3`, `ai` |
| `data/glyphs.json`, `glyphs.js` | transliteration code → Voynich character (Eva-2 and v101 fonts) |
| `img/<image>.jpg` | display image: the page's region of the scan, 1800 px high |

The format is described in [DATA.md](DATA.md).

**Coverage.** 189 single pages (f1r to f116v) and 38 foldout panels.

- Foldout panels are cut at the real folds of each foldout scan.
- Folio 101 is one page on each side, following voynich.nu: f101r covers the old f101r1 and f101r2.
- Wide panels with an extra internal crease (f68r3, f68v3, f70r2, f72v3, f89r2) are kept whole.

## Who marked what

| `boundary_source` | Meaning |
|---|---|
| `human` | outlined by a human, starting from an automatic SAM outline |
| `opus+human-corrected` | outlined by Claude Opus (AI) and corrected by a human |
| `opus+human-checked` | outlined by Claude Opus (AI) and accepted by a human without change |
| `opus` | outlined by Claude Opus (AI), not reviewed yet |

How Opus worked:
- It started from an automatic segmentation (SAM, reduced to a quadrilateral).
- It looked at zoomed strips of the full-resolution scan along every side.
- It followed the leaf's own edge, also under transparent tape.
- It left out stacked edges of other leaves, the binding and strips of neighbouring pages.

Its errors are mostly random, a few pixels to a few tens of pixels on the thumbnail scale. Unreviewed pages are good
enough to separate a page's own ink from a neighbour's in most places, but not exact.

**Holes.**
- The pages listed as having holes, after the notes on [voynich.nu](https://www.voynich.nu/), were checked by a human.
- Large holes and small holes inside the text are outlined.
- Tiny wormholes in the margins may be missing.

## Row lines (tab 5)

Each row line follows the middle of a row of writing. How they were made:

1. GPT-5.5 drew them over each page twice, in two independent runs.
2. The drawings were registered back onto the scan and pulled onto the ink.
3. The lines were clipped to the page boundary.
4. Lines that both runs agree on are kept. Lines drawn by only one run were decided by a human, who confirmed, corrected, drew or rejected each one.
5. Every page where the lines disagreed with Ryan Allen's glyph map (CC BY 4.0: every word and letter of the
   manuscript tied to the pixels of the same Yale photographs) was gone through by a human as a whole: 108 pages,
   lines fixed on 87 of them (2026-11-25). Lines on those pages count as checked by a human. On the site all row lines
   are drawn in one colour; the status below is in the data and in the side panel.

| `status` | Meaning |
|---|---|
| `two_runs_agree` | both runs drew it; not checked by a human |
| `human_confirmed` | drawn by one run, confirmed by a human |
| `human_corrected` | moved or reshaped by a human |
| `human_drawn` | drawn by a human |
| `unclear` | a human could not decide |
| `red_tick` | a red symbol (GC 'bird'), kept as geometry, not a row of text |

The image model refused a few pages with nude figures (f72v1, f75r, f77v, f83v and some runs of the f72 and f72v
foldout panels). For those runs the figures were painted over with plain parchment colour before the page was sent.
Nothing else on the page was changed.

## Drawings (tab 2)

| `source` | Meaning |
|---|---|
| `human` | a human marked the drawings of this page and called it finished |
| `human-rough` | a human marked it, finished but imprecise in places (e.g. many small leaves) |
| `human-partial` | a human corrected parts of the AI mask, not finished |
| `ai-start` | AI only, nobody reviewed it: the **start mask** |

How the AI masks were made:
- **SAM 3** (Meta), text prompt "drawing": instances with score ≥ 0.30; show-through ghosts of the other side of the leaf
  removed (the partner page's drawing mirrored onto this one); edges refined with CascadePSP and snapped to the pen outline.
- **GPT-5.5 / Gemini**: the page was given to the image model with the request to paint every drawing bright blue and
  fill it; the blue was registered back onto the scan and snapped to the outline. Gemini (nano-banana-2.1) was used for
  the bathing pages, which GPT refuses.
- **Start mask**: where SAM 3 and GPT/Gemini agree, plus thin bands of disagreement next to the agreed part, snapped to
  the outline. On the three pages a human marked from scratch or from an older mask it reaches IoU 0.93–0.97.

View "who selected what": on a human page green = the AI selected it and the human kept it, yellow = the human added it,
red = the AI selected it and the human removed it; on an AI-only page blue = both AI voices, orange = only SAM 3,
magenta = only GPT/Gemini.

**Edit.** Press **✎ Edit mask** (`D`). Tools: brush `B` (Ctrl erases), eraser `E`, lasso `F` (draw around; Alt at the
start or "cut out" removes), magnetic lasso `L` (click along the outline, the line sticks to the edge; OpenCV.js is
loaded once, about 10 MB), restore brush `Y` (where you paint, the mask becomes the chosen layer: GPT/Gemini, SAM 3, the
start mask or the published mask; "only add" never removes), fill holes, grow, shrink, `Ctrl+Z` / `Ctrl+Y`. Size:
`[` `]`, right-click, or Alt/Ctrl + right-drag on the image. Your mask stays in this browser; download it as PNG (one
page) or JSON (all pages) and attach it to a GitHub issue.

## Source images

The scans are of Beinecke Rare Book & Manuscript Library, Yale University, MS 408, as distributed on archive.org. The
display images here are crops and reductions of those scans.

## Fonts

`fonts/EVA2.ttf` is the Eva-2 font by Gabriel Landini. `fonts/voynich.ttf` is the v101 font by Glen Claston. Both
were taken from voynich.nu (René Zandbergen), and they are used to draw the Voynich characters that the texts name.
