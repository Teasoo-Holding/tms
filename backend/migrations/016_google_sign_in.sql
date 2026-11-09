-- Sign in with Google (#97). A Google account is linked to one TMS user, by Google's stable account id ("sub"),
-- the first time that user signs in with Google using the verified email address on their TMS account.
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_sub text;
CREATE UNIQUE INDEX IF NOT EXISTS users_google_sub_key ON users (google_sub) WHERE google_sub IS NOT NULL;
