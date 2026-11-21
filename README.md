# Voynich page boundaries

Where each page of the Voynich manuscript (Beinecke MS 408) actually is on its scan: the outline of the folio's own
leaf, and the holes in the parchment. Each page is marked with who drew its outline and how far it has been checked.

This is the first layer of a larger set of page annotations. Text-line geometry and ink masks will follow as further
layers.

## Use it

Open `index.html` through any static web server (for example `python -m http.server` in this folder), or open the
GitHub Pages site of this repository.

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
| `data/pages/<image>.json` | boundary (four spline sides) and holes of one page, in pixels of the scan file |
| `img/<image>.jpg` | display image: the page's region of the scan, 1800 px high |

The format is described in [DATA.md](DATA.md).

**Coverage.** This release has 188 single pages. The 36 panels of the foldouts (f67–f73 and f85–f102 folds) are not
included yet: the scans of foldouts are split into equal parts, not at the real folds, and need their own treatment.

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

## Source images

The scans are of Beinecke Rare Book & Manuscript Library, Yale University, MS 408, as distributed on archive.org. The
display images here are crops and reductions of those scans.
