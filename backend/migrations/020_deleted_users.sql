-- Permanently deleted users (#111). A user with no records is removed completely. A user who collected data keeps
-- a row so their trees and visits still have an author, but every personal detail is erased: the name becomes
-- "Deleted user", the sign-in details and Google link are removed, the password can never match, and deleted_at is set.
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
