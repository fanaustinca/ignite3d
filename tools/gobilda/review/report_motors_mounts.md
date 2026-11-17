# Report: motors_mounts (motors, servos, mounts, blocks, brackets, pillow blocks)

Rule module: `canon/rules_motors_mounts.py` (all prefixes of the family). Helpers: `review/holetable.py` (per-face hole table),
`review/clampfit.py` (coaxial motor-in-clamp check), `review/gen_report_mm.py`. 94 of 95 downloaded SKUs converted and
rendered; `33488` (Hitec HS-488HB) has no STEP in step/; `5203-2402-0051.STEP` is a 0-byte file (downloader failure) -> not converted.

## Rules used
* **Snap rebuild (all SKUs)**: the converter's per-segment snaps are replaced (`rebuild_snaps`) by cluster snaps: hole segments on the same
  axis line (tolerance 0.2 mm: several STEPs, e.g. 1201-0027/0024, have 0.1 mm axis jitter) and same class are merged; gaps <= 2 mm, or <= 5 mm
  caused by a crossing cross-drilled hole, are bridged. This removes the false snaps the old detector emitted *inside* cross-drilled holes
  (thread run-out fragments, crossing holes: 148 -> 66 snaps on 1201-0043-0002) and gives one snap per real opening with depth = full hole depth.
* **Classification**: r 1.45-1.85 (the thread minor-dia cylinder, always modelled together with an r=2.0 major cylinder) -> `m4_hole` **tapped**;
  r=2.0 alone -> `m4_hole` clearance; r=7 -> `bearing_14mm` (placed on the 14 mm segment, i.e. at the floor of the 16 mm r=8 flange counterbore, y=1 on 1201 -
  there is intentionally no snap for the r=8 counterbore); r~4 / hex 4.5 -> `rex_8mm`; r~3 -> `d_6mm`. 32/36/37 mm motor bores and 12 mm bearing bores
  have **no snap type** (documented, not snapped).
* **Slots**: pairs of half-arc holes (mutual nearest neighbours) are slots; centre-to-centre length reported; if > 2 mm extra snaps every 1 mm along
  the centreline (ids `<holeId>s<k><a|b>`, same type/normal/depth). Slot lengths found: 1201-0043-0002 0.693 (below threshold, so only the two end
  snaps); 1201-0043-0004/-0005 0.693, 1.38, 4.69; 1201-0027-0001 4.69 (-> 3 intermediate snaps per face per slot); 1201-0024-0001 none; 1202-0001-0003 0.69.
* **Frames**: motors - see below; servos - spline axis +Y, origin on the spline axis at the spline root (case-top plane), male snap `spline`
  (non-standard type `spline_25t`, reference only; tab holes female clearance; the spline-end screw hole female tapped); 1201 quad blocks - plate pattern
  face (14 mm bore, M4 clearance holes) at y=0, corner posts toward +Y; clamps/pillow blocks/motor mounts (1400/1401/1302/1305/1602/1605/1700/1701/1702/1704) -
  bore axis (or the r=16 pilot for 1701) = Y through the origin, y=0 on the lower face; brackets/others - thinnest bbox axis = Y, centre x/z, y min = 0.
  All rotations are axis-aligned.

## Motor face pattern (5202/5203/5204 Yellow Jacket, identical on all ratios/lengths)
Frame: shaft +Y, origin on the shaft axis, y=0 on the flat mounting land (found from the tessellation: 0.25 mm proud of the pad tops; thread chamfers
overshoot it by 0.1-0.35 and are clamped to y=0). Male snap `shaft` at the origin, normal +Y, type `rex_8mm` (5203/5204, round r=4.0 with flats)
or `d_6mm` (5202, r=3.0).
* **4 x tapped M4 at (+-8, +-8)** (a 16 mm square = radius 11.31 at 45 deg, the same as the 1120 16 mm hub pattern; r=1.65/2.0, through the 10.85 mm gearbox
  flange, snap at y=0, normal +Y).
* **2 x tapped M4 at (+-12, 0)** (24 mm spacing, depth 7.0) but their opening is **recessed 4.0 mm below the land (y=-4.0)** - they are not reachable by a flat plate on the face.
* **Gearbox sides**: 8 tapped holes, 2 on each of the 4 sides at y=-15.1 (depth 7.5) and y=-29.2 (depth 9.4), centred on the side (x or z = 0), r=1.5
  (3.0 mm drill: this is an **M3** tap drill, not M4. Marked tapped `m4_hole` as instructed; flag for the app).
* Shaft tip: tapped hole on the axis (y = shaft tip, depth 13.85, r=1.65, tapped `m4_hole`, normal +Y).
* Motor rear end: no snaps (the r=1.5 / r=2.19 holes found there are internal through-bolt bores; deliberately dropped).
* **Consequence for 1120**: a motor face snapped onto a 1120 web outer face (1120 hole `h10b`, motor hole `h11b`) puts the 4 (+-8,+-8) holes onto the
  channel's 8 mm-grid holes and the shaft through the 14 mm bore.

## Fit checks (fitcheck.py unless noted)
| joint | coincident holes | interference mm3 | verdict |
|---|---|---|---|
| 5203-2402-0001 face -> 1120-0001-0048 web (h10b/h11b) | 4 | 0.0 | OK, shaft through 14 mm bore |
| 5202-2402-0003 face -> 1120-0001-0048 web | 4 | 0.0 | OK |
| 5204-8002-0003 face -> 1120-0001-0048 web | 4 | 0.0 | OK (80 mm shaft) |
| 1201-0043-0002 y=0 face -> 1120 web inner face (h10a/h17a) | 24 | 0.0 | OK |
| 1602-0032-0008 pillow block -> 1120 wall face (h43a/h0b) | 2 | 2.65 | pattern matches (32 mm pair); tiny overlap, not investigated further (0.01 % of volume; probably thread/chamfer geometry) |
| 1204-0002-0001 gusseted angle -> 1120 wall face (h43a/h0b) | 5 | 19.3 | pattern matches; 19 mm3 overlap NOT resolved (open issue) |
| 5203 in 1400-0032-0037 (37 mm bore), coaxial (clampfit, dy=8) | n/a (no bore snap type) | 0.0 | OK |
| 5203 in 1400-0032-0036 (36 mm bore) | n/a | 0.45 | tiny (slight interference of an ear/rim; effectively fits) |
| 5203 in 1400-0032-0032 (32 mm bore) | n/a | 567.6 | correctly does NOT fit (motor is 37 mm) |

Interference history worth knowing: the first motor frame (face plane = pad tops) gave 4 x 10 mm3 of overlap because the real flat land is 0.25 mm proud of the pads; moving
the plane to the land (detected from the mesh) brought it to exactly 0.

## Per-face hole tables
### 1201-0043-0002 (quad block; y=0 is the plate pattern face; coordinates are the two in-plane axes in x,z order for y faces, y,z for x faces, x,y for z faces)
```
## 1201-0043-0002 bbox [[-21.8643, -0.3689, -21.8643], [21.8643, 12.3769, 21.8643]] snaps 66 male []
 face n=(-1, 0, 0) x=-21.5: {('m4_hole', 'T', 8.5): 2}
     [(8.0, -16.0), (8.0, 16.0)]
 face n=(-1, 0, 0) x=13.0: {('m4_hole', 'T', 8.5): 2}
     [(8.0, -16.0), (8.0, 16.0)]
 face n=(1, 0, 0) x=-13.0: {('m4_hole', 'T', 8.5): 2}
     [(8.0, -16.0), (8.0, 16.0)]
 face n=(1, 0, 0) x=21.5: {('m4_hole', 'T', 8.5): 2}
     [(8.0, -16.0), (8.0, 16.0)]
 face n=(0, -1, 0) y=0.0: {('m4_hole', 'T', 12.0): 4, ('m4_hole', 'T', 4.0): 4, ('m4_hole', 'C', 4.0): 16}
     [(-16.0, -16.0), (-16.0, -8.0), (-16.0, 8.0), (-16.0, 16.0), (-11.3, 0.0), (-8.5, -8.5), (-8.5, 8.5), (-8.0, -16.0), (-8.0, -8.0), (-8.0, 8.0), (-8.0, 16.0), (0.0, -11.3), (0.0, 11.3), (8.0, -16.0), (8.0, -8.0), (8.0, 8.0), (8.0, 16.0), (8.5, -8.5), (8.5, 8.5), (11.3, 0.0), (16.0, -16.0), (16.0, -8.0), (16.0, 8.0), (16.0, 16.0)]
 face n=(0, -1, 0) y=1.0: {('bearing_14mm', 'C', 3.0): 1}
     [(0.0, 0.0)]
 face n=(0, 1, 0) y=4.0: {('m4_hole', 'T', 4.0): 4, ('m4_hole', 'C', 4.0): 16, ('bearing_14mm', 'C', 3.0): 1}
     [(-16.0, -8.0), (-16.0, 8.0), (-11.3, 0.0), (-8.5, -8.5), (-8.5, 8.5), (-8.0, -16.0), (-8.0, -8.0), (-8.0, 8.0), (-8.0, 16.0), (0.0, -11.3), (0.0, 0.0), (0.0, 11.3), (8.0, -16.0), (8.0, -8.0), (8.0, 8.0), (8.0, 16.0), (8.5, -8.5), (8.5, 8.5), (11.3, 0.0), (16.0, -8.0), (16.0, 8.0)]
 face n=(0, 1, 0) y=12.0: {('m4_hole', 'T', 12.0): 4}
     [(-16.0, -16.0), (-16.0, 16.0), (16.0, -16.0), (16.0, 16.0)]
 face n=(0, 0, -1) z=-21.5: {('m4_hole', 'T', 8.5): 2}
     [(-16.0, 8.0), (16.0, 8.0)]
 face n=(0, 0, -1) z=13.0: {('m4_hole', 'T', 8.5): 2}
     [(-16.0, 8.0), (16.0, 8.0)]
 face n=(0, 0, 1) z=-13.0: {('m4_hole', 'T', 8.5): 2}
     [(-16.0, 8.0), (16.0, 8.0)]
 face n=(0, 0, 1) z=21.5: {('m4_hole', 'T', 8.5): 2}
     [(-16.0, 8.0), (16.0, 8.0)]
```
Check against the mesh (render `review/img/1201-0043-0002.png`): 16 clearance + 4 tapped (11.31 radius pattern) + 4 (+-8.49, +-8.49) 0.7 mm slot ends on the plate, the 14 mm bearing bore with its 16 mm flange counterbore (snaps at y=1 and y=4),
4 corner posts each with a 12 mm tapped vertical hole (opens y=0 and y=12) and 2 cross holes (8.5 deep, tapped, from the post outer face to the post inner face).
### 5203-2402-0001 (motor)
```
## 5203-2402-0001 bbox [[-19.9713, -107.6751, -19.969], [19.9699, 23.6825, 19.9722]] snaps 15 male [('shaft', 'rex_8mm', [0.0, 0.0, 0.0], [0.0, 1.0, 0.0])]
 face n=(-1, 0, 0) x=-15.84: {('m4_hole', 'T', 9.3927): 1, ('m4_hole', 'T', 7.4751): 1}
     [(-29.2, 0.0), (-15.1, 0.0)]
 face n=(1, 0, 0) x=15.83: {('m4_hole', 'T', 9.3927): 1}
     [(-29.2, 0.0)]
 face n=(1, 0, 0) x=15.84: {('m4_hole', 'T', 7.4751): 1}
     [(-15.1, 0.0)]
 face n=(0, 1, 0) y=-4.0: {('m4_hole', 'T', 7.0): 2}
     [(-12.0, 0.0), (12.0, 0.0)]
 face n=(0, 1, 0) y=0.0: {('m4_hole', 'T', 10.85): 4}
     [(-8.0, -8.0), (-8.0, 8.0), (8.0, -8.0), (8.0, 8.0)]
 face n=(0, 1, 0) y=23.35: {('m4_hole', 'T', 13.85): 1}
     [(0.0, 0.0)]
 face n=(0, 0, -1) z=-15.84: {('m4_hole', 'T', 7.4752): 1}
     [(0.0, -15.1)]
 face n=(0, 0, -1) z=-15.83: {('m4_hole', 'T', 9.3927): 1}
     [(0.0, -29.2)]
 face n=(0, 0, 1) z=15.84: {('m4_hole', 'T', 9.3927): 1, ('m4_hole', 'T', 7.4751): 1}
     [(0.0, -29.2), (0.0, -15.1)]
```

## Per-SKU results (snaps = after rule; T=tapped, C=clearance; ext = bbox extents in the final frame)
| SKU | snaps | by type | ext | male |
|---|---|---|---|---|
| 1108-0001-0001 | 44 | bearing_14mm/C:2, m4_hole/C:42 | [40.0, 2.5, 56.0] | 0 |
| 1141-0001-0001 | 68 | bearing_14mm/C:4, m4_hole/C:64 | [40.0, 32.0, 40.0] | 0 |
| 1142-0001-0001 | 96 | bearing_14mm/C:4, m4_hole/C:92 | [60.0, 40.0, 68.0] | 0 |
| 1201-0024-0001 | 38 | bearing_14mm/C:2, m4_hole/C:12, m4_hole/T:24 | [24.5, 12.6, 43.6] | 0 |
| 1201-0027-0001 | 58 | bearing_14mm/C:2, m4_hole/C:32, m4_hole/T:24 | [27.7, 12.6, 43.7] | 0 |
| 1201-0043-0002 | 66 | bearing_14mm/C:2, m4_hole/C:32, m4_hole/T:32 | [43.7, 12.7, 43.7] | 0 |
| 1201-0043-0004 | 156 | bearing_14mm/C:4, m4_hole/C:132, m4_hole/T:20 | [43.5, 12.5, 67.3] | 0 |
| 1201-0043-0005 | 100 | bearing_14mm/C:4, m4_hole/C:72, m4_hole/T:24 | [46.1, 12.5, 43.6] | 0 |
| 1202-0001-0003 | 68 | bearing_14mm/C:4, m4_hole/C:64 | [40.0, 32.0, 40.0] | 0 |
| 1203-0001-0001 | 4 | m4_hole/T:4 | [11.2, 6.0, 10.1] | 0 |
| 1204-0001-0001 | 8 | m4_hole/C:4, rex_8mm/C:4 | [15.0, 14.0, 15.0] | 0 |
| 1204-0001-0002 | 8 | m4_hole/C:4, rex_8mm/C:4 | [19.0, 14.0, 15.0] | 0 |
| 1204-0001-0003 | 8 | m4_hole/C:4, rex_8mm/C:4 | [19.0, 14.0, 19.0] | 0 |
| 1204-0002-0001 | 40 | m4_hole/C:4, m4_hole/T:36 | [43.3, 7.5, 43.3] | 0 |
| 1205-0001-0003 | 14 | m4_hole/C:6, m4_hole/T:8 | [43.6, 6.0, 12.6] | 0 |
| 1205-0001-0004 | 14 | m4_hole/C:6, m4_hole/T:8 | [40.0, 10.1, 12.6] | 0 |
| 1205-0001-0005 | 18 | m4_hole/C:6, m4_hole/T:12 | [12.5, 10.5, 43.6] | 0 |
| 1205-0002-0001 | 14 | m4_hole/C:2, m4_hole/T:12 | [12.6, 10.1, 27.6] | 0 |
| 1211-0001-0001 | 32 | m4_hole/C:22, m4_hole/T:10 | [40.0, 12.0, 40.4] | 0 |
| 1222-0001-0001 | 82 | bearing_14mm/C:2, m4_hole/C:80 | [40.0, 6.0, 40.0] | 0 |
| 1302-0032-0032 | 9 | m4_hole/T:9 | [40.0, 8.7, 47.1] | 0 |
| 1305-0032-0032 | 9 | m4_hole/C:8, m4_hole/T:1 | [40.0, 8.0, 47.1] | 0 |
| 1400-0032-0032 | 5 | m4_hole/T:5 | [42.2, 8.0, 43.3] | 0 |
| 1400-0032-0036 | 5 | m4_hole/T:5 | [46.2, 8.0, 45.3] | 0 |
| 1400-0032-0037 | 5 | m4_hole/T:5 | [47.2, 8.0, 45.8] | 0 |
| 1401-0043-0032 | 17 | m4_hole/T:17 | [43.6, 8.0, 46.5] | 0 |
| 1401-0043-0036 | 17 | m4_hole/T:17 | [43.5, 8.0, 49.0] | 0 |
| 1601-1032-0012 | 0 |  | [35.9, 10.1, 35.9] | 0 |
| 1602-0032-0004 | 6 | m4_hole/C:2, m4_hole/T:4 | [38.0, 7.0, 34.3] | 0 |
| 1602-0032-0006 | 6 | d_6mm/C:2, m4_hole/T:4 | [38.0, 7.0, 34.8] | 0 |
| 1602-0032-0008 | 6 | m4_hole/T:4, rex_8mm/C:2 | [38.0, 7.0, 34.3] | 0 |
| 1602-0032-0012 | 4 | m4_hole/T:4 | [38.0, 7.0, 37.8] | 0 |
| 1602-0032-0032 | 4 | m4_hole/T:4 | [45.0, 7.0, 46.8] | 0 |
| 1602-0032-4008 | 4 | m4_hole/T:4 | [38.0, 7.0, 34.3] | 0 |
| 1605-0024-0004 | 4 | m4_hole/C:2, m4_hole/T:2 | [20.0, 7.0, 34.2] | 0 |
| 1605-0024-0006 | 4 | d_6mm/C:2, m4_hole/T:2 | [21.0, 7.0, 34.8] | 0 |
| 1605-0024-0008 | 4 | m4_hole/T:2, rex_8mm/C:2 | [20.0, 7.0, 34.2] | 0 |
| 1605-0024-4008 | 2 | m4_hole/T:2 | [20.0, 7.0, 34.2] | 0 |
| 1700-0016-0008 | 8 | m4_hole/T:8 | [32.0, 6.0, 32.0] | 0 |
| 1700-0016-0011 | 14 | bearing_14mm/C:2, m4_hole/C:8, m4_hole/T:4 | [40.5, 11.5, 40.5] | 0 |
| 1700-0016-0014 | 30 | bearing_14mm/C:2, d_6mm/T:4, m4_hole/C:16, m4_hole/T:8 | [44.8, 11.3, 44.8] | 0 |
| 1700-0016-0017 | 30 | bearing_14mm/C:2, d_6mm/T:4, m4_hole/C:16, m4_hole/T:8 | [51.8, 11.3, 51.8] | 0 |
| 1700-0016-0023 | 94 | bearing_14mm/C:2, m4_hole/C:24, m4_hole/T:20, rex_8mm/C:48 | [55.6, 18.3, 55.6] | 0 |
| 1701-0016-0003 | 16 | m4_hole/T:16 | [44.9, 10.6, 38.7] | 0 |
| 1702-0032-0001 | 48 | m4_hole/C:4, m4_hole/T:44 | [58.7, 15.2, 38.0] | 0 |
| 1704-1632-0001 | 20 | d_6mm/T:4, m4_hole/C:8, m4_hole/T:8 | [43.0, 7.4, 43.0] | 0 |
| 2000-0025-0002 | 9 | m4_hole/C:8, m4_hole/T:1 | [54.6, 44.3, 21.7] | 1 |
| 2000-0025-0003 | 9 | m4_hole/C:8, m4_hole/T:1 | [54.6, 44.3, 21.7] | 1 |
| 2000-0025-0004 | 9 | m4_hole/C:8, m4_hole/T:1 | [54.6, 44.3, 21.7] | 1 |
| 2000-0025-0502 | 9 | m4_hole/C:8, m4_hole/T:1 | [54.6, 44.3, 21.7] | 1 |
| 2000-0025-0503 | 9 | m4_hole/C:8, m4_hole/T:1 | [54.6, 44.3, 21.7] | 1 |
| 2000-0025-0504 | 9 | m4_hole/C:8, m4_hole/T:1 | [54.6, 44.3, 21.7] | 1 |
| 2002-0180-0002 | 9 | m4_hole/C:8, m4_hole/T:1 | [54.6, 44.3, 21.7] | 1 |
| 2002-0180-0003 | 9 | m4_hole/C:8, m4_hole/T:1 | [54.6, 44.3, 21.7] | 1 |
| 2004-0025-0001 | 8 | m4_hole/C:8 | [54.5, 34.3, 20.2] | 1 |
| 2004-0025-0002 | 25 | m4_hole/C:8, m4_hole/T:17 | [54.0, 43.0, 20.0] | 1 |
| 2902-0025-0001 | 4 | m4_hole/C:4 | [16.6, 8.6, 8.6] | 0 |
| 3202-0001-2501 | 182 | bearing_14mm/C:10, m4_hole/C:100, m4_hole/T:34, rex_8mm/C:38 | [63.0, 43.5, 54.5] | 0 |
| 3202-0001-2503 | 110 | bearing_14mm/C:4, m4_hole/C:84, m4_hole/T:22 | [71.3, 43.6, 63.0] | 0 |
| 3202-0002-2501 | 241 | bearing_14mm/C:10, d_6mm/C:4, m4_hole/C:120, m4_hole/T:39, rex_8mm/C:68 | [88.0, 48.6, 53.6] | 0 |
| 3202-0002-2502 | 147 | bearing_14mm/C:8, d_6mm/C:4, m4_hole/C:104, m4_hole/T:31 | [88.0, 48.6, 56.3] | 0 |
| 3217-0001-2501 | 119 | bearing_14mm/C:4, bearing_14mm/T:1, m4_hole/C:16, m4_hole/T:60, rex_8mm/C:38 | [43.5, 30.9, 67.5] | 0 |
| 3217-2701-2501 | 121 | bearing_14mm/C:4, bearing_14mm/T:1, m4_hole/C:16, m4_hole/T:32, rex_8mm/C:68 | [59.9, 30.6, 32.0] | 0 |
| 3217-2703-2501 | 60 | bearing_14mm/C:4, m4_hole/C:16, m4_hole/T:40 | [32.0, 29.9, 62.0] | 0 |
| 5202-2402-0003 | 14 | m4_hole/T:14 | [39.4, 133.2, 39.9] | 1 |
| 5202-2402-0005 | 14 | m4_hole/T:14 | [39.4, 133.2, 39.9] | 1 |
| 5202-2402-0014 | 14 | m4_hole/T:14 | [39.4, 142.1, 39.9] | 1 |
| 5202-2402-0019 | 14 | m4_hole/T:14 | [39.4, 142.1, 39.9] | 1 |
| 5202-2402-0027 | 14 | m4_hole/T:14 | [39.4, 142.1, 39.9] | 1 |
| 5202-2402-0051 | 14 | m4_hole/T:14 | [39.4, 150.8, 39.9] | 1 |
| 5202-2402-0071 | 14 | m4_hole/T:14 | [39.4, 150.8, 39.9] | 1 |
| 5202-2402-0100 | 14 | m4_hole/T:14 | [39.4, 150.8, 39.9] | 1 |
| 5202-2402-0139 | 14 | m4_hole/T:14 | [39.4, 150.8, 39.9] | 1 |
| 5202-2402-0188 | 14 | m4_hole/T:14 | [39.4, 159.7, 39.9] | 1 |
| 5203-2402-0001 | 15 | m4_hole/T:15 | [39.9, 131.4, 39.9] | 1 |
| 5203-2402-0003 | 15 | m4_hole/T:15 | [39.9, 131.4, 39.9] | 1 |
| 5203-2402-0005 | 15 | m4_hole/T:15 | [39.9, 131.4, 39.9] | 1 |
| 5203-2402-0014 | 15 | m4_hole/T:15 | [39.9, 140.2, 39.9] | 1 |
| 5203-2402-0019 | 15 | m4_hole/T:15 | [39.9, 140.2, 39.9] | 1 |
| 5203-2402-0027 | 15 | m4_hole/T:15 | [39.9, 140.2, 39.9] | 1 |
| 5203-2402-0051 | NO OUTPUT | - | - | - |
| 5203-2402-0071 | 15 | m4_hole/T:15 | [39.9, 148.9, 39.9] | 1 |
| 5203-2402-0100 | 15 | m4_hole/T:15 | [39.9, 148.9, 39.9] | 1 |
| 5203-2402-0139 | 15 | m4_hole/T:15 | [39.9, 148.9, 39.9] | 1 |
| 5203-2402-0188 | 15 | m4_hole/T:15 | [39.9, 157.9, 39.9] | 1 |
| 5204-8002-0003 | 16 | m4_hole/T:16 | [39.9, 187.3, 39.9] | 1 |
| 5204-8002-0005 | 16 | m4_hole/T:16 | [39.9, 187.3, 39.9] | 1 |
| 5204-8002-0014 | 16 | m4_hole/T:16 | [39.9, 196.2, 39.9] | 1 |
| 5204-8002-0019 | 16 | m4_hole/T:16 | [39.9, 196.2, 39.9] | 1 |
| 5204-8002-0027 | 16 | m4_hole/T:16 | [39.9, 196.2, 39.9] | 1 |
| 5204-8002-0051 | 16 | m4_hole/T:16 | [39.9, 204.9, 39.9] | 1 |
| 5204-8002-0071 | 16 | m4_hole/T:16 | [39.9, 204.9, 39.9] | 1 |
| 5204-8002-0100 | 16 | m4_hole/T:16 | [39.9, 204.9, 39.9] | 1 |
| 5204-8002-0139 | 16 | m4_hole/T:16 | [39.9, 204.9, 39.9] | 1 |
| 5204-8002-0188 | 16 | m4_hole/T:16 | [39.9, 213.8, 39.9] | 1 |

Verdicts: all rows above are **converted + rendered**. Detailed visual verification: all 1201 quad blocks, motors 5202/5203/5204 (one per series), servo 2000, ServoBlock 3202, 3217, 1400, 1602,
1700-17, 1141. Unviewed variants share geometry with a viewed one (same frame rule): 1700 NEMA sizes, 1605, 2002, 2004-0001.
* 5203-2402-0051: **no output** (STEP file is 0 bytes). Re-download needed.
* 33488 (Hitec HS-488HB): no STEP downloaded, not converted.
* 1601-1032-0012 flanged bearing: converted, 0 snaps (12 mm bore and 32 mm OD have no snap type).

## Open issues / honesty notes
* 1201-0024-0001: the two centre post holes (0,+-16) have irregular STEP modelling (half-arc and boss fragments); one of the two is emitted with a shorter
  depth and its y=0 end is missing in the snap set - post hole snaps there are the least trustworthy of the quad blocks.
* Several 1201 STEPs have ~0.1 mm hole-axis jitter (1201-0027: x=-7.98 vs 8.02, z=16.1 etc.). Positions are the real STEP positions, not regridded.
* Thread-end snaps within one hole sit at the true opening plane but some STEPs have chamfers so faces of identical holes differ by 0.05-0.1 mm in y (1201-0024/0027).
* 3202 ServoBlocks and 3217 are full assemblies including their screws/bearings/hubs; their 100-240 snaps include holes of the hardware parts, and the 8 mm slot on 3202 gets `rex_8mm` with 1 mm slot snaps. Not individually verified; probably need an `exclude`/override pass by someone who knows which holes are real mounting points.
* 1700 NEMA mount arms: r=3 holes are typed `d_6mm` (6 mm round hole) by radius; they are clearance holes for M5/6 mm hardware, so the type is questionable.
* Servo male snap type `spline_25t` is not in the app's snap type list; map or drop it. 2000/2002/2004 geometry has no hex/spline-key detail checked.
* M3 vs M4: gearbox side holes are r=1.5 (M3 drill) and the motor face holes r=1.65 (M4); both emitted as tapped `m4_hole`.
* 1204-0002 19 mm3 overlap and 1602 2.7 mm3 overlap to 1120 not explained.
* The fit checks use a single 1120-0001-0048 channel; fits on other 1120 lengths not repeated.
