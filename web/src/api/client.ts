const BASE = `${import.meta.env.VITE_API_BASE ?? ''}/api/v1`;
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

async function raw(method: string, path: string, body: unknown, authed: boolean, retry = true): Promise<any> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (authed && session) headers.Authorization = `Bearer ${session.access_token}`;
  const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  if (res.status === 401 && authed && retry && session) {
    if (await refresh()) return raw(method, path, body, authed, false);
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
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
    const go = () => fetch(BASE + path, { headers: { Authorization: `Bearer ${session?.access_token}` } });
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
