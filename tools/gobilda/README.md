# goBILDA real-parts pipeline

How Ignite3D's 619 real goBILDA parts were produced (run from a working directory outside the app; needs a
conda env with `pythonocc-core` + numpy and `npx @gltf-transform/cli`):

1. `crawl2.py` — polite crawl of goBILDA listing pages (honours robots.txt crawl-delay 10 s) -> `parts.json`.
2. `download.py` — STEP zips `/content/step_files/{SKU}.zip` + product-page weights for mixed-material parts.
3. `batch.py` -> `convert.py` per SKU: OpenCascade reads the STEP, `extract.py` finds every hole (concave
   cylinders merged by axis; slot end-arcs kept; open/blind ends via solid classification), the family rule in
   `canon/rules_*.py` sets the canonical part frame + male snaps, then it writes the mesh (Draco GLB), snaps,
   and an exact-B-rep STEP fragment in the same frame.
4. `gen_overrides_fasteners.py`, `pt_overrides.py` — per-family snap corrections (re-run after converting).
5. `build_catalog.py` — writes `public/parts/*` + `src/data/gobilda.json` here, and STEP fragments to the
   `ignite3d-cad` data repo (served by GitHub Pages, fetched only for STEP export).
6. `fitcheck.py A SNAP B SNAP` — snaps two real parts together with the app's mating rule and reports
   coincident holes + interference volume (OpenCascade boolean common).

`review/` has the per-family verification reports written during the review (structure, fasteners,
motors & mounts, power transmission, wheels & slides) and the snap renderer.
Geometry source: goBILDA's published STEP files (gobilda.com).
