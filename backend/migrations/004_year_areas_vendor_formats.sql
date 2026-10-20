-- Teasoo's operating model:
--  * The planting area is surveyed at the start of each year, so sectors (and their sub-sectors) belong
--    to a planting year. Each area is measured by its corner points; trees are located by area only.
--  * Several vendors plant across a year's whole area, and each may tag trees its own way, so tree ID
--    formats can be set per vendor and/or per planting year, falling back to the project's format.
--  * Executives are Teasoo management (all projects) and clients/sponsors (their assigned projects).

-- ---------------------------------------------------------------- areas per planting year
ALTER TABLE sectors ADD COLUMN planting_year_id uuid REFERENCES planting_years(id);

-- Existing sectors: tie each to the one planting year its trees use, or to the project's only year.
-- Sectors that cannot be placed stay NULL ("not tied to a year") and remain usable in every year.
UPDATE sectors s SET planting_year_id = y.planting_year_id
  FROM (SELECT sector_id, min(planting_year_id::text)::uuid AS planting_year_id
          FROM trees GROUP BY sector_id HAVING count(DISTINCT planting_year_id) = 1) y
 WHERE y.sector_id = s.id;
UPDATE sectors s SET planting_year_id = (SELECT id FROM planting_years py WHERE py.project_id = s.project_id)
 WHERE s.planting_year_id IS NULL
   AND (SELECT count(*) FROM planting_years py WHERE py.project_id = s.project_id) = 1
   AND NOT EXISTS (SELECT 1 FROM trees t WHERE t.sector_id = s.id);

-- The same sector code (e.g. S01) can be reused in a later year's survey.
ALTER TABLE sectors DROP CONSTRAINT sectors_project_id_short_code_key;
CREATE UNIQUE INDEX sectors_year_short_code_key
  ON sectors (project_id, COALESCE(planting_year_id, '00000000-0000-0000-0000-000000000000'::uuid), short_code);
CREATE INDEX sectors_planting_year_idx ON sectors (planting_year_id);

-- ---------------------------------------------------------------- vendors per planting year
CREATE TABLE planting_year_vendors (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       uuid NOT NULL REFERENCES projects(id),       -- denormalised for scoping and sync
  planting_year_id uuid NOT NULL REFERENCES planting_years(id),
  vendor_id        uuid NOT NULL REFERENCES vendors(id),
  active           boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (planting_year_id, vendor_id)
);
CREATE TRIGGER planting_year_vendors_change AFTER INSERT OR UPDATE ON planting_year_vendors
  FOR EACH ROW EXECUTE FUNCTION log_change('planting_year_vendor');

-- Vendors already on trees are linked to those years, so existing work keeps its vendor choices.
INSERT INTO planting_year_vendors (project_id, planting_year_id, vendor_id)
SELECT DISTINCT t.project_id, t.planting_year_id, t.vendor_id FROM trees t WHERE t.vendor_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------- ID formats per vendor / year
-- A format applies to the most specific match: vendor + year, then vendor, then year, then project.
ALTER TABLE tree_id_schemes
  ADD COLUMN vendor_id uuid REFERENCES vendors(id),
  ADD COLUMN planting_year_id uuid REFERENCES planting_years(id);
DROP INDEX tree_id_schemes_one_active;
CREATE UNIQUE INDEX tree_id_schemes_one_active ON tree_id_schemes (
  project_id,
  COALESCE(vendor_id, '00000000-0000-0000-0000-000000000000'::uuid),
  COALESCE(planting_year_id, '00000000-0000-0000-0000-000000000000'::uuid)
) WHERE active;

-- ---------------------------------------------------------------- executives
-- Teasoo management sees every project; clients and sponsors only the projects they are assigned to.
ALTER TABLE users ADD COLUMN all_projects boolean NOT NULL DEFAULT false;
