# Data format

All coordinates are **pixels of the scan file** named in `scan` (the archive.org JPEG of Beinecke MS 408, e.g. `003.jpg`), x to the right, y down.

## `data/index.json`

A list, one entry per page:

```json
{"image": "003_0_f1r", "folio": "f1r", "scan": "003.jpg",
 "display": {"file": "img/003_0_f1r.jpg", "scan_x0": 0, "scan_y0": 0, "scale": 0.478, "w": 1420, "h": 1800},
 "boundary_source": "opus+human-checked", "status": "final", "holes": 4, "holes_source": "human-checked"}
```

`display` maps the display image to the scan: `display_px = (scan_px - scan_x0/y0) * scale`.

The site's page number is derived from `image` = `<scan>_<part>_<folio>`: `#<scan>` for a whole scan (`003_0_f1r` →
`#3`), `#<scan>.<panel>` for a foldout panel, panel = `P<k>` + 1 (`121_P1_f67r2` → `#121.2`).

## `data/search.json`

`{image: text}`: the lowercase text the site searches besides folio, number, title, section and kind — every row's ZL
locus and EVA text, every object's type, reading and status (made by `export_site_search.py`).

## `data/pages/<image>.json`

```json
{"image": "003_0_f1r", "folio": "f1r", "scan": "003.jpg", "coords": "pixels of the scan file",
 "boundary": {"top": [[x,y], ...], "right": [...], "bottom": [...], "left": [...]},
 "holes": [[[x,y], ...], ...],
 "provenance": {"boundary_source": "...", "status": "...", "holes_source": "...",
                "opus_confidence": "high|medium|low|null", "opus_note": "...", "human_note": "...", "saved_at": "..."}}
```

- **Boundary**: four sides, clockwise from the top-left corner (`top` left→right, `right` top→bottom, `bottom` right→left, `left` bottom→top). Consecutive sides share their corner point. Each side is a **Catmull-Rom spline through its points**; a side with only its two corners is a straight line. The page is the closed area inside.
- **Holes**: closed polygons inside the page that are not page (parchment missing).
- **Provenance**
  - `boundary_source`: `human` | `opus+human-corrected` | `opus+human-checked` | `opus`.
  - `status`: `final` | `unclear` | `unreviewed`.
  - `holes_source`:
    - `human-checked`: a human went through the holes of this page;
    - `human`: holes drawn by a human;
    - `human-not-checked`: the page was outlined by a human, who did not look for holes yet;
    - `opus`: holes marked by Opus only;
    - `opus-none-marked`: not checked for holes.

## Edits sent from the site

Same coordinates, one object per edited page:

```json
{"format": "voynich-page-boundaries/edit-1", "coords": "scan pixels",
 "pages": [{"image": "...", "folio": "...", "scan": "...", "top": [...], "right": [...], "bottom": [...], "left": [...],
            "holes": [...], "note": "...", "edited_at": "..."}]}
```

## `data/lines/<image>.json` (layer 2)

```json
{"image": "...", "folio": "...", "scan": "...", "coords": "pixels of the scan file", "xheight": 18.5,
 "lines": [{"pts": [[x,y], ...], "status": "two_runs_agree|human_confirmed|human_corrected|human_drawn|unclear", "source": "..."}]}
```

Each line is a polyline along the middle of a row, simplified to within 1 scan pixel.

`source` says where the geometry comes from: `P8 & P8-r2` (both GPT runs), `P8` or `P8-r2` (one run), `drawn: straight` /
`drawn: spline` (drawn by a human), `ink-fit` (fitted to the ink), `owner` (a human), `joined: <a> + <b>` (pieces of one
row joined end to end), an agent label for the few lines an agent added; `(corrected)` = a human moved or reshaped it.

## `data/rows/<image>.json` (layer 2, rows)

```json
{"image": "...", "folio": "...", "coords": "line indices of data/lines/<image>.json; scan pixels",
 "rows": [{"id": "003_0_f1r:R3", "kind": "single", "block": 1, "order": 3,
           "dir": "fwd|rev", "geom": "line|steep|ring|curve", "dir_source": "zl_code|zl_order|manual|owner|auto|object|geometry",
           "dir_reader": "fwd|rev", "dir_zl_order": "fwd|rev|null", "dir_zl_code": "...|null", "conf_fwd": 0.95, "conf_rev": 0.77,
           "loci": ["f1r.3"], "zl_text": {"f1r.3": "syaiir sheky ..."}, "agree": 0.97, "status": "agree|partial|weak|no_zl",
           "pieces": [{"i": 2, "id": "003_0_f1r:L3", "rev": true, "loci": ["f1r.3"], "words": "syaiir sheky ...", "w": [[0, 8]],
                       "how": ["whole"], "tier": "gold", "reading": "syaiirshekyor...", "agree": 0.97,
                       "hints": {"ryan": "agree", "voynichese": "agree"}}]}],
 "lines_not_in_rows": []}
```

- `pieces` are in **reading order**; `i` is the index of the line in `data/lines/<image>.json`; `rev` = the piece is
  read against the order of its stored points. `dir` is relative to the order in which the pieces are joined.
- `loci`, `words`, `w` (word indices, 0-based, inclusive), `how`: the bridge of the piece to ZL. `tier`: `gold` /
  `silver` / `review`, or `noise` / `not_zl` when the matcher found no ZL text for it.
- `reading`: our reader's reading of the piece (Eva). `agree` = 1 − edit distance(reading, ZL words without spaces) /
  longer length; the row's `agree` is the same over all its pieces with ZL words. `status`: `agree` ≥ 0.8, `partial`
  0.5–0.8, `weak` < 0.5, `no_zl` = no piece of the row is linked to ZL (flagged, never removed).
- `hints`: whether Ryan Allen's word boxes and the voynichese word boxes on the piece agree with the bridge (`agree`,
  `disagree`, `none`); not used to decide.

`index.json` gives `rows`, `rows_by_status` and `rings` (rows that are rings) for each page.

## Labels

`data/pages/<image>.json` has `labels`:
- `leaf` and `side` (front = recto `r`, back = verso `v`);
- for foldouts, `panel` and `position` (where the panel lies on the scan);
- `section` and `quire`, from the page headers of the ZL transliteration.

## `data/marks/<image>.json` (layer 4, objects)

Marks on the page that are neither the main Voynich text nor a drawing. Opus (AI) found them, using the scans and the notes on voynich.nu. A human then checked every object.

- `objects`: a list. Each object has:
  - `type`: `folio_number`, `quire_mark`, `pencil_letter`, `colour_note`, `marginalia`, `month_name`, `alphabet_column`, `ex_libris`, `red_tick`, `red_spot`, `scribble`, `dirt`, `voynich_text`, `under_paint` (writing under paint), `show_through` (the other side of the leaf seen through it) or `other`;
  - `type_label`: the type in plain words;
  - `text`: what the mark says or what it is;
  - `status`: `confirmed`, `confirmed (edited)`, `unclear`, `AI find, not reviewed` (found by an AI agent, nobody checked it yet), `confirmed by a human` or `owner's verdict: show-through`;
  - `found_by`, `reviewed_by`: who found it and who checked it;
  - `bbox`: `[x0, y0, x1, y1]` in scan pixels;
  - `poly` (optional): an outline in scan pixels;
  - `evidence` (optional): the path of an image, or a list of paths, that support the reading;
  - AI finds also have `confidence` (the agent's own), `reasoning` (its notes, English) and `summary_ru` (its summary in
    Russian, as written), and `id`;
  - show-through objects also have `other_side` (the folio of the other side of the leaf) and `match`
    (`ncc`: normalised cross-correlation of this crop with the flipped crop of the other side at the mirrored position,
    `shift_px`, `how`).
- `not_found`: things that were expected on this page (from the literature) but were not found on the scan.

`data/index.json` also gives `marks` (the number of objects) and `marks_by_type` for each page. An unclear object is counted under `unclear`; AI finds not reviewed yet are also counted under `ai_unreviewed`.

## `data/drawings.json` (tab 2, drawings)

`{"format": "voynich-drawings/1", "frame": ..., "pages": {<image>: {...}}}`, one entry per page with drawing masks:

| field | meaning |
|---|---|
| `source` | `human`, `human-rough`, `human-partial` or `ai-start` (see README) |
| `status`, `note`, `saved_at` | the human's page status, note (original language) and time |
| `owner_edits` | number of edit operations the human made on the page |
| `ai_model` | which image model and prompt made the GPT/Gemini layer |
| `layers` | PNG layers present in `img/draw_<layer>/<image>.png`: `mask` (published), `start`, `sam3`, `ai` |

The PNGs are greyscale, white = drawing, in the frame of the page image `img/<image>.jpg` (`display` in index.json:
scan = display / scale + scan_x0/y0). `index.json` has `drawing` = the page's `source`.

Edits downloaded from the site: `{"format": "voynich-drawings/edit-1", "pages": [{image, folio, frame, w, h, png,
edited_at}]}`, `png` = data URL of the mask in the same frame.

## `data/glyphs.json` and `glyphs.js` (Voynich characters in the text)

The site draws Voynich characters wherever a text names a transliteration code. `glyphs.js` finds codes such as "EVA g", "EVA @221", "GC2a @155", "GC208" and "ZL @252". It replaces each one with the character, followed by the code in brackets.

`data/glyphs.json` maps a scheme and a code to one of three things:
- a font character. The fonts are Eva-2 (`fonts/EVA2.ttf`) and v101 (`fonts/voynich.ttf`), both from voynich.nu.
- a cut-out of the voynich.nu character table, for characters the fonts lack. The white background is removed.
- a cut-out of the scan, for the four ZL comment codes @252–@255. These have no glyph in any font.

The schemes are:
- `eva`: basic, capitalised and extended (@NNN);
- `v101`: Glen Claston (GC);
- `currier`, `fsg` and `bennett`: these are read through Table 1 of voynich.nu ("Transliteration of the text").
