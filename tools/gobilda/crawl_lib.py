"""Polite goBILDA crawler: category pages -> series pages -> variant cards (sku, name, price, url, step zip).
Honours robots.txt crawl-delay (10 s), caches every page, never touches disallowed paths."""
import json, os, re, sys, time, html, urllib.request
BASE = 'https://www.gobilda.com/'
UA = 'Mozilla/5.0 (Ignite3D parts sync; respects robots.txt)'
D = os.path.dirname(os.path.abspath(__file__))
last = [0.0]
def get(path, binary=False):
    cache = os.path.join(D, 'html', re.sub(r'[^a-z0-9.-]+', '_', path.lower()) + ('' if binary else '.html'))
    if os.path.exists(cache):
        return open(cache, 'rb').read() if binary else open(cache, encoding='utf-8', errors='ignore').read()
    wait = 10.5 - (time.time() - last[0])
    if wait > 0: time.sleep(wait)
    req = urllib.request.Request(BASE + path.lstrip('/'), headers={'User-Agent': UA})
    try:
        with urllib.request.urlopen(req, timeout=60) as r: data = r.read()
    except Exception as e:
        print('ERR', path, e, flush=True); last[0] = time.time(); return b'' if binary else ''
    last[0] = time.time()
    open(cache, 'wb').write(data)
    return data if binary else data.decode('utf-8', 'ignore')

