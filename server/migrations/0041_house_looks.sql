-- Doing a house up, polished (ADR 0011): more paints, fences, yard pieces
-- and a golden postbox, and four more things a resident can choose: the
-- front door's colour, the flowers in the window boxes (or roses climbing
-- the walls), lights (string lights along the eaves, or lanterns by the
-- door) and a garden path from the step to the gate. The Home Exterior shop
-- turns through them week by week.
INSERT INTO items (id, key, kind, name, rarity, meta) VALUES
    (860, 'lavender_paint', 'exterior', 'Lavender Paint', 0, '{"slot": "facade", "code": 5, "account_bound": true, "source": "npc"}'),
    (861, 'mint_paint', 'exterior', 'Mint Paint', 0, '{"slot": "facade", "code": 6, "account_bound": true, "source": "npc"}'),
    (862, 'cream_paint', 'exterior', 'Cream & Walnut Paint', 1, '{"slot": "facade", "code": 7, "account_bound": true, "source": "npc"}'),
    (863, 'brick_paint', 'exterior', 'Red Brick & Slate', 2, '{"slot": "facade", "code": 8, "account_bound": true, "source": "npc"}'),
    (864, 'red_door', 'exterior', 'Red Front Door', 0, '{"slot": "door", "code": 1, "account_bound": true, "source": "npc"}'),
    (865, 'green_door', 'exterior', 'Green Front Door', 0, '{"slot": "door", "code": 2, "account_bound": true, "source": "npc"}'),
    (866, 'sunny_door', 'exterior', 'Sunny Yellow Door', 0, '{"slot": "door", "code": 3, "account_bound": true, "source": "npc"}'),
    (867, 'oak_door', 'exterior', 'Oak Front Door', 1, '{"slot": "door", "code": 4, "account_bound": true, "source": "npc"}'),
    (868, 'navy_door', 'exterior', 'Navy Front Door', 1, '{"slot": "door", "code": 5, "account_bound": true, "source": "npc"}'),
    (869, 'tulip_boxes', 'exterior', 'Tulip Window Boxes', 0, '{"slot": "flowers", "code": 1, "account_bound": true, "source": "npc"}'),
    (870, 'lavender_boxes', 'exterior', 'Lavender Window Boxes', 0, '{"slot": "flowers", "code": 2, "account_bound": true, "source": "npc"}'),
    (871, 'sunflower_boxes', 'exterior', 'Marigold Window Boxes', 1, '{"slot": "flowers", "code": 3, "account_bound": true, "source": "npc"}'),
    (872, 'climbing_roses', 'exterior', 'Climbing Roses', 2, '{"slot": "flowers", "code": 4, "account_bound": true, "source": "npc"}'),
    (873, 'eave_lights', 'exterior', 'String Lights for the Eaves', 1, '{"slot": "lights", "code": 1, "account_bound": true, "source": "npc"}'),
    (874, 'fairy_lights', 'exterior', 'Fairy Lights', 1, '{"slot": "lights", "code": 2, "account_bound": true, "source": "npc"}'),
    (875, 'door_lanterns', 'exterior', 'Door Lanterns', 2, '{"slot": "lights", "code": 3, "account_bound": true, "source": "npc"}'),
    (876, 'stone_path', 'exterior', 'Stone Path', 0, '{"slot": "path", "code": 1, "account_bound": true, "source": "npc"}'),
    (877, 'brick_path', 'exterior', 'Brick Path', 1, '{"slot": "path", "code": 2, "account_bound": true, "source": "npc"}'),
    (878, 'lantern_path', 'exterior', 'Lantern-lit Path', 2, '{"slot": "path", "code": 3, "account_bound": true, "source": "npc"}'),
    (879, 'white_rail_fence', 'exterior', 'White Rail Fence', 0, '{"slot": "fence", "code": 3, "account_bound": true, "source": "npc"}'),
    (880, 'iron_fence', 'exterior', 'Wrought-iron Fence', 2, '{"slot": "fence", "code": 4, "account_bound": true, "source": "npc"}'),
    (881, 'flowering_hedge', 'exterior', 'Flowering Hedge', 1, '{"slot": "fence", "code": 5, "account_bound": true, "source": "npc"}'),
    (882, 'stone_wall', 'exterior', 'Dry-stone Wall', 1, '{"slot": "fence", "code": 6, "account_bound": true, "source": "npc"}'),
    (883, 'garden_bench', 'exterior', 'Garden Bench', 0, '{"slot": "yard", "code": 4, "account_bound": true, "source": "npc"}'),
    (884, 'sunflowers', 'exterior', 'Sunflowers', 0, '{"slot": "yard", "code": 5, "account_bound": true, "source": "npc"}'),
    (885, 'yard_lamp', 'exterior', 'Garden Lamp Post', 1, '{"slot": "yard", "code": 6, "account_bound": true, "source": "npc"}'),
    (886, 'garden_pond', 'exterior', 'Little Pond', 2, '{"slot": "yard", "code": 7, "account_bound": true, "source": "npc"}'),
    (887, 'golden_postbox', 'exterior', 'Golden Postbox', 3, '{"slot": "postbox", "code": 3, "account_bound": true, "source": "npc"}')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE home_exterior DROP CONSTRAINT IF EXISTS home_exterior_slot_check;
ALTER TABLE home_exterior ADD CONSTRAINT home_exterior_slot_check
    CHECK (slot IN ('facade', 'door', 'flowers', 'lights', 'fence', 'path', 'yard', 'postbox'));
