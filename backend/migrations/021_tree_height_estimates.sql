-- Tree height estimated from a photo against the year's reference stick (#109): 3 ft (91.44 cm) in 2025 and 1 m
-- in 2026. Each estimate is its own reviewable record; field measurements (tree_observations.height_cm) are never
-- overwritten. AI suggests the four points; an administrator checks or moves them and confirms the height.
CREATE TABLE IF NOT EXISTS tree_height_estimates (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tree_id             uuid NOT NULL REFERENCES trees(id) ON DELETE CASCADE,
  media_id            uuid NOT NULL REFERENCES tree_media(id) ON DELETE CASCADE,
  project_id          uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  status              text NOT NULL CHECK (status IN ('SUGGESTED', 'UNSUITABLE', 'CONFIRMED', 'DISCARDED')),
  reference_length_cm numeric(6, 2) NOT NULL,
  reference_label     text NOT NULL,
  image_width         int,
  image_height        int,
  -- Points as fractions of the image width (x, from the left) and height (y, from the top).
  suggested_points    jsonb,
  points              jsonb,
  stick_pixels        numeric(8, 1),
  tree_pixels         numeric(8, 1),
  suggested_height_cm numeric(7, 1),
  confirmed_height_cm numeric(7, 1),
  confidence          text CHECK (confidence IN ('low', 'medium', 'high')),
  unsuitable_reason   text,
  ai_notes            text,
  method_note         text,
  model               text,
  requested_by        uuid REFERENCES users(id),
  reviewed_by         uuid REFERENCES users(id),
  reviewed_at         timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tree_height_estimates_tree_idx ON tree_height_estimates (tree_id, created_at DESC);
