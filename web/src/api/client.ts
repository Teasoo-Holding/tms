/** Backend origin, without trailing slashes. Empty means same origin (the /api proxy: Vite in development, vercel.json or nginx in production). */
// Tolerates common mistakes: trailing slashes, or the /api or /api/v1 suffix included in the variable.
const API_ORIGIN = String(import.meta.env.VITE_API_BASE ?? '')
  .trim()
  .replace(/\/+$/, '')
  .replace(/\/api(\/v1)?$/, '');
const BASE = `${API_ORIGIN}/api/v1`;
const STORAGE_KEY = 'tms.session';

export interface SessionUser {
  id: string;
  email: string;
  full_name: string;
  role: 'ADMIN' | 'FIELD_OFFICER' | 'EXECUTIVE';
}
interface StoredSession {
  access_token: string;
  refresh_token: string;
  user: SessionUser;
}

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown, public body?: any) {
    super(message);
  }
}

let session: StoredSession | null = (() => {
  try {
    return JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? 'null');
  } catch {
    return null;
  }
})();
const listeners = new Set<() => void>();

function setSession(s: StoredSession | null) {
  session = s;
  try {
    if (s) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage unavailable: session lives in memory only */
  }
  listeners.forEach((l) => l());
}

export const auth = {
  get user() {
    return session?.user ?? null;
  },
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  async login(email: string, password: string) {
    const res = await raw('POST', '/auth/login', { email, password }, false);
    setSession(res);
  },
  async logout() {
    if (session) await raw('POST', '/auth/logout', { refresh_token: session.refresh_token }, false).catch(() => undefined);
    setSession(null);
  },
};

let refreshing: Promise<boolean> | null = null;
async function refresh(): Promise<boolean> {
  if (!session) return false;
  refreshing ??= raw('POST', '/auth/refresh', { refresh_token: session.refresh_token }, false)
    .then((res) => {
      setSession(res);
      return true;
    })
    .catch(() => {
      setSession(null);
      return false;
    })
    .finally(() => (refreshing = null));
  return refreshing;
}

/** Human-readable location of the API, for error messages. */
function describeBase() {
  try {
    return new URL(BASE, window.location.origin).toString();
  } catch {
    return BASE;
  }
}

/**
 * fetch() only throws (a TypeError) when no HTTP response arrived at all: the server is unreachable, or the
 * browser blocked a cross-origin response because the backend did not allow this site's origin (CORS).
 */
async function send(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (err) {
    const origin = window.location.origin;
    const crossOrigin = !!API_ORIGIN && !url.startsWith(origin);
    const message =
      `The portal cannot reach the TMS server at ${describeBase()}. ` +
      (crossOrigin
        ? `The usual fix is either (a) setting CORS_ORIGINS on the backend to include this site's origin, ${origin}, or ` +
          `(b) leaving VITE_API_BASE empty when building the portal so it uses the same-origin /api proxy.`
        : `Check that the server is running and that the /api proxy is configured for this site (${origin}).`);
    throw new ApiError(0, 'NETWORK_ERROR', message, undefined, { cause: String(err) });
  }
}

async function raw(method: string, path: string, body: unknown, authed: boolean, retry = true): Promise<any> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (authed && session) headers.Authorization = `Bearer ${session.access_token}`;
  const res = await send(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  if (res.status === 401 && authed && retry && session) {
    if (await refresh()) return raw(method, path, body, authed, false);
  }
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // A non-JSON body (e.g. an HTML page from a misconfigured proxy) is reported as a failed request below.
    if (res.ok) throw new ApiError(res.status, 'BAD_RESPONSE', `The server at ${describeBase()} returned an unexpected response. Check VITE_API_BASE and the /api proxy.`);
  }
  if (!res.ok) {
    throw new ApiError(res.status, data?.code ?? 'ERROR', data?.message ?? `Request failed (${res.status})`, data?.details, data);
  }
  return data;
}

export const api = {
  get: <T = any>(path: string) => raw('GET', path, undefined, true) as Promise<T>,
  post: <T = any>(path: string, body?: unknown) => raw('POST', path, body ?? {}, true) as Promise<T>,
  patch: <T = any>(path: string, body: unknown) => raw('PATCH', path, body, true) as Promise<T>,
  /** Downloads an authenticated file (exports). */
  async download(path: string, filename: string) {
    const go = () => send(BASE + path, { headers: { Authorization: `Bearer ${session?.access_token}` } });
    let res = await go();
    if (res.status === 401 && (await refresh())) res = await go();
    if (!res.ok) throw new ApiError(res.status, 'DOWNLOAD_FAILED', 'The export could not be downloaded.');
    const url = URL.createObjectURL(await res.blob());
    const a = Object.assign(document.createElement('a'), { href: url, download: filename });
    a.click();
    URL.revokeObjectURL(url);
  },
};

export function qs(params: Record<string, string | number | undefined | null>) {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '');
  return entries.length ? '?' + new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString() : '';
}
