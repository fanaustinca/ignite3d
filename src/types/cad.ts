// Core CAD data schemas. All lengths are millimetres, Y is up (Three.js convention).

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];

export type SnapType = 'm4_hole' | 'bearing_14mm' | 'rex_8mm' | 'd_6mm' | 'hub_pattern_16mm';

/**
 * A mating feature on a part.
 *
 * Mating rule (used everywhere): when part A's snap point mates with part B's,
 * A.position == B.position and A.normal == -B.normal.
 *
 * - Hole faces: `normal` points OUT of the material along the hole axis.
 *   Through holes get one snap point on each face, both with the same `depth`
 *   (material thickness along the axis) and the same `holeId`.
 * - Male features (screw under-head, shaft ends, bearing flange underside):
 *   `normal` points in the direction the feature is inserted, so after mating
 *   the body goes into the other part's hole.
 */
export interface SnapPoint {
  id: string;
  type: SnapType;
  position: Vec3;
  normal: Vec3;
  upVector?: Vec3;
  /** Material thickness of the hole along -normal (through holes). */
  depth?: number;
  /** Threaded (tapped) hole — a screw ends here, no nut needed. */
  tapped?: boolean;
  /** Male feature (screw/shaft/bearing body) rather than a hole. */
  male?: boolean;
  /** Snap points that are two faces of the same physical hole share this. */
  holeId?: string;
}

export type Category =
  | 'Structure'
  | 'Mounts'
  | 'Motors & Servos'
  | 'Shafts & Hubs'
  | 'Gears & Slides'
  | 'Wheels'
  | 'Fasteners & Spacers'
  | 'Custom';

export const CATEGORIES: Category[] = [
  'Structure',
  'Mounts',
  'Motors & Servos',
  'Shafts & Hubs',
  'Gears & Slides',
  'Wheels',
  'Fasteners & Spacers',
  'Custom',
];

// ---------- Procedural geometry recipe (single source of truth for mesh, snaps and STEP) ----------

export type Pt2 = [number, number];

export type Outline =
  | { kind: 'circle'; r: number; cx?: number; cy?: number }
  | { kind: 'poly'; pts: Pt2[] };

export interface HoleSpec {
  x: number;
  y: number;
  /** Clearance diameter (circle) or across-flats (hex/rex) in mm. */
  d: number;
  shape?: 'circle' | 'rex' | 'dshaft' | 'square';
  /** Snap type created on both faces; 'none' for visual-only holes. */
  snap?: SnapType | 'none';
  tapped?: boolean;
}

/** A frame: origin + two in-plane axes. Extrusion direction is u × v. */
export interface Frame {
  o: Vec3;
  u: Vec3;
  v: Vec3;
}

/** A prism: 2D outline (with holes) in the (u,v) plane, extruded `depth` mm along u×v. */
export interface Extrusion {
  outline: Outline;
  holes?: HoleSpec[];
  frame: Frame;
  depth: number;
  color: string;
  /** Faces whose holes should NOT produce snaps (e.g. 'bottom' for blind holes). */
  noSnapFaces?: ('bottom' | 'top')[];
  /** Visual-only detail (thread markers); skipped by STEP export. */
  decal?: boolean;
}

export interface ProceduralRecipe {
  solids: Extrusion[];
  /** Additional snap points that are not plain hole faces (male features). */
  extraSnaps?: SnapPoint[];
}

export interface CatalogPart {
  sku: string;
  name: string;
  category: Category;
  dimensions?: Vec3;
  massGrams: number;
  priceUsd: number;
  snapPoints: SnapPoint[];
  isCustom?: boolean;
  /** Optional sub-family label used for grouping in the sidebar. */
  series?: string;
  /** Chiral partner (e.g. mecanum Left <-> Right) used by Mirror. */
  mirrorSku?: string;
  /** Procedural fallback recipe. Present for all built-in parts. */
  procedural?: ProceduralRecipe;
  /** Uniform scale applied to the remote .glb (default 1 = file is in mm). */
  glbScale?: number;
  /** Extra search keywords. */
  tags?: string[];
  /** Snap points live in parts/{sku}.json and are loaded on demand (real goBILDA parts). */
  remoteSnaps?: boolean;
  /** Exact part-frame bounding box [min, max] (real parts); dimensions alone lose the origin offset. */
  bounds?: [Vec3, Vec3];
  /** Number of snap points (known before they are loaded). */
  snapCount?: number;
  /** Units per goBILDA retail pack. */
  pack?: number;
  /** Product page on gobilda.com. */
  sourceUrl?: string;
}

export interface PlacedInstance {
  instanceId: string;
  sku: string;
  position: Vec3;
  quaternion: Quat;
  hidden: boolean;
  ghosted: boolean;
  groupId?: string;
  /** World-space axis of the last snap mate, used by [ / ] nudge and R rotate. */
  snapAxis?: Vec3;
  /** World-space point on that axis (the mated hole centre). */
  snapPivot?: Vec3;
}

export interface BuildFile {
  app: 'ignite3d';
  version: string;
  instances: PlacedInstance[];
  groups: Record<string, string>;
}
