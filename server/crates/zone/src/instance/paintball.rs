//! The Splat Yard: paintball, Blue against Red, three a side (bots in the
//! empty places). The match itself is `commons_sim::paintball`; here it's
//! put on the map: the players' own avatars go out onto the field when it
//! starts (their walking held: they move with the match), everyone in the
//! hall gets a `PbState` every tick, a `PbShot` for each shot and a
//! `PbEvent` for each splat, and when it's over they're back by the desk.
//!
//! Out in the city (the yard behind the Splat Yard) it's the same game in
//! the open, fenced round: only those who can see the field are told, and
//! when nobody's playing the bots put on a match of their own that anyone
//! watching can bet on (as at the arena). Someone stepping up to play calls
//! it off (bets handed back) and it's theirs.

use super::Instance;
use crate::econ::CallError;
use commons_protocol::{PbFlag, PbPickup, PbPlayer, PbPoint, ServerMsg, error_code, state};
use commons_sim::TilePos;
use commons_sim::map::MapObject;
use commons_sim::paintball as pb;
use rand::Rng;

/// (The coin's item id.)
const COIN: u32 = 1;
/// A bet on the bots' match, and what a winning one pays (the teams are even).
pub const BET_STAKE: i32 = 10;
pub const BET_PAY: i32 = 20;
/// Bets are open through the countdown and this long into the match.
const BET_OPEN_MS: u32 = 30_000;
/// The field stands empty this long before the bots start another match.
const EXHIBIT_AFTER_MS: u32 = 6000;

/// A spectator's bet: who, on which team, and whether the stake's been taken yet.
#[derive(Debug, Clone)]
struct Bet {
    id: u32,
    player: String,
    pick: u8,
    paid: bool,
}

#[derive(Debug, Clone)]
pub(super) struct Yard {
    m: pb::Match,
    /// The field's top-left corner (map tiles), and its size.
    origin: (u16, u16),
    size: (u16, u16),
    /// Where the players stand when they come off the field (by place).
    desk: Vec<TilePos>,
    /// The lobby changed (sent at once, not every tick).
    dirty: bool,
    /// Out in the city (the bots play when nobody else does; only those near are told).
    outdoor: bool,
    /// The bots' matches: which one this is, bets on it, and when betting closes.
    round: u32,
    bets: Vec<Bet>,
    bet_close: u32,
    /// Nobody's played since: the bots start a match once it's been a while.
    quiet_until: u32,
    /// Every other tick (`pb_send_tick`).
    beat: bool,
}

impl Yard {
    /// Out in the city (not the hall).
    pub(super) fn outdoor(&self) -> bool {
        self.outdoor
    }

    /// The middle of the field (map tiles): where a TV watcher looks on from.
    pub(super) fn middle(&self) -> TilePos {
        (
            self.origin.0 + self.size.0 / 2,
            self.origin.1 + self.size.1 / 2,
        )
    }

    pub(super) fn new(objects: &[MapObject], outdoor: bool) -> Option<Yard> {
        let (field, origin) = pb::Field::from_map(objects)?;
        let size = (field.w as u16, field.h as u16);
        let desk = objects
            .iter()
            .find(|o| o.kind == "pb_desk")
            .map(|d| {
                (0..pb::SLOTS as u16)
                    .map(|k| (d.x + k % d.w.max(1), d.y + d.h))
                    .collect()
            })
            .unwrap_or_else(|| vec![(origin.0, origin.1 + field.h as u16 + 1); pb::SLOTS]);
        Some(Yard {
            m: pb::Match::new(field),
            origin,
            size,
            desk,
            dirty: true,
            outdoor,
            round: 0,
            bets: Vec::new(),
            bet_close: 0,
            beat: false,
            quiet_until: EXHIBIT_AFTER_MS,
        })
    }

    /// How long bets on the bots' match stay open (0: they're closed).
    fn bet_ms(&self, now: u32) -> u32 {
        if self.m.exhibition() && matches!(self.m.status, pb::COUNTDOWN | pb::PLAYING) {
            self.bet_close.saturating_sub(now)
        } else {
            0
        }
    }

    /// The map tile under field point (x, y).
    fn tile(&self, x: f64, y: f64) -> TilePos {
        (
            self.origin.0 + x.max(0.0) as u16,
            self.origin.1 + y.max(0.0) as u16,
        )
    }

    fn state(&self, now: u32) -> ServerMsg {
        let m = &self.m;
        let ms = |t: u32| t.saturating_sub(now).min(65_535) as u16;
        ServerMsg::PbState {
            status: m.status,
            now,
            phase_ms: m.phase_end.saturating_sub(now),
            blue: m.score[0],
            red: m.score[1],
            winner: m.winner,
            slots: m.slots.to_vec(),
            players: m
                .players
                .iter()
                .map(|p| PbPlayer {
                    id: p.id,
                    team: p.team,
                    x: x100(p.x),
                    y: x100(p.y),
                    aim: pb::aim_to_u16(p.aim),
                    hp: p.hp,
                    ammo: p.ammo,
                    flags: p.flags(now),
                    power: if now < p.power_until { p.power } else { 0 },
                    power_ms: ms(p.power_until),
                    respawn_ms: if p.out { ms(p.respawn_at) } else { 0 },
                    dash_ms: ms(p.dash_ready),
                    reload_ms: ms(p.reload_until),
                    kills: p.kills,
                    deaths: p.deaths,
                    streak: p.streak,
                    fix: p.fix,
                    class: p.class,
                })
                .collect(),
            pickups: m
                .pads
                .iter()
                .filter(|p| p.kind != 0)
                .map(|p| PbPickup {
                    kind: p.kind,
                    x: x100(p.x),
                    y: x100(p.y),
                })
                .collect(),
            level: m.level,
            round: self.round,
            exhibit: m.exhibition(),
            bet_ms: self.bet_ms(now).min(65_535) as u16,
            bets: (0..2u8)
                .map(|t| {
                    (self.bets.iter().filter(|b| b.pick == t).count() as i32 * BET_STAKE)
                        .min(65_535) as u16
                })
                .collect(),
            bet_pay: BET_PAY as u16,
            classes: m.slots.iter().map(|&s| m.class_of(s)).collect(),
            mode: m.mode,
            to_win: m.to_win(),
            flags: m
                .flags
                .iter()
                .map(|f| PbFlag {
                    x: x100(f.x),
                    y: x100(f.y),
                    carrier: f.carrier,
                    home: f.is_home(),
                })
                .collect(),
            points: m
                .points
                .iter()
                .map(|p| PbPoint {
                    x: x100(p.x),
                    y: x100(p.y),
                    r: (p.r * 10.0).round() as u8,
                    value: (p.value * 10.0).round() as u8,
                    owner: p.owner,
                    progress: (p.progress + 100.0).round().clamp(0.0, 200.0) as u8,
                })
                .collect(),
            winner_id: m.winner_id,
            giant: m.players.iter().find(|p| p.giant).map_or(0, |p| p.id),
        }
    }
}

fn x100(v: f64) -> u16 {
    (v * 100.0).round().clamp(0.0, 65_535.0) as u16
}

fn from100(v: u16) -> f64 {
    v as f64 / 100.0
}

impl Instance {
    /// Whether `id` is out on the paintball field (they can't walk off it).
    pub(super) fn pb_playing(&self, id: u32) -> bool {
        self.yard.as_ref().is_some_and(|y| y.m.playing(id))
    }

    /// To everyone in the hall (it's all one room); out in the city, to
    /// those who can see the field.
    fn pb_broadcast(&mut self, msg: &ServerMsg, except: Option<u32>) {
        self.pb_tell(msg, except, false);
    }

    /// The same, `near`: only those near enough to see it well (and whoever's in it).
    fn pb_tell(&mut self, msg: &ServerMsg, except: Option<u32>, near: bool) {
        let bytes = msg.to_bytes();
        let Some(y) = &self.yard else { return };
        if !y.outdoor {
            for (id, a) in self.avatars.iter_mut() {
                if Some(*id) != except {
                    a.send(&bytes);
                }
            }
            return;
        }
        let (x0, y0) = y.origin;
        let (x1, y1) = (
            x0 + y.size.0.saturating_sub(1),
            y0 + y.size.1.saturating_sub(1),
        );
        let mut cells: Vec<u16> = Vec::new();
        for ty in [y0, (y0 + y1) / 2, y1] {
            for tx in [x0, (x0 + x1) / 2, x1] {
                cells.push(self.cell_of((tx, ty)));
            }
        }
        cells.sort_unstable();
        cells.dedup();
        let mut to: Vec<u32> = cells
            .iter()
            .flat_map(|&c| self.watchers[c as usize].iter().copied())
            .collect();
        to.sort_unstable();
        to.dedup();
        let area = (x0, y0, y.size.0, y.size.1);
        let playing: Vec<u32> = y.m.players.iter().map(|p| p.id).collect();
        for id in to {
            if near
                && !playing.contains(&id)
                && self
                    .avatars
                    .get(&id)
                    .is_some_and(|a| !a.watching && super::apart(a.tile, area) > super::FIGHT_NEAR)
            {
                continue;
            }
            if Some(id) != except
                && let Some(a) = self.avatars.get_mut(&id)
            {
                a.send(&bytes);
            }
        }
    }

    fn pb_send_state(&mut self, now: u32) {
        let Some(y) = &self.yard else { return };
        let msg = y.state(now);
        self.pb_broadcast(&msg, None);
    }

    /// A tick of a match: to those far off across town, every other one.
    fn pb_send_tick(&mut self, now: u32) {
        let Some(y) = &mut self.yard else { return };
        y.beat = !y.beat;
        let near = y.beat;
        let msg = y.state(now);
        self.pb_tell(&msg, None, near);
    }

    /// A newcomer sees how the yard stands.
    pub(super) fn pb_hello(&mut self, id: u32) {
        let now = self.clock.now_ms();
        if let Some(y) = &self.yard {
            let msg = y.state(now);
            self.send_to(id, &msg);
        }
    }

    /// Puts player `id` on tile `t`: walking stopped, everyone shown.
    fn pb_place(&mut self, id: u32, t: TilePos, now: u32) {
        let Some(a) = self.avatars.get(&id) else {
            return;
        };
        if a.state == state::SITTING {
            self.stand(id, now);
        }
        let Some(a) = self.avatars.get_mut(&id) else {
            return;
        };
        a.motion = None;
        a.pending = None;
        if a.tile != t {
            a.tile = t;
            self.on_tile_changed(id, now);
        }
        let cell = self.avatars[&id].cell;
        self.broadcast(cell, &ServerMsg::Snap { id, x: t.0, y: t.1 }, None);
    }

    /// Everyone on the field to where the match has them.
    fn pb_place_all(&mut self, now: u32) {
        let Some(y) = &self.yard else { return };
        let spots: Vec<(u32, TilePos)> =
            y.m.players
                .iter()
                .filter(|p| !p.bot)
                .map(|p| (p.id, y.tile(p.x, p.y)))
                .collect();
        for (id, t) in spots {
            self.pb_place(id, t, now);
        }
    }

    /// `id` back by the desk (off the field).
    fn pb_to_desk(&mut self, id: u32, slot: usize, now: u32) {
        let Some(y) = &self.yard else { return };
        let t = y.desk[slot % y.desk.len()];
        self.pb_place(id, t, now);
    }

    pub(super) fn pb_join(&mut self, id: u32, team: u8, now: u32) {
        let Some(y) = self.yard.as_mut() else { return };
        // The bots' match: called off (bets handed back), the field's yours.
        if y.m.exhibition() && !y.m.playing(id) {
            y.m.call_off();
            y.dirty = true;
            self.pb_settle(None);
        }
        let Some(y) = self.yard.as_mut() else { return };
        y.quiet_until = now + EXHIBIT_AFTER_MS;
        // (A bot playing as a player: the server plays its seat.)
        if self.avatars.get(&id).is_some_and(|a| a.bot) && !y.m.pilots.contains(&id) {
            y.m.pilots.push(id);
        }
        let was_playing = y.m.playing(id);
        if !y.m.join(id, team, now) {
            self.error(
                id,
                commons_protocol::error_code::BAD_MESSAGE,
                "both teams are full",
            );
            return;
        }
        y.dirty = true;
        // Dropped into a match in progress: straight out to their base.
        if !was_playing && y.m.playing(id) {
            let t = y.m.player(id).map(|p| y.tile(p.x, p.y));
            if let Some(t) = t {
                self.pb_place(id, t, now);
            }
        }
        self.pb_send_state(now);
    }

    pub(super) fn pb_leave(&mut self, id: u32) {
        let now = self.clock.now_ms();
        let Some(y) = self.yard.as_mut() else { return };
        let Some(slot) = y.m.slot_of(id) else { return };
        let was_playing = y.m.playing(id);
        let was_on = y.m.status != pb::LOBBY;
        y.m.leave(id, now);
        y.dirty = true;
        let called_off = was_on && y.m.status == pb::LOBBY;
        if was_playing && self.avatars.contains_key(&id) {
            self.pb_to_desk(id, slot, now);
        }
        if called_off {
            self.pb_all_to_desk(now);
        }
        self.pb_send_state(now);
    }

    /// Everyone with a place, back off the field.
    fn pb_all_to_desk(&mut self, now: u32) {
        let Some(y) = &self.yard else { return };
        let ids: Vec<(u32, usize)> =
            y.m.slots
                .iter()
                .enumerate()
                .filter(|(_, s)| **s != 0 && !pb::is_bot(**s))
                .map(|(k, &s)| (s, k))
                .collect();
        for (id, k) in ids {
            self.pb_to_desk(id, k, now);
        }
    }

    pub(super) fn pb_start(&mut self, id: u32, bots: bool, now: u32) {
        let Some(y) = self.yard.as_mut() else { return };
        if !y.m.start(id, bots, now) {
            self.error(
                id,
                commons_protocol::error_code::BAD_MESSAGE,
                "each side needs a player (or fill with bots)",
            );
            return;
        }
        y.dirty = true;
        self.pb_place_all(now);
        self.pb_send_state(now);
    }

    pub(super) fn pb_bot(&mut self, id: u32, slot: u8, on: bool, now: u32) {
        let Some(y) = self.yard.as_mut() else { return };
        if y.m.set_bot(id, slot as usize, on) {
            y.dirty = true;
            self.pb_send_state(now);
        }
    }

    pub(super) fn pb_level(&mut self, id: u32, level: u8, now: u32) {
        let Some(y) = self.yard.as_mut() else { return };
        if y.m.set_level(id, level) {
            y.dirty = true;
            self.pb_send_state(now);
        }
    }

    pub(super) fn pb_mode(&mut self, id: u32, mode: u8, now: u32) {
        let Some(y) = self.yard.as_mut() else { return };
        if y.m.set_mode(id, mode) {
            y.dirty = true;
            self.pb_send_state(now);
        }
    }

    pub(super) fn pb_class(&mut self, id: u32, class: u8, now: u32) {
        let Some(y) = self.yard.as_mut() else { return };
        if y.m.pick_class(id, class) {
            y.dirty = true;
            self.pb_send_state(now);
        }
    }

    pub(super) fn pb_move(&mut self, id: u32, x: u16, y: u16, aim: u16, now: u32) {
        let Some(yd) = self.yard.as_mut() else { return };
        yd.m.claim_move(id, from100(x), from100(y), pb::aim_from_u16(aim), now);
    }

    pub(super) fn pb_fire(&mut self, id: u32, shot: u16, x: u16, y: u16, aim: u16, now: u32) {
        let Some(yd) = self.yard.as_mut() else { return };
        if let Some(s) =
            yd.m.fire(id, shot, from100(x), from100(y), pb::aim_from_u16(aim), now)
        {
            let msg = shot_msg(&s);
            // The shooter already flies their own.
            self.pb_broadcast(&msg, Some(id));
        }
    }

    pub(super) fn pb_dash(&mut self, id: u32, now: u32) {
        let Some(yd) = self.yard.as_mut() else { return };
        if let Some(e) = yd.m.dash(id, now) {
            self.pb_broadcast(&event_msg(&e), Some(id));
        }
    }

    pub(super) fn pb_reload(&mut self, id: u32, now: u32) {
        let Some(yd) = self.yard.as_mut() else { return };
        if let Some(e) = yd.m.reload(id, now) {
            self.pb_broadcast(&event_msg(&e), None);
        }
    }

    /// A tick of the match: everything moves on, the avatars stand where
    /// their players are, and everyone's told.
    pub(super) fn pb_tick(&mut self, now: u32) {
        let Some(y) = self.yard.as_mut() else { return };
        let before = y.m.status;
        // Out in the city, nobody's played for a while: the bots put on a match.
        if before == pb::LOBBY
            && y.outdoor
            && y.m.humans() == 0
            && now >= y.quiet_until
            && y.m.exhibit(now)
        {
            y.round += 1;
            y.bets.clear();
            y.bet_close = now + pb::COUNTDOWN_MS + BET_OPEN_MS;
            self.pb_send_state(now);
            return;
        }
        if before == pb::LOBBY {
            // (Someone's in the lobby: no bots' match for a while yet.)
            if y.m.humans() > 0 {
                y.quiet_until = now + EXHIBIT_AFTER_MS;
            }
            if y.dirty {
                y.dirty = false;
                self.pb_send_state(now);
            }
            return;
        }
        let exhibit = y.m.exhibition();
        let mut rng = rand::rng();
        let (evs, shots) = y.m.step(now, 100, &mut || rng.random::<f64>());
        let after = y.m.status;
        // The avatars stand where their players are (so the cells know).
        let spots: Vec<(u32, TilePos)> =
            y.m.players
                .iter()
                .filter(|p| !p.bot)
                .map(|p| (p.id, y.tile(p.x, p.y)))
                .collect();
        for (id, t) in spots {
            if let Some(a) = self.avatars.get_mut(&id)
                && a.tile != t
            {
                a.tile = t;
                self.on_tile_changed(id, now);
            }
        }
        for s in &shots {
            self.pb_broadcast(&shot_msg(s), None);
        }
        for e in &evs {
            self.pb_broadcast(&event_msg(e), None);
        }
        // The bots' match decided: the bets settled.
        if exhibit && after == pb::OVER && before != pb::OVER {
            let w = self.yard.as_ref().map_or(2, |y| y.m.winner);
            self.pb_settle((w < 2).then_some(w));
        }
        // The match won: a win for everyone on the winning side (people, not bots).
        if after == pb::OVER && before != pb::OVER {
            let won: Vec<u32> = self.yard.as_ref().map_or(vec![], |y| {
                y.m.players
                    .iter()
                    .filter(|p| {
                        !p.bot
                            && if y.m.mode == pb::mode::FFA {
                                p.id == y.m.winner_id
                            } else {
                                p.team == y.m.winner
                            }
                    })
                    .map(|p| p.id)
                    .collect()
            });
            for id in won {
                self.count_stat(id, "paintball_wins");
            }
        }
        if before != pb::LOBBY && after == pb::LOBBY {
            self.pb_all_to_desk(now);
            if let Some(y) = self.yard.as_mut() {
                y.quiet_until = now + EXHIBIT_AFTER_MS;
            }
        }
        // (A change of stage goes to everyone at once.)
        if after == before {
            self.pb_send_tick(now);
        } else {
            self.pb_send_state(now);
        }
    }

    /// A bet on the bots' match (`pick`: the team): the stake taken, or told why not.
    pub(super) fn pb_bet(&mut self, id: u32, pick: u8, now: u32) {
        let Some(a) = self.avatars.get_mut(&id) else {
            return;
        };
        if !a.emote_rl.try_take(now as u64) {
            return;
        }
        let (player, minor) = (a.player_id.clone(), a.minor);
        let Some(y) = self.yard.as_ref() else { return };
        // (Betting's kept from under-18s, as the casino is.)
        if minor && !commons_common::config::env_or("COMMONS_CASINO_MINORS", false) {
            return self.error(id, error_code::NOT_ALLOWED, "betting's for grown-ups");
        }
        if y.bet_ms(now) == 0 {
            return self.error(
                id,
                error_code::NOT_ALLOWED,
                "bets are closed for this match",
            );
        }
        if pick > 1 || y.bets.iter().any(|b| b.id == id) {
            return;
        }
        let Some(econ) = self.economy.clone() else {
            return self.error(id, error_code::UNAVAILABLE, "the bookie's away just now");
        };
        if let Some(y) = self.yard.as_mut() {
            y.bets.push(Bet {
                id,
                player: player.clone(),
                pick,
                paid: false,
            });
            y.dirty = true;
        }
        let key = self.next_key("pb_bet");
        let who = player.clone();
        self.spawn_call(
            async move { econ.grant(&who, COIN, -BET_STAKE, "pb_bet", &key).await },
            move |inst, result| {
                let bet = inst
                    .yard
                    .as_mut()
                    .and_then(|y| y.bets.iter_mut().find(|b| b.id == id));
                match (result, bet) {
                    (Ok(applied), Some(b)) => {
                        b.paid = true;
                        if inst.avatars.contains_key(&id) {
                            inst.send_granted(id, &applied);
                            inst.send_to(
                                id,
                                &ServerMsg::PbBetPlaced {
                                    pick,
                                    pays: BET_PAY as u16,
                                },
                            );
                        }
                    }
                    // (The match was over before the till rang: it's handed straight back.)
                    (Ok(applied), None) => {
                        if inst.avatars.contains_key(&id) {
                            inst.send_granted(id, &applied);
                        }
                        inst.pb_pay(id, player, BET_STAKE, true);
                    }
                    (Err(e), _) => {
                        if let Some(y) = inst.yard.as_mut() {
                            y.bets.retain(|b| b.id != id);
                        }
                        let (code, msg) = match e {
                            CallError::Rejected(_) => {
                                (error_code::NOT_ALLOWED, "not enough coins for a bet")
                            }
                            CallError::Unavailable => {
                                (error_code::UNAVAILABLE, "the bookie's busy; try again")
                            }
                        };
                        inst.error(id, code, msg);
                    }
                }
            },
        );
    }

    /// The bots' match decided (`team`: who won; none: a draw, or called
    /// off): winning bets paid, stakes handed back, the rest told.
    fn pb_settle(&mut self, team: Option<u8>) {
        let Some(y) = self.yard.as_mut() else { return };
        let bets = std::mem::take(&mut y.bets);
        for b in bets {
            if !b.paid {
                continue;
            }
            match team {
                None => self.pb_pay(b.id, b.player, BET_STAKE, true),
                Some(t) if t == b.pick => self.pb_pay(b.id, b.player, BET_PAY, false),
                Some(_) => self.send_to(
                    b.id,
                    &ServerMsg::PbBetSettled {
                        coins: 0,
                        refund: false,
                    },
                ),
            }
        }
    }

    /// Coins to a spectator (wherever they've got to: it's theirs).
    fn pb_pay(&mut self, id: u32, player: String, coins: i32, refund: bool) {
        let Some(econ) = self.economy.clone() else {
            return;
        };
        let reason = if refund { "pb_bet_back" } else { "pb_bet_won" };
        let key = self.next_key("pb_bet_pay");
        self.spawn_call(
            async move { econ.grant(&player, COIN, coins, reason, &key).await },
            move |inst, result| match result {
                Ok(applied) if inst.avatars.contains_key(&id) => {
                    inst.send_granted(id, &applied);
                    inst.send_to(
                        id,
                        &ServerMsg::PbBetSettled {
                            coins: coins as u16,
                            refund,
                        },
                    );
                }
                Ok(_) => {}
                Err(e) => tracing::warn!(?e, coins, "paintball bet: couldn't pay out"),
            },
        );
    }
}

fn shot_msg(s: &pb::Shot) -> ServerMsg {
    ServerMsg::PbShot {
        by: s.by,
        shot: s.n,
        x: x100(s.x),
        y: x100(s.y),
        aim: pb::aim_to_u16(s.aim),
        kind: s.kind,
    }
}

fn event_msg(e: &pb::Event) -> ServerMsg {
    ServerMsg::PbEvent {
        kind: e.kind,
        a: e.a,
        b: e.b,
        x: x100(e.x),
        y: x100(e.y),
        n: e.n,
    }
}

#[cfg(test)]
mod tests {
    use crate::instance::Cmd;
    use crate::instance::tests::*;
    use crate::registry::ZoneDef;
    use commons_protocol::{ClientMsg, ServerMsg};
    use commons_sim::map::MapObject;
    use commons_sim::paintball as pb;
    use std::sync::Arc;

    fn yard() -> crate::instance::Instance {
        yard_in("paintball")
    }

    fn yard_in(zone: &str) -> crate::instance::Instance {
        let mut m = map(30, 30);
        let o = |kind: &str, x, y, w, h, label: Option<&str>| MapObject {
            kind: kind.into(),
            x,
            y,
            w,
            h,
            label: label.map(Into::into),
        };
        m.objects = vec![
            o("pb_field", 2, 2, 20, 12, None),
            o("pb_hay", 10, 6, 1, 2, None),
            o("pb_spawn", 3, 7, 1, 1, Some("blue")),
            o("pb_spawn", 20, 7, 1, 1, Some("red")),
            o("pb_pad", 11, 3, 1, 1, None),
            o("pb_desk", 10, 20, 6, 1, None),
        ];
        instance_for(Arc::new(ZoneDef::new(zone.into(), m, None)))
    }

    fn send(inst: &mut crate::instance::Instance, conn: u64, msg: ClientMsg) {
        inst.handle(Cmd::Msg { conn, msg });
    }

    fn last_state(c: &Client) -> Option<(u8, Vec<u32>)> {
        c.log.iter().rev().find_map(|m| match m {
            ServerMsg::PbState { status, slots, .. } => Some((*status, slots.clone())),
            _ => None,
        })
    }

    #[test]
    fn a_tv_on_the_paintball_channel_watches_the_yard_unseen() {
        let mut inst = yard_in("city");
        let mut a = connect(&mut inst, 1, "a", (12, 18));
        let mut tv = claims("tv");
        tv.watch = true;
        tv.channel = 1;
        let mut w = connect_with(&mut inst, 2, tv, (12, 18));
        // Over the middle of the field, not walking, not talking.
        assert_eq!(inst.avatars[&2].tile, (12, 8));
        send(
            &mut inst,
            2,
            ClientMsg::MoveTo {
                x: 3,
                y: 3,
                sprint: false,
            },
        );
        send(&mut inst, 2, ClientMsg::PbJoin { team: 0 });
        // The bots' match comes on: they see it, and can bet on it; nobody sees them.
        let now = inst.clock.now_ms();
        inst.pb_tick(now + 7000);
        inst.flush();
        a.pump();
        w.pump();
        assert!(last_state(&w).is_some_and(|(s, _)| s == pb::COUNTDOWN));
        assert!(inst.avatars[&2].motion.is_none());
        assert!(!a.known.contains(&2));
        assert!(
            inst.yard.as_ref().unwrap().m.slot_of(2).is_none(),
            "watching, not playing"
        );
        // A bet from the sofa is taken to the bookie (not ignored, as a TV watcher's
        // other messages are; there's no bank in a test, so the bookie's away).
        send(&mut inst, 2, ClientMsg::PbBet { pick: 1 });
        inst.flush();
        w.pump();
        assert!(
            w.log
                .iter()
                .any(|m| matches!(m, ServerMsg::PbBetPlaced { .. } | ServerMsg::Error { .. }))
        );
    }

    #[test]
    fn outdoors_the_bots_play_when_nobody_does_till_someone_steps_up() {
        let mut inst = yard_in("city");
        let mut a = connect(&mut inst, 1, "a", (12, 18));
        let now = inst.clock.now_ms();
        // A while with nobody playing: the bots put on a match, open for bets.
        inst.pb_tick(now + 7000);
        inst.flush();
        a.pump();
        let (status, slots) = last_state(&a).unwrap();
        assert_eq!(status, pb::COUNTDOWN);
        assert!(slots.iter().all(|&s| pb::is_bot(s)));
        assert!(
            a.log.iter().any(
                |m| matches!(m, ServerMsg::PbState { exhibit: true, bet_ms, .. } if *bet_ms > 0)
            )
        );
        // Someone steps up: it's called off, and the field's theirs (bots to take on, in the lobby).
        send(&mut inst, 1, ClientMsg::PbJoin { team: 0 });
        inst.flush();
        a.pump();
        let (status, slots) = last_state(&a).unwrap();
        assert_eq!(status, pb::LOBBY);
        assert_eq!(slots[0], 1);
        // In the hall, the bots never start one on their own.
        let mut hall = yard();
        let mut b = connect(&mut hall, 1, "b", (12, 25));
        let now = hall.clock.now_ms();
        hall.pb_tick(now + 60_000);
        hall.flush();
        b.pump();
        assert_eq!(last_state(&b).map(|s| s.0), Some(pb::LOBBY));
    }

    #[test]
    fn a_match_with_bots_runs_and_players_go_out_and_back() {
        let mut inst = yard();
        let mut a = connect(&mut inst, 1, "a", (12, 25));
        let _b = connect(&mut inst, 2, "b", (13, 25));
        send(&mut inst, 1, ClientMsg::PbJoin { team: 0 });
        send(&mut inst, 2, ClientMsg::PbJoin { team: 1 });
        send(&mut inst, 1, ClientMsg::PbStart { bots: true });
        inst.flush();
        a.pump();
        let (status, slots) = last_state(&a).unwrap();
        assert_eq!(status, pb::COUNTDOWN);
        assert_eq!(slots[0], 1);
        assert_eq!(slots[3], 2);
        assert!(slots.iter().filter(|&&s| pb::is_bot(s)).count() == 4);
        // Out on the field, at their bases; no walking off.
        let t = inst.avatars[&1].tile;
        assert_eq!(t, (3, 7));
        send(
            &mut inst,
            1,
            ClientMsg::MoveTo {
                x: 12,
                y: 25,
                sprint: false,
            },
        );
        assert!(inst.avatars[&1].motion.is_none());
        let now = inst.clock.now_ms();
        for k in 1..=40 {
            inst.pb_tick(now + k * 100);
        }
        // Moving and firing.
        let at = now + 4100;
        send(
            &mut inst,
            1,
            ClientMsg::PbMove {
                x: 250,
                y: 560,
                aim: 0,
            },
        );
        send(
            &mut inst,
            1,
            ClientMsg::PbFire {
                shot: 1,
                x: 250,
                y: 560,
                aim: 0,
            },
        );
        let _ = at;
        for k in 41..=80 {
            inst.pb_tick(now + k * 100);
        }
        inst.flush();
        a.pump();
        assert!(
            a.log.iter().any(|m| matches!(m, ServerMsg::PbShot { .. })),
            "shots are seen"
        );
        assert_eq!(last_state(&a).unwrap().0, pb::PLAYING);
        // b leaves: a bot takes the place; b's back by the desk.
        send(&mut inst, 2, ClientMsg::PbLeave {});
        inst.flush();
        a.pump();
        let (_, slots) = last_state(&a).unwrap();
        assert!(pb::is_bot(slots[3]));
        assert_eq!(inst.avatars[&2].tile.1, 21);
        // a leaves too: nobody left, it's called off.
        send(&mut inst, 1, ClientMsg::PbLeave {});
        inst.flush();
        a.pump();
        assert_eq!(last_state(&a).unwrap().0, pb::LOBBY);
    }
}
