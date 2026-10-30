-- Sessions that survive poor field networks, and an organisation-wide default height unit.
--
--  * Each refresh session records the session issued in its place. When a refresh succeeds on the server but the
--    response never reaches the phone, the phone presents the old token again; if the token issued in its place has
--    never been used, that is a retry (not theft) and the server issues a fresh pair instead of revoking the family.
--  * system_settings gains height_unit (cm, m, in or ft): the unit the portal and the phones show tree heights in.
--    Heights are always stored in centimetres.
--
-- Safe to run again.

ALTER TABLE refresh_sessions ADD COLUMN IF NOT EXISTS replaced_by uuid REFERENCES refresh_sessions(id);

INSERT INTO system_settings (key, value) VALUES ('height_unit', 'cm') ON CONFLICT (key) DO NOTHING;
