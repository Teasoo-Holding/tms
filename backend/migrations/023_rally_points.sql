-- Rally points (#128): named meeting points of a project (for example the camp or the access road), shown on the
-- field map so officers can find their way back without internet. Set on the web (Projects, or a KML upload).
ALTER TABLE projects ADD COLUMN IF NOT EXISTS rally_points jsonb NOT NULL DEFAULT '[]'::jsonb;
