-- Trading face to face (social `trade.rs`): the daily crate isn't yours to
-- keep any more. It can be traded, given, put on a stall or a shelf, and
-- sold to the market (for about what the coins in one come to).
UPDATE items SET meta = (meta - 'account_bound') || '{"sell": 40}'
WHERE id = 143;
