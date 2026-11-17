"""Generate overrides/{SKU}.json for the fasteners family from out/{SKU}.json (run after batch.py).
Male snaps and cleaned female snaps (nuts, standoffs) are written here because rules can only return male snaps."""
import json, os, re
D = os.path.dirname(os.path.abspath(__file__))
PRE = ('2800-', '2802-', '2811-', '2812-', '1501-', '1516-', '1523-', '2904-')
for f in sorted(os.listdir(os.path.join(D, 'out'))):
    m = re.fullmatch(r'(\d{4}-\d{4}-\d{4})\.json', f)
    if not m or not m.group(1).startswith(PRE): continue
    sku = m.group(1)
    o = json.load(open(os.path.join(D, 'out', f)))
    ov = {'notes': o['registration'].get('notes', '')}
    if o['male']:
        ov['male'] = o['male']
    def two(L, y0, y1, hid='n0'):
        ov['removeSnapIds'] = [s['id'] for s in o['snaps']]
        ov['addSnaps'] = [
            {'id': 'n0a', 'type': 'm4_hole', 'p': [0, y0, 0], 'n': [0, -1, 0], 'depth': L, 'tapped': True, 'holeId': hid},
            {'id': 'n0b', 'type': 'm4_hole', 'p': [0, y1, 0], 'n': [0, 1, 0], 'depth': L, 'tapped': True, 'holeId': hid}]
    if sku.startswith('1523-'):
        ov['exclude'] = True
        ov['notes'] = 'STEP is an assembly (standoff + 2 screws + 2 bodies, 56 mm extent vs 43.5 mm part); excluded. ' + ov['notes']
    elif sku.startswith(('1501-', '1516-')):
        L = float(re.search(r'length ([0-9.]+)', ov['notes']).group(1))
        two(L, -L / 2, L / 2)
    elif sku.startswith(('2811-', '2812-')):
        H = float(re.search(r'total height ([0-9.]+)', ov['notes']).group(1))
        two(H, 0, H)
    json.dump(ov, open(os.path.join(D, 'overrides', f'{sku}.json'), 'w'), indent=1)
