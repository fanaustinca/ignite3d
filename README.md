<p align="center"><img src="public/logo.svg" width="96" alt="Ignite3D logo"></p>

<h1 align="center">Ignite3D</h1>
<p align="center"><b>Fast browser CAD for goBILDA FTC robots.</b> 100% frontend — no account, no server.<br>
<a href="https://fanaustinca.github.io/ignite3d/">Open the app →</a><br><br>
<i>Made by Spark Servos</i></p>

---

## What it does

- **Hole-to-hole snapping on the goBILDA grid.** Every part's holes (8 mm grid, 14 mm bores, 16 mm square
  M4 patterns) are modelled as snap points. Hover a hole, click, done — parts land flush with their hole axes
  aligned, and the default orientation is the quarter-turn that presses the most hole faces together
  (never one that puts material inside material); faces already covered by another part are not offered. `R` rotates 90°,
  `Tab` mates with a different hole on the new part, `S` turns snapping off for free placement with a gizmo.
- **Smart Fasten.** `F` + click a hole in a joint, or `J` to fasten every aligned joint at once (up to 4
  well-spread screws per joint). Ignite3D walks the stack of plates on that hole axis, adds up the thickness,
  picks the right M4 SHCS length, puts the head on the outside and a nyloc nut on the far face — or threads it
  straight into tapped holes (motor faces, goBILDA hubs, standoffs, blocks) with no nut.
  Dropping a screw from the catalogue onto a hole does the same thing: the length is corrected to fit the
  joint, the head always lands on the exposed outer face (never inside a wall), and the locknut is added.
- **Move arrows + rotation rings** on the selection: drag a ring to turn the part about X / Y / Z, snapping
  in 45° steps (15° / 90° / free in the toolbar). `R` turns 90° about the mated hole axis.
- **1,180 real goBILDA parts** converted from goBILDA's own STEP files — everything in goBILDA's kits and bundles
  (FTC Starter Kit, Strafer, BeeLine, U-channel/goRAIL/beam bundles, motion starter packs…) plus popular series: U-channels (incl. the real slot / oval hole
  pattern), low-side & mini channels, goRAIL, beams, grid plates, quad blocks & mounts, clamping mounts, pillow
  blocks, Yellow Jacket motors (5202/5203/5204), servos & ServoBlocks, REX / D shafts, hubs, collars, bearings,
  gears, pulleys, sprockets, the gear-driven turret, Viper-Slide extrusions, odometry pods, control arms & discs, CV joints, hinges,
  ball links, tubes, threaded rods, mecanum (incl. GripForce Vector intake) / Gecko / Rhino / omni / Wasteland wheels, screws, nuts, washers, standoffs and
  spacers. Real names, per-piece prices and masses (goBILDA weights, or real volume × material density).
- **Snap points measured from the real geometry:** every M4 clearance hole, threaded hole, slot end (and every
  1 mm along true sliding slots), 14 mm bearing bore, REX / D bore and shaft end — verified part by part with
  renders and with OpenCascade fit checks (two real solids snapped together must not intersect).
- **Robot Check (`K`):**
  - **Collision detection** on the real goBILDA meshes, live while you build: parts that pass through each
    other turn red, with a marker at the overlap, a toolbar badge and a toast. Flush faces, screws in their
    holes and shafts in their bores are expected and ignored. The test is surface samples sitting more than
    0.4 mm inside another part's material, with shared hole axes excluded.
  - **Structure:** every bolted joint is rated by its screws (none = loose, one = pivots, two or more =
    fastened). It also flags screws with no nut and no threaded hole, shafts with no bearing (or only one
    bearing while carrying a wheel or gear), parts not attached to the robot, and long cantilevers.
  - **Stability:** support polygon from the real ground contacts and the centre-of-gravity height give the
    tip-over angle and the braking/turning acceleration (in g) that would tip the robot.
  - Click any finding to select the parts and fly the camera to it. This is a rule-based check, not a stress
    simulation.
- **FTC overlays:** 18″ sizing cube (turns red when you are too big), live weight in g/lb, center of gravity.
- **Request a part / send feedback:** links in the toolbar, the parts list and Help open the team's Google Forms.
- **Onshape-ready export:** STEP AP214 assembly — one instance per part, exact placement, millimetres, Z-up —
  containing **goBILDA's exact B-rep geometry** for each part (fetched on demand from the
  [ignite3d-cad](https://github.com/fanaustinca/ignite3d-cad) data site), so Onshape gets the real parts. Also STL, GLB
  and a JSON manifest with every occurrence's `/occurrencetransforms` matrix.
- **Parts library** grouped by category → series sub-sections (open/close, remembered), short names that only
  show what differs ("19.2:1 · 312 RPM", "5 Hole · 144 mm"), and a hover card with a rendered thumbnail, SKU,
  price and weight. Yellow Jacket motors are coloured from their real sub-parts (yellow sleeve, black encoder
  cap, dark gearbox, steel shaft).
- **Cloud files (Firebase):** the cloud button saves the build online under a **6-digit access code**. Anyone with
  the code (or the `?cad=123456` link) can open and edit it. Every change auto-saves to Firestore and streams live to
  everyone who has the file open; the last write wins. Codes are remembered in localStorage, so each one is typed once,
  and the last open file reopens on load. See [Cloud setup](#cloud-setup-firebase).
- **Autosave** to IndexedDB + localStorage on every change and on reload/close, with a "Saved" indicator; if a
  big build is cleared, the empty scene offers to restore it.
- **BOM** with CSV download, **share links** (`#build=…`, compressed in the URL), undo/redo, grouping,
  mirroring (mecanum L↔R swap), hide / x-ray, autosave, light & dark themes.
- **Kit picker:** choose a goBILDA kit under the search box to see exactly its parts with quantities (from the kit's
  bill of materials); electronics, wiring, belts and chain are listed as non-CAD items.
- **Custom parts:** upload `.glb`/`.stl`, click to tag holes (auto-centres on round holes, detects
  through-thickness, one-click 16 mm 4-hole stamp), save to your browser, export a `{sku}.glb + {sku}.json`
  bundle or open a pre-filled GitHub issue to add it to the catalog.

## Cloud setup (Firebase)

1. In the [Firebase console](https://console.firebase.google.com), create a project (Analytics is not needed).
2. **Build → Firestore Database → Create database** (production mode, any region).
3. **Firestore → Rules:** paste [`firestore.rules`](firestore.rules) and publish. Anyone can read or write a file
   whose code they know. Listing the collection is denied, so codes can't be enumerated, and nothing can be deleted.
4. **Project settings → Your apps → Web (`</>`):** register an app (no Hosting needed) and copy the `firebaseConfig`
   values into `PASTE_HERE` in [`src/config/firebase.ts`](src/config/firebase.ts). These are public identifiers, so
   committing them is fine. Alternatively, set `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`,
   `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID` and
   `VITE_FIREBASE_APP_ID` at build time.
5. Push. The Cloud button switches from "not connected" to working.

Each file is one document `cad/{code}` holding the lz-string-compressed build (under 1 MB, which is about 10,000
parts). Custom parts stay in each browser. For local testing without Firebase, add `?cloudmock` to the URL: it uses
a localStorage backend that syncs between tabs.

## Parts pipeline (GitHub + jsDelivr, zero backend)

```
public/catalog.json        part metadata + snap points (generated by `npm run catalog`)
public/parts/{sku}.glb     optional real meshes, Draco ok, MILLIMETRES, same origin as the procedural model
public/parts/index.json    list of SKUs that have a .glb (generated) — the app never probes for missing files
public/thumbnails/{sku}.png  optional
```

At boot the app only fetches `catalog.json`. A part's `.glb` is fetched the first time you hover or use it,
from `https://cdn.jsdelivr.net/gh/{owner}/{repo}@{branch}/public/parts/{sku}.glb` (falling back to this site's
own `./parts/`), then cached in IndexedDB. Parts without a mesh render instantly from an accurate procedural
model — the same model whose holes define the snap points and the STEP export.

Teams can add their own repo (Settings → Team repos) to load custom printed parts from it.

To contribute a mesh: drop `{sku}.glb` in `public/parts/`, run `npm run catalog`, open a PR.

## Develop

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # typecheck + unit tests + build + headless browser e2e (20 tests)
```

The e2e suite drives the real app with a mouse and keyboard (snapping, fastening, exports, share links,
custom upload, CDN mesh upgrade). If an OpenCascade Python (`pythonocc-core`) is available
(`OCCT_PYTHON=/path/to/python`), the exported STEP is also validated with OpenCascade.

## Known limitations

- 4 very large assemblies (the 104 mm and 140 mm mecanum wheels and two Viper-Slide kits) have no exact STEP
  fragment (> 15 MB compressed) and export as bounding-box placeholders; they still render and snap with the real mesh.
- Left/right part pairs (mecanum, Vector intake wheels) swap to their partner on Mirror; parts goBILDA ships in only one
  handedness get a mirrored *placement*, not chiral geometry.
- Excluded (not single parts in goBILDA's STEP): bundles, the 1523 standoff assembly, the 2:1 bevel gear sets, roller packs.
- Some joints still show small overlaps in fit checks (REX-in-REX zero-clearance fits, Gecko-on-hub, Viper-Slide
  hardware below its mounting plane) — see `tools/gobilda/review/`.

The conversion pipeline lives in `tools/gobilda/`.

Unofficial community tool. Part geometry comes from the STEP files goBILDA publishes on gobilda.com;
goBILDA® and REX® are trademarks of their owner.
