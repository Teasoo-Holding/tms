-- Maintenance planning: each project has a maintenance interval, in days. A tree's next maintenance is due that many
-- days after its latest maintenance visit (visit_type MAINTENANCE), else after its planting date, else after it was
-- registered (computed when read; see src/domain/maintenance.ts).
--
-- Safe to run again.

ALTER TABLE projects ADD COLUMN IF NOT EXISTS maintenance_interval_days int NOT NULL DEFAULT 90;
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_maintenance_interval_days_check;
ALTER TABLE projects ADD CONSTRAINT projects_maintenance_interval_days_check CHECK (maintenance_interval_days BETWEEN 7 AND 730);

-- Each tree's latest maintenance visit, found without scanning its other visits.
CREATE INDEX IF NOT EXISTS tree_observations_maintenance_idx ON tree_observations (tree_id, observed_at DESC) WHERE visit_type = 'MAINTENANCE';
