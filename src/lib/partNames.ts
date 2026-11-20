// Library grouping + short display names. goBILDA titles repeat the series, units and boilerplate on every
// row ("5203 Series Yellow Jacket Planetary Gear Motor (19.2:1 Ratio, 24mm Length 8mm REX Shaft, 312 RPM,
// 3.3 - 5V Encoder)"); inside a sub-section only the part that differs is useful ("19.2:1 · 312 RPM").
import type { CatalogPart } from '../types/cad';

/** Sub-section key: the series without a leading size, so "45 Tooth Hub-Mount Gear" + "46 Tooth …" share one. */
export function familyOf(p: Pick<CatalogPart, 'series' | 'name' | 'category'>): string {
  let s = (p.series ?? p.name ?? p.category).trim();
  // series names were cut at the first comma / 48 chars; the full title lead is the real family
  const lead = (p.name ?? '').replace(/\s*\(.*$/, '').trim();
  if (p.series && lead.length > s.length && lead.startsWith(s) && /^[,\w]/.test(lead.slice(s.length))) s = lead;
  s = s.replace(/^(?:Ø?\d+(?:\.\d+)?\s*(?:mm|tooth|t)\b\s*)(?:rex\s+)?(?:id\s+)?(?:bore\s+)?/i, '');
  s = s.replace(/^series,?\s*/i, '').replace(/,\s*$/, '');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Readable sub-section title: plural, without the boring parts. */
export function familyTitle(f: string) {
  return f
    .replace(/\bSeries\b,?\s*/g, '')
    .replace(/\s+/g, ' ')
    .replace(/,\s*$/, '')
    .trim();
}

const JUNK: RegExp[] = [
  /^3\.3\s*-\s*5v encoder$/i,
  /^\d+mm length \d+mm (rex |d-)shaft$/i,
  /^⌀?\d+mm gearbox$/i,
  /^m4 x 0\.7mm threads$/i,
  /^stainless steel$/i,
  /^simple$/i,
  /^\d+\s*-?\s*pack$/i,
];

function tidy(t: string) {
  return t
    .replace(/(\d+(?:\.\d+)?)mm Length\b/gi, '$1 mm')
    .replace(/(\d+(?:\.\d+)?)mm Diameter\b/gi, 'Ø$1 mm')
    .replace(/(\d+(?:\.\d+)?)mm Thickness\b/gi, '$1 mm thick')
    .replace(/(\d+(?:\.\d+)?)mm Thick\b/gi, '$1 mm thick')
    .replace(/(\d+(?:\.\d+)?)mm\b/g, '$1 mm')
    .replace(/(\d+(?:\.\d+)?:1) Ratio/i, '$1')
    .replace(/ Durometer( Bearing Supported)?( Rollers)?\b/gi, '')
    .replace(/(\d)x (\d)/g, '$1 × $2')
    .replace(/ x /g, ' × ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokensOf(name: string): { lead: string; tokens: string[] } {
  const m = /^(.*?)\s*\((.*)\)\s*$/.exec(name);
  const head = m ? m[1] : name;
  const inner = m ? m[2] : '';
  // motors: "24mm Length 8mm REX Shaft" is one token in goBILDA titles; split it
  const tokens = inner
    ? inner
        .split(/,\s*/)
        .map((t) => t.trim())
        .filter(Boolean)
    : [];
  return { lead: head, tokens };
}

/**
 * Short names for every part of one sub-section: tokens shared by all members are dropped (the section
 * title already says them), junk is removed and units tidied. Falls back to the full name.
 */
export function shortNames(parts: Pick<CatalogPart, 'sku' | 'name' | 'series' | 'category'>[]): Map<string, string> {
  const out = new Map<string, string>();
  const parsed = parts.map((p) => ({ p, ...tokensOf(p.name) }));
  const shared = new Set<string>();
  if (parts.length > 1) {
    const first = parsed[0].tokens;
    for (const t of first) if (parsed.every((x) => x.tokens.includes(t))) shared.add(t);
  }
  for (const { p, lead, tokens } of parsed) {
    const keep = tokens.filter((t) => !shared.has(t) && !JUNK.some((r) => r.test(t)));
    // the distinguishing size at the front of the title ("45 Tooth Hub-Mount Gear", "96mm Omni Wheel")
    const series = p.series ?? '';
    let front = '';
    const lm = /^(Ø?\d+(?:\.\d+)?\s*(?:mm|Tooth)\b(?:\s+REX)?(?:\s+(?:ID|Bore))?)/i.exec(lead);
    if (lm && parts.length > 1) front = lm[1];
    // a lead that is not just the series (e.g. "1400 Series 1-Side, 2-Post Clamping Mount") adds what differs
    let rest = '';
    if (series && lead.startsWith(series) && lead.length > series.length + 1 && familyOf(p as CatalogPart) !== lead) rest = lead.slice(series.length).replace(/^[,\s]+/, '');
    const bits = [front, rest, ...keep].map(tidy).filter(Boolean);
    let s = bits.join(' · ');
    if (!s) s = tidy(lead.replace(/^\d{4} Series,?\s*/, ''));
    out.set(p.sku, s);
  }
  return out;
}
