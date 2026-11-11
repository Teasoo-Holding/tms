-- Sector 4 of the 2026 planting year (project T4L): its sub-sectors from the 2026 KML were not registered properly
-- (#112). SS1-SS5 are (re)created without GPS; an administrator can add corners later. Trees already in SS1-SS5 keep
-- their sub-sector. Trees in any other Sector 4 sub-sector (for example SB5) are shared across SS1-SS5 in blocks by
-- tree number, so trees planted together stay together. Emptied sub-sectors are removed, or switched off when an
-- officer assignment still refers to them. Phones receive every change through the change-log triggers.
-- Does nothing when the project, its 2026 year or Sector 4 does not exist. Safe to run again.
DO $$
DECLARE
  v_project uuid;
  v_year uuid;
  v_sector uuid;
  v_moved int := 0;
  v_removed int := 0;
  v_off int := 0;
  i int;
BEGIN
  SELECT id INTO v_project FROM projects WHERE short_code = 'T4L';
  SELECT id INTO v_year FROM planting_years WHERE project_id = v_project AND year_label = '2026';
  SELECT id INTO v_sector FROM sectors WHERE project_id = v_project AND planting_year_id = v_year AND short_code = 'S4';
  IF v_sector IS NULL THEN
    RAISE NOTICE 'Sector 4 of T4L 2026 not found; nothing to do';
    RETURN;
  END IF;

  FOR i IN 1..5 LOOP
    UPDATE sub_sectors
       SET name = 'Sub-sector ' || i, boundary_geometry = NULL, reference_latitude = NULL, reference_longitude = NULL, active = true,
           description = 'Created without GPS: the 2026 KML outline was not usable. Add corners when surveyed.', updated_at = now()
     WHERE sector_id = v_sector AND short_code = 'SS' || i
       AND (boundary_geometry IS NOT NULL OR reference_latitude IS NOT NULL OR NOT active OR name <> 'Sub-sector ' || i);
    IF NOT EXISTS (SELECT 1 FROM sub_sectors WHERE sector_id = v_sector AND short_code = 'SS' || i) THEN
      INSERT INTO sub_sectors (sector_id, project_id, name, short_code, description)
      VALUES (v_sector, v_project, 'Sub-sector ' || i, 'SS' || i, 'Created without GPS: the 2026 KML outline was not usable. Add corners when surveyed.');
    END IF;
  END LOOP;

  -- Misplaced trees: in Sector 4 but not in SS1-SS5. Five blocks by tree number.
  WITH targets AS (
    SELECT id, row_number() OVER (ORDER BY short_code) AS n FROM sub_sectors WHERE sector_id = v_sector AND short_code IN ('SS1', 'SS2', 'SS3', 'SS4', 'SS5')
  ), misplaced AS (
    SELECT t.id, ntile(5) OVER (ORDER BY length(t.serial_number), t.serial_number, t.physical_tree_id) AS block
      FROM trees t JOIN sub_sectors ss ON ss.id = t.sub_sector_id
     WHERE t.sector_id = v_sector AND ss.short_code NOT IN ('SS1', 'SS2', 'SS3', 'SS4', 'SS5')
  ), moved AS (
    UPDATE trees t SET sub_sector_id = g.id, revision = t.revision + 1, updated_at = now()
      FROM misplaced m JOIN targets g ON g.n = m.block
     WHERE t.id = m.id
    RETURNING t.id
  )
  SELECT count(*) INTO v_moved FROM moved;

  -- Other Sector 4 sub-sectors, now empty.
  WITH gone AS (
    DELETE FROM sub_sectors ss
     WHERE ss.sector_id = v_sector AND ss.short_code NOT IN ('SS1', 'SS2', 'SS3', 'SS4', 'SS5')
       AND NOT EXISTS (SELECT 1 FROM trees t WHERE t.sub_sector_id = ss.id)
       AND NOT EXISTS (SELECT 1 FROM user_project_assignments a WHERE a.sub_sector_id = ss.id)
    RETURNING ss.id
  )
  SELECT count(*) INTO v_removed FROM gone;
  WITH off AS (
    UPDATE sub_sectors ss SET active = false, updated_at = now()
     WHERE ss.sector_id = v_sector AND ss.short_code NOT IN ('SS1', 'SS2', 'SS3', 'SS4', 'SS5') AND ss.active
       AND NOT EXISTS (SELECT 1 FROM trees t WHERE t.sub_sector_id = ss.id)
    RETURNING ss.id
  )
  SELECT count(*) INTO v_off FROM off;

  IF v_moved + v_removed + v_off > 0 THEN
    INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, project_id, metadata)
    VALUES (NULL, 'migration.sector4_sub_sectors', 'sector', v_sector::text, v_project,
            jsonb_build_object('trees_moved', v_moved, 'sub_sectors_removed', v_removed, 'sub_sectors_switched_off', v_off, 'issue', 112));
  END IF;
  RAISE NOTICE 'Sector 4: % trees moved, % sub-sectors removed, % switched off', v_moved, v_removed, v_off;
END $$;
