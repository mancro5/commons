-- Bugs and mushrooms (ADR 0019): what turns up where and when is worked
-- out from the clock, the weather, the season and the moon (commons_sim::
-- nature); these are the items. Bugs need a net (the curator sells them);
-- mushrooms are just picked. Both sell a little at the market cart, and the
-- museum takes one of each.
INSERT INTO items (id, key, kind, name, rarity, meta) VALUES
    (960, 'bug_net', 'tool', 'Bug Net', 1, '{"buy": 40}'),
    (1000, 'cabbage_white', 'bug', 'Cabbage White', 0, '{"sell": 1}'),
    (1001, 'red_admiral', 'bug', 'Red Admiral', 1, '{"sell": 3}'),
    (1002, 'peacock_butterfly', 'bug', 'Peacock Butterfly', 2, '{"sell": 5}'),
    (1003, 'swallowtail', 'bug', 'Swallowtail', 3, '{"sell": 8}'),
    (1004, 'blue_morpho', 'bug', 'Blue Morpho', 4, '{"sell": 30}'),
    (1005, 'brimstone', 'bug', 'Brimstone', 1, '{"sell": 3}'),
    (1006, 'ladybird', 'bug', 'Ladybird', 0, '{"sell": 1}'),
    (1007, 'honeybee', 'bug', 'Honeybee', 0, '{"sell": 1}'),
    (1008, 'bumblebee', 'bug', 'Bumblebee', 1, '{"sell": 3}'),
    (1009, 'garden_snail', 'bug', 'Garden Snail', 0, '{"sell": 1}'),
    (1010, 'banded_snail', 'bug', 'Banded Snail', 2, '{"sell": 5}'),
    (1011, 'grasshopper', 'bug', 'Grasshopper', 0, '{"sell": 1}'),
    (1012, 'field_cricket', 'bug', 'Field Cricket', 1, '{"sell": 3}'),
    (1013, 'bush_cricket', 'bug', 'Bush Cricket', 2, '{"sell": 5}'),
    (1014, 'firefly', 'bug', 'Firefly', 1, '{"sell": 3}'),
    (1015, 'common_darter', 'bug', 'Common Darter', 0, '{"sell": 1}'),
    (1016, 'emperor_dragonfly', 'bug', 'Emperor Dragonfly', 2, '{"sell": 5}'),
    (1017, 'azure_damselfly', 'bug', 'Azure Damselfly', 1, '{"sell": 3}'),
    (1018, 'pond_skater', 'bug', 'Pond Skater', 0, '{"sell": 1}'),
    (1019, 'diving_beetle', 'bug', 'Great Diving Beetle', 2, '{"sell": 5}'),
    (1020, 'stag_beetle', 'bug', 'Stag Beetle', 3, '{"sell": 8}'),
    (1021, 'rhino_beetle', 'bug', 'Rhinoceros Beetle', 4, '{"sell": 30}'),
    (1022, 'jewel_beetle', 'bug', 'Jewel Beetle', 3, '{"sell": 8}'),
    (1023, 'ground_beetle', 'bug', 'Ground Beetle', 0, '{"sell": 1}'),
    (1024, 'woodlouse', 'bug', 'Woodlouse', 0, '{"sell": 1}'),
    (1025, 'garden_spider', 'bug', 'Garden Spider', 1, '{"sell": 3}'),
    (1026, 'money_spider', 'bug', 'Money Spider', 2, '{"sell": 5}'),
    (1027, 'luna_moth', 'bug', 'Luna Moth', 4, '{"sell": 30}'),
    (1028, 'tiger_moth', 'bug', 'Garden Tiger Moth', 2, '{"sell": 5}'),
    (1029, 'winter_moth', 'bug', 'Winter Moth', 1, '{"sell": 3}'),
    (1030, 'snow_flea', 'bug', 'Snow Flea', 1, '{"sell": 3}'),
    (1031, 'praying_mantis', 'bug', 'Praying Mantis', 3, '{"sell": 8}'),
    (1032, 'golden_scarab', 'bug', 'Golden Scarab', 5, '{"sell": 60}'),
    (1050, 'field_mushroom', 'shroom', 'Field Mushroom', 0, '{"sell": 1}'),
    (1051, 'shaggy_ink_cap', 'shroom', 'Shaggy Ink Cap', 1, '{"sell": 2}'),
    (1052, 'giant_puffball', 'shroom', 'Giant Puffball', 2, '{"sell": 4}'),
    (1053, 'fly_agaric', 'shroom', 'Fly Agaric', 2, '{"sell": 4}'),
    (1054, 'chanterelle', 'shroom', 'Chanterelle', 2, '{"sell": 4}'),
    (1055, 'porcini', 'shroom', 'Porcini', 3, '{"sell": 7}'),
    (1056, 'oyster_mushroom', 'shroom', 'Oyster Mushroom', 1, '{"sell": 2}'),
    (1057, 'honey_fungus', 'shroom', 'Honey Fungus', 0, '{"sell": 1}'),
    (1058, 'turkey_tail', 'shroom', 'Turkey Tail', 0, '{"sell": 1}'),
    (1059, 'velvet_shank', 'shroom', 'Velvet Shank', 1, '{"sell": 2}'),
    (1060, 'morel', 'shroom', 'Morel', 3, '{"sell": 7}'),
    (1061, 'st_georges', 'shroom', 'St George''s Mushroom', 1, '{"sell": 2}'),
    (1062, 'parasol', 'shroom', 'Parasol', 1, '{"sell": 2}'),
    (1063, 'amethyst_deceiver', 'shroom', 'Amethyst Deceiver', 2, '{"sell": 4}'),
    (1064, 'fairy_ring', 'shroom', 'Fairy Ring Champignon', 2, '{"sell": 4}'),
    (1065, 'ghost_glowcap', 'shroom', 'Ghost Glowcap', 4, '{"sell": 25}'),
    (1066, 'giggle_cap', 'shroom', 'Giggle Cap', 2, '{"sell": 4}'),
    (1067, 'wobble_puff', 'shroom', 'Wobble Puff', 1, '{"sell": 2}'),
    (1068, 'lions_mane', 'shroom', 'Lion''s Mane', 4, '{"sell": 25}'),
    (1069, 'jelly_ear', 'shroom', 'Jelly Ear', 0, '{"sell": 1}'),
    (1070, 'starcap', 'shroom', 'Starcap', 5, '{"sell": 50}');

-- Each bug or mushroom, once per player: a spot's slot (ten minutes for a
-- bug, a weather spell for a mushroom) can be taken once by each of us,
-- so nobody takes one away from anyone else.
CREATE TABLE forage_claims (
    player_id  uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    spot       integer NOT NULL,
    slot       bigint NOT NULL,
    item_id    integer NOT NULL REFERENCES items(id),
    at         timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (player_id, spot, slot)
);
CREATE INDEX forage_claims_at ON forage_claims (at);
SELECT setval('items_id_seq', GREATEST((SELECT max(id) FROM items), 2000));
