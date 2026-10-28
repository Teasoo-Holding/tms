-- Sectors and sub-sectors can be created before anyone has walked them: an administrator enters the name and short
-- code first and adds the corner points (or a reference point) later.
--
--  * The reference point becomes optional. The range checks from 001 stay (they pass for NULL).
--  * A reference point is whole or absent: latitude and longitude are both set or both NULL.
--
-- Safe to run again.

ALTER TABLE sectors ALTER COLUMN reference_latitude DROP NOT NULL;
ALTER TABLE sectors ALTER COLUMN reference_longitude DROP NOT NULL;
ALTER TABLE sub_sectors ALTER COLUMN reference_latitude DROP NOT NULL;
ALTER TABLE sub_sectors ALTER COLUMN reference_longitude DROP NOT NULL;

ALTER TABLE sectors DROP CONSTRAINT IF EXISTS sectors_reference_point_whole;
ALTER TABLE sectors ADD CONSTRAINT sectors_reference_point_whole
  CHECK ((reference_latitude IS NULL) = (reference_longitude IS NULL));
ALTER TABLE sub_sectors DROP CONSTRAINT IF EXISTS sub_sectors_reference_point_whole;
ALTER TABLE sub_sectors ADD CONSTRAINT sub_sectors_reference_point_whole
  CHECK ((reference_latitude IS NULL) = (reference_longitude IS NULL));
