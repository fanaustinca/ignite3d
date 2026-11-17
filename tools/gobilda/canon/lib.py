"""Helpers for canonicalisation rules."""
import numpy as np

def unit(v):
    v = np.asarray(v, float); n = np.linalg.norm(v)
    return v / n if n > 1e-12 else v

def frame(y_axis, x_hint=(1, 0, 0)):
    """Rotation R whose rows map world -> canonical, such that R @ y_axis = +Y."""
    y = unit(y_axis)
    x = np.asarray(x_hint, float); x = x - y * x.dot(y)
    if np.linalg.norm(x) < 1e-6:
        x = np.array([0, 0, 1.0]) - y * y[2]
    x = unit(x); z = np.cross(x, y)
    return np.vstack([x, y, z])  # rows

def snap_axis(R):
    """Round a rotation to the nearest axis-aligned one when it is within 1e-6 (keeps grids exact)."""
    Rr = np.round(R)
    return Rr if np.allclose(Rr, R, atol=1e-6) else R

def bosses_along(ctx, axis, rmin=0, rmax=1e9):
    a = unit(axis)
    return [b for b in ctx['bosses'] if abs(abs(np.dot(unit(b['dir']), a)) - 1) < 1e-4 and rmin <= b['r'] <= rmax]

def ends(seg, axis):
    """(t_low, t_high) of a segment along axis."""
    a = unit(axis); t0, t1 = np.dot(seg['c0'], a), np.dot(seg['c1'], a)
    return min(t0, t1), max(t0, t1)

def male(id_, type_, pos, normal, up=(1, 0, 0)):
    return {'id': id_, 'type': type_, 'position': [round(float(x), 4) for x in pos], 'normal': [round(float(x), 6) for x in unit(normal)],
            'upVector': [round(float(x), 6) for x in unit(up)], 'male': True}

def longest_axis(ctx):
    lo, hi = np.array(ctx['bbox'][0]), np.array(ctx['bbox'][1])
    e = np.eye(3)[int(np.argmax(hi - lo))]
    return e
