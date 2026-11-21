# Voynich page annotations

Layered annotations of the Voynich manuscript (Beinecke MS 408) on its scans, each with who made it and how far it has
been checked:

1. **Page boundaries and holes**: the outline of each page's own leaf (or foldout panel) and the holes in the parchment.
2. **Row lines**: a line along the middle of every row of text, including curved, circular and radial rows and labels.

Ink masks and other layers will follow.

## Use it

Open `index.html` through any static web server (for example `python -m http.server` in this folder), or open the
GitHub Pages site of this repository.

- **Views.** Tabs at the top: 1 page outline and holes, 2 row lines, 3 all layers together.
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
| `img/<image>.jpg` | display image: the page's region of the scan, 1800 px high |

The format is described in [DATA.md](DATA.md).

**Coverage.** 188 single pages and 38 foldout panels.

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

## Row lines (layer 2)

Each row line follows the middle of a row of writing. How they were made:

1. GPT-5.5 drew them over each page twice, in two independent runs.
2. The drawings were registered back onto the scan and pulled onto the ink.
3. The lines were clipped to the page boundary.
4. Lines that both runs agree on are kept. Lines drawn by only one run were decided by a human, who confirmed, corrected, drew or rejected each one.

| `status` | Meaning |
|---|---|
| `two_runs_agree` | both runs drew it; not checked by a human |
| `human_confirmed` | drawn by one run, confirmed by a human |
| `human_corrected` | moved or reshaped by a human |
| `human_drawn` | drawn by a human |
| `unclear` | a human could not decide |

The image model refused a few pages with nude figures (f72v1, f75r, f77v, f83v and some runs of the f72 and f72v
foldout panels). For those runs the figures were painted over with plain parchment colour before the page was sent.
Nothing else on the page was changed.

## Source images

The scans are of Beinecke Rare Book & Manuscript Library, Yale University, MS 408, as distributed on archive.org. The
display images here are crops and reductions of those scans.
