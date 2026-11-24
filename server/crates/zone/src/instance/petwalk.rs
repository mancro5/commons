//! A pet's skills out on a walk (`pet_skill`, learnt in the pet's skill
//! tree): digging up a few coins now and then as you walk the town. (Its
//! catches at the water are fishing's; leading you places is the client's.)

use super::Instance;
use commons_protocol::{ServerMsg, pet_skill};
use rand::Rng;

/// How often a walk's checked (ms), and how much walking (ms, on the move
/// outdoors with the pet) until it digs something up.
const CHECK_MS: u32 = 1_000;
const DIG_EVERY_MS: u32 = 150_000;
/// Coins it digs up (at least, at most).
const DIG_COINS: std::ops::RangeInclusive<i32> = 3..=10;
const COIN: u32 = 1;

impl Instance {
    /// Walkers with a digger out: their walking counted, and a dig when it's time.
    pub(super) fn pet_walk_tick(&mut self, now: u32) {
        if now < self.pet_check_at {
            return;
        }
        self.pet_check_at = now + CHECK_MS;
        if self.zone.id != super::OUTDOORS {
            return;
        }
        let mut digs = vec![];
        for a in self.avatars.values_mut() {
            let moving = a.motion.as_ref().is_some_and(|m| !m.is_done(now));
            if a.pet == 0 || a.pet_skills & pet_skill::DIG == 0 || !moving {
                continue;
            }
            a.pet_walked += CHECK_MS;
            if a.pet_walked >= DIG_EVERY_MS {
                a.pet_walked = 0;
                digs.push(a.id);
            }
        }
        for id in digs {
            self.pet_dig(id);
        }
    }

    /// `id`'s pet digs up a few coins where they are: everyone nearby sees, they get them.
    fn pet_dig(&mut self, id: u32) {
        let Some(econ) = self.economy.clone() else {
            return;
        };
        let a = &self.avatars[&id];
        let (tile, cell, player) = (a.tile, a.cell, a.player_id.clone());
        let coins = rand::rng().random_range(DIG_COINS);
        self.broadcast(
            cell,
            &ServerMsg::PetDug {
                id,
                x: tile.0,
                y: tile.1,
                coins: coins as u16,
            },
            None,
        );
        let key = self.next_key("petdig");
        self.spawn_call(
            async move { econ.grant(&player, COIN, coins, "pet_dig", &key).await },
            move |inst, result| {
                if let Ok(applied) = result
                    && inst.avatars.contains_key(&id)
                {
                    inst.send_granted(id, &applied);
                }
            },
        );
    }
}
