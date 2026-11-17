# Ignite3D real-parts pipeline — brief for review agents

Goal: every goBILDA part in Ignite3D must use goBILDA's real geometry, with **accurate snap points** so parts
snap together exactly as they physically bolt together. You own one part family. Work only inside
`~/ignite3d-assets` (never edit `~/ignite3d`, never fetch gobilda.com — a polite downloader is already running).

## Data
- `parts.json` — crawled goBILDA catalogue: sku -> {title, category, page, price}.
- `step/{SKU}.STEP` — real STEP (appears as the downloader progresses; `tail download.log`). If your SKUs are not
  downloaded yet, work on the ones that are and poll (`sleep 60`) for the rest.
- `out/{SKU}.json` — produced by the converter: `snaps` (auto-detected hole faces), `bosses` (convex cylinders),
  `bbox`, `centroid`, `registration`, `male` (from your rule), all in the FINAL part frame.
- `procedural.json` — Ignite3D's old hand-made models (only for some SKUs; their hole patterns were partly WRONG —
  e.g. the real 1120 channel has slot holes; treat real geometry as truth).

## Conventions (must hold exactly — the app depends on them)
- Units mm, **Y up**. A part's frame = the FINAL frame your rule produces (R, t applied to the STEP's Y-up coords).
- Mating rule: snap A meets snap B when positions coincide and normals oppose (A.n = -B.n).
- **Female snap** (hole face): position = hole centre on the face, normal points OUT of the material along the
  hole axis. Through-holes get a snap on each open face with `depth` = material thickness. `tapped: true` for
  threaded holes (tap-drill radius ~1.65-1.75 mm, or holes in standoffs/nuts/motor faces/hubs that are threaded in reality).
- **Male snap** (screw under-head, shaft end, bearing flange underside, motor shaft root): normal points in the
  INSERTION direction (the direction the feature moves into the mating hole).
- Snap types: `m4_hole` (M4 clearance OR threaded), `bearing_14mm` (14 mm bore / 14 mm OD bearing seat),
  `rex_8mm` (8 mm REX or 8 mm round bore / shaft), `d_6mm` (6 mm D bore / shaft), `hub_pattern_16mm`.
- goBILDA's 4 mm holes are modelled at r = 2.0. Slots: BOTH end arcs are valid screw positions (the detector
  already emits one snap per arc centre; keep them).
- Required canonical frames:
  - Screws (2800/2802 …): axis = Y, head on +Y, **under-head plane at y = 0, axis through the origin**; male
    `m4_hole` snap at the origin with normal (0,-1,0).
  - Nuts (2811/2812): axis = Y, one bearing face at y = 0, body toward +Y, axis through origin; both faces are
    female tapped `m4_hole` snaps.
  - Motors: output shaft along +Y, mounting face plane at y = 0, shaft axis through the origin; male `rex_8mm`
    (or `d_6mm`) snap at the origin, normal +Y; face holes are female tapped.
  - Channels/rails/beams: length along X, centred; U-channels open toward +Y.
  - Plates/flat parts: largest face in the XZ plane, thickness along Y.
  - Shafts/standoffs/spacers: axis along Y, centred. Shafts: male snap at each end, normals pointing inward.
  - Wheels: axle along X, centred.
  - Anything else: sensible, documented, axis-aligned.
  Keep rotations axis-aligned (entries 0/±1) wherever the part is axis-aligned so 8 mm grids stay exact.

## Tools
- Rule module: `canon/rules_<family>.py` with `PREFIXES` and `rule(ctx)`; see `canon/__init__.py` (contract) and
  `canon/lib.py` (helpers). Return R (3x3 rows), t, male snaps (in FINAL frame), notes.
- Convert: `python batch.py --jobs 4 --force SKU [SKU ...]` (uses `~/miniforge3/envs/occt/bin/python` internally).
- Inspect: `cat out/SKU.json | python3 -m json.tool | head`, or write small python with numpy
  (`~/miniforge3/envs/occt/bin/python` has OpenCascade (`OCC`) + numpy).
- Render for visual review: `node review/render.mjs SKU [SKU ...]` -> `review/img/SKU.png` (4 views; rings =
  female snaps coloured by type, filled = tapped, red arrows = male). Look at the PNG with your Read tool —
  copy it to a unique filename first (`cp review/img/X.png review/img/X-v2.png`), the image reader caches by path.
- Fit check: `~/miniforge3/envs/occt/bin/python fitcheck.py A_SKU A_SNAP B_SKU B_SNAP [turns|auto]` -> JSON with
  coincident hole faces and **interference_mm3** (boolean common of the two real solids). A correct flush joint
  has interference ≈ 0 and several coincident holes. Screws in threaded holes will show small interference
  (thread engagement) — that is expected; screws through 4.0 mm clearance holes should be ≈ 0.
- Manual corrections: `overrides/SKU.json` = {"removeSnapIds": [...], "addSnaps": [snap...], "typeFixes": {"id": "type"},
  "tappedFix": {"id": true}, "male": [...], "exclude": false, "notes": "..."} (snap format as in out json:
  {id, type, p, n, depth, tapped, holeId}). Prefer fixing systematically in your rule.

## Deliverables
1. `canon/rules_<family>.py` covering your SKUs.
2. Every SKU converted with your rule, rendered, and visually checked (at least one per size variant group; all
   for families with few SKUs).
3. Fit checks proving real joints: list them with results.
4. `review/report_<family>.md`: per-SKU verdict (OK / fixed / excluded + why), rules used, fit-check table,
   anything you could not verify. Be honest about anything uncertain.
