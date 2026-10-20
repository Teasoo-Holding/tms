-- Administrator-defined extra fields (e.g. nursery batch number) and tree height for growth tracking.

-- ---------------------------------------------------------------- custom fields
-- Projects can add their own fields to tree registrations or observations without a code change.
-- Values live in a jsonb column on the record, keyed by the definition's immutable key.
CREATE TABLE custom_field_definitions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES projects(id),
  applies_to  text NOT NULL CHECK (applies_to IN ('TREE', 'OBSERVATION')),
  key         text NOT NULL CHECK (key ~ '^[a-z][a-z0-9_]{0,39}$'),
  label       text NOT NULL,
  field_type  text NOT NULL CHECK (field_type IN ('TEXT', 'NUMBER', 'DATE', 'SELECT', 'BOOLEAN')),
  options     jsonb NOT NULL DEFAULT '[]',          -- choices for SELECT fields
  required    boolean NOT NULL DEFAULT false,       -- enforced by the forms; sync accepts older devices' records
  -- Carry the last value forward while a field session lasts (a nursery batch rarely changes tree to tree).
  sticky      boolean NOT NULL DEFAULT false,
  help_text   text,
  sort_order  integer NOT NULL DEFAULT 0,
  active      boolean NOT NULL DEFAULT true,
  created_by  uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, applies_to, key)
);
CREATE TRIGGER custom_fields_change AFTER INSERT OR UPDATE ON custom_field_definitions
  FOR EACH ROW EXECUTE FUNCTION log_change('custom_field');

ALTER TABLE trees ADD COLUMN custom_fields jsonb NOT NULL DEFAULT '{}';
ALTER TABLE tree_observations ADD COLUMN custom_fields jsonb NOT NULL DEFAULT '{}';

-- ---------------------------------------------------------------- growth
-- Height recorded with an observation, typed in or measured on the photo against a reference
-- stick of known length. The measurement (marked points, stick length, photo) is kept for review.
ALTER TABLE tree_observations
  ADD COLUMN height_cm numeric(7, 1) CHECK (height_cm IS NULL OR (height_cm > 0 AND height_cm < 20000)),
  ADD COLUMN height_method text CHECK (height_method IS NULL OR height_method IN ('MANUAL', 'PHOTO_REFERENCE')),
  ADD COLUMN height_measurement jsonb,
  ADD CONSTRAINT tree_observations_height_method CHECK ((height_cm IS NULL) = (height_method IS NULL));

-- ---------------------------------------------------------------- audit
CREATE INDEX audit_logs_actor_idx ON audit_logs (actor_id, created_at DESC);
CREATE INDEX audit_logs_project_idx ON audit_logs (project_id, created_at DESC);
