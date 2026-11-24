//! Fishing (spec §7): cast, wait, a local timing mini-game, then a
//! server-decided outcome. The server picks when the fish bites and, as it
//! bites, which fish it is (by its rarity's odds); the bite tells the
//! angler, whose reel game is the harder the rarer the fish. The client only
//! reports how well the reel was timed: good enough, and that fish is landed.

use super::{Instance, Pending};
use crate::econ::{CallError, FishInfo};
use commons_protocol::{ServerMsg, error_code, fish_event, lure, pet_skill, state};
use commons_sim::TilePos;
use rand::Rng;

/// How long till a bite: twice what it was, and a bit more by chance
/// (`BITE_JITTER_MS` on top, so no two waits feel the same).
const BITE_MIN_MS: u32 = 5_000;
const BITE_MAX_MS: u32 = 18_000;
const BITE_JITTER_MS: u32 = 4_000;
/// How long the fish stays on the hook.
const WINDOW_MS: u32 = 2_500;
/// Extra allowance for the reel message's network trip.
const GRACE_MS: u32 = 400;
/// Casts reach this far (Chebyshev tiles) from where you stand.
const CAST_RANGE: i32 = 4;
/// Reels scoring below this lose the fish.
const MIN_QUALITY: u16 = 250;
/// The fisherman's upgraded rod (an item): fish bite a quarter sooner, and
/// the reel game gives one more swing of the needle, so the hook holds longer.
pub(crate) const ROD_ITEM: u32 = 112;
const ROD_BITE: f64 = 0.75;
const ROD_EXTRA_MS: u32 = 3_200;
/** Fish this rare (`rarity`) and up land flopping on the bank, to be hit before they jump back. */
const FLOP_FROM: i16 = 2;
/// …and, missed in the reel game, may stay hooked for one more swing (the
/// angler's screen rolls for it): the hook holds this much longer for them.
const SECOND_CHANCE_MS: u32 = 3_000;
/// Legendary and mythical fish must be stopped in the zone twice: more time for the second.
const DOUBLE_HIT_FROM: i16 = 4;
const DOUBLE_HIT_MS: u32 = 2_000;
/** Treasure: a chest instead of a fish, opened on the spot for coins. */
pub(crate) const TREASURE_ITEM: u32 = 113;
const TREASURE_COINS: i32 = 50;
/// The fisherman's glimmer lure (an item, used up when thrown): for five
/// minutes, lines cast into the circle of water round it (a 5×5 circle:
/// within √5 tiles of its centre) bite rare-and-up fish this many times as often
/// (a gentle nudge: it was 3×, too generous for the economy).
pub(crate) const LURE_ITEM: u32 = 117;
const LURE_MS: u32 = 5 * 60_000;
const LURE_R2: i32 = 5;
const LURE_LUCK: f64 = 1.6;
/// Nothing below uncommon bites at a lure.
const LURE_LEAST: i16 = 1;
/// Lures are thrown this far (Chebyshev tiles) from where you stand.
const LURE_RANGE: i32 = 10;
/// The legendary lure (the fisherman's dearest): its circle of water turns
/// gold for three minutes, and nothing below epic bites there.
pub(crate) const GOLD_LURE_ITEM: u32 = 119;
const GOLD_LURE_MS: u32 = 3 * 60_000;
const GOLD_LEAST: i16 = 3;
/// The Glimmering Magnet Lure: for five minutes its circle of water turns
/// purple and the rarer metals gather there, for a magnet dropped in it
/// (nothing common, the rare and up more often; a line's no different).
pub(crate) const MAGNET_LURE_ITEM: u32 = 142;
/// The Legendary Magnet Lure: for three minutes only epic metals and up lie
/// in its circle of rose-gold water, and a magnet finds them that much sooner.
pub(crate) const GOLD_MAGNET_LURE_ITEM: u32 = 961;
const GOLD_MAGNET_LURE_WAIT_PCT: u32 = 70;
/// What lies on the bottom about what a magnet found (so 3 to 7 things in all).
const SALVAGE_JUNK: std::ops::RangeInclusive<usize> = 2..=6;
/// The fisherman's magnet (an item): dropped in instead of a line, it brings
/// up scrap; it takes half again as long as a bite to find something, and then the
/// salvage game (steer it down, pull the thing free of the mud, haul it up)
/// has this long.
pub(crate) const MAGNET_ITEM: u32 = 120;
/// (Half again a line's wait: it was three times, twice too slow.)
const MAGNET_SLOWER_HALVES: u32 = 3;
const SALVAGE_MS: u32 = 32_000;
/// What the magnet finds comes after a reel game: this good (the hard middle
/// of the bar), and it's what was found; less (the easy band round it), the
/// next rarity down. A miss loses it.
const SALVAGE_BEST: u16 = 800;
/// That reel game's time: long enough for two full swings of the needle at
/// its slowest (the client's `MAGNET_SWINGS`); it says at once if it's over sooner.
const MAGNET_REEL_MS: u32 = 5_500;
/// In a magnet lure's water the magnet finds something this much of the
/// time it would take (a percentage: 15% faster).
const MAGNET_LURE_WAIT_PCT: u32 = 85;

#[derive(Debug, Clone, Copy)]
pub(super) struct Lure {
    at: TilePos,
    until: u32,
    kind: u8,
}

impl Lure {
    fn covers(&self, t: TilePos) -> bool {
        let (dx, dy) = (t.0 as i32 - self.at.0 as i32, t.1 as i32 - self.at.1 as i32);
        dx * dx + dy * dy <= LURE_R2
    }
}
const COIN: u32 = 1;

#[derive(Debug, Clone)]
pub(super) struct FishSession {
    target: TilePos,
    bite_at: u32,
    window_end: u32,
    biting: bool,
    /// The fish on the hook, once it bites.
    fish: Option<u32>,
    /// When the line went in, and whether it's the upgraded rod.
    cast_at: u32,
    rod: bool,
    /// A rare fish flopping on the bank, waiting to be hit.
    flop: Option<Flop>,
    /// The magnet, not a line: scrap, and the salvage game; the other junk
    /// lying about down there (the greedy may take it too).
    magnet: bool,
    junk: Vec<u32>,
    /// The magnet's reel game is won: the salvage game's on.
    diving: bool,
}

/// An angler's pet at the water (`pet_skill::FISH`, or `MAGNET` at the
/// magnet), from their first cast there till they walk off (further than
/// `PET_STAY` from `water`): pulling something out every so often (next
/// when `due`); or, a rare fish, flopping on the bank till it's hit
/// enough (`PetFishHit`).
#[derive(Debug, Clone)]
pub(super) struct PetCatch {
    due: u32,
    water: TilePos,
    magnet: bool,
    flop: Option<Flop>,
}

/// How long after the first cast it pulls something out (ms), and between
/// one catch and the next after that; and how far (tiles) its angler may
/// wander from the water before it gives up and follows them.
const PET_PULL_MS: std::ops::RangeInclusive<u32> = 5_000..=12_000;
const PET_EVERY_MS: std::ops::RangeInclusive<u32> = 18_000..=32_000;
pub(super) const PET_STAY: i32 = 6;

#[derive(Debug, Clone)]
pub(super) struct Flop {
    item: u32,
    at: TilePos,
    until: u32,
    hits: u32,
    /// Hits it takes, and how far (tiles) each one sends it.
    need: u32,
    reach: i32,
}

/** How hard a fish of `rarity` is to land on the bank: hits needed, and how far it hops. */
pub(crate) fn flop_toughness(rarity: i16) -> (u32, i32) {
    match rarity {
        ..=2 => (3, 1),
        3 => (4, 1),
        4 => (5, 1),
        _ => (5, 2),
    }
}

/// The rarest fish a fishing pet can bring up, by its tier: tier I rare,
/// II epic, III legendary (`pet_skill::FISH`, `FISH2`, `FISH3`).
pub(super) fn pet_fish_most(skills: u32) -> i16 {
    if skills & pet_skill::FISH3 != 0 {
        4
    } else if skills & pet_skill::FISH2 != 0 {
        3
    } else {
        2
    }
}

/// The pet skill for fishing at the magnet (or with a line).
fn pet_skill_for(magnet: bool) -> u32 {
    if magnet {
        pet_skill::MAGNET
    } else {
        pet_skill::FISH
    }
}

fn chebyshev(a: TilePos, b: TilePos) -> i32 {
    (a.0 as i32 - b.0 as i32)
        .abs()
        .max((a.1 as i32 - b.1 as i32).abs())
}

/// Picks what bites, by each fish's odds (`weight`: common ones often,
/// mythical ones seldom); night-only fish appear only at night. `luck`
/// (a lure, above 1) multiplies the odds of rare-and-up ones, and keeps
/// the commons away altogether: uncommon at the least.
#[cfg(test)]
pub(crate) fn roll_fish(fish: &[FishInfo], night: bool, luck: f64, roll: f64) -> Option<u32> {
    let least = if luck > 1.0 { LURE_LEAST } else { 0 };
    roll_fish_from(fish, night, luck, least, roll)
}

/// As `roll_fish`, nothing less rare than `least` biting (the gold lure: epic and up).
pub(crate) fn roll_fish_from(
    fish: &[FishInfo],
    night: bool,
    luck: f64,
    least: i16,
    roll: f64,
) -> Option<u32> {
    let weight = |f: &FishInfo| -> f64 {
        if (f.night && !night) || f.rarity < least {
            0.0
        } else if f.rarity >= FLOP_FROM {
            f.weight as f64 * luck
        } else {
            f.weight as f64
        }
    };
    let total: f64 = fish.iter().map(weight).sum();
    if total <= 0.0 {
        return None;
    }
    let mut x = roll * total;
    for f in fish {
        x -= weight(f);
        if x < 0.0 {
            return Some(f.id);
        }
    }
    fish.last().map(|f| f.id)
}

fn is_night() -> bool {
    use chrono::Timelike;
    let h = chrono::Local::now().hour();
    !(6..21).contains(&h)
}

impl Instance {
    /// `id` throws a glimmer lure into the water at `target` (it's used up).
    pub(super) fn throw_lure(&mut self, id: u32, target: TilePos, kind: u8, now: u32) {
        // Walking up to the shore: thrown on arrival.
        if self.moving(id, now) {
            self.avatars.get_mut(&id).unwrap().pending = Some(Pending::Lure {
                x: target.0,
                y: target.1,
                kind,
            });
            return;
        }
        self.do_throw_lure(id, target, kind, now);
    }

    pub(super) fn do_throw_lure(&mut self, id: u32, target: TilePos, kind: u8, now: u32) {
        let (item, ms, missing) = match kind {
            lure::GLIMMER => (
                LURE_ITEM,
                LURE_MS,
                "you don't have a lure: the fisherman sells them",
            ),
            lure::GOLD => (
                GOLD_LURE_ITEM,
                GOLD_LURE_MS,
                "you don't have a legendary lure: the fisherman sells them",
            ),
            lure::MAGNET => (
                MAGNET_LURE_ITEM,
                LURE_MS,
                "you don't have a magnet lure: the fisherman sells them",
            ),
            lure::GOLD_MAGNET => (
                GOLD_MAGNET_LURE_ITEM,
                GOLD_LURE_MS,
                "you don't have a legendary magnet lure: the fisherman sells them",
            ),
            _ => return self.error(id, error_code::BAD_MESSAGE, "that's no lure"),
        };
        if !self.is_water(target) {
            return self.error(id, error_code::BAD_MESSAGE, "throw it into the water");
        }
        let a = &self.avatars[&id];
        if chebyshev(a.tile, target) > LURE_RANGE {
            return self.error(id, error_code::TOO_FAR, "walk closer to the water");
        }
        let Some(econ) = self.economy.clone() else {
            return self.error(id, error_code::UNAVAILABLE, "the fish aren't biting yet");
        };
        let player = a.player_id.clone();
        let key = self.next_key("lure");
        self.spawn_call(
            async move { econ.grant(&player, item, -1, "lure", &key).await },
            move |inst, r| match r {
                Ok(applied) => {
                    if inst.avatars.contains_key(&id) {
                        inst.send_granted(id, &applied);
                    }
                    inst.lures.retain(|l| l.until > now);
                    let lure = Lure {
                        at: target,
                        until: now + ms,
                        kind,
                    };
                    inst.lures.push(lure);
                    // The throw itself, seen by those nearby: the arm, the lure arcing out.
                    if let Some(a) = inst.avatars.get(&id) {
                        let cell = a.cell;
                        inst.broadcast(
                            cell,
                            &ServerMsg::FishEvent {
                                id,
                                kind: fish_event::LURE,
                                x: target.0,
                                y: target.1,
                                item,
                            },
                            None,
                        );
                    }
                    // Everyone in the park hears of it, not just those looking at
                    // that bit of the pond: whoever wanders over later sees it too.
                    let bytes = ServerMsg::LureShown {
                        x: target.0,
                        y: target.1,
                        ends: lure.until,
                        kind,
                    }
                    .to_bytes();
                    for a in inst.avatars.values_mut() {
                        a.send(&bytes);
                    }
                }
                Err(CallError::Rejected(_)) => inst.error(id, error_code::NOT_ALLOWED, missing),
                Err(CallError::Unavailable) => inst.error(
                    id,
                    error_code::UNAVAILABLE,
                    "couldn't throw it just now, try again",
                ),
            },
        );
    }

    /// A newcomer sees the lures already in the water.
    pub(super) fn lure_hello(&mut self, id: u32) {
        let now = self.clock.now_ms();
        self.lures.retain(|l| l.until > now);
        for l in self.lures.clone() {
            self.send_to(
                id,
                &ServerMsg::LureShown {
                    x: l.at.0,
                    y: l.at.1,
                    ends: l.until,
                    kind: l.kind,
                },
            );
        }
    }

    fn is_water(&self, t: TilePos) -> bool {
        if self.pond_water.contains(&t) {
            return true;
        }
        let m = &self.zone.map;
        if t.0 >= m.width || t.1 >= m.height {
            return false;
        }
        let g = m.ground[t.1 as usize * m.width as usize + t.0 as usize] as usize;
        m.ground_legend.get(g).is_some_and(|n| n == "water")
    }

    pub(super) fn fish_cast(&mut self, id: u32, target: TilePos, magnet: bool, now: u32) {
        if self.moving(id, now) {
            self.avatars.get_mut(&id).unwrap().pending = Some(Pending::Cast {
                x: target.0,
                y: target.1,
                magnet,
            });
            return;
        }
        self.do_cast(id, target, magnet, now);
    }

    pub(super) fn do_cast(&mut self, id: u32, target: TilePos, magnet: bool, now: u32) {
        if self.economy.as_ref().and_then(|e| e.catalog()).is_none() {
            return self.error(id, error_code::UNAVAILABLE, "the fish aren't biting yet");
        }
        if !self.is_water(target) {
            return self.error(id, error_code::BAD_MESSAGE, "cast into the water");
        }
        let a = &self.avatars[&id];
        if let Some(s) = &a.fish {
            // A line just cast, nothing on it yet, swapped for the magnet (the
            // double tap's menu: its first tap cast the line).
            if magnet && !s.magnet && !s.biting && s.flop.is_none() {
                self.stop_fishing(id, false);
            } else {
                return;
            }
        }
        let a = &self.avatars[&id];
        if chebyshev(a.tile, target) > CAST_RANGE {
            return self.error(id, error_code::TOO_FAR, "walk closer to the water");
        }
        if a.state == state::SITTING {
            self.stand(id, now);
        }
        let mut rng = rand::rng();
        let wait =
            rng.random_range(BITE_MIN_MS..=BITE_MAX_MS) + rng.random_range(0..=BITE_JITTER_MS);
        // (Rare metals gather quicker in a magnet lure's water.)
        let lured = |kind: u8| {
            self.lures
                .iter()
                .any(|l| l.until > now && l.kind == kind && l.covers(target))
        };
        let bite_at = now
            + if magnet && lured(lure::GOLD_MAGNET) {
                wait * MAGNET_SLOWER_HALVES / 2 * GOLD_MAGNET_LURE_WAIT_PCT / 100
            } else if magnet && lured(lure::MAGNET) {
                wait * MAGNET_SLOWER_HALVES / 2 * MAGNET_LURE_WAIT_PCT / 100
            } else if magnet {
                wait * MAGNET_SLOWER_HALVES / 2
            } else {
                wait
            };
        let a = self.avatars.get_mut(&id).unwrap();
        a.state = state::FISHING;
        a.fish = Some(FishSession {
            target,
            bite_at,
            window_end: bite_at + WINDOW_MS,
            biting: false,
            fish: None,
            cast_at: now,
            rod: false,
            flop: None,
            magnet,
            junk: Vec::new(),
            diving: false,
        });
        let (tile, cell, player) = (a.tile, a.cell, a.player_id.clone());
        // The magnet: only if they have one (asked of the economy; the answer's
        // back long before anything bites).
        if magnet && let Some(econ) = self.economy.clone() {
            self.spawn_call(
                async move { econ.has(&player, MAGNET_ITEM).await },
                move |inst, has| {
                    if matches!(has, Ok(q) if q > 0) {
                        return;
                    }
                    let ours = inst
                        .avatars
                        .get(&id)
                        .and_then(|a| a.fish.as_ref())
                        .is_some_and(|s| s.cast_at == now && s.magnet);
                    if ours {
                        inst.stop_fishing(id, false);
                        inst.error(
                            id,
                            error_code::NOT_ALLOWED,
                            "you need a magnet: the fisherman sells them",
                        );
                    }
                },
            );
        } else if let Some(econ) = self.economy.clone() {
            // The upgraded rod? (Asked of the economy; the answer's back long before a bite.)
            self.spawn_call(
                async move { econ.has(&player, ROD_ITEM).await },
                move |inst, has| {
                    if !matches!(has, Ok(q) if q > 0) {
                        return;
                    }
                    let Some(s) = inst.avatars.get_mut(&id).and_then(|a| a.fish.as_mut()) else {
                        return;
                    };
                    if s.cast_at != now || s.biting {
                        return;
                    }
                    s.rod = true;
                    s.bite_at = now + ((s.bite_at - now) as f64 * ROD_BITE) as u32;
                    s.window_end = s.bite_at + WINDOW_MS + ROD_EXTRA_MS;
                },
            );
        }
        self.broadcast(
            cell,
            &ServerMsg::StateChange {
                id,
                state: state::FISHING,
                x: tile.0,
                y: tile.1,
            },
            None,
        );
        self.broadcast(
            cell,
            &ServerMsg::FishEvent {
                id,
                kind: fish_event::CAST,
                x: target.0,
                y: target.1,
                // (The magnet, not a line: everyone sees it dangling there.)
                item: if magnet { MAGNET_ITEM } else { 0 },
            },
            None,
        );
        self.pet_cast(id, target, magnet, now);
    }

    /// `id` cast (at the magnet, or a line): a pet out with them that's
    /// learnt to (`pet_skill::FISH`, `MAGNET`) sets to work at the water
    /// with them (already at it: it carries on, at this water, this way).
    fn pet_cast(&mut self, id: u32, water: TilePos, magnet: bool, now: u32) {
        let Some(a) = self.avatars.get_mut(&id) else {
            return;
        };
        if a.pet == 0 || a.pet_skills & pet_skill_for(magnet) == 0 {
            return;
        }
        if let Some(c) = a.pet_catch.as_mut() {
            c.water = water;
            c.magnet = magnet;
            return;
        }
        a.pet_catch = Some(PetCatch {
            due: now + rand::rng().random_range(PET_PULL_MS),
            water,
            magnet,
            flop: None,
        });
    }

    /// Pets pulling things out of the water (their angler still at it), and
    /// their rare catches flopping on the bank (not hit in time: back in).
    pub(super) fn pet_catch_tick(&mut self, now: u32) {
        let due: Vec<u32> = self
            .avatars
            .values()
            .filter(|a| a.pet_catch.is_some())
            .map(|a| a.id)
            .collect();
        for id in due {
            let a = self.avatars.get_mut(&id).unwrap();
            let cell = a.cell;
            let c = a.pet_catch.as_ref().unwrap();
            if let Some(f) = &c.flop {
                if now > f.until + GRACE_MS {
                    let at = f.at;
                    let c = a.pet_catch.as_mut().unwrap();
                    c.flop = None;
                    c.due = now + rand::rng().random_range(PET_EVERY_MS);
                    let msg = ServerMsg::FishEvent {
                        id,
                        kind: fish_event::PET_ESCAPED,
                        x: at.0,
                        y: at.1,
                        item: 0,
                    };
                    self.broadcast(cell, &msg, None);
                }
                continue;
            }
            if now < c.due {
                continue;
            }
            // (Walked off from the water, or the pet's gone home: it's done.)
            if a.pet == 0
                || a.pet_skills & pet_skill_for(c.magnet) == 0
                || chebyshev(a.tile, c.water) > PET_STAY
            {
                a.pet_catch = None;
                continue;
            }
            let (water, magnet, tile) = (c.water, c.magnet, a.tile);
            let catalog = self.economy.as_ref().and_then(|e| e.catalog());
            let Some(c) = catalog else {
                self.avatars.get_mut(&id).unwrap().pet_catch = None;
                continue;
            };
            // (Fishing, only as rare as its tier lets it bring up; the magnet, as ever.)
            let skills = self.avatars[&id].pet_skills;
            let capped: Vec<FishInfo>;
            let list = if magnet {
                &c.scrap
            } else {
                let most = pet_fish_most(skills);
                capped = c
                    .fish
                    .iter()
                    .filter(|f| f.rarity <= most)
                    .cloned()
                    .collect();
                &capped
            };
            let night = magnet || is_night();
            let Some(item) = roll_fish_from(list, night, 1.0, 0, rand::rng().random()) else {
                self.avatars.get_mut(&id).unwrap().pet_catch = None;
                continue;
            };
            let rarity = list.iter().find(|f| f.id == item).map_or(0, |f| f.rarity);
            let at = self.flop_spot(tile, water, None, 1);
            let a = self.avatars.get_mut(&id).unwrap();
            let c = a.pet_catch.as_mut().unwrap();
            c.due = now + rand::rng().random_range(PET_EVERY_MS);
            // A rare fish (not a chest; nothing at the magnet flops): hit it to land it.
            if rarity >= FLOP_FROM && item != TREASURE_ITEM && !magnet {
                let (need, reach) = flop_toughness(rarity);
                c.flop = Some(Flop {
                    item,
                    at,
                    until: now + fish_event::FLOP_MS,
                    hits: 0,
                    need,
                    reach,
                });
                let msg = ServerMsg::FishEvent {
                    id,
                    kind: fish_event::PET_FLOP,
                    x: at.0,
                    y: at.1,
                    item,
                };
                self.broadcast(cell, &msg, None);
                continue;
            }
            let msg = ServerMsg::FishEvent {
                id,
                kind: fish_event::PET_PULL,
                x: at.0,
                y: at.1,
                item,
            };
            self.broadcast(cell, &msg, None);
            self.pet_grant(id, item);
        }
    }

    /// A smack at your pet's catch flopping on the bank: enough and it's yours.
    pub(super) fn pet_fish_hit(&mut self, id: u32, now: u32) {
        let Some(a) = self.avatars.get_mut(&id) else {
            return;
        };
        let cell = a.cell;
        let Some(f) = a.pet_catch.as_mut().and_then(|c| c.flop.as_mut()) else {
            return;
        };
        if now > f.until + GRACE_MS || !a.hit_rl.try_take(now as u64) {
            return;
        }
        f.hits += 1;
        let (item, at, hits, need, reach) = (f.item, f.at, f.hits, f.need, f.reach);
        let water = a.pet_catch.as_ref().map_or(at, |c| c.water);
        let at = if hits < need {
            let next = self.flop_spot(at, water, Some(at), reach);
            if let Some(f) = self
                .avatars
                .get_mut(&id)
                .and_then(|a| a.pet_catch.as_mut())
                .and_then(|c| c.flop.as_mut())
            {
                f.at = next;
            }
            next
        } else {
            at
        };
        let kind = if hits >= need {
            fish_event::PET_CAUGHT
        } else {
            fish_event::PET_HIT
        };
        let msg = ServerMsg::FishEvent {
            id,
            kind,
            x: at.0,
            y: at.1,
            item: if hits >= need { item } else { hits },
        };
        self.broadcast(cell, &msg, None);
        if hits >= need {
            if let Some(c) = self.avatars.get_mut(&id).unwrap().pet_catch.as_mut() {
                c.flop = None;
                c.due = now + rand::rng().random_range(PET_EVERY_MS);
            }
            self.pet_grant(id, item);
        }
    }

    /// What `id`'s pet brought up is theirs (a chest: its coins).
    fn pet_grant(&mut self, id: u32, item: u32) {
        let Some(econ) = self.economy.clone() else {
            return;
        };
        let player = self.avatars[&id].player_id.clone();
        let (grant, qty) = if item == TREASURE_ITEM {
            (COIN, TREASURE_COINS)
        } else {
            (item, 1)
        };
        let key = self.next_key("petfish");
        self.spawn_call(
            async move { econ.grant(&player, grant, qty, "pet_fishing", &key).await },
            move |inst, result| {
                if let Ok(applied) = result
                    && inst.avatars.contains_key(&id)
                {
                    inst.send_granted(id, &applied);
                }
            },
        );
    }

    /// Ends a fishing session; `escaped` tells everyone the fish got away.
    pub(super) fn stop_fishing(&mut self, id: u32, escaped: bool) {
        let Some(a) = self.avatars.get_mut(&id) else {
            return;
        };
        let Some(session) = a.fish.take() else { return };
        a.state = state::IDLE;
        let (tile, cell) = (a.tile, a.cell);
        // A fish flopping on the bank always goes back in, so screens don't keep it.
        if escaped || session.flop.is_some() {
            let msg = ServerMsg::FishEvent {
                id,
                kind: fish_event::ESCAPED,
                x: session.target.0,
                y: session.target.1,
                item: 0,
            };
            self.broadcast(cell, &msg, None);
        }
        self.broadcast(
            cell,
            &ServerMsg::StateChange {
                id,
                state: state::IDLE,
                x: tile.0,
                y: tile.1,
            },
            None,
        );
    }

    pub(super) fn fish_reel(&mut self, id: u32, quality: u16, now: u32) {
        let Some(session) = self.avatars[&id].fish.clone() else {
            return;
        };
        // (Already down there: that reel game's over.)
        if session.diving {
            return;
        }
        let in_window = session.biting && now <= session.window_end + GRACE_MS;
        if !in_window || quality < MIN_QUALITY {
            return self.stop_fishing(id, true);
        }
        let Some(econ) = self.economy.clone() else {
            return self.stop_fishing(id, true);
        };
        let Some(item) = session.fish else {
            return self.stop_fishing(id, true);
        };
        if session.magnet {
            return self.start_salvage(id, item, quality, now);
        }
        // A rare fish (not a chest) comes out flopping onto the bank: hit it to land it.
        let rarity = econ
            .catalog()
            .and_then(|c| c.fish.iter().find(|f| f.id == item).map(|f| f.rarity))
            .unwrap_or(0);
        if rarity >= FLOP_FROM && item != TREASURE_ITEM && !session.magnet {
            let a = &self.avatars[&id];
            let at = self.flop_spot(a.tile, session.target, None, 1);
            let (need, reach) = flop_toughness(rarity);
            let a = self.avatars.get_mut(&id).unwrap();
            // The rod goes down: the angler may walk about after the fish now.
            a.state = state::IDLE;
            let (tile, cell) = (a.tile, a.cell);
            let s = a.fish.as_mut().unwrap();
            s.biting = false;
            s.flop = Some(Flop {
                item,
                at,
                until: now + fish_event::FLOP_MS,
                hits: 0,
                need,
                reach,
            });
            let msg = ServerMsg::FishEvent {
                id,
                kind: fish_event::FLOP,
                x: at.0,
                y: at.1,
                item,
            };
            self.broadcast(cell, &msg, None);
            let idle = ServerMsg::StateChange {
                id,
                state: state::IDLE,
                x: tile.0,
                y: tile.1,
            };
            return self.broadcast(cell, &idle, None);
        }
        self.land(id, item, session.target);
    }

    /// The magnet's reel game won: the best that can come up now is `item`
    /// (hit in the bar's middle) or something a rarity below it (hit in the
    /// band round that), with cheaper junk about it, never better than that.
    fn start_salvage(&mut self, id: u32, item: u32, quality: u16, now: u32) {
        let catalog = self.economy.as_ref().and_then(|e| e.catalog());
        let scrap: &[FishInfo] = catalog.as_ref().map_or(&[], |c| &c.scrap);
        let rarity_of = |i: u32| scrap.iter().find(|f| f.id == i).map_or(0, |f| f.rarity);
        let found = rarity_of(item);
        // The next rarity down that there is.
        let below = scrap.iter().map(|f| f.rarity).filter(|&r| r < found).max();
        let item = match below {
            Some(r) if quality < SALVAGE_BEST => {
                let pool: Vec<FishInfo> = scrap.iter().filter(|f| f.rarity == r).cloned().collect();
                roll_fish_from(&pool, true, 1.0, 0, rand::rng().random()).unwrap_or(item)
            }
            _ => item,
        };
        let top = rarity_of(item);
        // Junk about it: common and uncommon only, and nothing above the best on offer.
        let cheap: Vec<FishInfo> = scrap
            .iter()
            .filter(|f| f.rarity <= top.min(1))
            .cloned()
            .collect();
        let n = rand::rng().random_range(SALVAGE_JUNK);
        let junk: Vec<u32> = (0..n)
            .filter_map(|_| roll_fish_from(&cheap, true, 1.0, 0, rand::rng().random()))
            .collect();
        let Some(s) = self.avatars.get_mut(&id).and_then(|a| a.fish.as_mut()) else {
            return;
        };
        s.fish = Some(item);
        s.junk = junk.clone();
        s.diving = true;
        s.window_end = now + SALVAGE_MS;
        let target = s.target;
        self.send_to(id, &ServerMsg::SalvageJunk { items: junk });
        self.send_to(
            id,
            &ServerMsg::FishEvent {
                id,
                kind: fish_event::SALVAGE,
                x: target.0,
                y: target.1,
                item,
            },
        );
    }

    /// The salvage game's done: the glinting thing (if it came up) and
    /// whichever of the other junk was grabbed too (`extras`, bit by bit).
    pub(super) fn salvage_reel(&mut self, id: u32, target: bool, extras: u8, now: u32) {
        let Some(session) = self.avatars.get(&id).and_then(|a| a.fish.clone()) else {
            return;
        };
        let in_window = session.biting && now <= session.window_end + GRACE_MS;
        if !session.magnet || !session.diving || !in_window {
            return self.stop_fishing(id, true);
        }
        let mut items: Vec<u32> = Vec::new();
        if target && let Some(i) = session.fish {
            items.push(i);
        }
        for (k, &j) in session.junk.iter().enumerate().take(8) {
            if extras & (1 << k) != 0 {
                items.push(j);
            }
        }
        if items.is_empty() {
            return self.stop_fishing(id, true);
        }
        self.land_all(id, &items, session.target);
    }

    /// Lands several things at once (the salvage game, greedy): all held up, all granted.
    fn land_all(&mut self, id: u32, items: &[u32], from: TilePos) {
        let Some(econ) = self.economy.clone() else {
            return self.stop_fishing(id, true);
        };
        self.land(id, items[0], from);
        let (player, cell) = {
            let a = &self.avatars[&id];
            (a.player_id.clone(), a.cell)
        };
        for &item in &items[1..] {
            self.broadcast(
                cell,
                &ServerMsg::FishEvent {
                    id,
                    kind: fish_event::HAUL,
                    x: from.0,
                    y: from.1,
                    item,
                },
                None,
            );
            let econ = econ.clone();
            let player = player.clone();
            let key = self.next_key("fish");
            self.spawn_call(
                async move { econ.grant(&player, item, 1, "fishing", &key).await },
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

    /**
     * Where a fish flops: the dry tile around `at` nearest `water` (as it
     * comes out); or, hit (`from` its spot), a random dry tile right next
     * to where it was (never water; if there's none, it stays put).
     */
    fn flop_spot(&self, at: TilePos, water: TilePos, from: Option<TilePos>, reach: i32) -> TilePos {
        let mut spots = vec![];
        for dy in -reach..=reach {
            for dx in -reach..=reach {
                let (x, y) = (at.0 as i32 + dx, at.1 as i32 + dy);
                if (dx == 0 && dy == 0) || x < 0 || y < 0 {
                    continue;
                }
                let t = (x as u16, y as u16);
                if self.grid.walkable(t.0, t.1) && !self.is_water(t) {
                    spots.push(t);
                }
            }
        }
        if from.is_some() {
            if spots.is_empty() {
                return at;
            }
            return spots[rand::rng().random_range(0..spots.len())];
        }
        spots
            .into_iter()
            .min_by_key(|t| {
                (t.0 as i32 - water.0 as i32).pow(2) + (t.1 as i32 - water.1 as i32).pow(2)
            })
            .unwrap_or(at)
    }

    /// A smack at your flopping fish: enough of them and it's yours.
    pub(super) fn fish_hit(&mut self, id: u32, now: u32) {
        let Some(a) = self.avatars.get_mut(&id) else {
            return;
        };
        let cell = a.cell;
        let Some(f) = a.fish.as_mut().and_then(|s| s.flop.as_mut()) else {
            return;
        };
        if now > f.until + GRACE_MS || !a.hit_rl.try_take(now as u64) {
            return;
        }
        f.hits += 1;
        let (item, at, hits, need, reach) = (f.item, f.at, f.hits, f.need, f.reach);
        // Smacked, it flops off to a tile nearby (unless that was the last hit).
        let at = if hits < need {
            let water = self.avatars[&id]
                .fish
                .as_ref()
                .map(|s| s.target)
                .unwrap_or(at);
            let next = self.flop_spot(at, water, Some(at), reach);
            if let Some(f) = self
                .avatars
                .get_mut(&id)
                .and_then(|a| a.fish.as_mut())
                .and_then(|s| s.flop.as_mut())
            {
                f.at = next;
            }
            next
        } else {
            at
        };
        let msg = ServerMsg::FishEvent {
            id,
            kind: fish_event::HIT,
            x: at.0,
            y: at.1,
            item: hits,
        };
        self.broadcast(cell, &msg, None);
        if hits >= need {
            self.land(id, item, at);
        }
    }

    /// The catch is landed (from `from`): everyone sees it, the economy records it.
    fn land(&mut self, id: u32, item: u32, from: TilePos) {
        let Some(econ) = self.economy.clone() else {
            return self.stop_fishing(id, true);
        };
        let a = self.avatars.get_mut(&id).unwrap();
        a.fish = None;
        a.state = state::IDLE;
        let (tile, cell, player) = (a.tile, a.cell, a.player_id.clone());
        let catch = ServerMsg::FishEvent {
            id,
            kind: fish_event::CAUGHT,
            x: from.0,
            y: from.1,
            item,
        };
        self.broadcast(cell, &catch, None);
        self.broadcast(
            cell,
            &ServerMsg::StateChange {
                id,
                state: state::IDLE,
                x: tile.0,
                y: tile.1,
            },
            None,
        );
        let key = self.next_key("fish");
        let (grant, qty) = if item == TREASURE_ITEM {
            (COIN, TREASURE_COINS)
        } else {
            (item, 1)
        };
        self.spawn_call(
            async move { econ.grant(&player, grant, qty, "fishing", &key).await },
            move |inst, result| match result {
                Ok(applied) if inst.avatars.contains_key(&id) => inst.send_granted(id, &applied),
                Ok(_) => {}
                Err(CallError::Rejected(msg)) => inst.error(id, error_code::NOT_ALLOWED, &msg),
                Err(CallError::Unavailable) => inst.error(
                    id,
                    error_code::UNAVAILABLE,
                    "the catch couldn't be saved; please try again",
                ),
            },
        );
    }

    /// Bites and timeouts.
    pub(super) fn fish_tick(&mut self, now: u32) {
        let fishing: Vec<u32> = self
            .avatars
            .values()
            .filter(|a| a.fish.is_some())
            .map(|a| a.id)
            .collect();
        for id in fishing {
            let a = self.avatars.get_mut(&id).unwrap();
            let s = a.fish.as_mut().unwrap();
            if let Some(f) = &s.flop {
                // Not hit in time: it flops back into the water.
                if now > f.until + GRACE_MS {
                    self.stop_fishing(id, true);
                }
                continue;
            }
            if !s.biting && now >= s.bite_at && s.magnet {
                // The magnet's found something: what, and the reel game first (see
                // `start_salvage`). Its pace and its zones are this thing's rarity.
                s.biting = true;
                let catalog = self.economy.as_ref().and_then(|e| e.catalog());
                // (In a magnet lure's water: the rarer metals, nothing common.)
                let target = s.target;
                let lured = |kind: u8| {
                    self.lures
                        .iter()
                        .any(|l| l.until > now && l.kind == kind && l.covers(target))
                };
                // (A legendary magnet lure's: epic and up, as a gold lure's fish.)
                let (luck, least) = if lured(lure::GOLD_MAGNET) {
                    (1.0, GOLD_LEAST)
                } else if lured(lure::MAGNET) {
                    (LURE_LUCK, LURE_LEAST)
                } else {
                    (1.0, 0)
                };
                s.fish = catalog.as_ref().and_then(|c| {
                    roll_fish_from(&c.scrap, true, luck, least, rand::rng().random())
                });
                s.window_end = s.bite_at + MAGNET_REEL_MS;
                let (target, cell, item) = (s.target, a.cell, s.fish.unwrap_or(0));
                let bite = ServerMsg::FishEvent {
                    id,
                    kind: fish_event::BITE,
                    x: target.0,
                    y: target.1,
                    item,
                };
                self.broadcast(cell, &bite, None);
            } else if !s.biting && now >= s.bite_at {
                s.biting = true;
                // What's on the hook: the angler sees how rare (and so how hard) it is.
                let catalog = self.economy.as_ref().and_then(|e| e.catalog());
                let target = s.target;
                let here = |kind: u8| {
                    self.lures
                        .iter()
                        .any(|l| l.until > now && l.kind == kind && l.covers(target))
                };
                // (A gold lure's water: epic and up; a glimmer lure's: rarer, more often.)
                let (luck, least) = if here(lure::GOLD) {
                    (1.0, GOLD_LEAST)
                } else if here(lure::GLIMMER) {
                    (LURE_LUCK, LURE_LEAST)
                } else {
                    (1.0, 0)
                };
                s.fish = catalog.as_ref().and_then(|c| {
                    roll_fish_from(&c.fish, is_night(), luck, least, rand::rng().random())
                });
                // A rare one may get a second swing at it.
                let rarity = catalog.as_ref().and_then(|c| {
                    s.fish
                        .and_then(|id| c.fish.iter().find(|f| f.id == id).map(|f| f.rarity))
                });
                if rarity.is_some_and(|r| r >= FLOP_FROM) {
                    s.window_end += SECOND_CHANCE_MS;
                }
                if rarity.is_some_and(|r| r >= DOUBLE_HIT_FROM) {
                    s.window_end += DOUBLE_HIT_MS;
                }
                let (target, cell, item) = (s.target, a.cell, s.fish.unwrap_or(0));
                let bite = ServerMsg::FishEvent {
                    id,
                    kind: fish_event::BITE,
                    x: target.0,
                    y: target.1,
                    item,
                };
                self.broadcast(cell, &bite, None);
            } else if s.biting && now > s.window_end + GRACE_MS {
                self.stop_fishing(id, true);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::econ::ZoneCatalog;
    use crate::instance::Cmd;
    use crate::instance::tests::*;
    use commons_protocol::{ClientMsg, ServerMsg};

    #[test]
    fn roll_respects_night_and_rarity() {
        let fish = ZoneCatalog::for_tests().fish;
        // Moonfish (106) is night-only.
        for i in 0..100 {
            assert_ne!(roll_fish(&fish, false, 1.0, i as f64 / 100.0), Some(106));
        }
        let count = |id: u32| {
            (0..1000)
                .filter(|i| roll_fish(&fish, true, 1.0, *i as f64 / 1000.0) == Some(id))
                .count()
        };
        assert!(
            count(100) > count(107) && count(107) > count(105),
            "common minnows, fewer boots, a rare koi"
        );
        assert!(count(105) > 0, "but koi do bite");
    }

    #[test]
    fn a_gold_lure_brings_only_epic_and_up() {
        let fish = ZoneCatalog::for_tests().fish;
        let mut seen = 0;
        for i in 0..1000 {
            if let Some(id) = roll_fish_from(&fish, i % 2 == 0, 1.0, GOLD_LEAST, i as f64 / 1000.0)
            {
                let f = fish.iter().find(|f| f.id == id).unwrap();
                assert!(f.rarity >= GOLD_LEAST, "{} is below epic", f.id);
                seen += 1;
            }
        }
        assert!(seen > 0, "something bites");
    }

    #[test]
    fn a_lure_draws_the_rarer_fish_to_its_circle() {
        let fish = ZoneCatalog::for_tests().fish;
        let rare = |luck: f64| {
            (0..10_000)
                .filter_map(|i| roll_fish(&fish, true, luck, i as f64 / 10_000.0))
                .filter(|id| fish.iter().any(|f| f.id == *id && f.rarity >= FLOP_FROM))
                .count()
        };
        assert!(
            rare(LURE_LUCK) > 2 * rare(1.0),
            "rare fish come far more often to a lure"
        );
        for i in 0..1000 {
            let id = roll_fish(&fish, true, LURE_LUCK, i as f64 / 1000.0).expect("something bites");
            let f = fish.iter().find(|f| f.id == id).unwrap();
            assert!(
                f.rarity >= LURE_LEAST,
                "never a common fish at a lure: {}",
                f.id
            );
        }
        // A 5×5 circle: 21 tiles round its centre, not the corners.
        let l = Lure {
            at: (10, 10),
            until: 1,
            kind: lure::GLIMMER,
        };
        let n = (5..=15)
            .flat_map(|x| (5..=15).map(move |y| (x, y)))
            .filter(|&t| l.covers(t))
            .count();
        assert_eq!(n, 21);
        assert!(l.covers((12, 11)) && !l.covers((12, 12)));
    }

    #[test]
    fn a_magnet_brings_up_scrap_after_a_long_wait_and_never_flops() {
        let mut inst = pond_instance();
        let _a = connect(&mut inst, 1, "salvager", (20, 12));
        place(&mut inst, 1, (5, 4));
        let now = inst.clock.now_ms();
        inst.handle(Cmd::Msg {
            conn: 1,
            msg: ClientMsg::FishCast {
                x: 5,
                y: 6,
                magnet: true,
            },
        });
        let s = inst.avatars[&1].fish.clone().expect("dropped in");
        assert!(s.magnet);
        assert!(
            s.bite_at >= now + BITE_MIN_MS * MAGNET_SLOWER_HALVES / 2,
            "half again the wait"
        );
        inst.fish_tick(s.bite_at);
        let s = inst.avatars[&1].fish.clone().unwrap();
        assert!(s.biting);
        let item = s.fish.expect("something down there");
        assert!([121, 127].contains(&item), "scrap, not fish: {item}");
        assert_eq!(
            s.window_end,
            s.bite_at + MAGNET_REEL_MS,
            "the reel game first"
        );
        assert!(s.junk.is_empty() && !s.diving);
        // Reeled (the bar's middle): the salvage game's on, for what was found.
        let at = s.bite_at + 500;
        inst.fish_reel(1, 1000, at);
        let s = inst.avatars[&1].fish.clone().unwrap();
        assert!(s.diving);
        assert_eq!(s.fish, Some(item));
        assert_eq!(s.window_end, at + SALVAGE_MS);
        // Junk lies about it (the cheap stuff only), for the greedy.
        assert!(SALVAGE_JUNK.contains(&s.junk.len()), "{:?}", s.junk);
        assert!(s.junk.iter().all(|&j| j == 121));
        // Salvaged, with two bits of junk: straight into the bag (an old safe never flops about).
        inst.salvage_reel(1, true, 0b11, at + 20_000);
        assert!(inst.avatars[&1].fish.is_none());
    }

    #[test]
    fn a_legendary_magnet_lure_gathers_only_epic_metals_and_sooner() {
        let mut inst = pond_instance();
        let _a = connect(&mut inst, 1, "salvager", (20, 12));
        place(&mut inst, 1, (5, 4));
        inst.lures.push(Lure {
            at: (5, 6),
            until: u32::MAX,
            kind: lure::GOLD_MAGNET,
        });
        let slowest = (BITE_MAX_MS + BITE_JITTER_MS) * MAGNET_SLOWER_HALVES / 2;
        let catalog = inst.economy.as_ref().and_then(|e| e.catalog()).unwrap();
        for _ in 0..30 {
            let now = inst.clock.now_ms();
            inst.handle(Cmd::Msg {
                conn: 1,
                msg: ClientMsg::FishCast {
                    x: 5,
                    y: 6,
                    magnet: true,
                },
            });
            let s = inst.avatars[&1].fish.clone().expect("dropped in");
            assert!(s.bite_at - now <= slowest * 70 / 100 + 1, "sooner still");
            inst.fish_tick(s.bite_at);
            let s = inst.avatars[&1].fish.clone().unwrap();
            let item = s.fish.expect("something's down there");
            let rarity = catalog.scrap.iter().find(|f| f.id == item).unwrap().rarity;
            assert!(rarity >= GOLD_LEAST, "nothing less than epic: {rarity}");
            inst.stop_fishing(1, true);
        }
    }

    #[test]
    fn a_magnet_lure_gathers_the_rarer_metals_and_three_to_seven_things_lie_about() {
        let mut inst = pond_instance();
        let _a = connect(&mut inst, 1, "salvager", (20, 12));
        place(&mut inst, 1, (5, 4));
        inst.lures.push(Lure {
            at: (5, 6),
            until: u32::MAX,
            kind: lure::MAGNET,
        });
        let mut counts = std::collections::HashSet::new();
        // (15% faster: never as long as the slowest wait of all.)
        let slowest = (BITE_MAX_MS + BITE_JITTER_MS) * MAGNET_SLOWER_HALVES / 2;
        for _ in 0..60 {
            let now = inst.clock.now_ms();
            inst.handle(Cmd::Msg {
                conn: 1,
                msg: ClientMsg::FishCast {
                    x: 5,
                    y: 6,
                    magnet: true,
                },
            });
            let s = inst.avatars[&1].fish.clone().expect("dropped in");
            assert!(
                s.bite_at - now <= slowest * 85 / 100 + 1,
                "sooner in its water"
            );
            inst.fish_tick(s.bite_at);
            let s = inst.avatars[&1].fish.clone().unwrap();
            assert_eq!(s.fish, Some(127), "never the common can in its water");
            inst.fish_reel(1, 1000, s.bite_at + 100);
            let s = inst.avatars[&1].fish.clone().unwrap();
            let on_the_floor = 1 + s.junk.len();
            assert!((3..=7).contains(&on_the_floor), "{on_the_floor}");
            counts.insert(on_the_floor);
            inst.salvage_reel(1, true, 0, s.bite_at + 20_000);
        }
        assert!(counts.contains(&3) && counts.contains(&7), "{counts:?}");
    }

    #[test]
    fn the_magnets_reel_game_sets_the_best_that_can_come_up() {
        // Dropped in lured water, so it's the old safe (legendary) it finds.
        let dive = |quality: u16| {
            let mut inst = pond_instance();
            let _a = connect(&mut inst, 1, "salvager", (20, 12));
            place(&mut inst, 1, (5, 4));
            inst.lures.push(Lure {
                at: (5, 6),
                until: u32::MAX,
                kind: lure::MAGNET,
            });
            inst.handle(Cmd::Msg {
                conn: 1,
                msg: ClientMsg::FishCast {
                    x: 5,
                    y: 6,
                    magnet: true,
                },
            });
            let s = inst.avatars[&1].fish.clone().unwrap();
            inst.fish_tick(s.bite_at);
            let s = inst.avatars[&1].fish.clone().unwrap();
            assert_eq!(s.fish, Some(127));
            assert!(!s.diving, "the reel game first");
            inst.fish_reel(1, quality, s.bite_at + 100);
            inst.avatars[&1].fish.clone()
        };
        // The hard middle: what it found.
        assert_eq!(dive(1000).unwrap().fish, Some(127));
        // The easy band: the next rarity down, and nothing on the floor above it.
        let s = dive(500).unwrap();
        assert_eq!(s.fish, Some(121));
        assert!(s.diving && s.junk.iter().all(|&j| j == 121));
        // Missed: it's gone.
        assert!(dive(0).is_none());
    }

    #[test]
    fn cast_bite_and_escape() {
        let mut inst = pond_instance();
        let mut a = connect(&mut inst, 1, "angler", (20, 12));
        place(&mut inst, 1, (5, 4));
        let now = inst.clock.now_ms();
        inst.handle(Cmd::Msg {
            conn: 1,
            msg: ClientMsg::FishCast {
                x: 5,
                y: 6,
                magnet: false,
            },
        });
        assert_eq!(inst.avatars[&1].state, state::FISHING);
        // Too far.
        inst.handle(Cmd::Msg {
            conn: 1,
            msg: ClientMsg::FishCast {
                x: 5,
                y: 9,
                magnet: false,
            },
        });
        // Reeling before the bite scares the fish.
        inst.handle(Cmd::Msg {
            conn: 1,
            msg: ClientMsg::FishReel { quality: 900 },
        });
        assert_eq!(inst.avatars[&1].state, state::IDLE);
        // Cast again and let the fish get away.
        inst.handle(Cmd::Msg {
            conn: 1,
            msg: ClientMsg::FishCast {
                x: 5,
                y: 6,
                magnet: false,
            },
        });
        inst.fish_tick(now + BITE_MAX_MS + BITE_JITTER_MS + 1);
        assert!(inst.avatars[&1].fish.as_ref().unwrap().biting);
        inst.fish_tick(
            now + BITE_MAX_MS
                + BITE_JITTER_MS
                + WINDOW_MS
                + SECOND_CHANCE_MS
                + DOUBLE_HIT_MS
                + GRACE_MS
                + 2,
        );
        assert!(inst.avatars[&1].fish.is_none());
        inst.flush();
        a.pump();
        let kinds: Vec<u8> = a
            .log
            .iter()
            .filter_map(|m| match m {
                ServerMsg::FishEvent { kind, .. } => Some(*kind),
                _ => None,
            })
            .collect();
        assert_eq!(
            kinds,
            vec![
                fish_event::CAST,
                fish_event::ESCAPED,
                fish_event::CAST,
                fish_event::BITE,
                fish_event::ESCAPED
            ]
        );
    }

    #[test]
    fn an_epic_fish_flops_on_the_bank_until_hit_four_times() {
        let mut inst = pond_instance();
        let mut a = connect(&mut inst, 1, "angler", (20, 12));
        place(&mut inst, 1, (5, 4));
        let now = inst.clock.now_ms();
        inst.handle(Cmd::Msg {
            conn: 1,
            msg: ClientMsg::FishCast {
                x: 5,
                y: 6,
                magnet: false,
            },
        });
        // A koi (epic, in the test catalogue: four hits) bites.
        {
            let s = inst.avatars.get_mut(&1).unwrap().fish.as_mut().unwrap();
            s.biting = true;
            s.fish = Some(105);
            s.window_end = now + 60_000;
        }
        inst.handle(Cmd::Msg {
            conn: 1,
            msg: ClientMsg::FishReel { quality: 900 },
        });
        assert!(
            inst.avatars[&1].fish.as_ref().unwrap().flop.is_some(),
            "flopping on the bank"
        );
        for _ in 0..3 {
            inst.handle(Cmd::Msg {
                conn: 1,
                msg: ClientMsg::FishHit {},
            });
        }
        assert!(
            inst.avatars[&1].fish.is_some(),
            "three isn't enough for an epic fish"
        );
        inst.handle(Cmd::Msg {
            conn: 1,
            msg: ClientMsg::FishHit {},
        });
        assert!(inst.avatars[&1].fish.is_none(), "landed");
        inst.flush();
        a.pump();
        let kinds: Vec<u8> = a
            .log
            .iter()
            .filter_map(|m| match m {
                ServerMsg::FishEvent { kind, .. } => Some(*kind),
                _ => None,
            })
            .collect();
        assert_eq!(
            &kinds[1..],
            &[
                fish_event::FLOP,
                fish_event::HIT,
                fish_event::HIT,
                fish_event::HIT,
                fish_event::HIT,
                fish_event::CAUGHT
            ]
        );
    }

    #[test]
    fn an_unhit_fish_jumps_back_in() {
        let mut inst = pond_instance();
        let _a = connect(&mut inst, 1, "angler", (20, 12));
        place(&mut inst, 1, (5, 4));
        let now = inst.clock.now_ms();
        inst.handle(Cmd::Msg {
            conn: 1,
            msg: ClientMsg::FishCast {
                x: 5,
                y: 6,
                magnet: false,
            },
        });
        {
            let s = inst.avatars.get_mut(&1).unwrap().fish.as_mut().unwrap();
            s.biting = true;
            s.fish = Some(105);
            s.window_end = now + 60_000;
        }
        inst.handle(Cmd::Msg {
            conn: 1,
            msg: ClientMsg::FishReel { quality: 900 },
        });
        inst.handle(Cmd::Msg {
            conn: 1,
            msg: ClientMsg::FishHit {},
        });
        inst.fish_tick(now + fish_event::FLOP_MS + GRACE_MS + 1_000);
        assert!(inst.avatars[&1].fish.is_none(), "it got away");
        assert_eq!(inst.avatars[&1].state, state::IDLE);
    }

    #[test]
    fn walking_after_a_flopping_fish_keeps_it_and_hits_make_it_hop() {
        let mut inst = pond_instance();
        let mut a = connect(&mut inst, 1, "angler", (20, 12));
        place(&mut inst, 1, (5, 4));
        let now = inst.clock.now_ms();
        inst.handle(Cmd::Msg {
            conn: 1,
            msg: ClientMsg::FishCast {
                x: 5,
                y: 6,
                magnet: false,
            },
        });
        {
            let s = inst.avatars.get_mut(&1).unwrap().fish.as_mut().unwrap();
            s.biting = true;
            s.fish = Some(105);
            s.window_end = now + 60_000;
        }
        inst.handle(Cmd::Msg {
            conn: 1,
            msg: ClientMsg::FishReel { quality: 900 },
        });
        assert_eq!(
            inst.avatars[&1].state,
            state::IDLE,
            "rod down, free to move"
        );
        // Walk off after it: the fish is still there to be hit.
        inst.handle(Cmd::Msg {
            conn: 1,
            msg: ClientMsg::MoveTo {
                x: 6,
                y: 3,
                sprint: false,
            },
        });
        let spot = |inst: &crate::instance::Instance| {
            inst.avatars[&1]
                .fish
                .as_ref()
                .unwrap()
                .flop
                .as_ref()
                .unwrap()
                .at
        };
        let before = spot(&inst);
        inst.handle(Cmd::Msg {
            conn: 1,
            msg: ClientMsg::FishHit {},
        });
        let after = spot(&inst);
        assert_ne!(after, before, "a hit sends it flopping somewhere else");
        assert!(
            (after.0 as i32 - before.0 as i32).abs() <= 1
                && (after.1 as i32 - before.1 as i32).abs() <= 1,
            "just one tile over"
        );
        assert!(!inst.is_water(after), "and never into the water");
        for _ in 0..3 {
            inst.handle(Cmd::Msg {
                conn: 1,
                msg: ClientMsg::FishHit {},
            });
        }
        assert!(inst.avatars[&1].fish.is_none(), "landed");
        inst.flush();
        a.pump();
        assert!(a.log.iter().any(|m| matches!(
            m,
            ServerMsg::FishEvent {
                kind: fish_event::CAUGHT,
                ..
            }
        )));
    }

    #[test]
    fn rarer_fish_take_more_hits_and_mythical_ones_hop_further() {
        assert_eq!(flop_toughness(2), (3, 1), "rare");
        assert_eq!(flop_toughness(3), (4, 1), "epic");
        assert_eq!(flop_toughness(4), (5, 1), "legendary");
        assert_eq!(flop_toughness(5), (5, 2), "mythical: two tiles");
    }

    #[test]
    fn a_pet_that_can_fish_pulls_some_out_and_its_rare_ones_flop_till_hit() {
        let mut inst = pond_instance();
        let mut a = connect(&mut inst, 1, "angler", (20, 12));
        place(&mut inst, 1, (5, 4));
        let cast = |inst: &mut Instance| {
            inst.stop_fishing(1, false);
            inst.handle(Cmd::Msg {
                conn: 1,
                msg: ClientMsg::FishCast {
                    x: 5,
                    y: 6,
                    magnet: false,
                },
            });
        };
        // No pet (or one that hasn't learnt it): it never does.
        for _ in 0..40 {
            cast(&mut inst);
            assert!(inst.avatars[&1].pet_catch.is_none());
        }
        inst.avatars.get_mut(&1).unwrap().pet = 7;
        for _ in 0..40 {
            cast(&mut inst);
            assert!(inst.avatars[&1].pet_catch.is_none());
        }
        // Learnt: from the first cast it's at it too, and keeps at it with the
        // line in (you still there by the water), till you walk off.
        inst.avatars.get_mut(&1).unwrap().pet_skills = pet_skill::FISH;
        cast(&mut inst);
        assert!(inst.avatars[&1].pet_catch.is_some());
        inst.stop_fishing(1, false);
        let now0 = inst.clock.now_ms();
        let due = inst.avatars[&1].pet_catch.as_ref().unwrap().due;
        inst.pet_catch_tick(due + 1);
        let c = inst.avatars[&1]
            .pet_catch
            .as_ref()
            .expect("still at it, line in");
        assert!(c.due > due, "and on to the next");
        let tile = inst.avatars[&1].tile;
        place(&mut inst, 1, (tile.0 + PET_STAY as u16 + 2, tile.1));
        let due = inst.avatars[&1].pet_catch.as_ref().map_or(now0, |c| c.due);
        inst.pet_catch_tick(due + 1);
        assert!(
            inst.avatars[&1].pet_catch.is_none(),
            "walked off: it follows"
        );
        place(&mut inst, 1, (5, 4));
        // Its catches: common ones straight out, rare ones flopping till hit
        // (a tier II pet: the epic ones too).
        inst.avatars.get_mut(&1).unwrap().pet_skills = pet_skill::FISH | pet_skill::FISH2;
        let (mut pulled, mut landed) = (0, 0);
        let mut now = inst.clock.now_ms();
        for _ in 0..200 {
            if pulled > 0 && landed > 0 {
                break;
            }
            cast(&mut inst);
            let a1 = inst.avatars.get_mut(&1).unwrap();
            a1.pet_catch = Some(PetCatch {
                due: now,
                water: (5, 6),
                magnet: false,
                flop: None,
            });
            inst.pet_catch_tick(now + 1);
            let flopping = |inst: &Instance| {
                inst.avatars[&1]
                    .pet_catch
                    .as_ref()
                    .is_some_and(|c| c.flop.is_some())
            };
            if !flopping(&inst) {
                pulled += 1;
                continue;
            }
            // Flopping: hit it till it's landed.
            for _ in 0..10 {
                now += 300;
                inst.pet_fish_hit(1, now);
                if !flopping(&inst) {
                    landed += 1;
                    break;
                }
            }
            now += 1000;
        }
        assert!(pulled > 0 && landed > 0, "{pulled} {landed}");
        inst.flush();
        a.pump();
        let kinds: Vec<u8> = a
            .log
            .iter()
            .filter_map(|m| match m {
                ServerMsg::FishEvent { kind, .. } if *kind >= fish_event::PET_PULL => Some(*kind),
                _ => None,
            })
            .collect();
        for k in [
            fish_event::PET_PULL,
            fish_event::PET_FLOP,
            fish_event::PET_HIT,
            fish_event::PET_CAUGHT,
        ] {
            assert!(kinds.contains(&k), "{k}: {kinds:?}");
        }
        // Its tier caps what it brings up: rare at tier I, epic at II, legendary at III.
        assert_eq!(pet_fish_most(pet_skill::FISH), 2);
        assert_eq!(pet_fish_most(pet_skill::FISH | pet_skill::FISH2), 3);
        assert_eq!(
            pet_fish_most(pet_skill::FISH | pet_skill::FISH2 | pet_skill::FISH3),
            4
        );
        // A tier I pet: nothing rarer than rare, however many it brings up.
        let fish = inst
            .economy
            .as_ref()
            .unwrap()
            .catalog()
            .unwrap()
            .fish
            .clone();
        let rarity = |item: u32| fish.iter().find(|f| f.id == item).map_or(0, |f| f.rarity);
        inst.flush();
        a.pump();
        a.log.clear();
        inst.avatars.get_mut(&1).unwrap().pet_skills = pet_skill::FISH;
        for _ in 0..150 {
            cast(&mut inst);
            inst.avatars.get_mut(&1).unwrap().pet_catch = Some(PetCatch {
                due: now,
                water: (5, 6),
                magnet: false,
                flop: None,
            });
            inst.pet_catch_tick(now + 1);
            now += 50;
        }
        inst.flush();
        a.pump();
        let caught: Vec<u32> = a
            .log
            .iter()
            .filter_map(|m| match m {
                ServerMsg::FishEvent { kind, item, .. }
                    if *kind == fish_event::PET_PULL || *kind == fish_event::PET_FLOP =>
                {
                    Some(*item)
                }
                _ => None,
            })
            .collect();
        assert!(caught.len() > 50, "{}", caught.len());
        assert!(caught.iter().all(|&i| rarity(i) <= 2), "{caught:?}");
        // Not hit at all: back in it jumps.
        inst.avatars.get_mut(&1).unwrap().pet_catch = Some(PetCatch {
            due: 0,
            water: (5, 6),
            magnet: false,
            flop: Some(Flop {
                item: 2,
                at: (5, 5),
                until: now,
                hits: 0,
                need: 3,
                reach: 1,
            }),
        });
        inst.pet_catch_tick(now + GRACE_MS + 1);
        assert!(
            inst.avatars[&1]
                .pet_catch
                .as_ref()
                .is_some_and(|c| c.flop.is_none())
        );
    }
}
