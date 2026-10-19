import * as argon2 from 'argon2';

// Argon2id with OWASP-recommended baseline parameters.
const OPTIONS = { type: argon2.argon2id as 2, memoryCost: 19456, timeCost: 2, parallelism: 1 };

export const hashPassword = (plain: string) => argon2.hash(plain, OPTIONS);
export const verifyPassword = (hash: string, plain: string) => argon2.verify(hash, plain).catch(() => false);

export function assertPasswordPolicy(plain: string): string | null {
  if (plain.length < 10) return 'Passwords must be at least 10 characters long.';
  return null;
}
