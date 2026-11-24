"""Crawl goBILDA kit/bundle listings -> each kit's Bill of Materials (polite, cached). Writes kits.json."""
import json, os, re, html, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from crawl_lib import get
D = os.path.dirname(os.path.abspath(__file__))
LISTS = ['ftc-kits', 'chassis-kits', 'linear-motion-kits', 'pan-kits', 'structure-bundles', 'motion-bundles', 'hardware-bundles']
CARD = r'<a href="(https://www\.gobilda\.com/[^"]+)"\s+data-pid="\d+" data-sku="([^"]+)"\s+title="([^"]+)"'
def bom(t):
    out = []
    for i in [m.start() for m in re.finditer(r'Bill of Materials:?\s*</h\d>', t)] or [m.start() for m in re.finditer(r'(Kit Contents|Includes|Bundle Contents)[^<]{0,20}</h\d>', t)]:
        seg = t[i:i + 80000]; seg = seg[:seg.find('</table>')]
        for r in re.findall(r'<tr.*?</tr>', seg, re.S):
            c = [html.unescape(re.sub(r'<[^>]+>', '', x)).strip() for x in re.findall(r'<t[dh].*?</t[dh]>', r, re.S)]
            if len(c) >= 3 and c[0].isdigit():
                m = re.match(r'([0-9A-Za-z-]+)', c[1])
                if m: out.append({'qty': int(c[0]), 'sku': m.group(1), 'name': c[2]})
    return out
kits = {}
for L in LISTS:
    q, seen = [L], set()
    while q:
        p = q.pop(0)
        if p in seen: continue
        seen.add(p); t = get(p)
        for url, sku, title in re.findall(CARD, t):
            kits.setdefault(sku, {'sku': sku, 'title': html.unescape(title), 'url': url, 'list': L})
        for n in set(re.findall(r'href="https://www\.gobilda\.com/' + re.escape(L) + r'/?\?page=(\d+)"', t)): q.append(f'{L}/?page={n}')
    print(L, len(kits), flush=True)
for sku, k in kits.items():
    t = get(k['url'].replace('https://www.gobilda.com/', ''))
    k['bom'] = bom(t)
    print(sku, k['title'], len(k['bom']), flush=True)
    json.dump(kits, open(os.path.join(D, 'kits.json'), 'w'), indent=1)
print('DONE', len(kits), flush=True)
