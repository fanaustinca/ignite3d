// Zero-backend share links: the build is compressed into the URL hash (#build=...).
import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string';
import type { BuildFile, PlacedInstance, Quat, Vec3 } from '../types/cad';
import { APP_VERSION } from '../version';

const r3 = (x: number) => Math.round(x * 1000) / 1000;
const r6 = (x: number) => Math.round(x * 1e6) / 1e6;

type Row = [string, number, number, number, number, number, number, number, number, number];

export function encodeBuild(instances: PlacedInstance[]): string {
  const skus = [...new Set(instances.map((i) => i.sku))];
  const groups = [...new Set(instances.map((i) => i.groupId).filter(Boolean))] as string[];
  const rows = instances.map((i) => [
    skus.indexOf(i.sku),
    ...i.position.map(r3),
    ...i.quaternion.map(r6),
    (i.hidden ? 1 : 0) | (i.ghosted ? 2 : 0),
    i.groupId ? groups.indexOf(i.groupId) : -1,
  ]);
  return compressToEncodedURIComponent(JSON.stringify({ v: 1, s: skus, r: rows }));
}

export function decodeBuild(code: string): PlacedInstance[] | null {
  try {
    const json = decompressFromEncodedURIComponent(code);
    if (!json) return null;
    const d = JSON.parse(json) as { v: number; s: string[]; r: number[][] };
    if (d.v !== 1 || !Array.isArray(d.r)) return null;
    const gids = new Map<number, string>();
    return d.r.map((row, k) => {
      const [si, x, y, z, qx, qy, qz, qw, flags, g] = row;
      if (g >= 0 && !gids.has(g)) gids.set(g, `g${g}-${Math.random().toString(36).slice(2, 8)}`);
      return {
        instanceId: `s${k}-${Math.random().toString(36).slice(2, 10)}`,
        sku: d.s[si],
        position: [x, y, z] as Vec3,
        quaternion: [qx, qy, qz, qw] as Quat,
        hidden: !!(flags & 1),
        ghosted: !!(flags & 2),
        groupId: g >= 0 ? gids.get(g) : undefined,
      };
    });
  } catch {
    return null;
  }
}

export function shareUrl(instances: PlacedInstance[]) {
  const base = location.href.split('#')[0];
  return `${base}#build=${encodeBuild(instances)}`;
}

export function readHashBuild(): PlacedInstance[] | null {
  const m = location.hash.match(/build=([^&]+)/);
  return m ? decodeBuild(m[1]) : null;
}

export function toBuildFile(instances: PlacedInstance[]): BuildFile {
  const groups: Record<string, string> = {};
  instances.forEach((i) => i.groupId && (groups[i.instanceId] = i.groupId));
  return { app: 'ignite3d', version: APP_VERSION, instances, groups };
}

export function fromBuildFile(data: unknown): PlacedInstance[] | null {
  const d = data as Partial<BuildFile> & { instances?: PlacedInstance[] };
  if (!d || !Array.isArray(d.instances)) return null;
  return d.instances.filter((i) => typeof i.sku === 'string' && Array.isArray(i.position) && Array.isArray(i.quaternion));
}

export type _Row = Row;
