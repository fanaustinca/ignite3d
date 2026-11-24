"""Kit/popular-part expansion crawl (polite, cached): more listing pages merged into parts.json (existing entries kept)."""
import json, os, re, html, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from crawl_lib import get
D = os.path.dirname(os.path.abspath(__file__))
PAGES = {
 'Structure': ['1118-series-open-gorail/', 'gorail-accessories/', '1122-series-rail-channel/', '1145-series-threaded-square-beams/', '4103-series-gotube',
   'pattern-plates', 'angle-brackets', 'aluminum-flat-brackets', 'steel-flat-brackets', 'pattern-adaptors', 'threaded-plates'],
 'Mounts': ['1-side-2-post-pattern-mounts', '2-side-2-post-pattern-mounts', 'flat-mounts', 'surface-mounts', '1-side-1-post-clamping-mounts',
   '2-side-1-post-clamping-mounts', '1-side-2-post-clamping-mounts', '2-side-2-post-clamping-mounts', 'servo-mounts',
   'motor-mounts-for-5202-series-planetary-gear-motors/', '1606-series-2-side-1-post-pillow-blocks', '1604-series-2-side-2-post-pillow-blocks',
   'dual-bearing-pillow-blocks', 'face-thru-hole-pillow-blocks'],
 'Motors & Servos': ['saturn-planetary-gear-motors', 'servo-attachments', 'servo-gears'],
 'Shafts & Hubs': ['hub-shafts', 'collars', '8mm-rex-bore-hubs/', 'set-screw-hubs-16mm-pattern', 'classic-clamping-hubs', 'sonic-hubs', 'hyper-hubs-16mm-pattern',
   'flanged-ball-bearings', 'non-flanged-ball-bearings', 'thrust-ball-bearings', 'linear-ball-bearings', 'hyper-couplers', '8mm-rex-bore-couplers', 'couplers-h25t-8mm-rex-bore'],
 'Gears & Slides': ['set-screw-sprockets', '14mm-bore-plastic-hub-mount-sprockets', '14mm-bore-metal-hub-mount-sprockets', 'chain-tensioners-and-idlers',
   '2mm-gt2-pulleys/', '2mm-gt2-timing-belt-accessories', '5mm-htd-timing-belt-accessories/', 'gear-racks', '8mm-lead-screws', '8mm-lead-screw-nuts', 'v-wheels'],
 'Wheels': ['intake-wheels', 'omni-wheels', 'hogback-wheels/', 'disc-wheels'],
 'Fasteners & Spacers': ['4mm-id-x-6mm-od-spacers', '4mm-id-x-5mm-od-spacers', '4mm-id-x-8mm-od-spacers-1/', '6mm-id-x-8mm-od-spacers', '8mm-id-x-10mm-od-spacers',
   '8mm-id-x-12mm-od-spacers/', '8mm-rex-bore-x-12mm-rex-spacers/', 'm4-shoulder-standoffs', 'm5-set-screws', 'premium-m4-socket-head-thread-locking-screws/',
   'm4-low-profile-socket-head-screws', 'm4-hex-head-screws', 'nuts/'],
}
parts = json.load(open(os.path.join(D, 'parts.json')))
CARD = r'<a href="(https://www\.gobilda\.com/[^"]+)"\s+data-pid="\d+" data-sku="([^"]+)"\s+title="([^"]+)"(.*?)</li>'
for cat, pages in PAGES.items():
    for pg in pages:
        queue, seen = [pg], set()
        while queue:
            p = queue.pop(0)
            if p in seen: continue
            seen.add(p); t = get(p)
            steps = set(re.findall(r'step_files/([0-9A-Za-z-]+)\.zip', t))
            n0 = len(parts)
            for url, sku, title, body in re.findall(CARD, t, re.S):
                price = re.search(r'data-product-price-without-tax[^>]*>\s*\$([0-9.,]+)', body)
                parts.setdefault(sku, {'sku': sku, 'title': html.unescape(title), 'url': url, 'page': pg, 'category': cat,
                                       'price': float(price.group(1).replace(',', '')) if price else None, 'step_listed': sku in steps, 'added': 'kits'})
            base = pg.rstrip('/')
            for nxt in set(re.findall(r'href="https://www\.gobilda\.com/' + re.escape(base) + r'/?\?page=(\d+)"', t)): queue.append(f'{base}/?page={nxt}')
            print(f'{cat} | {p}: parts now {len(parts)} (+{len(parts) - n0})', flush=True)
            json.dump(parts, open(os.path.join(D, 'parts.json'), 'w'), indent=1)
print('DONE', len(parts), flush=True)
# second pass: table-style listings (<a class="tableSKU">)
TAB = r'<a href="(https://www\.gobilda\.com/[^"]+)" title="([^"]+)" class="tableSKU">\s*([0-9A-Za-z-]+)\s*</a>(.*?)</tr>'
for cat, pages in PAGES.items():
    for pg in pages:
        for f in [pg] + [f'{pg.rstrip("/")}/?page={n}' for n in range(2, 6)]:
            cache = os.path.join(D, 'html', re.sub(r'[^a-z0-9.-]+', '_', f.lower()) + '.html')
            if not os.path.exists(cache): continue
            t = open(cache, encoding='utf-8', errors='ignore').read(); n0 = len(parts)
            steps = set(re.findall(r'step_files/([0-9A-Za-z-]+)\.zip', t))
            for url, title, sku, body in re.findall(TAB, t, re.S):
                price = re.search(r'\$([0-9.,]+)', body)
                parts.setdefault(sku, {'sku': sku, 'title': html.unescape(title), 'url': url, 'page': pg, 'category': cat,
                                       'price': float(price.group(1).replace(',', '')) if price else None, 'step_listed': sku in steps, 'added': 'kits'})
            if len(parts) > n0: print('table', pg, '+', len(parts) - n0)
json.dump(parts, open(os.path.join(D, 'parts.json'), 'w'), indent=1)
print('DONE2', len(parts))
