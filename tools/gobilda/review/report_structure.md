# STRUCTURE family review (1101 1102 1103 1106 1109 1116 1117 1120 1121 1126 1127 1137 1139 1143)

Rule: `canon/rules_structure.py`. All 194 SKUs for which a STEP exists were converted with it (`batch.py --force`, no errors), every
one was checked against the real B-rep with `review/verify_structure.py` (details below), and a representative set of each
sub-family was rendered and looked at. No overrides are used (`overrides/` has no file of mine); everything is fixed in the rule.
Every SKU in `parts.json` for my prefixes has a STEP (194 files; the 1101 list is 21, 1106 21, 1109 19, ...).

## Frames produced by the rule (all axis-aligned, det +1, bbox centred on the origin)

| Sub-family | Final frame | How it is determined from geometry |
|---|---|---|
| 1120 / 1121 / 1143 U-channel, 1101 U-beam | length X, web at the bottom (-Y), open toward +Y | height axis = axis where the material centroid is shifted from the bbox centre (centroid sits toward the web); length axis = the remaining axis with fewer wall holes (wall holes run along the width axis; this is what disambiguates the 48x48x48 1-hole 1120). Rotation e.g. 1120: `[[0,0,1],[0,-1,0],[1,0,0]]` (matches the known registration). Verified: web holes have normal +-Y at the lowest y (-24/-21.5 for 1120, -6/-3.5 for 1121/1143), wall holes have normals +-Z. |
| 1102 flat beam, 1116/1117/1127/1139 grid plates, 1126/1137 flat brackets | thin axis -> Y, longest in-plane axis -> X | bbox extents. (1126/1137 are flat plates, 2.5 mm thick; 1137 are L-shaped cut-outs of a flat grid, not bent.) |
| 1103 L-beam | length X, corner at (-Y,-Z): flat leg on the bottom, other leg stands up at -Z | the two axes along which the centroid is shifted are the leg axes, the shift points to the corner |
| 1109 goRAIL 24x24 | length X, cross-section axes cyclically permuted (pure symmetry) | longest axis |
| 1106 8x8 square beam | length X | longest axis; length/centre from the nominal SKU length and the end planes (the bbox is 0.3-0.7 mm too long because the end tapped holes carry modelled threads) |

## Snap rules / corrections applied in the rule

* Slots: both end-arc snaps of every slot are kept (they come from the detector). `_slots()` pairs the two end arcs of each slot
  (mutual nearest partial-arc snaps, same face plane). Slots longer than 2 mm get extra snaps every 1 mm along the centre line on
  both faces, same type/normal/depth, ids `<holeId>s<k><a|b>` (in the out json `id` like `h0s1b`). Only one slot type in this
  family is that long (see below): 1120/1121 web (and 1120 walls) axial slot of 4.69 mm; 4 interpolated snaps per slot face.
  Totals: 21,648 interpolated snaps in 1120, 7,216 in 1121 (these inflate the files: 1120-0049-1200 has 8,022 snaps).
* 1109 / 1106: the detector also reports the internal r2.0 -> r1.7 step faces of the counterbored/threaded end holes and chamfer-shifted
  planes (0.05-0.6 mm inside the end). `_rail()` keeps only snaps on the end planes, puts them exactly on the end plane (+-nominal/2),
  merges the r2.0 entry and r1.65-1.7 thread of one hole into one snap (position = the centre on the 8 mm grid, `tapped: true`) and
  drops the false internal faces. The 1106 side through-holes also showed false snaps at +-1.17 mm (where they cross the central axial
  bore); those are removed (only the faces on the outer skin remain).
* Nothing is dropped for the channels/plates/beams: for 1101, 1120, 1121, 1143, 1102, 1103, 1116, 1117, 1127, 1126, 1137, 1139 the raw
  hole list had no unclassified radius (only r=2.0 / 2.02-2.03 / 7.0). There are no threaded holes in those families (all M4 clearance,
  `tapped: false`). Tapped holes exist only in 1109 (4 corner holes per end, r1.7 thread) and 1106 (1 centre hole per end).
* There are no holes in the end faces of 1101/1120/1121/1143 channels (checked: no planar end face has any inner wire).

## Verification against the real B-rep (`review/verify_structure.py`)

For every axis-aligned planar face of the real solid, every inner wire is read (circle -> one centre, slot -> both end-arc
centres, bore r=7 -> bearing_14mm). Pass criteria: each expected centre has a snap with the same outward normal within 0.05 mm
(no missing holes) and no snap exists that is not a wire centre or an interpolated slot snap (no false snaps). Result for all
194 SKUs: 0 missing, 0 false snaps (raw outputs in `review/st_verify_*.jsonl`). The only known exception is the 14 mm
central bore of 1109 goRAIL, whose end wire is merged with the 0.5 mm end nubs so the script cannot read it; those 2 snaps per
rail (at +-length/2, on the axis) were checked visually and against the counterbore geometry instead.

## Hole pattern of one 48 mm module of the 1120 channel (identical on the web and on both walls; coordinates relative to the 14 mm bore centre, u along the length, v across)

Each 48x48 mm face of one module has 21 wires: 1 bore, 8 round holes, 12 slots.
* 14 mm bore (r=7.0, `bearing_14mm`) at (0,0).
* 8 round r=2.0 holes at (+-8,+-16) and (+-16,+-16) (u,v).
* 8 diagonal micro-slots (r=2.0, 0.69 mm between end-arc centres): ends (+-8,+-8)<->(+-8.49,+-8.49) and (+-16,+-8)<->(+-15.51,+-8.49)
  (the outer end of each pair is the 8 mm-grid hole, the other end is 0.49 mm further along the diagonal).
* 2 short slots on the length axis at (+-12,0): end centres u=+-11.31 and u=+-12.69 (length 1.38 mm).
* 2 long slots on the cross axis (0,+-v): end centres v=+-11.31 and v=+-16 (length 4.69 mm, the only true sliding slots; interpolated
  snaps at v=12.31, 13.31, 14.31, 15.31 and mirror).
The 1120 channel with n holes repeats one such web every 24 mm (bores at -24(n-1)/2 .. +24(n-1)/2 step 24; overlapping module
patterns are merged in the real part). 1121 web: identical to 1120. 1121 walls (12 mm high): 5 round r=2.0 holes at 8 mm pitch
(u=0,+-8,+-16), 8 mm above the web outer face, no slots, no bore per module. 1143 (32 mm wide, 12 mm high) web: bore + 8 diagonal
micro-slots at (+-8,+-8) and (+-16,+-8) (r=2.02-2.03, 0.69 mm) + 2 axial slots (+-12,0) (1.38 mm); no 4.69 mm slots; walls: 5 round holes per module like 1121.
Slot-length list across the family: 0.69, 1.38 mm everywhere, 4.69 mm only 1120/1121 web/wall (1120 walls) as above.

## Fit checks (`fitcheck.py`, real solids, flush joints)

| Joint | Command (A snap, B snap) | coincident hole faces | interference mm3 |
|---|---|---|---|
| 1120-0001 web outer onto 1120-0002 web outer, bore on bore (web-to-web) | h20b <- h24b | 33 | 0.0 |
| 1120-0002 web outer onto 1120-0002 web outer, bore on bore | h25b <- h24b | 52 | 0.0 |
| 1120 wall outer onto another 1120's web outer (90 deg) | 1120-0001 h20b <- 1120-0002 h65b | 33 | 0.0 |
| same, other bore | 1120-0002 h24b <- 1120-0002 h65b | 52 | 0.0 |
| 1120 wall outer back to back (wall-wall) | 1120-0001 h52b <- 1120-0002 h65b | 33 | 0.0 |
| 1121 low-side web outer onto 1120 web outer | 1120-0001 h20b <- 1121-0001 h26a | 41 | 0.0 |
| 1143 mini web outer onto 1120 web outer | 1120-0001 h20b <- 1143-0001 h8a | 21 | 0.0 |
| 1102 flat beam (1102-0005-0040) onto 1120 web inner | 1120-0001 h15a <- 1102 h1b | 5 | 0.0 |
| 1103 L-beam (1103-0005-0040) flat leg onto 1120 web inner | 1120-0001 h82a <- 1103 h1a | 4 | 0.0 |
| 1116 grid plate (1116-0024-0040) onto 1120 web inner | 1120-0001 h82a <- 1116 h1b | 9 | 0.0 |
| 1139 steel grid plate (1139-0024-0056) onto 1120 web inner | 1120-0001 h82a <- 1139 h2b | 9 | 0.0 |
| 1109 goRAIL (0043) end face onto 1120 web inner (corner hole) | 1120-0001 h82a <- 1109 h6a | 5 | 0.0 |
| 1106 square beam (0016) end onto 1120 web inner | 1120-0001 h82a <- 1106 h0a | 1 (beam has a single end hole) | 0.0 |
| control: 1120-0002 wall nested into 1120-0001 web inner (physically impossible, B is as wide as A's inside) | 1120-0001 h20a <- 1120-0002 h63b | 33 | 3703.8 (expected overlap, proves the test detects collisions) |

All flush joints: 0.0 mm3 and several coincident holes. Note: the 1109/1139/1106 checks and the 1102/1103/1116 checks were run after
the final rule except where noted below. Not run: 1117/1127 polycarbonate, 1126/1137 brackets, 1101 and 1121 wall-face joints
(they use the same code path as the checked ones; only geometry/verify-script checked).

## Renders looked at (review/img, copies named s-* / v2-* / v3-*)
1120-0001, 1120-0002, 1120-0003, 1120-0049 (1200 mm), 1121-0001, 1121-0007, 1143-0001, 1143-0004, 1101-0001, 1101-0007, 1102-0005, 1103-0005,
1116-0024, 1106-0002, 1109-0024-0043, 1137-0001-0002 (viewed by eye); 1106-0041, 1109-1200, 1117-0040, 1126-0001, 1137-0001-0001, 1139-0040,
1127-0216, 1121-0049, 1143-0017 were rendered but only checked numerically (bbox/snap list/verify), not eyeballed one by one. Gaps: not every plate
(1116 sizes other than 24x40 were eyeballed only via verify numbers); 1137/1126/1127/1117 individual images not all viewed.

## Open issues / honest notes
* The 0.69 mm and 1.38 mm slot ends produce snaps that are very close to each other (as instructed, both ends kept); the app must
  tolerate several snaps within 1.4 mm.
* Interpolated slot snaps make 1120/1121 JSON large (1120 total 75k snaps for 26 SKUs). If the app cannot take that, drop snaps with `slotInterp: true`
  (every interpolated snap carries that flag in the out json).
* 1109: tapped flag is assumed for the 4 corner end holes (thread r1.7 through the whole length, 2.0 entry); the central 14 mm bore is the
  extrusion core cavity and is exported as `bearing_14mm` at both ends (not a through-checked bearing seat).
* 1106: the 4 side through holes per 8 mm are plain r2.0 clearance holes (`tapped:false`) per the model; the end hole is a modelled thread.
* 1117/1127 are 1.5 mm polycarbonate (same 8 mm grid), 1126/1137 flat steel brackets 2.5 mm thick; depth in snaps = thickness.
* `extract.py` bbox of 1106/1109 is loose (nubs/threads); out json `bbox` for those includes that fuzz (<0.4 mm), snaps/frame do not.
* `procedural.json` cross-check numbers (`procedural_matched_faces`) are meaningless for the new patterns; the old procedural models were wrong.

## Per-SKU table (verdict OK = converted with the rule, snaps verified against B-rep, no override)

#### 1101 (21 SKUs)

| SKU | final bbox (X,Y,Z mm) | snaps | slot-interp snaps | check | verdict |
|---|---|---|---|---|---|
| 1101-0001-0008 | [8.0, 12.0, 12.0] | 6 | 0 | verified vs B-rep | OK |
| 1101-0002-0016 | [16.0, 12.0, 12.0] | 12 | 0 | verified vs B-rep | OK |
| 1101-0003-0024 | [24.0, 12.0, 12.0] | 18 | 0 | verified vs B-rep | OK |
| 1101-0004-0032 | [32.0, 12.0, 12.0] | 24 | 0 | verified vs B-rep | OK |
| 1101-0005-0040 | [40.0, 12.0, 12.0] | 30 | 0 | verified vs B-rep | OK |
| 1101-0006-0048 | [48.0, 12.0, 12.0] | 36 | 0 | verified vs B-rep | OK |
| 1101-0007-0056 | [56.0, 12.0, 12.0] | 42 | 0 | verified vs B-rep | OK |
| 1101-0008-0064 | [64.0, 12.0, 12.0] | 48 | 0 | verified vs B-rep | OK |
| 1101-0009-0072 | [72.0, 12.0, 12.0] | 54 | 0 | verified vs B-rep | OK |
| 1101-0010-0080 | [80.0, 12.0, 12.0] | 60 | 0 | verified vs B-rep | OK |
| 1101-0011-0088 | [88.0, 12.0, 12.0] | 66 | 0 | verified vs B-rep | OK |
| 1101-0012-0096 | [96.0, 12.0, 12.0] | 72 | 0 | verified vs B-rep | OK |
| 1101-0013-0104 | [104.0, 12.0, 12.0] | 78 | 0 | verified vs B-rep | OK |
| 1101-0015-0120 | [120.0, 12.0, 12.0] | 90 | 0 | verified vs B-rep | OK |
| 1101-0017-0136 | [136.0, 12.0, 12.0] | 102 | 0 | verified vs B-rep | OK |
| 1101-0019-0152 | [152.0, 12.0, 12.0] | 114 | 0 | verified vs B-rep | OK |
| 1101-0021-0168 | [168.0, 12.0, 12.0] | 126 | 0 | verified vs B-rep | OK |
| 1101-0023-0184 | [184.0, 12.0, 12.0] | 138 | 0 | verified vs B-rep | OK |
| 1101-0029-0232 | [232.0, 12.0, 12.0] | 174 | 0 | verified vs B-rep | OK |
| 1101-0035-0280 | [280.0, 12.0, 12.0] | 210 | 0 | verified vs B-rep | OK |
| 1101-0041-0328 | [328.0, 12.0, 12.0] | 246 | 0 | verified vs B-rep | OK |

#### 1102 (20 SKUs)

| SKU | final bbox (X,Y,Z mm) | snaps | slot-interp snaps | check | verdict |
|---|---|---|---|---|---|
| 1102-0002-0016 | [16.0, 4.0, 8.0] | 4 | 0 | verified vs B-rep | OK |
| 1102-0003-0024 | [24.0, 4.0, 8.0] | 6 | 0 | verified vs B-rep | OK |
| 1102-0004-0032 | [32.0, 4.0, 8.0] | 8 | 0 | verified vs B-rep | OK |
| 1102-0005-0040 | [40.0, 4.0, 8.0] | 10 | 0 | verified vs B-rep | OK |
| 1102-0006-0048 | [48.0, 4.0, 8.0] | 12 | 0 | verified vs B-rep | OK |
| 1102-0007-0056 | [56.0, 4.0, 8.0] | 14 | 0 | verified vs B-rep | OK |
| 1102-0008-0064 | [64.0, 4.0, 8.0] | 16 | 0 | verified vs B-rep | OK |
| 1102-0009-0072 | [72.0, 4.0, 8.0] | 18 | 0 | verified vs B-rep | OK |
| 1102-0010-0080 | [80.0, 4.0, 8.0] | 20 | 0 | verified vs B-rep | OK |
| 1102-0011-0088 | [88.0, 4.0, 8.0] | 22 | 0 | verified vs B-rep | OK |
| 1102-0012-0096 | [96.0, 4.0, 8.0] | 24 | 0 | verified vs B-rep | OK |
| 1102-0013-0104 | [104.0, 4.0, 8.0] | 26 | 0 | verified vs B-rep | OK |
| 1102-0015-0120 | [120.0, 4.0, 8.0] | 30 | 0 | verified vs B-rep | OK |
| 1102-0017-0136 | [136.0, 4.0, 8.0] | 34 | 0 | verified vs B-rep | OK |
| 1102-0019-0152 | [152.0, 4.0, 8.0] | 38 | 0 | verified vs B-rep | OK |
| 1102-0021-0168 | [168.0, 4.0, 8.0] | 42 | 0 | verified vs B-rep | OK |
| 1102-0023-0184 | [184.0, 4.0, 8.0] | 46 | 0 | verified vs B-rep | OK |
| 1102-0029-0232 | [232.0, 4.0, 8.0] | 58 | 0 | verified vs B-rep | OK |
| 1102-0035-0280 | [280.0, 4.0, 8.0] | 70 | 0 | verified vs B-rep | OK |
| 1102-0041-0328 | [328.0, 4.0, 8.0] | 82 | 0 | verified vs B-rep | OK |

#### 1103 (21 SKUs)

| SKU | final bbox (X,Y,Z mm) | snaps | slot-interp snaps | check | verdict |
|---|---|---|---|---|---|
| 1103-0001-0008 | [8.0, 12.0, 12.0] | 4 | 0 | verified vs B-rep | OK |
| 1103-0002-0016 | [16.0, 12.0, 12.0] | 8 | 0 | verified vs B-rep | OK |
| 1103-0003-0024 | [24.0, 12.0, 12.0] | 12 | 0 | verified vs B-rep | OK |
| 1103-0004-0032 | [32.0, 12.0, 12.0] | 16 | 0 | verified vs B-rep | OK |
| 1103-0005-0040 | [40.0, 12.0, 12.0] | 20 | 0 | verified vs B-rep | OK |
| 1103-0006-0048 | [48.0, 12.0, 12.0] | 24 | 0 | verified vs B-rep | OK |
| 1103-0007-0056 | [56.0, 12.0, 12.0] | 28 | 0 | verified vs B-rep | OK |
| 1103-0008-0064 | [64.0, 12.0, 12.0] | 32 | 0 | verified vs B-rep | OK |
| 1103-0009-0072 | [72.0, 12.0, 12.0] | 36 | 0 | verified vs B-rep | OK |
| 1103-0010-0080 | [80.0, 12.0, 12.0] | 40 | 0 | verified vs B-rep | OK |
| 1103-0011-0088 | [88.0, 12.0, 12.0] | 44 | 0 | verified vs B-rep | OK |
| 1103-0012-0096 | [96.0, 12.0, 12.0] | 48 | 0 | verified vs B-rep | OK |
| 1103-0013-0104 | [104.0, 12.0, 12.0] | 52 | 0 | verified vs B-rep | OK |
| 1103-0015-0120 | [120.0, 12.0, 12.0] | 60 | 0 | verified vs B-rep | OK |
| 1103-0017-0136 | [136.0, 12.0, 12.0] | 68 | 0 | verified vs B-rep | OK |
| 1103-0019-0152 | [152.0, 12.0, 12.0] | 76 | 0 | verified vs B-rep | OK |
| 1103-0021-0168 | [168.0, 12.0, 12.0] | 84 | 0 | verified vs B-rep | OK |
| 1103-0023-0184 | [184.0, 12.0, 12.0] | 92 | 0 | verified vs B-rep | OK |
| 1103-0029-0232 | [232.0, 12.0, 12.0] | 116 | 0 | verified vs B-rep | OK |
| 1103-0035-0280 | [280.0, 12.0, 12.0] | 140 | 0 | verified vs B-rep | OK |
| 1103-0041-0328 | [328.0, 12.0, 12.0] | 164 | 0 | verified vs B-rep | OK |

#### 1106 (21 SKUs)

| SKU | final bbox (X,Y,Z mm) | snaps | slot-interp snaps | check | verdict |
|---|---|---|---|---|---|
| 1106-0002-0016 | [16.71, 8.0, 8.0] | 10 | 0 | verified vs B-rep | OK |
| 1106-0003-0024 | [24.56, 8.0, 8.0] | 14 | 0 | verified vs B-rep | OK |
| 1106-0004-0032 | [32.68, 8.0, 8.0] | 18 | 0 | verified vs B-rep | OK |
| 1106-0005-0040 | [40.7, 8.0, 8.0] | 22 | 0 | verified vs B-rep | OK |
| 1106-0006-0048 | [48.73, 8.0, 8.0] | 26 | 0 | verified vs B-rep | OK |
| 1106-0007-0056 | [56.63, 8.0, 8.0] | 30 | 0 | verified vs B-rep | OK |
| 1106-0008-0064 | [64.72, 8.0, 8.0] | 34 | 0 | verified vs B-rep | OK |
| 1106-0009-0072 | [72.55, 8.0, 8.0] | 38 | 0 | verified vs B-rep | OK |
| 1106-0010-0080 | [80.6, 8.0, 8.0] | 42 | 0 | verified vs B-rep | OK |
| 1106-0011-0088 | [88.6, 8.0, 8.0] | 46 | 0 | verified vs B-rep | OK |
| 1106-0012-0096 | [96.74, 8.0, 8.0] | 50 | 0 | verified vs B-rep | OK |
| 1106-0013-0104 | [104.68, 8.0, 8.0] | 54 | 0 | verified vs B-rep | OK |
| 1106-0015-0120 | [120.66, 8.0, 8.0] | 62 | 0 | verified vs B-rep | OK |
| 1106-0017-0136 | [136.7, 8.0, 8.0] | 70 | 0 | verified vs B-rep | OK |
| 1106-0019-0152 | [152.65, 8.0, 8.0] | 78 | 0 | verified vs B-rep | OK |
| 1106-0021-0168 | [168.67, 8.0, 8.0] | 86 | 0 | verified vs B-rep | OK |
| 1106-0023-0184 | [184.65, 8.0, 8.0] | 94 | 0 | verified vs B-rep | OK |
| 1106-0029-0232 | [232.59, 8.0, 8.0] | 118 | 0 | verified vs B-rep | OK |
| 1106-0033-0264 | [264.53, 8.0, 8.0] | 134 | 0 | verified vs B-rep | OK |
| 1106-0035-0280 | [280.57, 8.0, 8.0] | 142 | 0 | verified vs B-rep | OK |
| 1106-0041-0328 | [328.67, 8.0, 8.0] | 166 | 0 | verified vs B-rep | OK |

#### 1109 (19 SKUs)

| SKU | final bbox (X,Y,Z mm) | snaps | slot-interp snaps | check | verdict |
|---|---|---|---|---|---|
| 1109-0024-0043 | [43.5, 24.0, 24.0] | 10 | 0 | verified vs B-rep | OK |
| 1109-0024-0048 | [48.5, 24.0, 24.0] | 10 | 0 | verified vs B-rep | OK |
| 1109-0024-0072 | [72.5, 24.0, 24.0] | 10 | 0 | verified vs B-rep | OK |
| 1109-0024-0096 | [96.5, 24.0, 24.0] | 10 | 0 | verified vs B-rep | OK |
| 1109-0024-0120 | [120.5, 24.0, 24.0] | 10 | 0 | verified vs B-rep | OK |
| 1109-0024-0144 | [144.5, 24.0, 24.0] | 10 | 0 | verified vs B-rep | OK |
| 1109-0024-0168 | [168.5, 24.0, 24.0] | 10 | 0 | verified vs B-rep | OK |
| 1109-0024-0192 | [192.5, 24.0, 24.0] | 10 | 0 | verified vs B-rep | OK |
| 1109-0024-0216 | [216.5, 24.0, 24.0] | 10 | 0 | verified vs B-rep | OK |
| 1109-0024-0240 | [240.5, 24.0, 24.0] | 10 | 0 | verified vs B-rep | OK |
| 1109-0024-0264 | [264.5, 24.0, 24.0] | 10 | 0 | verified vs B-rep | OK |
| 1109-0024-0288 | [288.5, 24.0, 24.0] | 10 | 0 | verified vs B-rep | OK |
| 1109-0024-0336 | [336.5, 24.0, 24.0] | 10 | 0 | verified vs B-rep | OK |
| 1109-0024-0384 | [384.5, 24.0, 24.0] | 10 | 0 | verified vs B-rep | OK |
| 1109-0024-0432 | [432.5, 24.0, 24.0] | 10 | 0 | verified vs B-rep | OK |
| 1109-0024-0528 | [528.5, 24.0, 24.0] | 10 | 0 | verified vs B-rep | OK |
| 1109-0024-0624 | [624.5, 24.0, 24.0] | 10 | 0 | verified vs B-rep | OK |
| 1109-0024-0912 | [912.5, 24.0, 24.0] | 10 | 0 | verified vs B-rep | OK |
| 1109-0024-1200 | [1200.5, 24.0, 24.0] | 10 | 0 | verified vs B-rep | OK |

#### 1116 (11 SKUs)

| SKU | final bbox (X,Y,Z mm) | snaps | slot-interp snaps | check | verdict |
|---|---|---|---|---|---|
| 1116-0024-0040 | [40.0, 2.5, 24.0] | 30 | 0 | verified vs B-rep | OK |
| 1116-0040-0040 | [40.0, 2.5, 40.0] | 50 | 0 | verified vs B-rep | OK |
| 1116-0040-0056 | [56.0, 2.5, 40.0] | 70 | 0 | verified vs B-rep | OK |
| 1116-0040-0072 | [72.0, 2.5, 40.0] | 90 | 0 | verified vs B-rep | OK |
| 1116-0040-0088 | [88.0, 2.5, 40.0] | 110 | 0 | verified vs B-rep | OK |
| 1116-0040-0136 | [136.0, 2.5, 40.0] | 170 | 0 | verified vs B-rep | OK |
| 1116-0056-0056 | [56.0, 2.5, 56.0] | 98 | 0 | verified vs B-rep | OK |
| 1116-0056-0088 | [88.0, 2.5, 56.0] | 154 | 0 | verified vs B-rep | OK |
| 1116-0088-0232 | [232.0, 2.5, 88.0] | 638 | 0 | verified vs B-rep | OK |
| 1116-0136-0232 | [232.0, 2.5, 136.0] | 986 | 0 | verified vs B-rep | OK |
| 1116-0232-0424 | [424.0, 2.5, 232.0] | 3074 | 0 | verified vs B-rep | OK |

#### 1117 (3 SKUs)

| SKU | final bbox (X,Y,Z mm) | snaps | slot-interp snaps | check | verdict |
|---|---|---|---|---|---|
| 1117-0040-0352 | [352.0, 1.5, 40.0] | 440 | 0 | verified vs B-rep | OK |
| 1117-0088-0352 | [352.0, 1.5, 88.0] | 968 | 0 | verified vs B-rep | OK |
| 1117-0216-0352 | [352.0, 1.5, 216.0] | 2376 | 0 | verified vs B-rep | OK |

#### 1120 (26 SKUs)

| SKU | final bbox (X,Y,Z mm) | snaps | slot-interp snaps | check | verdict |
|---|---|---|---|---|---|
| 1120-0001-0048 | [48.0, 48.0, 48.0] | 246 | 48 | verified vs B-rep | OK |
| 1120-0002-0072 | [72.0, 48.0, 48.0] | 408 | 96 | verified vs B-rep | OK |
| 1120-0003-0096 | [96.0, 48.0, 48.0] | 570 | 144 | verified vs B-rep | OK |
| 1120-0004-0120 | [120.0, 48.0, 48.0] | 732 | 192 | verified vs B-rep | OK |
| 1120-0005-0144 | [144.0, 48.0, 48.0] | 894 | 240 | verified vs B-rep | OK |
| 1120-0006-0168 | [168.0, 48.0, 48.0] | 1056 | 288 | verified vs B-rep | OK |
| 1120-0007-0192 | [192.0, 48.0, 48.0] | 1218 | 336 | verified vs B-rep | OK |
| 1120-0008-0216 | [216.0, 48.0, 48.0] | 1380 | 384 | verified vs B-rep | OK |
| 1120-0009-0240 | [240.0, 48.0, 48.0] | 1542 | 432 | verified vs B-rep | OK |
| 1120-0010-0264 | [264.0, 48.0, 48.0] | 1704 | 480 | verified vs B-rep | OK |
| 1120-0011-0288 | [288.0, 48.0, 48.0] | 1866 | 528 | verified vs B-rep | OK |
| 1120-0012-0312 | [312.0, 48.0, 48.0] | 2028 | 576 | verified vs B-rep | OK |
| 1120-0013-0336 | [336.0, 48.0, 48.0] | 2190 | 624 | verified vs B-rep | OK |
| 1120-0014-0360 | [360.0, 48.0, 48.0] | 2352 | 672 | verified vs B-rep | OK |
| 1120-0015-0384 | [384.0, 48.0, 48.0] | 2514 | 720 | verified vs B-rep | OK |
| 1120-0016-0408 | [408.0, 48.0, 48.0] | 2676 | 768 | verified vs B-rep | OK |
| 1120-0017-0432 | [432.0, 48.0, 48.0] | 2838 | 816 | verified vs B-rep | OK |
| 1120-0018-0456 | [456.0, 48.0, 48.0] | 3000 | 864 | verified vs B-rep | OK |
| 1120-0021-0528 | [528.0, 48.0, 48.0] | 3486 | 1008 | verified vs B-rep | OK |
| 1120-0025-0624 | [624.0, 48.0, 48.0] | 4134 | 1200 | verified vs B-rep | OK |
| 1120-0029-0720 | [720.0, 48.0, 48.0] | 4782 | 1392 | verified vs B-rep | OK |
| 1120-0033-0816 | [816.0, 48.0, 48.0] | 5430 | 1584 | verified vs B-rep | OK |
| 1120-0037-0912 | [912.0, 48.0, 48.0] | 6078 | 1776 | verified vs B-rep | OK |
| 1120-0041-1008 | [1008.0, 48.0, 48.0] | 6726 | 1968 | verified vs B-rep | OK |
| 1120-0045-1104 | [1104.0, 48.0, 48.0] | 7374 | 2160 | verified vs B-rep | OK |
| 1120-0049-1200 | [1200.0, 48.0, 48.0] | 8022 | 2352 | verified vs B-rep | OK |

#### 1121 (26 SKUs)

| SKU | final bbox (X,Y,Z mm) | snaps | slot-interp snaps | check | verdict |
|---|---|---|---|---|---|
| 1121-0001-0048 | [48.0, 12.0, 48.0] | 102 | 16 | verified vs B-rep | OK |
| 1121-0002-0072 | [72.0, 12.0, 48.0] | 168 | 32 | verified vs B-rep | OK |
| 1121-0003-0096 | [96.0, 12.0, 48.0] | 234 | 48 | verified vs B-rep | OK |
| 1121-0004-0120 | [120.0, 12.0, 48.0] | 300 | 64 | verified vs B-rep | OK |
| 1121-0005-0144 | [144.0, 12.0, 48.0] | 366 | 80 | verified vs B-rep | OK |
| 1121-0006-0168 | [168.0, 12.0, 48.0] | 432 | 96 | verified vs B-rep | OK |
| 1121-0007-0192 | [192.0, 12.0, 48.0] | 498 | 112 | verified vs B-rep | OK |
| 1121-0008-0216 | [216.0, 12.0, 48.0] | 564 | 128 | verified vs B-rep | OK |
| 1121-0009-0240 | [240.0, 12.0, 48.0] | 630 | 144 | verified vs B-rep | OK |
| 1121-0010-0264 | [264.0, 12.0, 48.0] | 696 | 160 | verified vs B-rep | OK |
| 1121-0011-0288 | [288.0, 12.0, 48.0] | 762 | 176 | verified vs B-rep | OK |
| 1121-0012-0312 | [312.0, 12.0, 48.0] | 828 | 192 | verified vs B-rep | OK |
| 1121-0013-0336 | [336.0, 12.0, 48.0] | 894 | 208 | verified vs B-rep | OK |
| 1121-0014-0360 | [360.0, 12.0, 48.0] | 960 | 224 | verified vs B-rep | OK |
| 1121-0015-0384 | [384.0, 12.0, 48.0] | 1026 | 240 | verified vs B-rep | OK |
| 1121-0016-0408 | [408.0, 12.0, 48.0] | 1092 | 256 | verified vs B-rep | OK |
| 1121-0017-0432 | [432.0, 12.0, 48.0] | 1158 | 272 | verified vs B-rep | OK |
| 1121-0018-0456 | [456.0, 12.0, 48.0] | 1224 | 288 | verified vs B-rep | OK |
| 1121-0021-0528 | [528.0, 12.0, 48.0] | 1422 | 336 | verified vs B-rep | OK |
| 1121-0025-0624 | [624.0, 12.0, 48.0] | 1686 | 400 | verified vs B-rep | OK |
| 1121-0029-0720 | [720.0, 12.0, 48.0] | 1950 | 464 | verified vs B-rep | OK |
| 1121-0033-0816 | [816.0, 12.0, 48.0] | 2214 | 528 | verified vs B-rep | OK |
| 1121-0037-0912 | [912.0, 12.0, 48.0] | 2478 | 592 | verified vs B-rep | OK |
| 1121-0041-1008 | [1008.0, 12.0, 48.0] | 2742 | 656 | verified vs B-rep | OK |
| 1121-0045-1104 | [1104.0, 12.0, 48.0] | 3006 | 720 | verified vs B-rep | OK |
| 1121-0049-1200 | [1200.0, 12.0, 48.0] | 3270 | 784 | verified vs B-rep | OK |

#### 1126 (1 SKUs)

| SKU | final bbox (X,Y,Z mm) | snaps | slot-interp snaps | check | verdict |
|---|---|---|---|---|---|
| 1126-0001-0001 | [56.0, 2.5, 14.0] | 14 | 0 | verified vs B-rep | OK |

#### 1127 (3 SKUs)

| SKU | final bbox (X,Y,Z mm) | snaps | slot-interp snaps | check | verdict |
|---|---|---|---|---|---|
| 1127-0040-0352 | [352.0, 1.5, 40.0] | 440 | 0 | verified vs B-rep | OK |
| 1127-0088-0352 | [352.0, 1.5, 88.0] | 968 | 0 | verified vs B-rep | OK |
| 1127-0216-0352 | [352.0, 1.5, 216.0] | 2376 | 0 | verified vs B-rep | OK |

#### 1137 (3 SKUs)

| SKU | final bbox (X,Y,Z mm) | snaps | slot-interp snaps | check | verdict |
|---|---|---|---|---|---|
| 1137-0001-0001 | [64.0, 2.5, 48.0] | 66 | 0 | verified vs B-rep | OK |
| 1137-0001-0002 | [64.0, 2.5, 64.0] | 78 | 0 | verified vs B-rep | OK |
| 1137-0002-0001 | [64.0, 2.5, 40.0] | 60 | 0 | verified vs B-rep | OK |

#### 1139 (2 SKUs)

| SKU | final bbox (X,Y,Z mm) | snaps | slot-interp snaps | check | verdict |
|---|---|---|---|---|---|
| 1139-0024-0056 | [56.0, 2.5, 24.0] | 42 | 0 | verified vs B-rep | OK |
| 1139-0040-0056 | [56.0, 2.5, 40.0] | 70 | 0 | verified vs B-rep | OK |

#### 1143 (17 SKUs)

| SKU | final bbox (X,Y,Z mm) | snaps | slot-interp snaps | check | verdict |
|---|---|---|---|---|---|
| 1143-0001-0048 | [48.0, 12.0, 32.0] | 62 | 0 | verified vs B-rep | OK |
| 1143-0002-0072 | [72.0, 12.0, 32.0] | 96 | 0 | verified vs B-rep | OK |
| 1143-0003-0096 | [96.0, 12.0, 32.0] | 130 | 0 | verified vs B-rep | OK |
| 1143-0004-0120 | [120.0, 12.0, 32.0] | 164 | 0 | verified vs B-rep | OK |
| 1143-0005-0144 | [144.0, 12.0, 32.0] | 198 | 0 | verified vs B-rep | OK |
| 1143-0006-0168 | [168.0, 12.0, 32.0] | 232 | 0 | verified vs B-rep | OK |
| 1143-0007-0192 | [192.0, 12.0, 32.0] | 266 | 0 | verified vs B-rep | OK |
| 1143-0008-0216 | [216.0, 12.0, 32.0] | 300 | 0 | verified vs B-rep | OK |
| 1143-0009-0240 | [240.0, 12.0, 32.0] | 334 | 0 | verified vs B-rep | OK |
| 1143-0010-0264 | [264.0, 12.0, 32.0] | 368 | 0 | verified vs B-rep | OK |
| 1143-0011-0288 | [288.0, 12.0, 32.0] | 402 | 0 | verified vs B-rep | OK |
| 1143-0012-0312 | [312.0, 12.0, 32.0] | 436 | 0 | verified vs B-rep | OK |
| 1143-0013-0336 | [336.0, 12.0, 32.0] | 470 | 0 | verified vs B-rep | OK |
| 1143-0014-0360 | [360.0, 12.0, 32.0] | 504 | 0 | verified vs B-rep | OK |
| 1143-0015-0384 | [384.0, 12.0, 32.0] | 538 | 0 | verified vs B-rep | OK |
| 1143-0016-0408 | [408.0, 12.0, 32.0] | 572 | 0 | verified vs B-rep | OK |
| 1143-0017-0432 | [432.0, 12.0, 32.0] | 606 | 0 | verified vs B-rep | OK |