-- A pet's skill tree (`pets::SKILLS`): the skills it's learnt, a bit each
-- (`commons_protocol::pet_skill`). It earns a skill point at levels 1, 8,
-- 18, 30, 50 and 75 (`pets::SKILL_LEVELS`); each skill takes one, some only
-- once the one before them in the tree is learnt.
ALTER TABLE pets ADD COLUMN skills integer NOT NULL DEFAULT 0;
