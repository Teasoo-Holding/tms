-- Sync status reported by each phone at the end of every sync run (POST /sync/status): what is still waiting on the
-- phone, so reports can say "N devices have unsent records" instead of treating a missing day as zero.
-- devices.last_sync_at and app_version already exist (001); last_sync_at is also set by every accepted batch.
-- Apps that do not report leave these columns null.
--
-- Safe to run again.

ALTER TABLE devices ADD COLUMN IF NOT EXISTS last_sync_at timestamptz;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS pending_operations int;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS pending_photos int;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS oldest_pending_at timestamptz;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS status_reported_at timestamptz;
-- Who was signed in when the status was reported (a shared phone may change hands).
ALTER TABLE devices ADD COLUMN IF NOT EXISTS status_user_id uuid REFERENCES users(id);

ALTER TABLE devices DROP CONSTRAINT IF EXISTS devices_pending_counts_check;
ALTER TABLE devices ADD CONSTRAINT devices_pending_counts_check CHECK (pending_operations >= 0 AND pending_photos >= 0);

CREATE INDEX IF NOT EXISTS devices_user_idx ON devices (user_id);
