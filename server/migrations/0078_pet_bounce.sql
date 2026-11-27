-- Bounce Buddies (`pets::bounce`): the best score two players' pets have had together.
ALTER TABLE pet_friends ADD COLUMN best_bounce integer NOT NULL DEFAULT 0;
