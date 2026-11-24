"""Extract every kit's contents (all page layouts) from cached pages; expand nested bundles. Writes kits_bom.json."""
import json, os, re, html, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from crawl_lib import get
D = os.path.dirname(os.path.abspath(__file__))
kits = json.load(open(os.path.join(D, 'kits.json')))
SKU = r'(\d{4}-\d{4}-\d{4})'
def text(t):
    t = t.replace('\\r', ' ').replace('\\n', ' ').replace('\\"', '"')
    t = re.sub(r'<[^>]+>', ' ', t)
    t = html.unescape(html.unescape(t)).replace('\xa0', ' ')
    return re.sub(r'\s+', ' ', t)
out = {}
for ksku, k in kits.items():
    t = text(get(k['url'].replace('https://www.gobilda.com/', '')))
    found = {}
    for q, s in re.findall(r'Qty: (\d+) .{0,250}?SKU: ' + SKU, t): found[s] = max(found.get(s, 0), int(q))
    for kw in ('Bill of Materials', 'Contents', 'Includes:', 'Kit Includes'):
        for m in re.finditer(re.escape(kw), t):
            seg = t[m.end(): m.end() + 30000]
            cut = re.search(r'(Specifications|Related Products|Customers Also|You May Also|"image":|Resources)', seg)
            if cut: seg = seg[:cut.start()]
            for q, s in re.findall(r'Qty: (\d+) .{0,250}?SKU: ' + SKU, seg): found[s] = max(found.get(s, 0), int(q))
            for q, s in re.findall(r'\b(\d{1,4}) ' + SKU + r'(?:-\d+pk)? x \d+', seg): found[s] = max(found.get(s, 0), int(q))
            for s, q in re.findall(SKU + r'(?:-\d+pk)? x \d+ (\d{1,4}) ', seg): found.setdefault(s, int(q))
            for s, q in re.findall(SKU + r'(?:-\d+pk)? (\d{1,4}) \S', seg): found.setdefault(s, int(q))
    found.pop(ksku, None)
    names = {}
    for s in found:
        m = re.search(r'Qty: \d+ (.{3,200}?) SKU: ' + s, t)
        if m: names[s] = m.group(1).split('Qty:')[-1].strip(); continue
        for m in re.finditer(s + r'(?:-\d+pk)?(?: x \d+)?(?: \d{1,4})? (.{3,200})', t):
            nm = re.split(r' (?=\d{4}-\d{4}-\d{4}|Qty:|SKU:|\d{1,4} \d{4}-)', m.group(1))[0].strip()
            if re.match(r'[A-Za-z0-9]', nm) and not re.match(r'\d{4}-', nm): names[s] = nm[:120]; break
    out[ksku] = {'title': k['title'], 'items': found, 'names': names}
# expand nested bundles
def expand(s, seen=()):
    res = {}
    for c, q in out[s]['items'].items():
        if c in out and c not in seen and out[c]['items']:
            for cc, qq in expand(c, seen + (s,)).items(): res[cc] = res.get(cc, 0) + q * qq
        else: res[c] = res.get(c, 0) + q
    return res
for s in out: out[s]['flat'] = expand(s)
json.dump(out, open(os.path.join(D, 'kits_bom.json'), 'w'), indent=1)
for s, v in out.items(): print(s, len(v['items']), len(v['flat']), v['title'][:60])
