"""Round 5 (2026-11-24): popular FTC parts found by crawl4 (fresh category-tree crawl) -> parts.json.
Rigid parts with a STEP only; tubing/chain/springs/track belts/electronics/bundles left out."""
import json, os, re
D = os.path.dirname(os.path.abspath(__file__))
parts = json.load(open(os.path.join(D, 'parts.json')))
new = json.load(open(os.path.join(D, 'new4.json')))
CAT = [
    (r'^25(00|01)-', 'Gears & Slides'),          # Viper-Slide + end-stop / pulley bracket
    (r'^3110-', 'Mounts'),                        # odometry pods, Pinpoint
    (r'^19(14|16|17|18|19|20|25)-', 'Shafts & Hubs'),  # hub-mount control arms / discs
    (r'^2108-', 'Shafts & Hubs'),                 # CV joints
    (r'^2100-000[68]-', 'Shafts & Hubs'),         # 6 / 8 mm stainless round shafts
    (r'^4100-(0608|0810|1214)-', 'Shafts & Hubs'),  # aluminium tubes (intake rollers, spacers)
    (r'^2902-', 'Structure'),                     # hinges
    (r'^2904-', 'Fasteners & Spacers'),           # hole reducers
    (r'^29(03|13)-', 'Fasteners & Spacers'),      # ball linkages
    (r'^2808-', 'Fasteners & Spacers'),           # M4 threaded rods
    (r'^1513-', 'Fasteners & Spacers'),           # offset standoffs
    (r'^1140-', 'Structure'),                     # round baseplate
    (r'^(1608|1609)-', 'Shafts & Hubs'),          # idler bearing-hub, v-groove bearing
    (r'^3208-', 'Gears & Slides'),                # gear-driven turret
    (r'^3310-0032-|^3312-', 'Gears & Slides'),    # 32 mm bore hub-mount sprockets, pinion sprocket
    (r'^34(07|08)-', 'Gears & Slides'),           # winch pulley, v-groove pulley
    (r'^2405-|^2411-', 'Gears & Slides'),         # track idler wheel, track sprockets
    (r'^3628-', 'Wheels'),                        # steel flywheels (shooters)
    (r'^3616-', 'Wheels'),                        # Wasteland wheels
]
add = 0
for sku, v in new.items():
    if sku in parts or not v.get('step_listed'): continue
    cat = next((c for pat, c in CAT if re.search(pat, sku)), None)
    if not cat: continue
    if re.search(r'gear set|replacement|tubing|cable|spring|track \(|tank-track|grid-track|bundle|pack \(\d+ pcs\)', v['title'], re.I): continue
    title = re.sub(r'^\d{4}-\d{4}-\d{4} - ', '', v['title'])
    parts[sku] = {'sku': sku, 'title': title, 'url': v['url'], 'page': v['page'], 'category': cat, 'price': v['price'], 'step_listed': True, 'added': 'r5'}
    add += 1
    print(sku, cat, title)
json.dump(parts, open(os.path.join(D, 'parts.json'), 'w'), indent=1)
print('added', add, 'total', len(parts))
