//! Pets out together: where a pet's off to on its own (fishing, leading
//! the way), passed on to everyone about; and Treat Catch, a game for two
//! walkers and their pets (`together::PET_DUO`): treats fall on the lawn
//! (from a seed, the same on both screens), each steers their own pet to
//! catch them, the score's theirs together, and their pets grow fonder of
//! each other (the API's `pets::duo`).

use super::Instance;
use commons_protocol::{ServerMsg, error_code, pet_duo, pet_goal};
use rand::Rng;
use std::collections::HashSet;

#[derive(Debug, Clone)]
pub(super) struct Duo {
    a: u32,
    b: u32,
    start: u32,
    caught: HashSet<u16>,
    score: u16,
    /// Asked the API how it went (and waiting to hear).
    settling: bool,
}

impl Duo {
    fn other(&self, id: u32) -> Option<u32> {
        if id == self.a {
            Some(self.b)
        } else if id == self.b {
            Some(self.a)
        } else {
            None
        }
    }
}

/// When treat `i` lands (ms after the game's start).
pub(super) fn lands(i: u16) -> u32 {
    pet_duo::LEAD_MS + i as u32 * pet_duo::GAP_MS
}

/// What treat `i`'s worth (a heart: more).
pub(super) fn worth(i: u16) -> u16 {
    if i % pet_duo::HEART_EVERY == pet_duo::HEART_EVERY - 1 {
        pet_duo::HEART_PTS
    } else {
        1
    }
}

impl Instance {
    /// `id`'s pet is off somewhere on its own (or back at heel): everyone nearby's told.
    pub(super) fn pet_goal(&mut self, id: u32, x: u16, y: u16, kind: u8, now: u32) {
        let Some(a) = self.avatars.get_mut(&id) else {
            return;
        };
        if a.pet == 0 || kind > pet_goal::MAX || !a.play_rl.try_take(now as u64) {
            return;
        }
        let cell = a.cell;
        self.broadcast(cell, &ServerMsg::PetGoal { id, x, y, kind }, Some(id));
    }

    /// `a` asked `b` for a game of Treat Catch and they said yes: both with a pet out, neither in a game.
    pub(super) fn pet_duo_start(&mut self, a: u32, b: u32, now: u32) {
        let pets = [a, b]
            .iter()
            .all(|id| self.avatars.get(id).is_some_and(|v| v.pet != 0));
        if !pets {
            return self.error(
                b,
                error_code::NOT_ALLOWED,
                "you both need your pets out on a walk",
            );
        }
        if self
            .pet_duos
            .iter()
            .any(|d| d.other(a).is_some() || d.other(b).is_some())
        {
            return self.error(
                b,
                error_code::NOT_ALLOWED,
                "finish the game you're in first",
            );
        }
        let start = now + 3_500;
        let seed = rand::rng().random::<u32>();
        self.pet_duos.push(Duo {
            a,
            b,
            start,
            caught: HashSet::new(),
            score: 0,
            settling: false,
        });
        let msg = ServerMsg::PetDuo {
            a,
            b,
            seed,
            start,
            ms: pet_duo::MS,
        };
        self.send_to(a, &msg);
        self.send_to(b, &msg);
    }

    /// `id`'s pet moved across the lawn: their partner sees it.
    pub(super) fn pet_duo_move(&mut self, id: u32, x: u16, now: u32) {
        let Some(other) = self.pet_duos.iter().find_map(|d| d.other(id)) else {
            return;
        };
        if !self
            .avatars
            .get_mut(&id)
            .is_some_and(|a| a.play_rl.try_take(now as u64))
        {
            return;
        }
        self.send_to(other, &ServerMsg::PetDuoMove { id, x: x.min(1000) });
    }

    /// `id`'s pet caught treat `treat`: if it's one still falling, about now, it counts (once).
    pub(super) fn pet_duo_catch(&mut self, id: u32, treat: u16, now: u32) {
        let Some(d) = self.pet_duos.iter_mut().find(|d| d.other(id).is_some()) else {
            return;
        };
        let at = d.start + lands(treat);
        let close = now + pet_duo::WINDOW_MS >= at && now <= at + pet_duo::WINDOW_MS;
        if treat >= pet_duo::TREATS || !close || !d.caught.insert(treat) {
            return;
        }
        d.score = d.score.saturating_add(worth(treat));
        let other = d.other(id).unwrap_or(id);
        self.send_to(other, &ServerMsg::PetDuoCatch { id, treat });
    }

    /// Games over (their time's up): the API's told how it went, and both hear.
    pub(super) fn pet_duo_tick(&mut self, now: u32) {
        let done: Vec<usize> = self
            .pet_duos
            .iter()
            .enumerate()
            .filter(|(_, d)| !d.settling && now > d.start + pet_duo::MS + pet_duo::WINDOW_MS)
            .map(|(i, _)| i)
            .collect();
        for i in done {
            self.pet_duo_settle(i);
        }
    }

    /// Someone left: their game's over as it stands.
    pub(super) fn pet_duo_leave(&mut self, id: u32) {
        if let Some(i) = self
            .pet_duos
            .iter()
            .position(|d| d.other(id).is_some() && !d.settling)
        {
            self.pet_duo_settle(i);
        }
    }

    fn pet_duo_settle(&mut self, i: usize) {
        let d = &mut self.pet_duos[i];
        d.settling = true;
        let (a, b, score) = (d.a, d.b, d.score);
        let players = (
            self.avatars.get(&a).map(|v| v.player_id.clone()),
            self.avatars.get(&b).map(|v| v.player_id.clone()),
        );
        let finish =
            move |inst: &mut Instance, friendship: u16, level: u8, counted: bool, xp: u16| {
                inst.pet_duos.retain(|d| !(d.a == a && d.b == b));
                let msg = ServerMsg::PetDuoOver {
                    score,
                    friendship,
                    level,
                    counted,
                    xp,
                };
                for id in [a, b] {
                    if inst.avatars.contains_key(&id) {
                        inst.send_to(id, &msg);
                    }
                }
            };
        let (Some(econ), (Some(pa), Some(pb))) = (self.economy.clone(), players) else {
            return finish(self, 0, 0, false, 0);
        };
        self.spawn_call(
            async move { econ.pet_duo(&pa, &pb, score).await },
            move |inst, r| match r {
                Ok(v) => finish(
                    inst,
                    v["friendship"].as_u64().unwrap_or(0) as u16,
                    v["level"].as_u64().unwrap_or(0) as u8,
                    v["counted"].as_bool().unwrap_or(false),
                    v["xp"].as_u64().unwrap_or(0) as u16,
                ),
                Err(e) => {
                    tracing::warn!(?e, "couldn't settle a game of Treat Catch");
                    finish(inst, 0, 0, false, 0)
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

    fn duo(c: &Client) -> Option<(u32, u32, u32)> {
        c.log.iter().rev().find_map(|m| match m {
            ServerMsg::PetDuo { a, b, start, .. } => Some((*a, *b, *start)),
            _ => None,
        })
    }

    #[test]
    fn two_walkers_with_their_pets_play_treat_catch_and_only_real_catches_count() {
        let mut inst = chess_instance();
        let mut a = connect(&mut inst, 1, "a", (8, 8));
        let mut b = connect(&mut inst, 2, "b", (8, 8));
        place(&mut inst, 1, (8, 8));
        place(&mut inst, 2, (9, 8));
        let ask = |inst: &mut Instance| {
            inst.handle(Cmd::Msg {
                conn: 1,
                msg: ClientMsg::Offer {
                    to: 2,
                    kind: together::PET_DUO,
                },
            });
            inst.handle(Cmd::Msg {
                conn: 2,
                msg: ClientMsg::Accept {
                    from: 1,
                    kind: together::PET_DUO,
                },
            });
            inst.flush();
        };
        // No pets out: no game.
        ask(&mut inst);
        b.pump();
        assert!(duo(&b).is_none());
        for id in [1, 2] {
            inst.avatars.get_mut(&id).unwrap().pet = 5;
        }
        // Pets out: a game, for both of them.
        ask(&mut inst);
        a.pump();
        b.pump();
        let (x, y, start) = duo(&a).expect("a game");
        assert_eq!((x, y), (1, 2));
        assert_eq!(duo(&b).map(|d| d.2), Some(start));
        // A catch when the treat lands counts (once); one long before it does doesn't.
        let catch = |inst: &mut Instance, who: u64, treat: u16, at: u32| {
            inst.pet_duo_catch(who as u32, treat, at);
            let _ = inst;
        };
        catch(&mut inst, 1, 0, start + lands(0));
        catch(&mut inst, 2, 0, start + lands(0));
        catch(&mut inst, 2, 3, start + lands(3) + 100);
        catch(&mut inst, 1, 20, start + lands(0));
        assert_eq!(inst.pet_duos[0].score, 1 + pet_duo::HEART_PTS);
        // Time's up: it's over (no API in tests: as it stands), and both hear.
        inst.pet_duo_tick(start + pet_duo::MS + pet_duo::WINDOW_MS + 1);
        inst.flush();
        a.pump();
        b.pump();
        let over = |c: &Client| {
            c.log.iter().any(|m| matches!(m, ServerMsg::PetDuoOver { score, .. } if *score == 1 + pet_duo::HEART_PTS))
        };
        assert!(over(&a) && over(&b));
        assert!(inst.pet_duos.is_empty());
    }
}
