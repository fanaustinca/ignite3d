// Central asset configuration. Parts are served from a static GitHub repo via jsDelivr:
//   {cdn}/catalog.json, {cdn}/parts/{sku}.glb, {cdn}/thumbnails/{sku}.png
// with the deployed site's own ./parts/ folder as the fallback.
export interface RepoRef {
  owner: string;
  repo: string;
  branch: string;
  /** Folder inside the repo that holds catalog.json / parts / thumbnails ('' = repo root). */
  basePath: string;
}

export interface AssetConfig {
  primary: RepoRef;
  useCdn: boolean;
  /** Extra team repos whose catalog.json parts are merged in (custom printed parts etc.). */
  teamRepos: RepoRef[];
  /** Draco decoder location. */
  dracoPath: string;
  fetchTimeoutMs: number;
}

export const DEFAULT_REPO: RepoRef = { owner: 'fanaustinca', repo: 'ignite3d', branch: 'main', basePath: 'public' };

export const ASSET_CONFIG: AssetConfig = {
  primary: DEFAULT_REPO,
  useCdn: true,
  teamRepos: [],
  dracoPath: 'https://www.gstatic.com/draco/versioned/decoders/1.5.7/',
  fetchTimeoutMs: 6000,
};

const KEY = 'ignite3d-asset-config';

export function loadAssetConfig(): AssetConfig {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...ASSET_CONFIG, ...JSON.parse(raw) };
  } catch {
    /* storage unavailable */
  }
  return { ...ASSET_CONFIG };
}

export function saveAssetConfig(c: AssetConfig) {
  try {
    localStorage.setItem(KEY, JSON.stringify(c));
  } catch {
    /* ignore */
  }
}

export function cdnBase(r: RepoRef) {
  const base = r.basePath.replace(/^\/+|\/+$/g, '');
  return `https://cdn.jsdelivr.net/gh/${r.owner}/${r.repo}@${r.branch}/${base ? base + '/' : ''}`;
}

export function rawGithubBase(r: RepoRef) {
  const base = r.basePath.replace(/^\/+|\/+$/g, '');
  return `https://raw.githubusercontent.com/${r.owner}/${r.repo}/${r.branch}/${base ? base + '/' : ''}`;
}

/** The deployed app's own static folder (works offline / local dev). */
export function localBase() {
  return import.meta.env.BASE_URL || './';
}

/** Parse "owner/repo", "owner/repo@branch" or a github.com URL. */
export function parseRepo(input: string): RepoRef | null {
  const s = input.trim().replace(/\.git$/, '');
  let m = s.match(/github\.com\/([^/\s]+)\/([^/\s#?]+)(?:\/tree\/([^/\s]+)(?:\/(.*))?)?/);
  if (m) return { owner: m[1], repo: m[2], branch: m[3] ?? 'main', basePath: m[4] ?? '' };
  m = s.match(/^([\w.-]+)\/([\w.-]+)(?:@([\w./-]+))?(?::(.*))?$/);
  if (m) return { owner: m[1], repo: m[2], branch: m[3] ?? 'main', basePath: m[4] ?? '' };
  return null;
}

export const repoLabel = (r: RepoRef) => `${r.owner}/${r.repo}@${r.branch}${r.basePath ? ':' + r.basePath : ''}`;
