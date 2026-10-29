// Talks to the Cloudflare Worker. The API address can be overridden with ?api=URL (kept in
// localStorage) for local testing; ?api=reset goes back to the default.

const DEFAULT_API = 'https://chess-trainer-api.muellercodes.workers.dev';
const SESSION_KEY = 'ct.session';

function apiBase() {
  try {
    const q = new URLSearchParams(location.search).get('api');
    if (q === 'reset') localStorage.removeItem('ct.api');
    else if (q) localStorage.setItem('ct.api', q);
    return localStorage.getItem('ct.api') || DEFAULT_API;
  } catch (_) {
    return DEFAULT_API;
  }
}

export const API_BASE = apiBase();

export function getSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY)) || null; } catch (_) { return null; }
}

export function setSession(s) {
  if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
  else localStorage.removeItem(SESSION_KEY);
}

export class ApiError extends Error {
  constructor(msg, status) { super(msg); this.status = status; }
}

export async function api(method, path, body) {
  const s = getSession();
  const headers = { 'content-type': 'application/json' };
  if (s && s.token) headers.authorization = 'Bearer ' + s.token;
  let res;
  try {
    res = await fetch(API_BASE + '/api' + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch (e) {
    throw new ApiError('Could not reach the server. Check your connection.', 0);
  }
  let data = null;
  try { data = await res.json(); } catch (_) { /* empty */ }
  if (!res.ok) {
    if (res.status === 401 && s && path !== '/login') {
      setSession(null);
      window.dispatchEvent(new CustomEvent('ct-signed-out'));
    }
    throw new ApiError((data && data.error) || 'Server error (' + res.status + ')', res.status);
  }
  return data;
}
