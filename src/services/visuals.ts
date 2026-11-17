// Bridges the asset loader and the store: requests .glb upgrades and tracks status.
import { useEffect, useMemo } from 'react';
import { useCadStore } from '../store/useCadStore';
import { fetchGlbVisual, visualFor, type PartVisual } from './assetLoader';

const attempted = new Set<string>();

export function requestUpgrade(sku: string) {
  if (attempted.has(sku)) return;
  const st = useCadStore.getState();
  const part = st.catalog[sku];
  if (!part) return;
  attempted.add(sku);
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
