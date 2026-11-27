//! Bounce Buddies (`together::PET_BOUNCE`): two walkers' pets on a seesaw.
//! One's up in the air, gathering stars; the other's on the plank, braced.
//! As it lands they both press: on the beat, and the closer together, the
//! higher the other's thrown, and so on, turn about, quicker and quicker,
//! till three landings are missed. When every landing is is known from the
//! start (`land`): each client judges its own press against it, so nobody's
//! connection makes them late; here it's put together, and what comes of it
//! is the same for both. A bot playing as a player is played here.

use super::Instance;
use commons_protocol::{ServerMsg, error_code, pet_bounce as rules};
use rand::Rng;
use std::collections::HashSet;

#[derive(Debug, Clone)]
pub(super) struct Bounce {
    a: u32,
    b: u32,
    seed: u32,
    start: u32,
    /// The landing that's next to be settled; the two presses for it (and the next), as heard.
    n: u16,
    taps: [[Option<u8>; 2]; 2],
    height: f32,
    hearts: u8,
    combo: u16,
    top: u16,
    score: u32,
    stars: HashSet<(u16, u8)>,
    /// Their best together (before this one).
    best: u32,
    /// Over: since when (ms), and who'd like another.
    over: Option<u32>,
    again: [bool; 2],
    settling: bool,
}

/// How long the flight that ends in landing `n` lasts (ms).
pub(super) fn flight(n: u16) -> u32 {
    (rules::FLIGHT_MS.saturating_sub(n as u32 * rules::QUICKER_MS)).max(rules::FLIGHT_MIN_MS)
}

/// When landing `n` is (ms after the start).
pub(super) fn land(n: u16) -> u32 {
    (0..=n).map(flight).sum()
}

/// Whether star 0 of flight `n` is a heart.
pub(super) fn heart_flight(n: u16) -> bool {
    n % rules::HEART_EVERY == rules::HEART_EVERY - 1
}

impl Bounce {
    fn new(a: u32, b: u32, seed: u32, start: u32, best: u32) -> Bounce {
        Bounce {
            a,
            b,
            seed,
            start,
            n: 0,
            taps: [[None; 2]; 2],
            height: rules::HEIGHT0 as f32,
            hearts: rules::HEARTS,
            combo: 0,
            top: rules::HEIGHT0,
            score: 0,
            stars: HashSet::new(),
            best,
            over: None,
            again: [false; 2],
            settling: false,
        }
    }

    fn side(&self, id: u32) -> Option<usize> {
        if id == self.a {
            Some(0)
        } else if id == self.b {
            Some(1)
        } else {
            None
        }
    }

    fn other(&self, id: u32) -> Option<u32> {
        match self.side(id)? {
            0 => Some(self.b),
            _ => Some(self.a),
        }
    }

    fn times(&self) -> u32 {
        1 + (self.combo as u32 / rules::COMBO_STEP as u32).min(rules::TIMES_MAX as u32 - 1)
    }

    /// Landing `n`: the flyer's press (`OFF`: not on the plank) and the other's, put together.
    fn settle(&mut self, flyer: u8, braced: u8) {
        if flyer == 0 || flyer == rules::OFF {
            self.hearts = self.hearts.saturating_sub(1);
            self.combo = 0;
            self.height *= 0.6;
        } else {
            let f = [1.0, 0.96, 1.02, 1.05][flyer.min(3) as usize];
            let g = [0.8, 0.96, 1.015, 1.04][braced.min(3) as usize];
            let sync = if flyer == 3 && braced == 3 { 1.01 } else { 1.0 };
            self.height *= f * g * sync;
            if flyer >= 2 && braced >= 2 {
                self.combo += 1;
            } else if braced == 0 {
                self.combo = 0;
            }
            self.score += (flyer as u32 + braced as u32) * self.times();
        }
        self.height = self
            .height
            .clamp(rules::HEIGHT0 as f32, rules::HEIGHT_MAX as f32);
        self.top = self.top.max(self.height as u16);
        self.taps[0] = self.taps[1];
        self.taps[1] = [None; 2];
        self.n += 1;
    }
}

impl Instance {
    /// `a` asked `b` for a game and they said yes: both with a pet out, neither in one.
    pub(super) fn pet_bounce_start(&mut self, a: u32, b: u32, now: u32) {
        let pets = [a, b]
            .iter()
            .all(|id| self.avatars.get(id).is_some_and(|v| v.pet != 0 || v.bot));
        if !pets {
            return self.error(
                b,
                error_code::NOT_ALLOWED,
                "you both need your pets out on a walk",
            );
        }
        // (One that's over's done with; not one that's still on.)
        self.pet_bounces.retain(|g| {
            g.over.is_none() || g.settling || (g.side(a).is_none() && g.side(b).is_none())
        });
        if self
            .pet_bounces
            .iter()
            .any(|g| g.side(a).is_some() || g.side(b).is_some())
        {
            return self.error(
                b,
                error_code::NOT_ALLOWED,
                "finish the game you're in first",
            );
        }
        // Their best together first, to have something to beat.
        let players = (
            self.avatars.get(&a).map(|v| v.player_id.clone()),
            self.avatars.get(&b).map(|v| v.player_id.clone()),
        );
        let (Some(econ), (Some(pa), Some(pb))) = (self.economy.clone(), players) else {
            return self.pet_bounce_begin(a, b, 0, now);
        };
        self.spawn_call(
            async move { econ.pet_bounce_best(&pa, &pb).await },
            move |inst, r| {
                let best = r
                    .ok()
                    .and_then(|v| v["best"].as_u64())
                    .unwrap_or(0)
                    .min(u32::MAX as u64) as u32;
                if inst.avatars.contains_key(&a) && inst.avatars.contains_key(&b) {
                    let now = inst.clock.now_ms();
                    inst.pet_bounce_begin(a, b, best, now);
                }
            },
        );
    }

    fn pet_bounce_begin(&mut self, a: u32, b: u32, best: u32, now: u32) {
        let start = now + rules::LEAD_MS;
        let seed = rand::rng().random::<u32>();
        self.pet_bounces
            .retain(|g| g.side(a).is_none() && g.side(b).is_none());
        self.pet_bounces.push(Bounce::new(a, b, seed, start, best));
        let msg = ServerMsg::PetBounce {
            a,
            b,
            seed,
            start,
            best,
        };
        self.send_to(a, &msg);
        self.send_to(b, &msg);
    }

    /// `id`'s press for landing `n` (its quality, as its client judged it).
    pub(super) fn pet_bounce_tap(&mut self, id: u32, n: u16, q: u8, now: u32) {
        let Some(g) = self
            .pet_bounces
            .iter_mut()
            .find(|g| g.over.is_none() && g.side(id).is_some())
        else {
            return;
        };
        let side = g.side(id).unwrap_or(0);
        // This landing's or the next's, about when it is, once each.
        let ahead = n.wrapping_sub(g.n);
        let at = g.start + land(n);
        if ahead > 1 || (q > 3 && q != rules::OFF) || now + rules::EARLY_MS < at {
            return;
        }
        let slot = &mut g.taps[ahead as usize][side];
        if slot.is_some() {
            return;
        }
        *slot = Some(q);
        if let Some(to) = g.other(id) {
            self.send_to(to, &ServerMsg::PetBounceTap { id, n, q });
        }
    }

    /// Where `id`'s pet's steered itself to, up there: its partner sees it.
    pub(super) fn pet_bounce_at(&mut self, id: u32, x: u16, now: u32) {
        let Some(to) = self
            .pet_bounces
            .iter()
            .filter(|g| g.over.is_none())
            .find_map(|g| g.other(id))
        else {
            return;
        };
        if !self
            .avatars
            .get_mut(&id)
            .is_some_and(|a| a.play_rl.try_take(now as u64))
        {
            return;
        }
        self.send_to(to, &ServerMsg::PetBounceAt { id, x: x.min(1000) });
    }

    /// `id`'s pet caught star `k` on flight `n`: if it's the one flying, about now, it counts (once).
    pub(super) fn pet_bounce_star(&mut self, id: u32, n: u16, k: u8, now: u32) {
        let Some(g) = self
            .pet_bounces
            .iter_mut()
            .find(|g| g.over.is_none() && g.side(id).is_some())
        else {
            return;
        };
        let from = if n == 0 { 0 } else { land(n - 1) };
        let flying = g.side(id) == Some(n as usize % 2);
        let about = now + rules::SLACK_MS >= g.start + from
            && now <= g.start + land(n) + rules::SLACK_MS * 2;
        if !flying || !about || k >= rules::STARS || !g.stars.insert((n, k)) {
            return;
        }
        if k == 0 && heart_flight(n) {
            g.hearts = (g.hearts + 1).min(rules::HEARTS);
        } else {
            g.score += rules::STAR_PTS as u32 * g.times();
        }
        let hearts = g.hearts;
        let to = g.other(id).unwrap_or(id);
        self.send_to(to, &ServerMsg::PetBounceStar { id, n, k, hearts });
    }

    /// `id` would like another game (or, `on` not: is done).
    pub(super) fn pet_bounce_again(&mut self, id: u32, on: bool, now: u32) {
        let Some(i) = self.pet_bounces.iter().position(|g| g.side(id).is_some()) else {
            return;
        };
        let g = &mut self.pet_bounces[i];
        let side = g.side(id).unwrap_or(0);
        let to = g.other(id).unwrap_or(id);
        if g.over.is_none() {
            // Shut mid-game: that's the game, as it stands.
            if !on {
                self.send_to(to, &ServerMsg::PetBounceAgain { id, on });
                self.pet_bounce_over(i, now);
            }
            return;
        }
        g.again[side] = on;
        let (a, b, best, both) = (
            g.a,
            g.b,
            g.best.max(g.score),
            g.again[0] && g.again[1] && !g.settling,
        );
        if !on {
            self.pet_bounces.remove(i);
        }
        self.send_to(to, &ServerMsg::PetBounceAgain { id, on });
        if both && on {
            self.pet_bounce_begin(a, b, best, now);
        }
    }

    pub(super) fn pet_bounce_tick(&mut self, now: u32) {
        if self.pet_bounces.is_empty() {
            return;
        }
        // Over a while ago, and nobody's asked for another: done with.
        self.pet_bounces.retain(|g| {
            g.settling
                || g.over
                    .is_none_or(|t| now < t.saturating_add(rules::AGAIN_MS))
        });
        let mut i = 0;
        while i < self.pet_bounces.len() {
            self.pet_bounce_bots(i, now);
            let g = &mut self.pet_bounces[i];
            if g.over.is_some() {
                i += 1;
                continue;
            }
            let at = g.start + land(g.n);
            let t = g.taps[0];
            let due =
                now >= at && ((t[0].is_some() && t[1].is_some()) || now >= at + rules::LATE_MS);
            if !due {
                i += 1;
                continue;
            }
            let n = g.n;
            let fly = n as usize % 2;
            g.settle(t[fly].unwrap_or(0), t[1 - fly].unwrap_or(0));
            let msg = ServerMsg::PetBounceBeat {
                n,
                height: g.height as u16,
                hearts: g.hearts,
                combo: g.combo,
                score: g.score,
            };
            let (a, b, done) = (g.a, g.b, g.hearts == 0 || g.n >= rules::BOUNCES_MAX);
            self.send_to(a, &msg);
            self.send_to(b, &msg);
            if done {
                self.pet_bounce_over(i, now);
                // (Still in the list, over: on to the next.)
                i += 1;
            }
        }
    }

    /// Bots playing as players: their presses (good, not perfect), a star or two, and always up for another.
    fn pet_bounce_bots(&mut self, i: usize, now: u32) {
        let g = &self.pet_bounces[i];
        let ids = [g.a, g.b];
        for (side, &id) in ids.iter().enumerate() {
            if !self.avatars.get(&id).is_some_and(|v| v.bot) {
                continue;
            }
            let g = &self.pet_bounces[i];
            if let Some(t) = g.over {
                if !g.again[side] && !g.settling && now > t + 2_500 && now < t + 60_000 {
                    self.pet_bounce_again(id, true, now);
                    return;
                }
                continue;
            }
            let n = g.n;
            let at = g.start + land(n);
            if g.taps[0][side].is_some() || now < at {
                continue;
            }
            let mut rng = rand::rng();
            // (A little likelier to slip as it speeds up.)
            let slip = 0.03 + (n as f32 * 0.0015).min(0.12);
            let r: f32 = rng.random();
            let q = if r < slip {
                0
            } else if r < slip + 0.14 {
                1
            } else if r < slip + 0.5 {
                2
            } else {
                3
            };
            let flying = side == n as usize % 2;
            if flying {
                for k in 0..rules::STARS {
                    if rng.random::<f32>() < 0.4 {
                        self.pet_bounce_star(id, n, k, now);
                    }
                }
            }
            self.pet_bounce_tap(id, n, q, now);
        }
    }

    /// Someone left: their game's over as it stands.
    pub(super) fn pet_bounce_leave(&mut self, id: u32) {
        let now = self.clock.now_ms();
        if let Some(i) = self
            .pet_bounces
            .iter()
            .position(|g| g.side(id).is_some() && !g.settling)
        {
            if self.pet_bounces[i].over.is_some() {
                let to = self.pet_bounces[i].other(id).unwrap_or(id);
                self.pet_bounces.remove(i);
                self.send_to(to, &ServerMsg::PetBounceAgain { id, on: false });
            } else {
                let to = self.pet_bounces[i].other(id).unwrap_or(id);
                self.send_to(to, &ServerMsg::PetBounceAgain { id, on: false });
                self.pet_bounce_over(i, now);
            }
        }
    }

    fn pet_bounce_over(&mut self, i: usize, now: u32) {
        let g = &mut self.pet_bounces[i];
        g.over = Some(now);
        g.settling = true;
        let (a, b, seed, score, bounces, top, best) =
            (g.a, g.b, g.seed, g.score, g.n, g.top, g.best);
        let players = (
            self.avatars.get(&a).map(|v| v.player_id.clone()),
            self.avatars.get(&b).map(|v| v.player_id.clone()),
        );
        let finish = move |inst: &mut Instance, v: serde_json::Value| {
            let u = |k: &str| v[k].as_u64().unwrap_or(0);
            if let Some(g) = inst
                .pet_bounces
                .iter_mut()
                .find(|g| g.a == a && g.b == b && g.seed == seed)
            {
                g.settling = false;
            }
            let msg = ServerMsg::PetBounceOver {
                score,
                bounces,
                height: top,
                best: (u("best") as u32).max(best).max(score),
                record: score > best && score > 0,
                friendship: u("friendship").min(u16::MAX as u64) as u16,
                level: u("level").min(u8::MAX as u64) as u8,
                counted: v["counted"].as_bool().unwrap_or(false),
                xp: u("xp").min(u16::MAX as u64) as u16,
            };
            for id in [a, b] {
                if inst.avatars.contains_key(&id) {
                    inst.send_to(id, &msg);
                }
            }
        };
        let (Some(econ), (Some(pa), Some(pb))) = (self.economy.clone(), players) else {
            return finish(self, serde_json::Value::Null);
        };
        self.spawn_call(
            async move { econ.pet_bounce(&pa, &pb, score).await },
            move |inst, r| match r {
                Ok(v) => finish(inst, v),
                Err(e) => {
                    tracing::warn!(?e, "couldn't settle a game of Bounce Buddies");
                    finish(inst, serde_json::Value::Null)
                }
            },
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::instance::Cmd;
    use crate::instance::tests::*;
    use commons_protocol::{ClientMsg, together};

    fn game(c: &Client) -> Option<(u32, u32, u32)> {
        c.log.iter().rev().find_map(|m| match m {
            ServerMsg::PetBounce { a, b, start, .. } => Some((*a, *b, *start)),
            _ => None,
        })
    }

    fn begin(inst: &mut Instance) -> (Client, Client, u32) {
        let mut a = connect(inst, 1, "a", (8, 8));
        let mut b = connect(inst, 2, "b", (8, 8));
        place(inst, 1, (8, 8));
        place(inst, 2, (9, 8));
        for id in [1, 2] {
            inst.avatars.get_mut(&id).unwrap().pet = 5;
        }
        for (conn, msg) in [
            (
                1,
                ClientMsg::Offer {
                    to: 2,
                    kind: together::PET_BOUNCE,
                },
            ),
            (
                2,
                ClientMsg::Accept {
                    from: 1,
                    kind: together::PET_BOUNCE,
                },
            ),
        ] {
            inst.handle(Cmd::Msg { conn, msg });
        }
        inst.flush();
        a.pump();
        b.pump();
        let start = game(&a).expect("a game").2;
        assert_eq!(game(&b).map(|g| g.2), Some(start));
        (a, b, start)
    }

    #[test]
    fn both_pressing_on_the_beat_goes_higher_and_the_combo_grows() {
        let mut inst = chess_instance();
        let (_a, _b, start) = begin(&mut inst);
        let mut last = rules::HEIGHT0 as f32;
        for n in 0..8u16 {
            let at = start + land(n);
            inst.pet_bounce_tap(1, n, 3, at);
            inst.pet_bounce_tap(2, n, 3, at);
            inst.pet_bounce_tick(at + 20);
            let g = &inst.pet_bounces[0];
            assert_eq!((g.n, g.combo, g.hearts), (n + 1, n + 1, rules::HEARTS));
            assert!(g.height > last);
            last = g.height;
        }
        // It takes the both of them: one not pressing, and it's lower, the combo gone.
        let at = start + land(8);
        inst.pet_bounce_tap(1, 8, 3, at);
        inst.pet_bounce_tick(at + 20);
        assert_eq!(inst.pet_bounces[0].n, 8, "waits for the other a moment");
        inst.pet_bounce_tick(at + rules::LATE_MS);
        let g = &inst.pet_bounces[0];
        assert!(g.height < last && g.combo == 0 && g.hearts == rules::HEARTS);
    }

    #[test]
    fn three_missed_landings_end_it_and_both_saying_again_starts_another() {
        let mut inst = chess_instance();
        let (mut a, mut b, start) = begin(&mut inst);
        for n in 0..3u16 {
            let at = start + land(n);
            let flyer = 1 + (n as u32 % 2);
            inst.pet_bounce_tap(flyer, n, rules::OFF, at);
            inst.pet_bounce_tap(3 - flyer, n, 3, at);
            inst.pet_bounce_tick(at + 20);
        }
        inst.flush();
        a.pump();
        b.pump();
        let over = |c: &Client| {
            c.log
                .iter()
                .filter(|m| matches!(m, ServerMsg::PetBounceOver { .. }))
                .count()
        };
        assert_eq!((over(&a), over(&b)), (1, 1));
        let now = start + land(2) + 1000;
        inst.pet_bounce_again(1, true, now);
        inst.flush();
        b.pump();
        assert!(
            b.log
                .iter()
                .any(|m| matches!(m, ServerMsg::PetBounceAgain { id: 1, on: true }))
        );
        assert_eq!(game(&b).map(|g| g.2), Some(start), "not till both do");
        inst.pet_bounce_again(2, true, now + 50);
        inst.flush();
        a.pump();
        b.pump();
        assert!(game(&a).unwrap().2 > start);
        assert_eq!(game(&a), game(&b));
    }

    #[test]
    fn presses_out_of_turn_and_stars_not_flown_past_dont_count() {
        let mut inst = chess_instance();
        let (_a, _b, start) = begin(&mut inst);
        // Long before it lands; far ahead; twice.
        inst.pet_bounce_tap(1, 0, 3, start);
        inst.pet_bounce_tap(1, 5, 3, start + land(0));
        assert_eq!(inst.pet_bounces[0].taps, [[None; 2]; 2]);
        inst.pet_bounce_tap(1, 0, 1, start + land(0));
        inst.pet_bounce_tap(1, 0, 3, start + land(0));
        assert_eq!(inst.pet_bounces[0].taps[0][0], Some(1));
        // Flight 0 is the first one's: the other can't gather its stars.
        inst.pet_bounce_star(2, 0, 1, start + 500);
        assert_eq!(inst.pet_bounces[0].score, 0);
        inst.pet_bounce_star(1, 0, 1, start + 500);
        inst.pet_bounce_star(1, 0, 1, start + 600);
        assert_eq!(inst.pet_bounces[0].score, rules::STAR_PTS as u32);
    }

    #[test]
    fn someone_leaving_ends_it_for_the_other() {
        let mut inst = chess_instance();
        let (_a, mut b, _) = begin(&mut inst);
        inst.handle(Cmd::Leave { conn: 1 });
        inst.flush();
        b.pump();
        assert!(
            b.log
                .iter()
                .any(|m| matches!(m, ServerMsg::PetBounceOver { .. }))
        );
        assert!(
            b.log
                .iter()
                .any(|m| matches!(m, ServerMsg::PetBounceAgain { id: 1, on: false }))
        );
    }

    #[test]
    fn a_bot_plays_its_side() {
        let mut inst = chess_instance();
        let (_a, _b, start) = begin(&mut inst);
        inst.avatars.get_mut(&2).unwrap().bot = true;
        let mut pressed = 0;
        for n in 0..20u16 {
            let Some(g) = inst.pet_bounces.first() else {
                break;
            };
            if g.over.is_some() {
                break;
            }
            let at = start + land(n);
            inst.pet_bounce_tap(1, n, 3, at);
            inst.pet_bounce_tick(at + 30);
            pressed = inst.pet_bounces.first().map_or(pressed, |g| g.n);
        }
        assert!(pressed > 6, "{pressed}");
    }
}
