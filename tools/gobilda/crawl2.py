"""Targeted goBILDA listing crawl (polite: 10.5 s between requests, cached). Produces parts.json."""
import json, os, re, html, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from crawl_lib import get
D = os.path.dirname(os.path.abspath(__file__))
PAGES = {
 'Structure': ['1120-series-u-channel','1121-series-low-side-u-channel','1143-series-mini-low-side-u-channel','1109-series-gorail',
   '1102-series-flat-beams','1103-series-l-beams','1101-series-u-beams','1106-series-square-beams','grid-plates'],
 'Mounts': ['quad-block-pattern-mounts','dual-block-mounts','block-mounts','angle-pattern-mounts','gusseted-angle-mounts','motor-mounts',
   '1400-series-1-side-2-post-clamping-mount-32mm-bore','1401-series-2-side-2-post-clamping-mount-43mm-width-32mm-bore',
   '1605-series-1-side-1-post-pillow-blocks','1602-series-1-side-2-post-pillow-blocks'],
 'Motors & Servos': ['yellow-jacket-planetary-gear-motors','standard-size-servos','servoblocks'],
 'Shafts & Hubs': ['stainless-steel-rex-shafting/','stainless-steel-d-shafting/','1309-series-sonic-hub-8mm-rex-bore','1309-series-sonic-hub-6mm-d-bore',
   '1310-series-hyper-hub-8mm-rex-bore','2910-series-aluminum-clamping-collar-8mm-rex-id-x-20mm-od-9mm-length','2910-series-aluminum-clamping-collar-8mm-id-x-21mm-od-9mm-length',
   '1611-series-flanged-ball-bearing-8mm-rex-id-x-14mm-od-5mm-thickness-2-pack','1611-series-flanged-ball-bearing-8mm-id-x-14mm-od-5mm-thickness-2-pack',
   '2904-series-hole-reducer-4mm-id-x-14mm-od-4-pack'],
 'Gears & Slides': ['hub-mount-gears','pinion-gears','bevel-gears','5mm-htd-timing-pulleys/','2-stage-viper-slide-kit-belt-driven-336mm-slides/',
   '4-stage-viper-slide-kit-belt-driven-240mm-slides/','4-stage-viper-slide-kit-belt-driven-336mm-slides/'],
 'Wheels': ['mecanum-wheels','gripforce-gecko-wheels/','rhino-wheels','omni-wheels'],
 'Fasteners & Spacers': ['m4-socket-head-screws','m4-button-head-screws','m4-x-0-7mm-nylock-nut/','2811-series-zinc-plated-steel-hex-nut-m4-x-0-7mm-7mm-hex-25-pack/',
   'washers','m4-standoffs','pattern-spacers','shaft-spacers-shims','spacers'],
}
parts = {}
for cat, pages in PAGES.items():
    for pg in pages:
        queue, seen = [pg], set()
        while queue:
            p = queue.pop(0)
            if p in seen: continue
            seen.add(p)
            t = get(p)
            steps = set(re.findall(r'step_files/([0-9A-Za-z-]+)\.zip', t))
            n0 = len(parts)
            for m in re.finditer(r'<a href="(https://www\.gobilda\.com/[^"]+)"\s+data-pid="\d+" data-sku="([^"]+)"\s+title="([^"]+)"(.*?)</li>', t, re.S):
                url, sku, title, body = m.groups()
                price = re.search(r'data-product-price-without-tax[^>]*>\s*\$([0-9.,]+)', body)
                parts.setdefault(sku, {'sku': sku, 'title': html.unescape(title), 'url': url, 'page': pg, 'category': cat,
                                       'price': float(price.group(1).replace(',', '')) if price else None, 'step_listed': sku in steps})
            if len(parts) == n0:
                sk = re.search(r'"sku":"([0-9A-Za-z-]+)"', t); ti = re.search(r'<title>(.*?)</title>', t, re.S)
                pr = re.search(r'"price":\{"without_tax":\{"formatted":"\$([0-9.,]+)"', t)
                if sk:
                    parts.setdefault(sk.group(1), {'sku': sk.group(1), 'title': html.unescape(ti.group(1).strip()) if ti else sk.group(1), 'url': 'https://www.gobilda.com/' + pg,
                                                   'page': pg, 'category': cat, 'price': float(pr.group(1).replace(',', '')) if pr else None, 'step_listed': sk.group(1) in steps})
            base = pg.rstrip('/')
            for nxt in set(re.findall(r'href="https://www\.gobilda\.com/' + re.escape(base) + r'/?\?page=(\d+)"', t)):
                queue.append(f'{base}/?page={nxt}')
            print(f'{cat} | {p}: parts now {len(parts)} (+{len(parts) - n0})', flush=True)
            json.dump(parts, open(os.path.join(D, 'parts.json'), 'w'), indent=1)
print('DONE', len(parts), flush=True)
