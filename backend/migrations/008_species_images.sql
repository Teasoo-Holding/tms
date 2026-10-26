-- Reference photos per tree species (what the species looks like), so field officers can pick the
-- species by picture. Global reference data like the species themselves: every signed-in user
-- receives them (log_change finds no project for these rows), and deletions travel as tombstones.

CREATE TABLE species_images (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  species_id uuid NOT NULL REFERENCES tree_species(id) ON DELETE CASCADE,
  object_key text NOT NULL,              -- full image, JPEG within 1600 × 1600 px
  thumb_key  text NOT NULL,              -- JPEG within 400 × 400 px
  width      int,                        -- of the stored full image
  height     int,
  byte_size  int,
  sort_order int NOT NULL DEFAULT 0,
  caption    text,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX species_images_species_idx ON species_images (species_id);

CREATE TRIGGER species_images_change AFTER INSERT OR UPDATE ON species_images FOR EACH ROW EXECUTE FUNCTION log_change('species_image');
CREATE TRIGGER species_images_delete AFTER DELETE ON species_images FOR EACH ROW EXECUTE FUNCTION log_change('species_image');
