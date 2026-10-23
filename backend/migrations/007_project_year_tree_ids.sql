-- Tree IDs are scoped to the project and planting year, not the vendor: every vendor on a project shares
-- one progressive serial sequence per planting year, and a project has one ID format (the planting year is
-- a part of the ID, so one format serves every year). Vendors per planting year stay, as attribution.
--
-- Earlier formats are kept as inactive history rows: trees keep their scheme version and components
-- snapshot, so every registered ID stays valid. Safe to run again (each step only acts when needed).

-- ---------------------------------------------------------------- retire vendor and year formats
-- Year-only formats are remembered so a project left without its own format can carry the latest one on.
CREATE TEMP TABLE retired_year_formats ON COMMIT DROP AS
SELECT * FROM tree_id_schemes WHERE active AND vendor_id IS NULL AND planting_year_id IS NOT NULL;

UPDATE tree_id_schemes SET active = false, updated_at = now()
 WHERE active AND (vendor_id IS NOT NULL OR planting_year_id IS NOT NULL);

-- ---------------------------------------------------------------- drop vendor parts from project formats
-- A project format that names the vendor gets a new version without it: the vendor code is left out of the
-- ID and tree numbers are no longer counted per vendor (per project + planting year when nothing else is left).
CREATE TEMP TABLE vendor_project_formats ON COMMIT DROP AS
SELECT * FROM tree_id_schemes
 WHERE active AND vendor_id IS NULL AND planting_year_id IS NULL
   AND (component_definition @> '[{"type": "VENDOR_CODE"}]' OR serial_uniqueness_scope ? 'VENDOR');

UPDATE tree_id_schemes SET active = false, updated_at = now() WHERE id IN (SELECT id FROM vendor_project_formats);

INSERT INTO tree_id_schemes (project_id, version, component_definition, separator, serial_width, serial_uniqueness_scope)
SELECT f.project_id,
       (SELECT max(version) + 1 FROM tree_id_schemes x WHERE x.project_id = f.project_id),
       (SELECT jsonb_agg(c ORDER BY i) FROM jsonb_array_elements(f.component_definition) WITH ORDINALITY e(c, i)
         WHERE c ->> 'type' <> 'VENDOR_CODE'),
       f.separator, f.serial_width,
       COALESCE((SELECT jsonb_agg(d ORDER BY i) FROM jsonb_array_elements(f.serial_uniqueness_scope) WITH ORDINALITY e(d, i)
                  WHERE d #>> '{}' <> 'VENDOR'),
                '["PROJECT", "PLANTING_YEAR"]'::jsonb)
  FROM vendor_project_formats f;

-- ---------------------------------------------------------------- every project has one current format
-- A project that only had year formats carries on with its latest one (vendor parts removed); a project
-- with none at all gets the standard PROJECT-YEAR-000001 format, numbered per project + planting year.
INSERT INTO tree_id_schemes (project_id, version, component_definition, separator, serial_width, serial_uniqueness_scope)
SELECT p.id,
       COALESCE((SELECT max(version) + 1 FROM tree_id_schemes x WHERE x.project_id = p.id), 1),
       COALESCE((SELECT jsonb_agg(c ORDER BY i) FROM jsonb_array_elements(y.component_definition) WITH ORDINALITY e(c, i)
                  WHERE c ->> 'type' <> 'VENDOR_CODE'),
                '[{"type": "PROJECT_CODE", "required": true}, {"type": "PLANTING_YEAR", "required": true}, {"type": "SERIAL", "required": true}]'::jsonb),
       COALESCE(y.separator, '-'),
       COALESCE(y.serial_width, 6),
       CASE WHEN y.serial_uniqueness_scope = '[]'::jsonb THEN '[]'::jsonb  -- deliberately global numbering stays global
            ELSE COALESCE((SELECT jsonb_agg(d ORDER BY i) FROM jsonb_array_elements(y.serial_uniqueness_scope) WITH ORDINALITY e(d, i)
                            WHERE d #>> '{}' <> 'VENDOR'),
                          '["PROJECT", "PLANTING_YEAR"]'::jsonb) END
  FROM projects p
  LEFT JOIN LATERAL (SELECT * FROM retired_year_formats r WHERE r.project_id = p.id ORDER BY r.version DESC LIMIT 1) y ON true
 WHERE NOT EXISTS (SELECT 1 FROM tree_id_schemes s WHERE s.project_id = p.id AND s.active);

-- New formats are project-wide only (the API refuses vendor or year formats; this keeps old rows from returning).
ALTER TABLE tree_id_schemes DROP CONSTRAINT IF EXISTS tree_id_schemes_project_wide;
ALTER TABLE tree_id_schemes ADD CONSTRAINT tree_id_schemes_project_wide
  CHECK (NOT active OR (vendor_id IS NULL AND planting_year_id IS NULL));
