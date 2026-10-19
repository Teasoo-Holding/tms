-- Tree Management System — initial schema (Phase 1)
CREATE EXTENSION IF NOT EXISTS postgis;

-- ---------------------------------------------------------------- identity
CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL,
  full_name     text NOT NULL,
  role          text NOT NULL CHECK (role IN ('ADMIN', 'FIELD_OFFICER', 'EXECUTIVE')),
  password_hash text NOT NULL,
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_key ON users (lower(email));

CREATE TABLE devices (
  id           uuid PRIMARY KEY,                 -- generated on the device
  user_id      uuid NOT NULL REFERENCES users(id),
  name         text,
  app_version  text,
  last_seen_at timestamptz,
  last_sync_at timestamptz,
  revoked_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE refresh_sessions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id),
  device_id   uuid REFERENCES devices(id),
  family_id   uuid NOT NULL,
  token_hash  text NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  revoked_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX refresh_sessions_user_idx ON refresh_sessions (user_id);

-- ---------------------------------------------------------------- projects
CREATE TABLE projects (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                   text NOT NULL,
  short_code             text NOT NULL CHECK (short_code ~ '^[A-Z0-9]{1,16}$'),
  description            text,
  location               text,
  start_date             date,
  end_date               date,
  status                 text NOT NULL DEFAULT 'DRAFT'
                         CHECK (status IN ('DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETED', 'ARCHIVED')),
  -- Business scope in which a full physical tree ID must be unique. Chosen explicitly per project.
  physical_id_uniqueness text NOT NULL CHECK (physical_id_uniqueness IN ('GLOBAL', 'PROJECT')),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date)
);
CREATE UNIQUE INDEX projects_short_code_key ON projects (short_code);

CREATE TABLE planting_years (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES projects(id),
  year_label  text NOT NULL CHECK (year_label ~ '^[A-Za-z0-9]{1,16}$'),
  start_date  date,
  end_date    date,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, year_label),
  CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date)
);

CREATE TABLE tree_id_schemes (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id              uuid NOT NULL REFERENCES projects(id),
  version                 integer NOT NULL CHECK (version > 0),
  component_definition    jsonb NOT NULL,
  separator               text NOT NULL,
  serial_width            integer NOT NULL CHECK (serial_width BETWEEN 1 AND 12),
  serial_uniqueness_scope jsonb NOT NULL,
  active_from             timestamptz NOT NULL DEFAULT now(),
  active                  boolean NOT NULL DEFAULT true,
  created_by              uuid REFERENCES users(id),
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, version)
);
-- Only one scheme version is current for new registrations.
CREATE UNIQUE INDEX tree_id_schemes_one_active ON tree_id_schemes (project_id) WHERE active;

-- ---------------------------------------------------------------- geography
CREATE TABLE sectors (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id          uuid NOT NULL REFERENCES projects(id),
  name                text NOT NULL,
  short_code          text NOT NULL CHECK (short_code ~ '^[A-Z0-9]{1,16}$'),
  description         text,
  reference_latitude  numeric(9, 6) NOT NULL CHECK (reference_latitude BETWEEN -90 AND 90),
  reference_longitude numeric(9, 6) NOT NULL CHECK (reference_longitude BETWEEN -180 AND 180),
  boundary_geometry   geometry(Polygon, 4326) CHECK (boundary_geometry IS NULL OR ST_IsValid(boundary_geometry)),
  active              boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, short_code)
);
CREATE INDEX sectors_boundary_gix ON sectors USING gist (boundary_geometry);

CREATE TABLE sub_sectors (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sector_id           uuid NOT NULL REFERENCES sectors(id),
  project_id          uuid NOT NULL REFERENCES projects(id),   -- denormalised for scoping and sync
  name                text NOT NULL,
  short_code          text NOT NULL CHECK (short_code ~ '^[A-Z0-9]{1,16}$'),
  description         text,
  reference_latitude  numeric(9, 6) NOT NULL CHECK (reference_latitude BETWEEN -90 AND 90),
  reference_longitude numeric(9, 6) NOT NULL CHECK (reference_longitude BETWEEN -180 AND 180),
  boundary_geometry   geometry(Polygon, 4326) CHECK (boundary_geometry IS NULL OR ST_IsValid(boundary_geometry)),
  active              boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sector_id, short_code)
);
CREATE INDEX sub_sectors_boundary_gix ON sub_sectors USING gist (boundary_geometry);

-- ---------------------------------------------------------------- reference data
CREATE TABLE tree_species (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scientific_name text NOT NULL,
  common_name     text,
  code            text,
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX tree_species_name_key ON tree_species (lower(scientific_name));

CREATE TABLE tree_statuses (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code               text NOT NULL UNIQUE CHECK (code ~ '^[A-Z_]{1,32}$'),
  name               text NOT NULL,
  description        text,
  is_terminal        boolean NOT NULL DEFAULT false,   -- e.g. Dead, Missing
  allows_replacement boolean NOT NULL DEFAULT false,   -- a replacement may be planted for trees in this status
  requires_photo     boolean NOT NULL DEFAULT false,
  sort_order         integer NOT NULL DEFAULT 0,
  active             boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE vendors (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  short_code    text CHECK (short_code IS NULL OR short_code ~ '^[A-Z0-9]{1,16}$'),
  contact_name  text,
  contact_phone text,
  contact_email text,
  location      text,
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX vendors_short_code_key ON vendors (short_code) WHERE short_code IS NOT NULL;

-- ---------------------------------------------------------------- access scope
CREATE TABLE user_project_assignments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id),
  project_id    uuid NOT NULL REFERENCES projects(id),
  sector_id     uuid REFERENCES sectors(id),       -- optional narrower scope
  sub_sector_id uuid REFERENCES sub_sectors(id),   -- optional narrower scope
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX upa_user_idx ON user_project_assignments (user_id) WHERE active;

-- Optional pre-allocated serial ranges: the only way to guarantee collision-free offline issuance.
CREATE TABLE serial_allocations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES projects(id),
  scope_key   text NOT NULL,             -- same key format as trees.serial_scope_key
  user_id     uuid REFERENCES users(id), -- NULL = any officer within the scope
  range_start bigint NOT NULL CHECK (range_start > 0),
  range_end   bigint NOT NULL,
  notes       text,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (range_end >= range_start)
);
CREATE INDEX serial_allocations_scope_idx ON serial_allocations (scope_key) WHERE active;

-- ---------------------------------------------------------------- trees
CREATE TABLE trees (
  id                          uuid PRIMARY KEY,   -- generated on the device, immutable
  physical_tree_id            text NOT NULL,
  physical_tree_id_normalized text NOT NULL,
  physical_id_scope_key       text NOT NULL,
  serial_number               text NOT NULL,
  serial_scope_key            text NOT NULL,
  id_scheme_id                uuid NOT NULL REFERENCES tree_id_schemes(id),
  id_scheme_version           integer NOT NULL,
  id_components_snapshot      jsonb NOT NULL,
  project_id                  uuid NOT NULL REFERENCES projects(id),
  planting_year_id            uuid NOT NULL REFERENCES planting_years(id),
  sector_id                   uuid NOT NULL REFERENCES sectors(id),
  sub_sector_id               uuid NOT NULL REFERENCES sub_sectors(id),
  species_id                  uuid NOT NULL REFERENCES tree_species(id),
  current_status_id           uuid REFERENCES tree_statuses(id),
  last_observed_at            timestamptz,
  vendor_id                   uuid REFERENCES vendors(id),
  replaces_tree_id            uuid REFERENCES trees(id),
  planted_on                  date,
  notes                       text,
  created_by                  uuid NOT NULL REFERENCES users(id),
  updated_by                  uuid REFERENCES users(id),
  device_id                   uuid REFERENCES devices(id),
  client_recorded_at          timestamptz,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  synced_at                   timestamptz NOT NULL DEFAULT now(),
  revision                    integer NOT NULL DEFAULT 1,
  -- ACTIVE: in the registry. CONFLICT: preserved duplicate awaiting review. REJECTED: reviewed and set aside.
  record_state                text NOT NULL DEFAULT 'ACTIVE' CHECK (record_state IN ('ACTIVE', 'CONFLICT', 'REJECTED')),
  CHECK (replaces_tree_id IS NULL OR replaces_tree_id <> id)
);
-- Authoritative duplicate detection. Conflicting submissions are stored with record_state = 'CONFLICT'.
CREATE UNIQUE INDEX trees_physical_id_unique ON trees (physical_id_scope_key, physical_tree_id_normalized)
  WHERE record_state = 'ACTIVE';
CREATE UNIQUE INDEX trees_serial_unique ON trees (serial_scope_key, serial_number)
  WHERE record_state = 'ACTIVE';
-- A tree is directly replaced at most once; later generations link to the immediately preceding tree.
CREATE UNIQUE INDEX trees_single_replacement ON trees (replaces_tree_id)
  WHERE replaces_tree_id IS NOT NULL AND record_state = 'ACTIVE';
CREATE INDEX trees_project_idx ON trees (project_id, planting_year_id);
CREATE INDEX trees_sub_sector_idx ON trees (sub_sector_id);
CREATE INDEX trees_normalized_idx ON trees (physical_tree_id_normalized);

CREATE TABLE tree_physical_id_history (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tree_id              uuid NOT NULL REFERENCES trees(id),
  previous_physical_id text NOT NULL,
  previous_serial      text NOT NULL,
  new_physical_id      text NOT NULL,
  new_serial           text NOT NULL,
  reason               text NOT NULL,
  changed_by           uuid NOT NULL REFERENCES users(id),
  changed_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tree_observations (
  id                    uuid PRIMARY KEY,         -- generated on the device
  tree_id               uuid NOT NULL REFERENCES trees(id),
  observed_status_id    uuid NOT NULL REFERENCES tree_statuses(id),
  observed_at           timestamptz NOT NULL,
  recorded_at           timestamptz NOT NULL,
  synced_at             timestamptz NOT NULL DEFAULT now(),
  recorded_by           uuid NOT NULL REFERENCES users(id),
  device_id             uuid REFERENCES devices(id),
  remarks               text,
  revision              integer NOT NULL DEFAULT 1,
  is_initial            boolean NOT NULL DEFAULT false,
  is_amendment          boolean NOT NULL DEFAULT false,
  amends_observation_id uuid REFERENCES tree_observations(id),
  amendment_reason      text,
  CHECK (is_amendment = (amends_observation_id IS NOT NULL)),
  CHECK (amends_observation_id IS NULL OR amends_observation_id <> id)
);
CREATE INDEX tree_observations_tree_idx ON tree_observations (tree_id, observed_at DESC);
CREATE INDEX tree_observations_amends_idx ON tree_observations (amends_observation_id);

CREATE TABLE tree_media (
  id                     uuid PRIMARY KEY,        -- generated on the device
  tree_id                uuid NOT NULL REFERENCES trees(id),
  observation_id         uuid REFERENCES tree_observations(id),
  local_filename         text,
  object_key             text,
  checksum_sha256        text NOT NULL CHECK (checksum_sha256 ~ '^[0-9a-f]{64}$'),
  byte_size              bigint NOT NULL CHECK (byte_size > 0),
  mime_type              text NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp', 'image/heic')),
  upload_state           text NOT NULL DEFAULT 'PENDING' CHECK (upload_state IN ('PENDING', 'VERIFIED', 'FAILED')),
  failure_reason         text,
  remote_verified_at     timestamptz,
  association_verified_at timestamptz,
  uploaded_by            uuid REFERENCES users(id),
  device_id              uuid REFERENCES devices(id),
  captured_at            timestamptz NOT NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tree_media_tree_idx ON tree_media (tree_id);

-- ---------------------------------------------------------------- sync
CREATE TABLE sync_batches (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id       uuid NOT NULL REFERENCES devices(id),
  user_id         uuid NOT NULL REFERENCES users(id),
  received_at     timestamptz NOT NULL DEFAULT now(),
  operation_count integer NOT NULL,
  accepted        integer NOT NULL DEFAULT 0,
  already_processed integer NOT NULL DEFAULT 0,
  conflicts       integer NOT NULL DEFAULT 0,
  rejected        integer NOT NULL DEFAULT 0
);

-- Idempotency ledger: written in the same transaction as the entity change it records.
CREATE TABLE sync_operations (
  operation_id       uuid PRIMARY KEY,
  batch_id           uuid REFERENCES sync_batches(id),
  device_id          uuid NOT NULL REFERENCES devices(id),
  user_id            uuid NOT NULL REFERENCES users(id),
  entity_type        text NOT NULL,
  entity_id          uuid NOT NULL,
  operation_type     text NOT NULL,
  base_revision      integer,
  client_recorded_at timestamptz,
  payload            jsonb NOT NULL,
  result_status      text NOT NULL CHECK (result_status IN ('ACCEPTED', 'ALREADY_PROCESSED', 'CONFLICT', 'REJECTED')),
  result             jsonb NOT NULL,
  processed_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sync_operations_device_idx ON sync_operations (device_id, processed_at DESC);

CREATE TABLE conflict_records (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conflict_type      text NOT NULL CHECK (conflict_type IN ('DUPLICATE_PHYSICAL_ID', 'DUPLICATE_SERIAL', 'DUPLICATE_REPLACEMENT', 'REVISION_MISMATCH')),
  project_id         uuid NOT NULL REFERENCES projects(id),
  entity_type        text NOT NULL,
  entity_id          uuid NOT NULL,          -- the incoming record
  existing_entity_id uuid,                   -- the record it collided with
  operation_id       uuid,
  device_id          uuid,
  submitted_by       uuid REFERENCES users(id),
  details            jsonb NOT NULL,
  status             text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'RESOLVED')),
  resolution         text,
  resolution_notes   text,
  resolved_by        uuid REFERENCES users(id),
  resolved_at        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX conflict_records_open_idx ON conflict_records (project_id) WHERE status = 'OPEN';

CREATE TABLE audit_logs (
  id          bigserial PRIMARY KEY,
  actor_id    uuid REFERENCES users(id),
  action      text NOT NULL,
  entity_type text NOT NULL,
  entity_id   text,
  project_id  uuid,
  before      jsonb,
  after       jsonb,
  metadata    jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_entity_idx ON audit_logs (entity_type, entity_id);
CREATE INDEX audit_logs_created_idx ON audit_logs (created_at DESC);

-- ---------------------------------------------------------------- change feed
-- Every change to a syncable entity appends here; devices pull with a server-issued cursor (seq).
-- Writers hold a transaction-scoped advisory lock (key 7381001) while appending, so sequence values
-- become visible in commit order: the committed rows are always a gap-free prefix and a cursor never
-- skips a change that commits late. The application takes the lock at the start of each write
-- transaction (avoiding lock-order deadlocks); the trigger takes it too for any other writer.
CREATE TABLE change_log (
  seq         bigserial PRIMARY KEY,
  entity_type text NOT NULL,
  entity_id   uuid NOT NULL,
  project_id  uuid,                          -- NULL = global reference data
  changed_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX change_log_project_idx ON change_log (project_id, seq);

CREATE FUNCTION log_change() RETURNS trigger AS $$
DECLARE
  rec jsonb := to_jsonb(NEW);
  pid uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(7381001);
  IF TG_ARGV[0] = 'project' THEN
    pid := NEW.id;
  ELSIF rec ? 'project_id' THEN
    pid := (rec ->> 'project_id')::uuid;
  ELSIF rec ? 'tree_id' THEN
    SELECT project_id INTO pid FROM trees WHERE id = (rec ->> 'tree_id')::uuid;
  END IF;
  INSERT INTO change_log (entity_type, entity_id, project_id) VALUES (TG_ARGV[0], NEW.id, pid);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER projects_change AFTER INSERT OR UPDATE ON projects FOR EACH ROW EXECUTE FUNCTION log_change('project');
CREATE TRIGGER planting_years_change AFTER INSERT OR UPDATE ON planting_years FOR EACH ROW EXECUTE FUNCTION log_change('planting_year');
CREATE TRIGGER schemes_change AFTER INSERT OR UPDATE ON tree_id_schemes FOR EACH ROW EXECUTE FUNCTION log_change('tree_id_scheme');
CREATE TRIGGER sectors_change AFTER INSERT OR UPDATE ON sectors FOR EACH ROW EXECUTE FUNCTION log_change('sector');
CREATE TRIGGER sub_sectors_change AFTER INSERT OR UPDATE ON sub_sectors FOR EACH ROW EXECUTE FUNCTION log_change('sub_sector');
CREATE TRIGGER species_change AFTER INSERT OR UPDATE ON tree_species FOR EACH ROW EXECUTE FUNCTION log_change('species');
CREATE TRIGGER statuses_change AFTER INSERT OR UPDATE ON tree_statuses FOR EACH ROW EXECUTE FUNCTION log_change('status');
CREATE TRIGGER vendors_change AFTER INSERT OR UPDATE ON vendors FOR EACH ROW EXECUTE FUNCTION log_change('vendor');
CREATE TRIGGER assignments_change AFTER INSERT OR UPDATE ON user_project_assignments FOR EACH ROW EXECUTE FUNCTION log_change('assignment');
CREATE TRIGGER allocations_change AFTER INSERT OR UPDATE ON serial_allocations FOR EACH ROW EXECUTE FUNCTION log_change('serial_allocation');
CREATE TRIGGER trees_change AFTER INSERT OR UPDATE ON trees FOR EACH ROW EXECUTE FUNCTION log_change('tree');
CREATE TRIGGER observations_change AFTER INSERT OR UPDATE ON tree_observations FOR EACH ROW EXECUTE FUNCTION log_change('observation');
CREATE TRIGGER media_change AFTER INSERT OR UPDATE ON tree_media FOR EACH ROW EXECUTE FUNCTION log_change('media');
