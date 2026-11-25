import { describe, expect, it } from 'vitest';
import { decodeCad, encodeCad, isCode } from './cloud';
import type { PlacedInstance } from '../types/cad';

describe('cloud files', () => {
  it('round-trips a build (ids, groups, flags) through the online encoding', () => {
    const list: PlacedInstance[] = Array.from({ length: 400 }, (_, k) => ({
      instanceId: `i${k}`,
      sku: k % 2 ? '1120-0005-0144' : '2800-0004-0016',
      position: [k * 8, k % 7, -k],
      quaternion: [0, Math.SQRT1_2, 0, Math.SQRT1_2],
      hidden: k === 3,
      ghosted: k === 4,
      groupId: k < 10 ? 'g1' : undefined,
    }));
    const data = encodeCad(list);
    expect(data.length).toBeLessThan(60_000);
    const back = decodeCad(data)!;
    expect(back).toHaveLength(400);
    expect(back[5]).toEqual(list[5]);
    expect(back[3].hidden && back[4].ghosted && back[9].groupId === 'g1').toBe(true);
    expect(decodeCad('garbage')).toBeNull();
  });
  it('accepts exactly 6 digits as a code', () => {
    expect(isCode('012345')).toBe(true);
    expect(['12345', '1234567', 'abcdef', ''].some(isCode)).toBe(false);
  });
});
