-- Pets level up (1 to 100) from everything done together: walks, meals,
-- games, cuddles, brushing, baths, tricks and playdates (`xp`, see
-- `pets::level_of`). Tricks are learnt as a pet grows. `trick_at` and
-- `playdate_at` keep each from being done over and over in a row.
ALTER TABLE pets
    ADD COLUMN xp          integer NOT NULL DEFAULT 0,
    ADD COLUMN trick_at    timestamptz,
    ADD COLUMN playdate_at timestamptz;
