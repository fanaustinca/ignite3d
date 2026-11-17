# wheels_slides report

Rule: `canon/rules_wheels_slides.py` (prefixes 3213 3625 3601 3612 3614 3619 3613 3632 3624 3210). Overrides in `overrides/`.
All 27 downloaded SKUs converted (`3210-*` needed ~35 min each; `batch.py` has a 1800 s per-SKU timeout and crashed on them, so those were run via `convert.py` directly, then Draco-compressed by hand). Visually checked: 3601-0014-0096, 3601-0032-0096, 3613-4008-0032, 3614-0014-0072, 3619-0014-0096, 3624-4008-0032/0048, 3624-0014-0096, 3632-0014-0072, 3213-3606-0003, 3625-0202-0104, 3210-0003-0002, 3210-0004-0004. Other size variants are the same geometry family at different diameters and were only checked by snap counts.

## Rules
* Wheels: axle axis = direction of the bore (r 4/7/16 mm) holes, else shortest bbox axis -> mapped to X (axis-aligned R). Radial centre = bore axis (single-solid wheels) or the volume centroid (many-solid roller wheels 3213/3625/3624, because OCC bboxes of roller solids are loose). Axial centre = bbox centre (single-solid) / centroid (roller wheels).
* 3210 kits: longest bbox axis -> X, bbox centred; Y/Z left as in STEP (Y-up, base underside = -Y face). Y orientation not otherwise verified.

## Per-SKU verdicts
| SKU(s) | verdict |
|---|---|
| 3601-0014-0072/0096/0120 (Rhino 14 mm) | OK. 14 mm bore = bearing_14mm both sides, 8 mm grid of m4 holes (incl. 16 mm square pattern) both faces. Many grid holes (64-224), real. |
| 3601-0032-0096/0120 (32 mm bore) | OK geometry/grid holes; the 32 mm bore has NO snap (no snap type exists for it). |
| 3612-0014-0096, 3614-0014-0072/0096, 3619-0014-0096 | OK (same as 3601; 3614/3619 are 44-solid with a separate tread). |
| 3632-0014-0072/0096, 3613-0014-0072/0096 (Gecko 14 mm) | OK: 14 mm bearing bore + 8 hub holes on 22.6 mm circle plus 16 mm square holes. Note STEP bbox 76.8/102.8 mm (tread knobs) for 72/96 nominal. |
| 3613/3632-4008-0032/0048 (Gecko REX) | FIXED by override: hex REX bore is not a cylinder so the detector found 0 snaps; added `rex_8mm` snaps `rexA/rexB` at x=+-8 (through-bore ASSUMED, depth 16). |
| 3624-4008-0032 (omni 32 mm) | FIXED the same way (rex_8mm at x=+-7.555). |
| 3624-4008-0048 | 14 mm bearing pockets (7.65 deep each side, with 1.5 mm gap) detected; the 8 mm hex through-bore was NOT added (uncertain how bearing pockets and REX bore interact). 24 m4 + 4 tapped hub holes OK. Open issue. |
| 3624-0014-0072/0096 | OK (14 mm bearing bore + m4 pattern). |
| 3213-3606-0002 (96 mm) / -0003 (140 mm) | OK, single wheel (see mecanum findings). 0003: 8 rim roller-pin holes (r 44) removed by override. |
| 3625-0202-0104 | OK, single wheel. |
| 3210-0003-0002, 3210-0003-0004, 3210-0004-0004 | PARTIAL. Geometry good (190-270 solids, full extension 880-990 mm, length on X). Detector found ~1000-1270 snaps from internal parts; override keeps only the base-rail mounting-plane holes (3 rows, 16 mm row pitch, 8 mm hole pitch; 109/125/93 snaps). Which holes are the "base" is my inference (most populous -Y facing plane), not verified against goBILDA docs, and the plane differs between the 2-stage (y=-2.5) and 4-stage (y=-20.5) kits. |
| 3611-0030/0040/0140-0104 | EXCLUDED (spare roller pack); no STEP was downloaded either way. |

## Mecanum findings
* The STEP of every mecanum SKU is ONE wheel (3213-3606-0002: 41 solids, 96 mm; 3213-3606-0003: 403 solids = 2 plates + 16 rollers x (roller+bearing/pins), 140 mm, 37 mm wide; 3625-0202-0104: 223 solids, 104 mm). No set of 4. Left/right: STEP contains a single handedness (rollers tilted one way); the mirror is not in the file. Ignite3D should place the one wheel and mirror it (scale x -1 / rotate) for the other hand; the rest of the set = 4 copies, 2 mirrored.
* JSON `bbox` for roller wheels is inflated (OCC loose bbox: 3213-3606-0003 shows 78.6 x 197.9 x 197.9 in out json although the real wheel is 37.3 x 140 x 140; the renderer shows the true 37.3 x 140). Coordinator should recompute bbox from the mesh for these SKUs (also 3625, 3624, 3213-0002).

## Fit checks (fitcheck.py; interference mm3)
| joint | result |
|---|---|
| 1309-0016-4008 hub (override snap mh12a) <- 3601-0014-0096 h61b / h61a | 4 coincident holes, 0.001 / 0.001 |
| hub mh12a <- 3624-0014-0072 h395b | 4 coincident, 0.001 (h395a 0.367) |
| hub mh12a/mh12b <- 3632-0014-0072 h5a/h5b | 4 coincident, but 36.0 mm3 interference in every orientation. Not resolved: probably a hub boss/collar entering the Gecko's 14 mm bore/recessed web. |
| hub mh12b <- 3601 h61b | 174 mm3 (wrong face; h61a on mh12b is 0.178). Face choice matters: the two faces are not symmetric. |
| 2106-4008-0240 shaft end (male endB added in my test script only) <- Gecko 3632-4008-0032 / 3613-4008-0048 rexA | 1 coincident face, 37.0 mm3 (24.5 mm3 for 3624-4008-0032). Quarter turns 0/2: 81 mm3, 1/3: 37 mm3. A hex bore cannot be aligned with 90 deg turns (hex symmetry 60 deg), so the residual is orientation, not position; position/insertion depth look right. The 2106 shaft currently has no male snaps in its out/override (I injected one for the test). |
| 1120-0001-0048 channel h7a <- 3210-0003-0002 h290a | 7 coincident holes, 344.7 mm3. NOT clean: the slide has hardware below its mounting-plane (y down to -24.9) that collides with the channel; I could not find a face pairing that gives a clean contact. Unresolved. |

## Open issues
1. Viper-Slide base-rail identification and orientation unverified; fit with 1120 channel interferes.
2. REX hex bores are hand-added snaps (assumed through, depth = hub width). 3624-4008-0048 lacks a rex_8mm snap.
3. Gecko-on-1309-hub 36 mm3 and shaft/hex orientation residuals.
4. 32 mm bore of 3601-0032 has no snap type.
5. Loose bbox values in out/*.json for roller wheels (see above).
6. batch.py 1800 s timeout is too short for 3210-* kits.
