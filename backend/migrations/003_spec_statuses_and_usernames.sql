-- Align with the 19 Oct 2026 project spec: Alive/Dead statuses with a photo on every visit, and
-- accounts that sign in with a username or phone number as well as (optional) email.

-- ---------------------------------------------------------------- statuses
-- Alive and Dead become the working list. The earlier default statuses are deactivated, not deleted,
-- so trees and observations already recorded with them keep their meaning. Statuses an administrator
-- created themselves are left alone.
INSERT INTO tree_statuses (code, name, description, is_terminal, allows_replacement, requires_photo, sort_order, active)
VALUES ('ALIVE', 'Alive', 'The tree is alive.', false, false, true, 10, true),
       ('DEAD', 'Dead', 'The tree is dead. A replacement may be planted.', true, true, true, 20, true)
ON CONFLICT (code) DO UPDATE
  SET name = EXCLUDED.name, is_terminal = EXCLUDED.is_terminal, allows_replacement = EXCLUDED.allows_replacement,
      requires_photo = true, sort_order = EXCLUDED.sort_order, active = true, updated_at = now();

UPDATE tree_statuses SET active = false, updated_at = now()
 WHERE code IN ('PLANTED', 'HEALTHY', 'NEEDS_INSPECTION', 'DAMAGED', 'MISSING') AND active;

-- ---------------------------------------------------------------- sign-in identifiers
ALTER TABLE users ALTER COLUMN email DROP NOT NULL;
ALTER TABLE users ADD COLUMN username text CHECK (username IS NULL OR username ~ '^[A-Za-z0-9._-]{3,40}$' AND username ~ '[A-Za-z]');
-- Stored as typed by the administrator with separators removed (e.g. +2348031234567 or 08031234567).
ALTER TABLE users ADD COLUMN phone text CHECK (phone IS NULL OR phone ~ '^\+?[0-9]{7,16}$');
ALTER TABLE users ADD CONSTRAINT users_has_login CHECK (username IS NOT NULL OR email IS NOT NULL OR phone IS NOT NULL);
CREATE UNIQUE INDEX users_username_key ON users (lower(username)) WHERE username IS NOT NULL;
-- Phones match on their last ten digits, so +234 803… and 0803… are the same number.
CREATE UNIQUE INDEX users_phone_key ON users (right(phone, 10)) WHERE phone IS NOT NULL;
