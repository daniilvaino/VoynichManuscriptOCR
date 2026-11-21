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
