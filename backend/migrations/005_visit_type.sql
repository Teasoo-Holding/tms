-- Why a visit was made (the type of data collection). Defaults to an ordinary visit.
ALTER TABLE tree_observations
  ADD COLUMN visit_type text NOT NULL DEFAULT 'VISIT'
  CHECK (visit_type IN ('VISIT', 'FIRST_INSTANCE', 'PLANTING', 'MAINTENANCE'));
CREATE INDEX tree_observations_visit_type_idx ON tree_observations (visit_type);
