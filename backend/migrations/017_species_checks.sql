-- Species check (#101, stage 1 of #62): after sync, a daily sample of registration photos is sent to Pl@ntNet,
-- and its suggestion is compared with the species the officer chose. Disagreements wait for an administrator.
CREATE TABLE IF NOT EXISTS species_checks (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  media_id            uuid NOT NULL UNIQUE REFERENCES tree_media(id) ON DELETE CASCADE,
  tree_id             uuid NOT NULL REFERENCES trees(id) ON DELETE CASCADE,
  project_id          uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  recorded_by         uuid REFERENCES users(id),
  -- The officer's species when the photo was checked.
  claimed_species_id  uuid NOT NULL REFERENCES tree_species(id),
  status              text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'DONE', 'FAILED')),
  failure_reason      text,
  -- AGREE: the officer's species is the top suggestion or likely; DISAGREE: confidently another species;
  -- UNSURE: anything in between (low confidence, same genus, species unknown to Pl@ntNet).
  verdict             text CHECK (verdict IN ('AGREE', 'DISAGREE', 'UNSURE')),
  claimed_score       numeric(5, 4),
  top_name            text,
  top_score           numeric(5, 4),
  -- The best suggestion that is one of TMS's species, for a one-click correction.
  suggested_species_id uuid REFERENCES tree_species(id),
  suggested_score     numeric(5, 4),
  results             jsonb,
  review_state        text CHECK (review_state IN ('OPEN', 'KEPT', 'CORRECTED')),
  reviewed_by         uuid REFERENCES users(id),
  reviewed_at         timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  checked_at          timestamptz
);
CREATE INDEX IF NOT EXISTS species_checks_project_idx ON species_checks (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS species_checks_open_idx ON species_checks (project_id) WHERE review_state = 'OPEN';
