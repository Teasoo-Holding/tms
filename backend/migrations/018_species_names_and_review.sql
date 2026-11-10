-- Species check content fixes (#107).
-- 1. Scientific names: "Genus Swietenia" means the genus Swietenia, so the word "Genus" is dropped (genus-only names
--    match any species of that genus). Species epithets are lower case ("Tectona Grandis" → "Tectona grandis").
--    Phones receive the renamed species through the usual change-log trigger.
UPDATE tree_species s SET scientific_name = regexp_replace(trim(s.scientific_name), '^genus\s+', '', 'i'), updated_at = now()
 WHERE trim(s.scientific_name) ~* '^genus\s+\S'
   AND NOT EXISTS (SELECT 1 FROM tree_species o WHERE o.id <> s.id AND lower(o.scientific_name) = lower(regexp_replace(trim(s.scientific_name), '^genus\s+', '', 'i')));

UPDATE tree_species s
   SET scientific_name = initcap(split_part(trim(s.scientific_name), ' ', 1)) || ' ' || lower(split_part(trim(s.scientific_name), ' ', 2)), updated_at = now()
 WHERE array_length(regexp_split_to_array(trim(s.scientific_name), '\s+'), 1) = 2
   AND split_part(trim(s.scientific_name), ' ', 2) ~ '^[A-Z]'
   AND split_part(trim(s.scientific_name), ' ', 2) !~ '^[A-Z]+\.?$';

-- 2. The review list now holds every tree below 75% (amber and red). The server re-scores existing checks from their
--    stored results when it starts (SpeciesCheckService.rescore), which also applies the renamed species.
