"""Assemble converted real parts into the Ignite3D app.

python build_catalog.py [APP_DIR]   (default ~/ignite3d)
Writes:
  public/parts/{sku}.glb       Draco mesh (mm, Y-up, canonical part frame)
  public/parts/{sku}.json      {sku, snapPoints}  (lazy-loaded by the app)
  public/parts/{sku}.stp.gz    exact goBILDA B-rep in the part frame (spliced into STEP exports)
  public/parts/index.json      SKUs with meshes;  public/parts/step-index.json  fragment entity ids
  public/catalog.json          catalogue index (served via jsDelivr)
  src/data/gobilda.json        same index, bundled into the app
"""
import gzip, json, os, re, shutil, sys
import numpy as np

D = os.path.dirname(os.path.abspath(__file__))
APP = os.path.expanduser(sys.argv[1] if len(sys.argv) > 1 else '~/ignite3d')
PARTS = os.path.join(APP, 'public', 'parts')
CAD = os.path.expanduser('~/ignite3d-cad/parts')  # exact STEP fragments live in a separate data repo (served by jsDelivr)
VERSION = 4

parts = json.load(open(os.path.join(D, 'parts.json')))
weights = json.load(open(os.path.join(D, 'weights.json'))) if os.path.exists(os.path.join(D, 'weights.json')) else {}

STEEL = ('2800', '2802', '2811', '2812', '2801', '2810', '2807', '2809', '2101', '2102', '2106', '2109', '2303', '2315', '2317', '2319',
         '2320', '2322', '3204', '1126', '1137', '1139', '1141', '1142', '1523', '1531', '1600', '1611', '2910-0921')
PLASTIC = ('1500', '1520', '1526', '2312', '2902', '1117', '1127')

def density(sku, title):
    t = title.lower()
    if 'brass' in t: return 8.5e-3
    if any(k in t for k in ('acetal', 'plastic', 'polycarbonate', 'nylon')) or sku.startswith(PLASTIC): return 1.4e-3
    if 'stainless' in t or 'steel' in t or 'zinc' in t or sku.startswith(STEEL): return 7.9e-3
    return 2.7e-3

def pack_count(title):
    m = re.search(r'(\d+)\s*[- ]?\s*Pack', title, re.I)
    return int(m.group(1)) if m else 1

def clean_name(title):
    t = re.sub(r'\s*-\s*goBILDA®?\s*$', '', title)
    t = re.sub(r'\s*-\s*\d+\s*Pack\s*$', '', t, flags=re.I)
    return t.replace('®', '').replace('™', '').strip()

def series_of(name):
    m = re.match(r'^(\d{4} Series [^(,]+?)\s*(\(|,|$)', name)
    if m: return m.group(1).strip()
    return re.split(r'\s*\(', name)[0].strip()[:48]

def est_price(sku):
    if sku.startswith(('2800', '2802')): return round(0.10 + int(sku[-4:]) * 0.004, 2)
    if sku.startswith(('2811', '2812')): return 0.10
    return 1.0

def mesh_bounds(glb_path):
    import struct
    b = open(glb_path, 'rb').read()
    n = struct.unpack('<I', b[12:16])[0]
    acc = json.loads(b[20:20 + n])['accessors'][0]
    return np.array(acc['min']), np.array(acc['max'])

def to_app_snap(s):
    o = {'id': s['id'], 'type': s['type'], 'position': [round(x, 4) for x in s.get('p', s.get('position'))],
         'normal': [round(x, 6) for x in s.get('n', s.get('normal'))]}
    for k in ('depth', 'holeId'):
        if s.get(k) is not None: o[k] = round(s[k], 4) if k == 'depth' else s[k]
    if s.get('tapped'): o['tapped'] = True
    if s.get('male'): o['male'] = True
    if s.get('upVector') or s.get('up'): o['upVector'] = s.get('upVector') or s.get('up')
    return o

def main():
    os.makedirs(PARTS, exist_ok=True)
    index, step_index, skus_mesh = [], {}, []
    skipped = []
    for sku, info in sorted(parts.items()):
        out = os.path.join(D, 'out', f'{sku}.json')
        glb = os.path.join(D, 'out', f'{sku}.draco.glb')
        frag = os.path.join(D, 'out', f'{sku}.step.json')
        ovp = os.path.join(D, 'overrides', f'{sku}.json')
        ov = json.load(open(ovp)) if os.path.exists(ovp) else {}
        if ov.get('exclude'):
            skipped.append((sku, 'excluded: ' + ov.get('notes', ''))); continue
        if not (os.path.exists(out) and os.path.exists(glb)):
            skipped.append((sku, 'not converted')); continue
        meta = json.load(open(out))
        rm = set(ov.get('removeSnapIds', []))
        snaps = [dict(s) for s in meta['snaps'] if s['id'] not in rm] + ov.get('addSnaps', [])
        for s in snaps:
            if s['id'] in ov.get('typeFixes', {}): s['type'] = ov['typeFixes'][s['id']]
            if s['id'] in ov.get('tappedFix', {}): s['tapped'] = bool(ov['tappedFix'][s['id']])
        males = list({m['id']: m for m in (meta.get('male') or []) + ov.get('male', [])}.values())  # dedupe by id (override wins)
        KNOWN = {'m4_hole', 'bearing_14mm', 'rex_8mm', 'd_6mm', 'hub_pattern_16mm'}
        app_snaps = [to_app_snap(s) for s in snaps if s.get('type') in KNOWN] + [to_app_snap({**m, 'male': True}) for m in males if m.get('type') in KNOWN]
        lo, hi = mesh_bounds(os.path.join(D, 'out', f'{sku}.glb'))  # exact (OCC Bnd_Box adds tolerance)
        name = clean_name(info['title'])
        pack = pack_count(info['title'])
        mass = weights.get(sku)
        if mass is None: mass = meta['volume_mm3'] * density(sku, info['title'])
        price = info.get('price')
        price = round(price / pack, 2) if price else est_price(sku)
        entry = {'sku': sku, 'name': name, 'category': info['category'], 'series': series_of(name),
                 'dimensions': [round(x, 2) for x in (hi - lo)], 'bounds': [[round(float(x), 3) for x in lo], [round(float(x), 3) for x in hi]], 'massGrams': round(float(mass), 1), 'priceUsd': price,
                 'snapCount': len(app_snaps), 'remoteSnaps': True, 'sourceUrl': info['url']}
        if pack > 1: entry['pack'] = pack
        index.append(entry)
        shutil.copyfile(glb, os.path.join(PARTS, f'{sku}.glb'))
        json.dump({'sku': sku, 'snapPoints': app_snaps}, open(os.path.join(PARTS, f'{sku}.json'), 'w'), separators=(',', ':'))
        skus_mesh.append(sku)
        if os.path.exists(frag):
            f = json.load(open(frag))
            os.makedirs(CAD, exist_ok=True)
            with gzip.open(os.path.join(CAD, f'{sku}.stp.gz'), 'wt', encoding='latin-1', compresslevel=9) as g:
                g.write(f['data'])
            gz_path = os.path.join(CAD, f'{sku}.stp.gz')
            if os.path.getsize(gz_path) > 15e6:  # keep the CAD site lean; these export as meshes
                os.remove(gz_path)
            else:
                step_index[sku] = {k: f[k] for k in ('maxId', 'pd', 'rep', 'origin')}
    json.dump({'skus': sorted(skus_mesh)}, open(os.path.join(PARTS, 'index.json'), 'w'), indent=0)
    json.dump(step_index, open(os.path.join(CAD, 'step-index.json'), 'w'), separators=(',', ':'))
    for f in os.listdir(PARTS):  # never ship fragments in the Pages build
        if f.endswith('.stp.gz') or f == 'step-index.json': os.remove(os.path.join(PARTS, f))
    cat = {'version': VERSION, 'source': 'goBILDA STEP files (gobilda.com), converted by Ignite3D', 'parts': index}
    json.dump(cat, open(os.path.join(APP, 'public', 'catalog.json'), 'w'), separators=(',', ':'))
    json.dump(index, open(os.path.join(APP, 'src', 'data', 'gobilda.json'), 'w'), separators=(',', ':'))
    tot = sum(os.path.getsize(os.path.join(PARTS, f)) for f in os.listdir(PARTS))
    print(f'catalog: {len(index)} parts, skipped {len(skipped)}, public/parts {tot / 1e6:.1f} MB')
    from collections import Counter
    print(Counter(r for _, r in skipped).most_common(6))

if __name__ == '__main__':
    main()
