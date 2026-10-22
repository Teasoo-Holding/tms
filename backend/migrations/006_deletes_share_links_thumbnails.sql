-- Deletable reference data (with tombstones so phones drop deleted rows), a "clear all data"
-- generation counter, read-only share links for clients, and photo thumbnails.

-- ---------------------------------------------------------------- deletions reach the phones
ALTER TABLE change_log ADD COLUMN deleted boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION log_change() RETURNS trigger AS $$
DECLARE
  rec jsonb := to_jsonb(CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END);
  pid uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(7381001);
  IF TG_ARGV[0] = 'project' THEN
    pid := (rec ->> 'id')::uuid;
  ELSIF rec ? 'project_id' THEN
    pid := (rec ->> 'project_id')::uuid;
  ELSIF rec ? 'tree_id' THEN
    SELECT project_id INTO pid FROM trees WHERE id = (rec ->> 'tree_id')::uuid;
  END IF;
  INSERT INTO change_log (entity_type, entity_id, project_id, deleted)
  VALUES (TG_ARGV[0], (rec ->> 'id')::uuid, pid, TG_OP = 'DELETE');
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER projects_delete AFTER DELETE ON projects FOR EACH ROW EXECUTE FUNCTION log_change('project');
CREATE TRIGGER planting_years_delete AFTER DELETE ON planting_years FOR EACH ROW EXECUTE FUNCTION log_change('planting_year');
CREATE TRIGGER schemes_delete AFTER DELETE ON tree_id_schemes FOR EACH ROW EXECUTE FUNCTION log_change('tree_id_scheme');
CREATE TRIGGER sectors_delete AFTER DELETE ON sectors FOR EACH ROW EXECUTE FUNCTION log_change('sector');
CREATE TRIGGER sub_sectors_delete AFTER DELETE ON sub_sectors FOR EACH ROW EXECUTE FUNCTION log_change('sub_sector');
CREATE TRIGGER species_delete AFTER DELETE ON tree_species FOR EACH ROW EXECUTE FUNCTION log_change('species');
CREATE TRIGGER statuses_delete AFTER DELETE ON tree_statuses FOR EACH ROW EXECUTE FUNCTION log_change('status');
CREATE TRIGGER vendors_delete AFTER DELETE ON vendors FOR EACH ROW EXECUTE FUNCTION log_change('vendor');
CREATE TRIGGER assignments_delete AFTER DELETE ON user_project_assignments FOR EACH ROW EXECUTE FUNCTION log_change('assignment');
CREATE TRIGGER allocations_delete AFTER DELETE ON serial_allocations FOR EACH ROW EXECUTE FUNCTION log_change('serial_allocation');
CREATE TRIGGER custom_fields_delete AFTER DELETE ON custom_field_definitions FOR EACH ROW EXECUTE FUNCTION log_change('custom_field');
CREATE TRIGGER planting_year_vendors_delete AFTER DELETE ON planting_year_vendors FOR EACH ROW EXECUTE FUNCTION log_change('planting_year_vendor');

-- ---------------------------------------------------------------- clear all data
-- Bumped when an administrator clears the data; phones seeing a new value back up and reset.
CREATE TABLE system_settings (
  key        text PRIMARY KEY,
  value      text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO system_settings (key, value) VALUES ('data_generation', '1');

-- ---------------------------------------------------------------- client share links
-- A secret link gives read-only access to one project's dashboard and exports, without an account.
CREATE TABLE project_share_links (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  token_hash   text NOT NULL UNIQUE,     -- sha256 of the token; the token itself is shown once
  label        text,
  created_by   uuid REFERENCES users(id),
  expires_at   timestamptz,
  revoked_at   timestamptz,
  last_used_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX project_share_links_project_idx ON project_share_links (project_id);

-- ---------------------------------------------------------------- photo thumbnails
-- A small (≈320 px, ≈20 KB) copy made on the server after upload, for lists and galleries.
ALTER TABLE tree_media ADD COLUMN thumb_key text;
