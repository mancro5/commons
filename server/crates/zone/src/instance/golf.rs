//! Mini golf: the Fairground's nine holes (mapgen's `minigolf` marker). The
//! putting itself, the ball rolling, is each player's own client's
//! (`client/src/activities/golfsim.ts`); here each ball's whereabouts are
//! passed on to everyone who can see it, and the day's best rounds kept.

use super::Instance;
use commons_protocol::{ServerMsg, SkateEntry, golf};
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

    /// Today's best rounds, to `id`.
    pub(super) fn golf_board(&mut self, id: u32) {
        let Some(c) = self.golf.as_mut() else { return };
        let msg = c.board();
        self.send_to(id, &msg);
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
}
