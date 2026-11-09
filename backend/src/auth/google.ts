import { createPublicKey, verify, JsonWebKey } from 'crypto';

/** What a verified Google ID token tells us about the person. */
export interface GoogleIdentity {
  sub: string;
  email: string;
  name?: string;
}

const ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);
const CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs';

type Jwks = { keys: (JsonWebKey & { kid?: string })[] };
export type JwksSource = () => Promise<Jwks>;

let cache: { keys: Jwks; until: number } | null = null;
/** Google's signing keys, cached for as long as Google's Cache-Control allows (at least a minute). */
export const googleKeys: JwksSource = async () => {
  if (cache && cache.until > Date.now()) return cache.keys;
  const res = await fetch(CERTS_URL);
  if (!res.ok) throw new Error(`Google keys: HTTP ${res.status}`);
  const keys = (await res.json()) as Jwks;
  const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get('cache-control') ?? '')?.[1] ?? 3600);
  cache = { keys, until: Date.now() + Math.max(60, maxAge) * 1000 };
  return keys;
};

const b64json = (part: string) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));

/**
 * Checks a Google Identity Services ID token: RS256 signature by one of Google's keys, issuer, audience (our client
 * id), expiry and a verified email address. Returns null for any token that fails a check.
 */
export async function verifyGoogleIdToken(token: string, clientId: string, keys: JwksSource = googleKeys, now = Date.now()): Promise<GoogleIdentity | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  let header: any;
  let claims: any;
  try {
    header = b64json(parts[0]);
    claims = b64json(parts[1]);
  } catch {
    return null;
  }
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') return null;
  const jwk = (await keys()).keys.find((k) => k.kid === header.kid);
  if (!jwk) return null;
  const ok = verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(parts[2], 'base64url'));
  if (!ok) return null;
  const skew = 60;
  const t = Math.floor(now / 1000);
  if (!ISSUERS.has(claims.iss) || claims.aud !== clientId) return null;
  if (typeof claims.exp !== 'number' || claims.exp + skew < t) return null;
  if (typeof claims.iat === 'number' && claims.iat - skew > t) return null;
  if (typeof claims.sub !== 'string' || typeof claims.email !== 'string') return null;
  if (claims.email_verified !== true && claims.email_verified !== 'true') return null;
  return { sub: claims.sub, email: claims.email.toLowerCase(), name: typeof claims.name === 'string' ? claims.name : undefined };
}
