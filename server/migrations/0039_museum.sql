-- The Museum & Gallery (ADR 0018): paintings people make in the Studio, in
-- three sizes, hung in turn on the Salon's walls; hearts; a theme each week
-- and its Hall of Fame; and the town's natural history, from donations.

-- Your canvases in progress: one per size.
CREATE TABLE art_drafts (
    player_id  uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    size       smallint NOT NULL CHECK (size IN (16, 32, 64)),
    cells      bytea NOT NULL CHECK (length(cells) = size * size),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (player_id, size)
);

-- Paintings entered in the Salon. One current entry per player and size
-- (a new one retires the last); after a few weeks they retire on their own.
CREATE TABLE artworks (
    id           bigserial PRIMARY KEY,
    player_id    uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    artist       text NOT NULL,
    size         smallint NOT NULL CHECK (size IN (16, 32, 64)),
    title        text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 40),
    cells        bytea NOT NULL CHECK (length(cells) = size * size),
    -- The week it was entered (ISO, `2026-W43`) and that week's theme.
    week         text NOT NULL,
    theme        text NOT NULL,
    submitted_at timestamptz NOT NULL DEFAULT now(),
    retired_at   timestamptz,
    -- Taken down when reported, until someone checks it.
    hidden       boolean NOT NULL DEFAULT false,
    hearts       integer NOT NULL DEFAULT 0,
    -- 1, 2 or 3: in the Hall of Fame for its week and size.
    fame_rank    smallint CHECK (fame_rank BETWEEN 1 AND 3)
);
CREATE INDEX artworks_salon ON artworks (size, id) WHERE retired_at IS NULL AND NOT hidden;
CREATE INDEX artworks_week ON artworks (week, size);
CREATE UNIQUE INDEX artworks_one_entry ON artworks (player_id, size) WHERE retired_at IS NULL;

CREATE TABLE artwork_hearts (
    artwork_id bigint NOT NULL REFERENCES artworks(id) ON DELETE CASCADE,
    player_id  uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    at         timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (artwork_id, player_id)
);

CREATE TABLE artwork_reports (
    artwork_id bigint NOT NULL REFERENCES artworks(id) ON DELETE CASCADE,
    player_id  uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    at         timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (artwork_id, player_id)
);

-- Weeks whose Hall of Fame has been chosen.
CREATE TABLE museum_weeks (
    week       text PRIMARY KEY,
    settled_at timestamptz NOT NULL DEFAULT now()
);

-- Natural history: what each player has given the museum, one of each kind.
-- The first giver of a kind is on its plaque.
CREATE TABLE museum_donations (
    item_id   integer NOT NULL REFERENCES items(id),
    player_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    name      text NOT NULL,
    at        timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (item_id, player_id)
);
CREATE INDEX museum_donations_first ON museum_donations (item_id, at);
