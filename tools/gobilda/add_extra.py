"""Kit-only parts whose series listing was not crawled: product pages (polite) -> parts.json."""
import json, os, re, html, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from crawl_lib import get
D = os.path.dirname(os.path.abspath(__file__))
parts = json.load(open(os.path.join(D, 'parts.json')))
X = {'1514-0010-0060': ('1514-series-8mm-id-spacer-10mm-od-6mm-length-4-pack/', 'Fasteners & Spacers'),
     '1609-0613-0004': ('1609-series-v-groove-bearing-4mm-id-x-13mm-od-6mm-thickness-2-pack/', 'Shafts & Hubs'),
     '1616-0016-0002': ('1616-series-drop-center-bearing-plate-2mm-drop-4-pack/', 'Mounts'),
     '2401-0014-0012': ('2401-series-24mm-pitch-track-sprocket-12-tooth-2-pack/', 'Gears & Slides'),
     '2801-0004-0008': ('2801-series-zinc-plated-steel-washer-4mm-id-x-8mm-od-25-pack/', 'Fasteners & Spacers'),
     '2809-0004-0007': ('2809-series-zinc-plated-steel-split-lock-washer-4mm-id-x-7mm-od-25-pack/', 'Fasteners & Spacers'),
     '3604-0014-0096': ('3604-series-omni-wheel-14mm-bore-96mm-diameter/', 'Wheels')}
for sku, (pg, cat) in X.items():
    if sku in parts: continue
    t = get(pg)
    ti = re.search(r'<title>(.*?)</title>', t, re.S); pr = re.search(r'"price":\{"without_tax":\{"formatted":"\$([0-9.,]+)"', t)
    title = html.unescape(ti.group(1).strip()) if ti else sku
    title = re.sub(r'^.* - (?=[^-]*\d{4} Series|[^-]*Omni)', '', title)
    parts[sku] = {'sku': sku, 'title': title, 'url': 'https://www.gobilda.com/' + pg, 'page': pg, 'category': cat,
                  'price': float(pr.group(1).replace(',', '')) if pr else None, 'step_listed': f'{sku}.zip' in t, 'added': 'kits'}
    print(sku, title, parts[sku]['price'], flush=True)
for sku, title, cat in [('1133-0001-0001', '1133 Series Plastic Flat Grid Bracket (1-1) - 2 Pack', 'Structure'),
                        ('3302-4008-0014', '3302 Series 8mm Pitch Steel Clamping Sprocket (8mm REX Bore, 14 Tooth)', 'Gears & Slides')]:
    parts.setdefault(sku, {'sku': sku, 'title': title, 'url': 'https://www.gobilda.com/', 'page': '', 'category': cat, 'price': None, 'step_listed': True, 'added': 'kits'})
json.dump(parts, open(os.path.join(D, 'parts.json'), 'w'), indent=1)
print('DONE', len(parts))
