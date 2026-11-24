# Kit & popular-parts expansion (2026-11-23)

Requested: 2110-0608-0002, 1522-0010-0090, 1522-0010-0120, 2920-0001-4008 + their series, every part in goBILDA's
kits/bundles, and other popular parts, with correct holes.

## Sources
- `crawl_kits.py` -> `kits.json`: every listing under ftc-kits, chassis-kits, linear-motion-kits, pan-kits,
  structure-bundles, motion-bundles, hardware-bundles (52 kits/bundles).
- `kit_bom.py` -> `kits_bom.json`: each kit's contents from its page (three page layouts: "Bill of Materials" table,
  "Qty: N … SKU: X" lists, "Contents: SKU Qty Name" tables); nested bundles expanded (the FTC Starter Kit lists bundles).
- `crawl3.py`: series/category listings for every kit part's series + popular categories (card and table listings).
  `add_extra.py`: 9 kit-only parts whose listing was not crawled (product pages).
- parts.json 638 -> 1096 SKUs. Dropped as non-rigid / not parts: surgical tubing, rubber cord, assortment packs, bundles.
- Not modelled (no STEP on goBILDA): 1122-0017-0432, 1122-0018-0456, 4103-0032-0096.
- Kit items deliberately not in the CAD library: electronics (31xx/38xx), wiring, chain (3308), belts (3412/3423/3426),
  tools (42xx, 5027…), gearbox conversion kit (5105), zip ties (1209), consumables.

## Rules (canon/*) - new prefixes
- structure: flat (1105 1123 1133 2803 1206 1616 1800 1801 2311), L (1111 1112 1113 1147 1216), U (1122),
  rail (1118 open goRAIL, 4103 goTUBE: nominal length from SKU), threaded beam 1145 (like 1106).
  **1145 fix**: tapped cross holes on all 4 sides were dropped (thread chamfers start 0.05 mm inside the face and the
  OCC bbox is inflated) -> outer segment ends projected onto the true +-4 mm faces, tapped, deduped.
- motors_mounts: Saturn 5303/5304 (motor rule), pattern/clamping/servo mounts, pillow blocks (bore-aware).
  `1601-1032-` stays here (existing part; frame unchanged).
- power_transmission: hubs 1301/1308/1311-1315, collars 2920/2923, bearings 1601/1607/1609/1612/1613/1626,
  servo arms/hubs/shafts 19xx, sprockets 2401/3302/3307/3310-3312, pulleys/idlers 34xx, couplers 4001/4006/4007,
  lead screws 3501 (shaft rule) + nuts 35xx, hub-shaft 2110, flanged REV shaft 2105.
  - 1301/1308/1314: bores without a snap type (10 mm, 3/16", 3 mm…) -> centred on the bore (partial arc allowed for the
    clamp slit) or, for 12 mm REX (planar facets), on the 16 mm square of pattern holes, so hub_pattern_16mm is found.
  - stub shafts (1910-0816, 1911-0836, 1922, 2105): axis = the shaft; male rex_8mm at the free tip.
- fasteners: spacers 1502/1514/1521/1522/1529/1530/3900, shoulder standoffs 1503, screws 2804/2813/2822, set screws
  2806, washers 2809, nuts 2805/2816. **2822 fix**: the thread-lock patch is a second coaxial solid; under-head plane
  now from the shank boss that meets the head (lengths now exactly nominal 6-16 mm, were 0.8-1.5).
  Split-lock washer / hurricane nut: no outer cylinder -> axis from the M4 hole; 2809 bore is a helix -> override snaps.
- wheels: 3600 3604 3607 3615 3618 3626 3627 3629 3635.

## Snap post-processing
- `pt_overrides.py`: new parts get the bore type from the **title** (SKU codes are inconsistent in newer series, e.g.
  1601-0014-0004 = 4 mm ID x 14 mm OD was typed bearing_14mm): 8mm REX/8 mm -> rex_8mm, 6 mm/6 mm D -> d_6mm,
  4 mm -> m4_hole, 14 mm -> bearing_14mm, 12 mm REX/inch/hex -> none. Old SKUs unchanged.
- `2110` hub-shaft (STEP = hub + shaft + retaining shim/washer/M4 screw as shipped): frame Y = shaft, y=0 at the REX
  shoulder, hub +Y. Male rex_8mm at the shoulder (normal -Y). Flange faces from the mesh (y=16.0/20.0 -> the "20 mm hub
  offset"); 8 tapped hub_pattern_16mm + 16 clearance snaps (24 mm circle).
  goBILDA's STEP models the shaft section as **8 mm round**, not REX (r = 4.00 at every angle).
- `norm_new.py`: collinear hole segments (clearance entry + thread) merged to one snap per outer face (tapped if any),
  e.g. goRAIL nut 20 -> 10, threaded L-bracket 48 -> 20; oblique (angled-leg) holes kept as detected.
- `mount_bores.py`: REX bores are planar hex facets (invisible to the cylinder detector) -> found on the mesh (largest
  vertex-free circle ringed by bore vertices), rex_8mm on both faces + hex corner up-vector. Applied to the REX pillow
  blocks (incl. the pre-existing 1602-0032-4008 / 1605-0024-4008, which never had a bore snap) and REX wheels.
- `extract.load`: LOOSE_HW (1802 servo frame ships as a loose kit: frame + 4 screws + 4 washers lying beside it) ->
  only solids touching the main body are kept.

## Fit checks (fitcheck.py, interference = boolean common of the real solids)
| Joint | coincident holes | interference mm3 | verdict |
|---|---|---|---|
| 2110 hub-shaft `shoulder` <- 1611-0514-0008 (round 8 mm) `boreb` | 1 | 0.0 | shoulder flush on the bearing face (Strafer pairing) |
| 2110 `shoulder` <- 1611-0514-4008 (REX) `boreb` | 1 | 34.6 | goBILDA models the hub-shaft as 8 mm round -> round shaft in a hex bore (STEP limitation) |
| 2110 hub face `mh5a` <- 2302-0014-0048 hub-mount gear `mh0a` | 12 | 0.0 (64.4 before the flange-face fix) | 16 mm pattern + 14 mm spigot exact |
| 1522-0010-0090 spacer `h0b` <- 2106-4008-0800 `endA` | 1 | 0.0 | spacer on REX shaft |
| 2920-0001-4008 collar `boreb` <- 2106 `endA` | 1 | 1.53 | zero-clearance REX contact (existing 2910 collar: 9.98) |
| 1602-0032-4008 new REX bore `rexboreb` <- 2106 `endA` | 1 | 1.02 | REX bore found on the mesh |
| 3629-0001-0048 vector mecanum `rexboreb` <- 2106 `endA` | 1 | 2.47 | REX contact |
| 3615-4008-0096 boot wheel `rexboreb` <- 2106 `endA` | 1 | 2.63 | sharp-hex REX bore |
| 1120-0005-0144 `h0b` <- 1145-0002-0016 side `h33b` | 2 | 0.043 | threaded beam on a channel web (tapped cross holes) |
| 1120-0005-0144 `h0b` <- 1118-0024-0072 end `h0a` | 2 | 0.0 | open goRAIL end on a channel |
(2106 `endB` checks show 20-50 mm3: the e-clips goBILDA models in that shaft end's grooves land inside the hub - not a snap error.)

In-app check (v1.4.0 build, real meshes): 1120 channel + 1611 bearing + 2110 hub-shaft + 2302 gear on the hub pattern +
1522 spacer + 2920 collar, all placed with the app's mating rule; everything coaxial, REX section reaches the far wall's
14 mm bore exactly as on the Strafer.

## Visual review
Every new series rendered (review/img, montages m*/r*), problems found and fixed above. Remaining caveats:
- 1806 steel servo brackets: no snaps (M3 servo holes / threaded studs have no snap type).
- 1600-0001-0120, 1604, 1626, 1613-0521 etc.: 12-32 mm bores have no snap type (same as existing 12 mm parts).
- Pillow-block REX hex angle: the bearing inside goBILDA's pillow-block STEP is rotated (-16 deg on 1602-4008); the
  up-vector follows the real geometry.
