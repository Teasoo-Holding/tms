/** Sign-in identifiers: a username, an email address or a phone number, in one field. */

/** Strips spaces, dashes, dots and brackets; keeps a leading +. Returns null when it is not a phone number. */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim().replace(/[\s\-().]/g, '');
  return /^\+?[0-9]{7,16}$/.test(s) ? s : null;
}

export const USERNAME_RE = /^(?=.*[A-Za-z])[A-Za-z0-9._-]{3,40}$/;
