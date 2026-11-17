"""Real goBILDA hole data -> snap points, and rigid registration into Ignite3D's procedural part frame.

snaps_from_holes(): every open end of a hole segment becomes a snap face.
  r 1.5-1.85 -> threaded M4 (tapped), r 1.85-2.4 -> M4 clearance, r 6.8-7.2 -> 14 mm bore,
  slot end arcs (>= ~160 deg) count as screw positions; small fillets do not.
register(): try the 24 axis-aligned rotations; translation aligns bbox centres, then refined by the
  mean offset of matched holes. Score = matched snap faces (both directions) - size/centroid error.
"""
import itertools, json
import numpy as np

def classify(r):
    """Hole radius -> (snap type, threaded, minimum merged arc in rad to count as a real hole)."""
    if 1.45 <= r < 1.85: return 'm4_hole', True, 2.8       # M4 tap drill (threaded)
    if 1.85 <= r <= 2.45: return 'm4_hole', False, 2.8     # M4 clearance / slot ends
    if 2.95 <= r <= 3.1: return 'd_6mm', False, 2.8        # 6 mm D bore (round part)
    if 3.9 <= r <= 4.1: return 'rex_8mm', False, 2.8       # 8 mm round bore (takes REX shaft)
    if 4.2 <= r <= 4.95: return 'rex_8mm', False, 1.0      # REX hex bore: 6 rounded-corner arcs share one axis
    if 6.8 <= r <= 7.25: return 'bearing_14mm', False, 2.8 # 14 mm pattern bore
    return None, False, 99

def snaps_from_holes(holes):
    out = []
    for k, h in enumerate(holes):
        t, tapped, min_arc = classify(h['r'])
        if not t: continue
        if not h['full'] and h.get('arc', 0) < min_arc: continue  # fillets / partial notches
        d = np.array(h['dir'])
        for end, (c, sgn, open_) in enumerate(((h['c0'], -1, h['open0']), (h['c1'], 1, h['open1']))):
            if not open_: continue
            out.append({'id': f'h{k}{"ab"[end]}', 'type': t, 'p': list(map(float, c)), 'n': (d * sgn).tolist(),
                        'depth': h['len'], 'tapped': tapped or (not h['open0'] or not h['open1']), 'holeId': f'h{k}', 'full': h['full']})
    return out

def rotations():
    mats = []
    for perm in itertools.permutations(range(3)):
        for signs in itertools.product((1, -1), repeat=3):
            M = np.zeros((3, 3))
            for i in range(3): M[i, perm[i]] = signs[i]
            if np.linalg.det(M) > 0: mats.append(M)
    return mats

def match_count(A, An, B, Bn, tol=0.3):
    if not len(A) or not len(B): return 0, []
    d = np.linalg.norm(A[:, None, :] - B[None, :, :], axis=2)
    nd = An @ Bn.T
    ok = (d < tol) & (nd > 0.99)
    pairs = [(i, int(np.argmin(np.where(ok[i], d[i], 1e9)))) for i in range(len(A)) if ok[i].any()]
    return int(ok.any(1).sum() + ok.any(0).sum()), pairs

def register(real, proc):
    """real: {'bbox','centroid','snaps'}; proc: {'bbox','centroid','female'}. Returns R, t, report."""
    rb = np.array(real['bbox']); pb = np.array(proc['bbox'])
    rc = (rb[0] + rb[1]) / 2; pc = (pb[0] + pb[1]) / 2
    rs = rb[1] - rb[0]; ps = pb[1] - pb[0]
    RP = np.array([s['p'] for s in real['snaps']]) if real['snaps'] else np.zeros((0, 3))
    RN = np.array([s['n'] for s in real['snaps']]) if real['snaps'] else np.zeros((0, 3))
    PP = np.array([s['p'] for s in proc['female']]) if proc['female'] else np.zeros((0, 3))
    PN = np.array([s['n'] for s in proc['female']]) if proc['female'] else np.zeros((0, 3))
    best = None
    for R in rotations():
        t = pc - R @ rc
        A = RP @ R.T + t if len(RP) else RP
        An = RN @ R.T if len(RN) else RN
        m, pairs = match_count(A, An, PP, PN)
        if pairs:  # refine translation
            off = np.mean([PP[j] - A[i] for i, j in pairs], axis=0)
            if np.linalg.norm(off) < 2:
                t = t + off
                A = A + off
                m, pairs = match_count(A, An, PP, PN)
        size_err = float(np.abs(np.abs(R) @ rs - ps).sum())
        cen_err = float(np.linalg.norm(R @ np.array(real['centroid']) + t - np.array(proc['centroid'])))
        score = m - 0.5 * size_err - 0.5 * cen_err
        if best is None or score > best[0]:
            best = (score, R, t, m, size_err, cen_err, pairs)
    score, R, t, m, size_err, cen_err, pairs = best
    return R, t, {'score': round(score, 2), 'matched_faces': m, 'real_faces': len(RP), 'proc_faces': len(PP),
                  'real_matched': len({i for i, _ in pairs}), 'proc_matched': len({j for _, j in pairs}),
                  'size_err_mm': round(size_err, 3), 'centroid_err_mm': round(cen_err, 3)}

def apply(R, t, snaps):
    out = []
    for s in snaps:
        s2 = dict(s)
        s2['p'] = (R @ np.array(s['p']) + t).round(4).tolist()
        s2['n'] = (R @ np.array(s['n'])).round(6).tolist()
        out.append(s2)
    return out
