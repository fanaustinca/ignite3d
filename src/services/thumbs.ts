// Small part thumbnails for the library hover card, rendered from the real mesh with one shared
// offscreen WebGL renderer (memory-cached by sku + mesh source).
import { useEffect, useState } from 'react';
import { AmbientLight, Box3, DirectionalLight, Group, HemisphereLight, Mesh, PerspectiveCamera, Scene, Vector3, WebGLRenderer } from 'three';
import type { PartVisual } from './assetLoader';
import { useVisual } from './visuals';

const SIZE = 192;
let renderer: WebGLRenderer | null | undefined;
let scene: Scene;
let camera: PerspectiveCamera;
const cache = new Map<string, string>();

function setup() {
  if (renderer !== undefined) return renderer;
  try {
    const canvas = document.createElement('canvas');
    renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(SIZE, SIZE, false);
    renderer.setClearColor(0x000000, 0);
    scene = new Scene();
    scene.add(new HemisphereLight(0xffffff, 0x8a8178, 1.3));
    const d = new DirectionalLight(0xffffff, 1.6);
    d.position.set(3, 6, 4);
    scene.add(d);
    const d2 = new DirectionalLight(0xffffff, 0.5);
    d2.position.set(-4, 2, -3);
    scene.add(d2);
    scene.add(new AmbientLight(0xffffff, 0.25));
    camera = new PerspectiveCamera(30, 1, 0.1, 100000);
  } catch {
    renderer = null;
  }
  return renderer;
}

export function renderThumb(key: string, v: PartVisual): string | null {
  const hit = cache.get(key);
  if (hit) return hit;
  const r = setup();
  if (!r) return null;
  const g = new Group();
  for (const m of v.meshes) g.add(new Mesh(m.geometry, m.material));
  scene.add(g);
  const b = v.bounds.isEmpty() ? new Box3().setFromObject(g) : v.bounds;
  const c = b.getCenter(new Vector3());
  const rad = Math.max(1, b.getSize(new Vector3()).length() / 2);
  const dir = new Vector3(1, 0.8, 1.3).normalize();
  camera.position.copy(c).addScaledVector(dir, rad / Math.sin((camera.fov * Math.PI) / 360) * 1.02);
  camera.near = rad / 100;
  camera.far = rad * 100;
  camera.updateProjectionMatrix();
  camera.lookAt(c);
  r.render(scene, camera);
  const url = r.domElement.toDataURL('image/png');
  scene.remove(g);
  cache.set(key, url);
  return url;
}

/** Thumbnail data URL for a part (procedural model first, swapped for the real mesh once it loads). */
export function useThumb(sku: string): string | null {
  const v = useVisual(sku);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!v) return setUrl(null);
    // give the browser a frame so hovering never stutters
    const id = requestAnimationFrame(() => setUrl(renderThumb(`${sku}|${v.source}|${v.meshes.length}`, v)));
    return () => cancelAnimationFrame(id);
  }, [sku, v]);
  return url;
}
