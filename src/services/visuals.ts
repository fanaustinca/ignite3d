// Bridges the asset loader and the store: requests .glb upgrades and tracks status.
import { useEffect, useMemo } from 'react';
import { useCadStore } from '../store/useCadStore';
import { fetchGlbVisual, fetchPartSnaps, visualFor, type PartVisual } from './assetLoader';

const attempted = new Set<string>();

/** Make sure a part's real snap points are loaded (no-op for parts that carry them inline). */
export async function ensureSnaps(sku: string): Promise<boolean> {
  const st = useCadStore.getState();
  const part = st.catalog[sku];
  if (!part) return false;
  if (!part.remoteSnaps || part.snapPoints.length) return true;
  const snaps = await fetchPartSnaps(part, st.assetConfig);
  if (snaps) useCadStore.getState().updatePart(sku, { snapPoints: snaps });
  return !!snaps;
}

export function ensureAllSnaps(skus: string[]) {
  return Promise.all([...new Set(skus)].map(ensureSnaps));
}

export function requestUpgrade(sku: string) {
  if (attempted.has(sku)) return;
  const st = useCadStore.getState();
  const part = st.catalog[sku];
  if (!part) return;
  attempted.add(sku);
  void ensureSnaps(sku);
  st.setAssetStatus(sku, 'loading');
  fetchGlbVisual(part, st.assetConfig).then((v) => {
    const s = useCadStore.getState();
    if (v) {
      s.setAssetStatus(sku, v.source);
      s.bumpVisuals();
    } else s.setAssetStatus(sku, part.isCustom ? 'custom' : 'procedural');
  });
}

export function resetUpgradeAttempts() {
  attempted.clear();
}

export function useVisual(sku: string): PartVisual | null {
  const part = useCadStore((s) => s.catalog[sku]);
  const version = useCadStore((s) => s.visualVersion);
  const visual = useMemo(() => (part ? visualFor(part) : null), [part, version]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (part) requestUpgrade(sku);
  }, [part, sku]);
  return visual;
}
