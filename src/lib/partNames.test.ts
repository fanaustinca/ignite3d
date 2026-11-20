import { describe, expect, it } from 'vitest';
import { familyOf, shortNames } from './partNames';
import { BUILTIN_CATALOG } from '../data/catalog';

const P = (sku: string, name: string, series: string) => ({ sku, name, series, category: 'Structure' as const });

describe('library names', () => {
  it('drops what the section title already says', () => {
    const m = shortNames([
      P('a', '5203 Series Yellow Jacket Planetary Gear Motor (19.2:1 Ratio, 24mm Length 8mm REX Shaft, 312 RPM, 3.3 - 5V Encoder)', '5203 Series Yellow Jacket Planetary Gear Motor'),
      P('b', '5203 Series Yellow Jacket Planetary Gear Motor (3.7:1 Ratio, 24mm Length 8mm REX Shaft, 1620 RPM, 3.3 - 5V Encoder)', '5203 Series Yellow Jacket Planetary Gear Motor'),
    ]);
    expect(m.get('a')).toBe('19.2:1 · 312 RPM');
    const c = shortNames([P('x', '1120 Series U-Channel (5 Hole, 144mm Length)', '1120 Series U-Channel'), P('y', '1120 Series U-Channel (1 Hole, 48mm Length)', '1120 Series U-Channel')]);
    expect(c.get('x')).toBe('5 Hole · 144 mm');
    const s = shortNames([P('s', '2800 Series M4 x 0.7mm Socket Head Screw (8mm Length)', '2800 Series M4 x 0.7mm Socket Head Screw'), P('t', '2800 Series M4 x 0.7mm Socket Head Screw (10mm Length)', '2800 Series M4 x 0.7mm Socket Head Screw')]);
    expect(s.get('s')).toBe('8 mm');
  });
  it('merges size-prefixed series into one family', () => {
    expect(familyOf({ series: '45 Tooth Hub-Mount Gear', name: '', category: 'Gears & Slides' })).toBe('Hub-Mount Gear');
    expect(familyOf({ series: '8mm REX Bore 1-Side, 2-Post Pillow Block', name: '', category: 'Mounts' })).toBe('1-Side, 2-Post Pillow Block');
    const g = shortNames([P('g1', '45 Tooth Hub-Mount Gear (MOD 0.8, 4mm Thick Acetal)', '45 Tooth Hub-Mount Gear'), P('g2', '46 Tooth Hub-Mount Gear (MOD 0.8, 4mm Thick Acetal)', '46 Tooth Hub-Mount Gear')]);
    expect(g.get('g1')).toBe('45 Tooth');
  });
  it('every real part gets a short, non-empty name', () => {
    const fam = new Map<string, typeof BUILTIN_CATALOG>();
    for (const p of BUILTIN_CATALOG) fam.set(p.category + familyOf(p), [...(fam.get(p.category + familyOf(p)) ?? []), p]);
    let long = 0;
    for (const list of fam.values()) {
      const m = shortNames(list);
      for (const p of list) {
        const n = m.get(p.sku)!;
        expect(n.length, p.name).toBeGreaterThan(0);
        if (n.length > 40) long++;
      }
    }
    expect(long).toBeLessThan(BUILTIN_CATALOG.length * 0.05);
  });
});
