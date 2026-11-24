-- Pet life: a pet gets hungry and wants to play. `food` and `joy` (0–100)
-- are as they stood at `needs_at`; both run down by the hour from then (the
-- API works out where they are now). Feeding, playing, walks and cuddles top
-- them up; a pet low on either is sad. `plays_day`/`plays_paid` count the
-- day's minigames that paid out coins (a few a day).
--
-- The Breeder (a new shop in the mall) makes a pet to order: `design` is the
-- pet's look as a code (species, breed, coat, pattern, eyes, accessory; see
-- `pets::design_ok`), NULL for a pet from the Pets shop (its item's code).
ALTER TABLE pets
    ADD COLUMN design     integer,
    ADD COLUMN food       real NOT NULL DEFAULT 80,
    ADD COLUMN joy        real NOT NULL DEFAULT 80,
    ADD COLUMN needs_at   timestamptz NOT NULL DEFAULT now(),
    ADD COLUMN plays      integer NOT NULL DEFAULT 0,
    ADD COLUMN plays_day  date,
    ADD COLUMN plays_paid integer NOT NULL DEFAULT 0,
    ADD COLUMN cuddled_at timestamptz;

INSERT INTO items (id, key, kind, name, rarity, meta) VALUES
    (608, 'bred_pet', 'pet', 'Breeder Pet', 3, '{"code": 257, "account_bound": true, "source": "npc", "bred": true}')
ON CONFLICT (id) DO NOTHING;
