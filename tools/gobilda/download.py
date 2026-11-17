"""Download goBILDA STEP zips (polite, cached) for every SKU in parts.json; also product-page weights
for mixed-material parts (motors, servos, wheels, slides). Writes weights.json."""
import json, os, re, sys, time, zipfile, io
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from crawl_lib import get
D = os.path.dirname(os.path.abspath(__file__))
parts = json.load(open(os.path.join(D, 'parts.json')))
# spec-essential families first, extras afterwards
PRIORITY = ['1120-', '2800-', '2812-', '5203-', '1201-', '1202-', '1203-', '1204-', '1205-', '1211-', '1222-', '1400-', '1401-', '1702-', '1701-', '1121-', '1143-', '1109-', '1102-', '1103-', '1116-', '2106-', '2101-', '1309-', '1310-',
            '1611-', '2904-', '2910-', '2802-', '2801-', '1501-', '1516-', '1201-', '1202-', '1203-', '1204-', '1205-', '1206-', '1209-',
            '1400-', '1401-', '1600-', '1602-', '1605-', '2000-', '3217-', '2301-', '2302-', '2303-', '2304-', '2305-', '2306-', '2307-', '2308-',
            '2309-', '2310-', '2312-', '3407-', '3408-', '3412-', '3413-', '3414-', '3625-', '3213-', '3613-', '3614-', '3601-', '3624-',
            '1503-', '1504-', '1505-', '1506-', '3205-', '3209-']
def prio(s):
    for i, p in enumerate(PRIORITY):
        if s.startswith(p): return (0, i, s)
    return (1, 0, s)
skus = sorted(parts, key=prio)
weights = json.load(open(os.path.join(D, 'weights.json'))) if os.path.exists(os.path.join(D, 'weights.json')) else {}
ok = miss = 0
for sku in skus:
    stp = os.path.join(D, 'step', f'{sku}.STEP')
    if not os.path.exists(stp):
        data = get(f'content/step_files/{sku}.zip', binary=True)
        try:
            z = zipfile.ZipFile(io.BytesIO(data))
            names = [n for n in z.namelist() if n.lower().endswith(('.step', '.stp'))]
            if not names: raise ValueError('no step in zip')
            # biggest STEP in the archive is the part / assembly itself
            n = max(names, key=lambda n: z.getinfo(n).file_size)
            open(stp, 'wb').write(z.read(n))
            ok += 1
        except Exception as e:
            miss += 1
            print('NO STEP', sku, e, flush=True)
            continue
    else:
        ok += 1
    if parts[sku]['category'] in ('Motors & Servos', 'Wheels', 'Gears & Slides') and sku not in weights:
        page = parts[sku]['url'].replace('https://www.gobilda.com/', '')
        t = get(page)
        m = re.search(r'"weight":\{"formatted":"([0-9.]+) (Ounces|Pounds|Grams)","value":([0-9.]+)', t)
        if m:
            v = float(m.group(3)); u = m.group(2)
            weights[sku] = round(v * (28.3495 if u == 'Ounces' else 453.592 if u == 'Pounds' else 1), 1)
            json.dump(weights, open(os.path.join(D, 'weights.json'), 'w'), indent=1)
    print(f'ok {sku}  ({ok} ok / {miss} missing)', flush=True)
print('DONE', ok, miss, flush=True)
