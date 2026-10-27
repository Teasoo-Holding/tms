-- Vendor codes are back in tree IDs, and observations carry the phone's field session.
--
--  * Several vendors tag trees on the same project, each numbering from 1, so the vendor's short code is a part of
--    the ID (T4L-2026-KNM-000001) and tree numbers run per project + planting year + vendor. Still one format per
--    project (the tree_id_schemes_project_wide check from 007 stays): every project format without the vendor code
--    gets a new version with it, just before the tree number. Trees keep their registered IDs and snapshots.
--  * The phone generates one id per field session (a stretch of work) and sends it with each observation, for the
--    field-activity report. Older apps send none.
--  * Client share links keep their token encrypted (by the server's key), so administrators can copy a link again.
--
-- Safe to run again (each step only acts when needed).

-- ---------------------------------------------------------------- vendor code in every project format
CREATE TEMP TABLE formats_without_vendor ON COMMIT DROP AS
SELECT * FROM tree_id_schemes
 WHERE active AND vendor_id IS NULL AND planting_year_id IS NULL
   AND NOT component_definition @> '[{"type": "VENDOR_CODE"}]';

UPDATE tree_id_schemes SET active = false, updated_at = now() WHERE id IN (SELECT id FROM formats_without_vendor);

-- Parts in their order with the vendor code slotted in just before the tree number (at the end if there is none);
-- the vendor joins the numbering scope, except where numbering was deliberately global.
INSERT INTO tree_id_schemes (project_id, version, component_definition, separator, serial_width, serial_uniqueness_scope)
SELECT f.project_id,
       (SELECT max(version) + 1 FROM tree_id_schemes x WHERE x.project_id = f.project_id),
       (SELECT jsonb_agg(c ORDER BY pos NULLS LAST)
          FROM (SELECT c, i::numeric AS pos FROM jsonb_array_elements(f.component_definition) WITH ORDINALITY e(c, i)
                UNION ALL
                SELECT '{"type": "VENDOR_CODE", "required": true}'::jsonb,
                       (SELECT i - 0.5 FROM jsonb_array_elements(f.component_definition) WITH ORDINALITY e(c, i)
                         WHERE c ->> 'type' = 'SERIAL' LIMIT 1)) parts),
       f.separator, f.serial_width,
       CASE WHEN f.serial_uniqueness_scope = '[]'::jsonb OR f.serial_uniqueness_scope ? 'VENDOR' THEN f.serial_uniqueness_scope
            ELSE f.serial_uniqueness_scope || '["VENDOR"]'::jsonb END
  FROM formats_without_vendor f;

-- ---------------------------------------------------------------- field sessions
ALTER TABLE tree_observations ADD COLUMN IF NOT EXISTS field_session_id uuid;
CREATE INDEX IF NOT EXISTS tree_observations_field_session_idx ON tree_observations (field_session_id) WHERE field_session_id IS NOT NULL;
-- The field-activity report reads observations by date (and officer).
CREATE INDEX IF NOT EXISTS tree_observations_observed_at_idx ON tree_observations (observed_at, recorded_by);
CREATE INDEX IF NOT EXISTS tree_media_observation_idx ON tree_media (observation_id);

-- ---------------------------------------------------------------- client links
-- AES-GCM ciphertext of the token (links created before this have none: they can be revoked, not copied again).
ALTER TABLE project_share_links ADD COLUMN IF NOT EXISTS token_encrypted text;
