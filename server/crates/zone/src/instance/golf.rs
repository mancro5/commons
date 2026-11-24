//! Mini golf: the Fairground's nine holes (mapgen's `minigolf` marker). The
//! putting itself, the ball rolling, is each player's own client's
//! (`client/src/activities/golfsim.ts`); here each ball's whereabouts are
//! passed on to everyone who can see it, and the day's best rounds kept.
//! And 1v1s: two players round the nine turn about, both balls on the green
//! at once (the one putting rolls them both, so it can knock the other's);
//! here whose turn it is, the strokes, and who won. Or you against the golf
//! bot (`golf::BOT`): the same round, its putts played by your client.

use super::Instance;
use commons_protocol::{GolfDuelBall, ServerMsg, SkateEntry, error_code, golf};
use commons_sim::map::MapObject;

/// The course, and today's best rounds (a player's best only).
pub(super) struct Course {
    /// Its bounds (world px), with a little room round it.
    x0: u32,
    y0: u32,
    x1: u32,
    y1: u32,
    day: u64,
    /// (Player, name, strokes), fewest first.
    rounds: Vec<(String, String, u32)>,
    duels: Vec<Duel>,
    /// Whoever's waiting for someone to take them on (`GolfDuelSeek`).
    waiting: Option<u32>,
}

/// A 1v1 round: `a` asked (red), `b` (blue). Balls in the hole's own px;
/// `golf::NONE`: still on the tee (where that is, the clients know).
struct Duel {
    a: u32,
    b: u32,
    hole: u8,
    turn: u32,
    balls: [GolfDuelBall; 2],
    strokes: [[u8; golf::HOLES]; 2],
    /// When a putt rolling was last passed on (ms): not every frame.
    rolled: u32,
}

impl Duel {
    /// Who's putting now, if `id` may: your own turn, or (against the bot) its
    /// turn, putted for it by your client.
    fn putter(&self, id: u32) -> Option<usize> {
        if self.turn == id {
            self.side(id)
        } else if self.b == golf::BOT && self.turn == golf::BOT && self.a == id {
            Some(1)
        } else {
            None
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

    fn id(&self, side: usize) -> u32 {
        if side == 0 { self.a } else { self.b }
    }

    /// Done with this hole: in, or out of strokes (picked up).
    fn through(&self, side: usize) -> bool {
        self.balls[side].state == golf::HOLED
            || self.strokes[side][self.hole as usize - 1] >= golf::MAX_STROKES
    }

    fn msg(&self, over: bool, winner: u32) -> ServerMsg {
        ServerMsg::GolfDuel {
            a: self.a,
            b: self.b,
            hole: self.hole,
            turn: self.turn,
            balls: self.balls.to_vec(),
            strokes: self.strokes.concat(),
            over,
            winner,
        }
    }

    /// A putt played out (`side`'s): its stroke, then whose turn, or on to the
    /// next hole (whoever did it in fewer goes first), or the round's over:
    /// Some(the winner; 0, a draw).
    fn putted(&mut self, side: usize, balls: [GolfDuelBall; 2], penalty: u8) -> Option<u32> {
        let h = self.hole as usize - 1;
        self.strokes[side][h] = (self.strokes[side][h] + 1 + penalty).min(golf::MAX_STROKES);
        self.balls = balls;
        let other = 1 - side;
        if !(self.through(0) && self.through(1)) {
            // Turn about, unless they're through (then you play on).
            self.turn = if self.through(other) {
                self.id(side)
            } else {
                self.id(other)
            };
            return None;
        }
        if (self.hole as usize) < golf::HOLES {
            let (sa, sb) = (self.strokes[0][h], self.strokes[1][h]);
            self.turn = match sa.cmp(&sb) {
                std::cmp::Ordering::Less => self.a,
                std::cmp::Ordering::Greater => self.b,
                std::cmp::Ordering::Equal => self.id(other),
            };
            self.hole += 1;
            self.balls = [tee_ball(), tee_ball()];
            return None;
        }
        let total = |s: usize| self.strokes[s].iter().map(|&n| n as u32).sum::<u32>();
        Some(match total(0).cmp(&total(1)) {
            std::cmp::Ordering::Less => self.a,
            std::cmp::Ordering::Greater => self.b,
            std::cmp::Ordering::Equal => 0,
        })
    }
}

fn tee_ball() -> GolfDuelBall {
    GolfDuelBall {
        x: 0,
        y: 0,
        state: golf::NONE,
    }
}

/// How many of the day's best are kept.
const BOARD: usize = 10;

impl Course {
    pub(super) fn new(objects: &[MapObject]) -> Option<Course> {
        let o = objects.iter().find(|o| o.kind == "minigolf")?;
        let t = 32u32;
        Some(Course {
            x0: (o.x as u32).saturating_sub(2) * t,
            y0: (o.y as u32).saturating_sub(2) * t,
            x1: (o.x as u32 + o.w as u32 + 2) * t,
            y1: (o.y as u32 + o.h as u32 + 2) * t,
            day: 0,
            rounds: vec![],
            duels: vec![],
            waiting: None,
        })
    }

    fn board(&mut self) -> ServerMsg {
        let day = today();
        if self.day != day {
            self.day = day;
            self.rounds.clear();
        }
        ServerMsg::GolfBoard {
            rounds: self
                .rounds
                .iter()
                .map(|(_, name, n)| SkateEntry {
                    name: name.clone(),
                    points: *n,
                })
                .collect(),
        }
    }
}

fn today() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() / 86_400)
        .unwrap_or(0)
}

impl Instance {
    /// `id`'s ball, where it is: passed on to everyone about (on the course only).
    #[allow(clippy::too_many_arguments)]
    pub(super) fn golf_ball(
        &mut self,
        id: u32,
        hole: u8,
        x: u16,
        y: u16,
        strokes: u8,
        state: u8,
        now: u32,
    ) {
        let Some(c) = &self.golf else { return };
        if hole == 0 || hole as usize > golf::HOLES || state > golf::HOLED {
            return;
        }
        let (px, py) = (x as u32, y as u32);
        if state != golf::NONE && (px < c.x0 || px >= c.x1 || py < c.y0 || py >= c.y1) {
            return;
        }
        let Some(a) = self.avatars.get_mut(&id) else {
            return;
        };
        if !a.play_rl.try_take(now as u64) {
            return;
        }
        let cell = a.cell;
        let strokes = strokes.min(golf::MAX_STROKES);
        self.broadcast(
            cell,
            &ServerMsg::GolfBall {
                id,
                hole,
                x,
                y,
                strokes,
                state,
            },
            Some(id),
        );
    }

    /// A round played out: on today's board if it's one of the best (your best only).
    pub(super) fn golf_card(&mut self, id: u32, strokes: Vec<u8>) {
        if strokes.len() != golf::HOLES || strokes.iter().any(|&s| s == 0 || s > golf::MAX_STROKES)
        {
            return;
        }
        let Some(a) = self.avatars.get(&id) else {
            return;
        };
        let (player, name) = (a.player_id.clone(), a.name.clone());
        let total: u32 = strokes.iter().map(|&s| s as u32).sum();
        let Some(c) = self.golf.as_mut() else { return };
        let _ = c.board();
        match c.rounds.iter_mut().find(|r| r.0 == player) {
            Some(r) if r.2 <= total => {}
            Some(r) => r.2 = total,
            None => c.rounds.push((player, name, total)),
        }
        c.rounds.sort_by_key(|r| r.2);
        c.rounds.truncate(BOARD);
        let msg = c.board();
        self.send_to(id, &msg);
    }

    /// Whether `id` is at the course (or just by it).
    fn on_course(&self, id: u32) -> bool {
        let Some(c) = &self.golf else { return false };
        self.avatars.get(&id).is_some_and(|v| {
            let (x, y) = (v.tile.0 as u32 * 32, v.tile.1 as u32 * 32);
            x >= c.x0 && x < c.x1 && y >= c.y0 && y < c.y1
        })
    }

    /// Who's waiting for a 1v1, to everyone at the course (and `also`, wherever they are).
    fn golf_seeking_tell(&mut self, also: Option<u32>) {
        let Some(c) = &self.golf else { return };
        let msg = ServerMsg::GolfSeeking {
            id: c.waiting.unwrap_or(0),
        };
        let mut to: Vec<u32> = self
            .avatars
            .keys()
            .copied()
            .filter(|&id| self.on_course(id))
            .collect();
        if let Some(a) = also
            && !to.contains(&a)
        {
            to.push(a);
        }
        for id in to {
            self.send_to(id, &msg);
        }
    }

    /// `id` isn't waiting for a 1v1 any more (into one, gone, or changed their mind).
    fn golf_unwait(&mut self, id: u32) {
        let Some(c) = self.golf.as_mut() else { return };
        if c.waiting == Some(id) {
            c.waiting = None;
            self.golf_seeking_tell(Some(id));
        }
    }

    /// `id` wants a 1v1 against whoever comes (`on`), or doesn't any more: with
    /// someone waiting (still here, not in a round), into it with them, them first;
    /// else `id` waits.
    pub(super) fn golf_duel_seek(&mut self, id: u32, on: bool) {
        if !on {
            return self.golf_unwait(id);
        }
        let Some(c) = &self.golf else { return };
        if !self.on_course(id) {
            return self.error(
                id,
                error_code::NOT_ALLOWED,
                "come to the mini golf for a 1v1",
            );
        }
        if c.duels.iter().any(|d| d.side(id).is_some()) {
            return self.error(
                id,
                error_code::NOT_ALLOWED,
                "finish the round you're in first",
            );
        }
        let other = c.waiting.filter(|&w| {
            w != id && self.on_course(w) && !c.duels.iter().any(|d| d.side(w).is_some())
        });
        match other {
            Some(w) => {
                if let Some(c) = self.golf.as_mut() {
                    c.waiting = None;
                }
                self.golf_seeking_tell(Some(id));
                self.golf_duel_start(w, id);
            }
            None => {
                if let Some(c) = self.golf.as_mut() {
                    c.waiting = Some(id);
                }
                self.golf_seeking_tell(Some(id));
            }
        }
    }

    /// `a` asked `b` for a 1v1 and they said yes: hole 1, `a` first.
    pub(super) fn golf_duel_start(&mut self, a: u32, b: u32) {
        let Some(c) = &self.golf else { return };
        let on = |id: u32| {
            self.avatars.get(&id).is_some_and(|v| {
                let (x, y) = (v.tile.0 as u32 * 32, v.tile.1 as u32 * 32);
                x >= c.x0 && x < c.x1 && y >= c.y0 && y < c.y1
            })
        };
        if !on(a) || !on(b) {
            return self.error(
                b,
                error_code::NOT_ALLOWED,
                "meet at the mini golf for a 1v1",
            );
        }
        if c.duels
            .iter()
            .any(|d| d.side(a).is_some() || d.side(b).is_some())
        {
            return self.error(
                b,
                error_code::NOT_ALLOWED,
                "finish the round you're in first",
            );
        }
        let d = Duel {
            a,
            b,
            hole: 1,
            turn: a,
            balls: [tee_ball(), tee_ball()],
            strokes: [[0; golf::HOLES]; 2],
            rolled: 0,
        };
        let msg = d.msg(false, 0);
        if let Some(c) = self.golf.as_mut() {
            c.duels.push(d);
        }
        self.send_to(a, &msg);
        self.send_to(b, &msg);
        self.golf_unwait(a);
        self.golf_unwait(b);
    }

    /// `a` takes on the golf bot: hole 1, `a` first (on the course, and not in a round already).
    pub(super) fn golf_duel_bot(&mut self, a: u32) {
        let Some(c) = &self.golf else { return };
        let on = self.avatars.get(&a).is_some_and(|v| {
            let (x, y) = (v.tile.0 as u32 * 32, v.tile.1 as u32 * 32);
            x >= c.x0 && x < c.x1 && y >= c.y0 && y < c.y1
        });
        if !on {
            return self.error(
                a,
                error_code::NOT_ALLOWED,
                "meet the golf bot at the mini golf",
            );
        }
        if c.duels.iter().any(|d| d.side(a).is_some()) {
            return self.error(
                a,
                error_code::NOT_ALLOWED,
                "finish the round you're in first",
            );
        }
        let d = Duel {
            a,
            b: golf::BOT,
            hole: 1,
            turn: a,
            balls: [tee_ball(), tee_ball()],
            strokes: [[0; golf::HOLES]; 2],
            rolled: 0,
        };
        let msg = d.msg(false, 0);
        if let Some(c) = self.golf.as_mut() {
            c.duels.push(d);
        }
        self.send_to(a, &msg);
        self.golf_unwait(a);
    }

    /// `id`'s putt in their 1v1: rolling (passed on to the other), or played out.
    pub(super) fn golf_duel_shot(
        &mut self,
        id: u32,
        balls: Vec<GolfDuelBall>,
        done: bool,
        penalty: u8,
        now: u32,
    ) {
        let Some(c) = self.golf.as_mut() else { return };
        let Some(i) = c.duels.iter().position(|d| d.side(id).is_some()) else {
            return;
        };
        let Ok(balls) = <[GolfDuelBall; 2]>::try_from(balls) else {
            return;
        };
        let d = &mut c.duels[i];
        let Some(side) = d.putter(id) else { return };
        if balls.iter().any(|b| b.state > golf::HOLED) {
            return;
        }
        let other = d.id(1 - side);
        if !done {
            // (The bot's putt rolling is its opponent's own doing: nobody else to show.)
            if other == id || other == golf::BOT {
                return;
            }
            if now.saturating_sub(d.rolled) < 60 {
                return;
            }
            d.rolled = now;
            return self.send_to(
                other,
                &ServerMsg::GolfDuelRoll {
                    balls: balls.to_vec(),
                },
            );
        }
        // (Played out: nothing still rolling.)
        if balls.iter().any(|b| b.state == golf::ROLLING) {
            return;
        }
        let won = d.putted(side, balls, penalty.min(2));
        let msg = d.msg(won.is_some(), won.unwrap_or(0));
        let (a, b) = (d.a, d.b);
        if won.is_some() {
            c.duels.remove(i);
        }
        self.send_to(a, &msg);
        self.send_to(b, &msg);
    }

    /// `id`'s out of their 1v1 (left it, or gone): it's the other's.
    pub(super) fn golf_duel_leave(&mut self, id: u32) {
        self.golf_unwait(id);
        let Some(c) = self.golf.as_mut() else { return };
        let Some(i) = c.duels.iter().position(|d| d.side(id).is_some()) else {
            return;
        };
        let d = c.duels.remove(i);
        let winner = if d.a == id { d.b } else { d.a };
        let msg = d.msg(true, winner);
        self.send_to(d.a, &msg);
        self.send_to(d.b, &msg);
    }

    /// Today's best rounds, to `id`.
    pub(super) fn golf_board(&mut self, id: u32) {
        let Some(c) = self.golf.as_mut() else { return };
        let msg = c.board();
        let seeking = ServerMsg::GolfSeeking {
            id: c.waiting.unwrap_or(0),
        };
        self.send_to(id, &msg);
        self.send_to(id, &seeking);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn course() -> Course {
        Course::new(&[MapObject {
            kind: "minigolf".into(),
            x: 10,
            y: 10,
            w: 42,
            h: 31,
            label: None,
        }])
        .unwrap()
    }

    fn ball(state: u8) -> GolfDuelBall {
        GolfDuelBall { x: 5, y: 5, state }
    }

    #[test]
    fn a_duel_goes_turn_about_and_the_better_on_a_hole_goes_first_on_the_next() {
        let mut d = Duel {
            a: 1,
            b: 2,
            hole: 1,
            turn: 1,
            balls: [tee_ball(), tee_ball()],
            strokes: [[0; golf::HOLES]; 2],
            rolled: 0,
        };
        // a putts: b's turn; b putts: a's.
        assert_eq!(d.putted(0, [ball(golf::REST), tee_ball()], 0), None);
        assert_eq!(d.turn, 2);
        assert_eq!(d.putted(1, [ball(golf::REST), ball(golf::REST)], 0), None);
        assert_eq!(d.turn, 1);
        // a holes out: b plays on alone (a stroke on for the water).
        assert_eq!(d.putted(0, [ball(golf::HOLED), ball(golf::REST)], 0), None);
        assert_eq!(d.turn, 2);
        assert_eq!(d.putted(1, [ball(golf::HOLED), ball(golf::REST)], 1), None);
        assert_eq!(d.turn, 2);
        // b's in too: hole 2, a first (2 strokes to b's 4), balls back on the tee.
        assert_eq!(d.putted(1, [ball(golf::HOLED), ball(golf::HOLED)], 0), None);
        assert_eq!((d.hole, d.turn), (2, 1));
        assert_eq!((d.strokes[0][0], d.strokes[1][0]), (2, 4));
        assert!(d.balls.iter().all(|b| b.state == golf::NONE));
        // Out of strokes is through (picked up): the other plays on.
        d.strokes[1][1] = golf::MAX_STROKES - 1;
        d.turn = 2;
        assert_eq!(d.putted(1, [tee_ball(), ball(golf::REST)], 0), None);
        assert!(d.through(1));
        assert_eq!(d.turn, 1);
        // The last hole: fewer in all wins.
        d.hole = golf::HOLES as u8;
        d.strokes[0][golf::HOLES - 1] = 1;
        let won = d.putted(0, [ball(golf::HOLED), ball(golf::HOLED)], 0);
        assert_eq!(won, Some(1));
    }

    #[test]
    fn against_the_bot_its_opponent_putts_for_it_on_its_turn() {
        let mut d = Duel {
            a: 7,
            b: golf::BOT,
            hole: 1,
            turn: 7,
            balls: [tee_ball(), tee_ball()],
            strokes: [[0; golf::HOLES]; 2],
            rolled: 0,
        };
        // Yours: you putt for yourself (no one else can).
        assert_eq!(d.putter(7), Some(0));
        assert_eq!(d.putter(8), None);
        assert_eq!(d.putted(0, [ball(golf::REST), tee_ball()], 0), None);
        // The bot's: yours to putt for it, as its side.
        assert_eq!(d.turn, golf::BOT);
        assert_eq!(d.putter(7), Some(1));
        assert_eq!(d.putter(8), None);
        assert_eq!(d.putted(1, [ball(golf::REST), ball(golf::REST)], 0), None);
        assert_eq!(d.turn, 7);
        assert_eq!((d.strokes[0][0], d.strokes[1][0]), (1, 1));
        // In first, you wait while it plays on alone (putted for it); then on together.
        assert_eq!(d.putted(0, [ball(golf::HOLED), ball(golf::REST)], 0), None);
        assert_eq!(d.putter(7), Some(1));
        assert_eq!(d.putted(1, [ball(golf::HOLED), ball(golf::HOLED)], 0), None);
        assert_eq!(d.hole, 2);
        assert_eq!(d.turn, 7, "fewer strokes on the last, first on the next");
    }

    #[test]
    fn the_board_keeps_each_players_best_fewest_strokes_first() {
        let mut c = course();
        let _ = c.board();
        c.rounds.push(("a".into(), "Ann".into(), 30));
        c.rounds.push(("b".into(), "Bo".into(), 24));
        c.rounds.sort_by_key(|r| r.2);
        let ServerMsg::GolfBoard { rounds } = c.board() else {
            panic!()
        };
        assert_eq!(rounds[0].name, "Bo");
        assert_eq!(rounds[1].points, 30);
        assert!(c.x0 < 10 * 32 && c.x1 > 52 * 32);
    }

    mod lobby {
        use crate::instance::Cmd;
        use crate::instance::tests::*;
        use crate::registry::ZoneDef;
        use commons_protocol::{ClientMsg, ServerMsg};
        use commons_sim::map::MapObject;
        use std::sync::Arc;

        fn fairground() -> crate::instance::Instance {
            let mut m = map(60, 60);
            m.objects = vec![MapObject {
                kind: "minigolf".into(),
                x: 10,
                y: 10,
                w: 20,
                h: 15,
                label: None,
            }];
            instance_for(Arc::new(ZoneDef::new("city".into(), m, None)))
        }

        fn send(inst: &mut crate::instance::Instance, conn: u64, msg: ClientMsg) {
            inst.handle(Cmd::Msg { conn, msg });
        }

        fn seeking(c: &Client) -> Option<u32> {
            c.log.iter().rev().find_map(|m| match m {
                ServerMsg::GolfSeeking { id } => Some(*id),
                _ => None,
            })
        }

        fn duel(c: &Client) -> Option<(u32, u32, u32)> {
            c.log.iter().rev().find_map(|m| match m {
                ServerMsg::GolfDuel { a, b, turn, .. } => Some((*a, *b, *turn)),
                _ => None,
            })
        }

        #[test]
        fn one_waits_at_the_course_and_the_next_to_seek_plays_them_waiter_first() {
            let mut inst = fairground();
            let mut a = connect(&mut inst, 1, "a", (20, 20));
            let mut b = connect(&mut inst, 2, "b", (20, 20));
            let mut far = connect(&mut inst, 3, "far", (50, 50));
            place(&mut inst, 1, (12, 12));
            place(&mut inst, 2, (14, 12));
            place(&mut inst, 3, (55, 55));
            // Nobody waiting: a waits, and everyone at the course hears so (not those away off).
            send(&mut inst, 1, ClientMsg::GolfDuelSeek { on: true });
            inst.flush();
            a.pump();
            b.pump();
            far.pump();
            assert_eq!(seeking(&a), Some(1));
            assert_eq!(seeking(&b), Some(1));
            assert_eq!(seeking(&far), None);
            assert_eq!(duel(&a), None);
            // a changes their mind, then waits again.
            send(&mut inst, 1, ClientMsg::GolfDuelSeek { on: false });
            inst.flush();
            b.pump();
            assert_eq!(seeking(&b), Some(0));
            send(&mut inst, 1, ClientMsg::GolfDuelSeek { on: true });
            // From away off: not allowed (come to the course).
            send(&mut inst, 3, ClientMsg::GolfDuelSeek { on: true });
            // b comes along: into it with a, a (who waited) first; nobody waiting now.
            send(&mut inst, 2, ClientMsg::GolfDuelSeek { on: true });
            inst.flush();
            a.pump();
            b.pump();
            far.pump();
            assert_eq!(duel(&a), Some((1, 2, 1)));
            assert_eq!(duel(&b), Some((1, 2, 1)));
            assert_eq!(duel(&far), None);
            assert_eq!(seeking(&b), Some(0));
        }

        #[test]
        fn a_waiter_who_wanders_off_or_goes_isnt_waiting() {
            let mut inst = fairground();
            let mut a = connect(&mut inst, 1, "a", (20, 20));
            let mut b = connect(&mut inst, 2, "b", (20, 20));
            place(&mut inst, 1, (12, 12));
            place(&mut inst, 2, (14, 12));
            send(&mut inst, 1, ClientMsg::GolfDuelSeek { on: true });
            // a wanders off the course: b, seeking, waits instead (no round with someone not there).
            place(&mut inst, 1, (55, 55));
            send(&mut inst, 2, ClientMsg::GolfDuelSeek { on: true });
            inst.flush();
            a.pump();
            b.pump();
            assert_eq!(duel(&b), None);
            assert_eq!(seeking(&b), Some(2));
            // b goes: nobody waiting.
            let mut c = connect(&mut inst, 3, "c", (20, 20));
            place(&mut inst, 3, (13, 13));
            inst.handle(Cmd::Leave { conn: 2 });
            inst.flush();
            c.pump();
            assert_eq!(seeking(&c), Some(0));
        }
    }
}
