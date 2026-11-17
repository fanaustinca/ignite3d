// Onshape REST integration (advanced, optional).
//
// Reality check: Onshape's API and OAuth endpoints do not send CORS headers, so a pure
// static site cannot call them directly from the browser. This module therefore needs:
//   1. Your own Onshape OAuth app (dev-portal.onshape.com) with this page as redirect URI.
//   2. A tiny CORS relay you control (e.g. a Cloudflare Worker) that forwards requests to
//      cad.onshape.com / oauth.onshape.com.
// The always-works path is the STEP assembly export (Insert → Import in Onshape).
import { onshapeTransform } from '../export/files';
import type { CatalogPart, PlacedInstance } from '../types/cad';

export interface OnshapeSettings {
  clientId: string;
  proxyUrl: string; // e.g. https://my-relay.workers.dev/ ; requests go to `${proxy}${absoluteUrl}`
  /** documentId/workspaceId/elementId of the target assembly. */
  target: { did: string; wid: string; eid: string };
  /** SKU -> {documentId, versionId, elementId, partId?} in the FTC Parts Library or your own docs. */
  library: Record<string, { documentId: string; versionId?: string; elementId: string; partId?: string }>;
}

const KEY = 'ignite3d-onshape';
export function loadOnshapeSettings(): OnshapeSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  return { clientId: '', proxyUrl: '', target: { did: '', wid: '', eid: '' }, library: {} };
}
export function saveOnshapeSettings(s: OnshapeSettings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

function b64url(bytes: ArrayBuffer | Uint8Array) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  arr.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Start the OAuth 2 authorization-code + PKCE flow (redirects the page). */
export async function startOnshapeLogin(s: OnshapeSettings) {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const state = b64url(crypto.getRandomValues(new Uint8Array(12)));
  sessionStorage.setItem('ignite3d-pkce', JSON.stringify({ verifier, state }));
  const redirect = location.href.split('#')[0].split('?')[0];
  const url = new URL('https://oauth.onshape.com/oauth/authorize');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', s.clientId);
  url.searchParams.set('redirect_uri', redirect);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', state);
  location.href = url.toString();
}

/** Call on boot: if we returned from Onshape with ?code=, exchange it (through the relay). */
export async function completeOnshapeLogin(s: OnshapeSettings): Promise<string | null> {
  const params = new URLSearchParams(location.search);
  const code = params.get('code');
  const state = params.get('state');
  const saved = JSON.parse(sessionStorage.getItem('ignite3d-pkce') || 'null');
  if (!code || !saved || saved.state !== state) return null;
  const redirect = location.href.split('#')[0].split('?')[0];
  const body = new URLSearchParams({ grant_type: 'authorization_code', code, client_id: s.clientId, redirect_uri: redirect, code_verifier: saved.verifier });
  const res = await fetch(`${s.proxyUrl}https://oauth.onshape.com/oauth/token`, { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  if (!res.ok) throw new Error(`Token exchange failed (${res.status})`);
  const tok = await res.json();
  sessionStorage.setItem('ignite3d-onshape-token', tok.access_token);
  sessionStorage.removeItem('ignite3d-pkce');
  history.replaceState(null, '', redirect + location.hash);
  return tok.access_token as string;
}

export function onshapeToken() {
  return sessionStorage.getItem('ignite3d-onshape-token');
}

async function api(s: OnshapeSettings, token: string, method: string, path: string, body?: unknown) {
  const res = await fetch(`${s.proxyUrl}https://cad.onshape.com/api/v10${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${await res.text()}`);
  return res.json();
}

/**
 * Insert one instance per placed part from the mapped library documents into the target
 * assembly, then set each occurrence's transform. Unmapped SKUs are reported back.
 */
export async function pushToOnshape(s: OnshapeSettings, token: string, instances: PlacedInstance[], catalog: Record<string, CatalogPart>) {
  const { did, wid, eid } = s.target;
  const base = `/assemblies/d/${did}/w/${wid}/e/${eid}`;
  const missing = new Set<string>();
  let pushed = 0;
  for (const inst of instances.filter((i) => !i.hidden)) {
    const lib = s.library[inst.sku];
    if (!lib) {
      missing.add(`${inst.sku} ${catalog[inst.sku]?.name ?? ''}`);
      continue;
    }
    await api(s, token, 'POST', `${base}/instances`, {
      documentId: lib.documentId,
      versionId: lib.versionId,
      elementId: lib.elementId,
      partId: lib.partId,
      isAssembly: false,
      isWholePartStudio: !lib.partId,
    });
    const asm = await api(s, token, 'GET', `${base}`);
    const last = asm.rootAssembly.instances[asm.rootAssembly.instances.length - 1];
    await api(s, token, 'POST', `${base}/occurrencetransforms`, {
      occurrences: [{ path: [last.id] }],
      transform: onshapeTransform(inst),
      isRelative: false,
    });
    pushed++;
  }
  return { pushed, missing: [...missing] };
}
