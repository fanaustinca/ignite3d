# Power transmission review (shafts, hubs, bearings, collars, gears, pulleys)
Saved by the main session from the review agent's hand-back report.

- Rule: canon/rules_power_transmission.py (frames + male snaps). Female fixes: pt_overrides.py -> overrides/SKU.json (re-run after every batch.py).
- 151 SKUs converted. Excluded: 5023334001 (tool, no STEP), 3204-0002-0001/0002 (two meshed bevel gears + hardware in one STEP; needs splitting).
- REX: real 8 mm REX bores are modelled as planar hex facets (flats ~3.5 mm, corners ~4.0 mm from axis) -> the arc detector finds nothing; bore snaps are added from the SKU bore code (4008/0008 rex_8mm, 1006/0006 d_6mm, 0014 bearing_14mm) with axial extent from the real mesh. Round 8 mm bores detected correctly. E-clip groove false rex removed. 14 mm hub-mount bores split at a seam -> merged. 2106 shafts have M4 tapped ends (~12 mm deep). Hub pattern holes modelled twice (clearance + tap) -> one hub_pattern_16mm tapped snap per face. 12 mm REX (2102/2109) frame only.
- REX/D bore snaps and male shaft snaps carry `up` vectors (hex corner / D-flat direction) so rotation seats correctly.
- 2101-0006 titles in parts.json are wrong by 10x for some SKUs; geometry is correct (e.g. -0100 is 100 mm).

## Fit checks (interference mm3)
| Joint | coincident | interference |
|---|---|---|
| 1120-0001-0048 h20b (14 mm bore) <- 1611-0514-4008 barrel | 1 | 0.0 |
| 1611-0514-4008 REX ID <- 2106 endA | 1 | 0.28 |
| 1611-0514-0008 round ID <- 2106 endA | 1 | 0.006 |
| 1309-0016-4008 bore <- 2106 endA | 1 | 0.88 |
| 1310-0016-4008 bore <- 2106-4008-0480 endA | 1 | 0.91 |
| 1309-0016-1006 D bore <- 2101-0006-0100 endA | 1 | 0.82 |
| 1309-0016-4008 pattern <- 2302-0014-0048 | 4 | 0.0 |
| 1310-0016-4008 pattern (lower face) <- 2302-0014-0048 | 4 | 0.0 |
| 1309-0016-4008 pattern <- 2312-0414-0048 | 4 | 0.18 |
| 1309-0016-4008 pattern <- 3415-0014-0048 (mh11b face) | 4 | 0.13 |
| 2106 endA <- 2910-0920-4008 collar | 1 | 9.98 (tolerance contact / hex angle estimate) |
| 2106 endA <- 2303-4008-0020 pinion | 1 | 3.08 |

REX-in-REX is a zero-clearance fit: ~0.3-0.9 mm3 when the hex is aligned.

## Open issues
- Which hub face is threaded is unknown -> both faces tapped. Radial clamp holes on 1309/1310 assumed threaded.
- 2312 hole set mixes two 16 mm-pattern orientations plus a ring at r=12; all kept as m4 clearance.
- Not fit-checked: collar on hub, 2312 on 1310, miter gears, U-joint.
