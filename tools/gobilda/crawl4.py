"""Fresh category-tree crawl (polite, 10.5 s/page): roots -> category cards -> product cards/tables.
Writes new4.json = products not yet in parts.json (sku -> {title,url,page,category,price,step_listed})."""
import json, os, re, html, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import crawl_lib
from crawl_lib import get
D = os.path.dirname(os.path.abspath(__file__))
parts = json.load(open(os.path.join(D, 'parts.json')))
FRESH = os.path.join(D, 'crawl4_fresh.txt')
done = set(open(FRESH).read().split()) if os.path.exists(FRESH) else set()
def cpath(p): return os.path.join(D, 'html', re.sub(r'[^a-z0-9.-]+', '_', p.lower()) + '.html')
def fresh(p):
    if p not in done and os.path.exists(cpath(p)): os.remove(cpath(p))
    t = get(p)
    if p not in done:
        done.add(p); open(FRESH, 'a').write(p + '\n')
    return t
ROOTS = ['structure', 'motion', 'hardware', 'intake/', 'turrets/', 'odometry', 'mecanum-wheels', 'intake-wheels']
SKIP = re.compile(r'electronics|batter|wiring|cable$|tools|merch|lubric|thread-locker|bundles|kits|education|support|grommets|magnets|ptfe|rubber|zip|light|switch|fuse|sensor|camera|signal|regulator|controller|transmitter|programmer|power-dist|motor-controllers')
CARD = r'<a href="(https://www\.gobilda\.com/[^"]+)"\s+data-pid="\d+" data-sku="([^"]+)"\s+title="([^"]+)"(.*?)</li>'
TAB = r'<a href="(https://www\.gobilda\.com/[^"]+)" title="([^"]+)" class="tableSKU">\s*([0-9A-Za-z-]+)\s*</a>(.*?)</tr>'
new = {}
queue, seen = [(r, r.split('/')[0]) for r in ROOTS], set()
while queue:
    p, root = queue.pop(0)
    if p in seen: continue
    seen.add(p)
    t = fresh(p)
    steps = set(re.findall(r'step_files/([0-9A-Za-z-]+)\.zip', t))
    found = [(u, s, ti, b) for u, s, ti, b in re.findall(CARD, t, re.S)] + [(u, s, ti, b) for u, ti, s, b in re.findall(TAB, t, re.S)]
    for url, sku, title, body in found:
        pr = re.search(r'\$([0-9.,]+)', body)
        if sku not in parts and sku not in new:
            new[sku] = {'sku': sku, 'title': html.unescape(title), 'url': url, 'page': p, 'root': root,
                        'price': float(pr.group(1).replace(',', '')) if pr else None, 'step_listed': sku in steps}
            print('NEW', sku, html.unescape(title), flush=True)
    for sub in re.findall(r'data-card-type="category" data-cat-path="([^"]+)"', t):
        if not SKIP.search(sub): queue.append((sub, root))
    base = p.rstrip('/')
    for n in set(re.findall(r'href="https://www\.gobilda\.com/' + re.escape(base) + r'/?\?page=(\d+)"', t)): queue.append((f'{base}/?page={n}', root))
    print(f'[{len(seen)} pages, queue {len(queue)}] {p}: {len(found)} products', flush=True)
    json.dump(new, open(os.path.join(D, 'new4.json'), 'w'), indent=1)
print('DONE', len(new), flush=True)
