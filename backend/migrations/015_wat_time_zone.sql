-- Reports count days in West Africa Time (Africa/Lagos). Making it the database's default time zone means every
-- ::date cast, date_trunc and date filter on a timestamptz follows WAT days. Stored instants do not change.
DO $$
BEGIN
  EXECUTE format('ALTER DATABASE %I SET timezone = %L', current_database(), 'Africa/Lagos');
END $$;
SET timezone = 'Africa/Lagos';
