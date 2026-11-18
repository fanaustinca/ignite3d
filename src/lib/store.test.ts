import { describe, expect, it } from 'vitest';
import { useCadStore } from '../store/useCadStore';

describe('store', () => {
  it('moving / rotating a part carries its mated hole axis and pivot with it', () => {
    const st = useCadStore.getState();
    st.setInstances([]);
    const id = st.addInstance({ sku: 'x', position: [10, 0, 0], quaternion: [0, 0, 0, 1], snapAxis: [0, 1, 0], snapPivot: [10, 5, 0] });
    // 90° about world Z through the origin, then a shift
    const s = Math.SQRT1_2;
    useCadStore.getState().updateTransforms({ [id]: { position: [0, 10, 3], quaternion: [0, 0, s, s] } });
    const i = useCadStore.getState().instances.find((x) => x.instanceId === id)!;
    expect(i.snapAxis![0]).toBeCloseTo(-1, 6);
    expect(i.snapAxis![1]).toBeCloseTo(0, 6);
    expect(i.snapPivot![0]).toBeCloseTo(-5, 6);
    expect(i.snapPivot![1]).toBeCloseTo(10, 6);
    expect(i.snapPivot![2]).toBeCloseTo(3, 6);
  });
});
