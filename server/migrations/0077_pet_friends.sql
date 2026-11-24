-- Pets that have played together (Treat Catch, `pets::duo`): how fond of
-- each other they've grown (`points`), and the games they've had today
-- (only the day's first few grow it: `pets::DUO_COUNTED`). One row a pair
-- of owners, the lesser id first.
CREATE TABLE pet_friends (
    a          uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    b          uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    points     integer NOT NULL DEFAULT 0,
    day        date NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::date,
    games      integer NOT NULL DEFAULT 0,
    PRIMARY KEY (a, b),
    CHECK (a < b)
);
