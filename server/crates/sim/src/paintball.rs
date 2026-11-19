//! Paintball at the Splat Yard: Blue against Red, three a side (bots fill
//! the empty places), on a fenced field of bunkers, hay bales, crates, tyres,
//! steel drums and hedges. Three hits and you're out: back to your base, and
//! a point to the other side. First to ten wins.
//!
//! Everything is in field tiles (the field's top-left corner is 0,0; a
//! tile's middle is .5). People move themselves (the client says where it
//! is; `claim_move` checks it could have got there) and say when they fire
//! (`fire` checks the rate and the hopper); the balls, the hits, the bots,
//! the power-ups and the score are all decided here. The client runs the
//! same ball flight (`Ball::advance`) so a shot looks the same everywhere.
//!
//! The twists: a dodge roll (a burst of speed, untouchable while it lasts);
//! power-ups on two pads (rapid fire, a three-ball spread, a shield, balls
//! that bounce); steel drums that always send a ball back off them; hedges
//! you can hide in (until you shoot or someone comes close); and three outs
//! in a row without going out yourself sets you On Fire (quicker shots, a
//! blazing trail) until somebody shuts you down.
//!
//! Modes (`mode`, picked in the lobby): Team Splat (outs score, first to
//! ten), Capture the Flag (take theirs home while yours is there, first to
//! three) and Control Point (three rings, one before each base and the
//! hard-fought one in the middle: stand on one to take it, quicker with more
//! of you; each scores while it's yours, the middle half as much again;
//! first to two hundred), Goliath (five hunters against one giant with a
//! huge hopper and eighty hearts, who never comes back: bring it down, or be
//! splatted fifteen times or outlasted) and Free-for-all (everyone for
//! themselves, first to ten outs).
//!
//! Classes (`class`, picked in the lobby, or while out for the next life):
//! the Assault (the all-rounder), the Sniper (a slow, far, fast shot that
//! takes two hearts), the Shotgun (three balls close together, slower to
//! fire) and the Machine Gun (fifty in the magazine, quick to fire, slower
//! balls). Each has its `Gun`.

use std::f64::consts::{PI, TAU};

/// Places: 0–2 Blue, 3–5 Red.
pub const SLOTS: usize = 6;
pub const BLUE: u8 = 0;
pub const RED: u8 = 1;
/// `Match::status`.
pub const LOBBY: u8 = 0;
pub const COUNTDOWN: u8 = 1;
pub const PLAYING: u8 = 2;
pub const OVER: u8 = 3;
/// The bots, as player ids (one per place).
pub const BOT_BASE: u32 = 0xffff_ff10;

pub const TO_WIN: u8 = 10;
pub const HP: u8 = 3;
pub const HOPPER: u8 = 12;
pub const RELOAD_MS: u32 = 1300;
/// How early a shot after a reload is still taken (the client finishes it on its own clock).
pub const RELOAD_SLACK_MS: u32 = 200;
pub const FIRE_MS: u32 = 170;
/// On Fire, and with Rapid.
pub const FIRE_HOT_MS: u32 = 125;
pub const FIRE_RAPID_MS: u32 = 85;
pub const SPEED: f64 = 4.8;
pub const DASH_SPEED: f64 = 15.0;
pub const DASH_MS: u32 = 170;
pub const DASH_CD_MS: u32 = 2400;
pub const BALL_SPEED: f64 = 17.0;
/// How far a ball flies (tiles), and how fine its flight is checked.
pub const RANGE: f64 = 14.5;
pub const BALL_STEP: f64 = 0.2;
pub const BALL_R: f64 = 0.12;
pub const PLAYER_R: f64 = 0.3;
/// How close a ball has to pass to splat someone (a little generous: you
/// see others a beat behind).
pub const HIT_R: f64 = 0.46;
/// The muzzle: balls start this far out in front.
pub const MUZZLE: f64 = 0.45;
/// A spread's outer balls, either side of the aim (radians).
pub const SPREAD: f64 = 0.15;
pub const RESPAWN_MS: u32 = 3000;
pub const SPAWN_SHIELD_MS: u32 = 1600;
pub const REGEN_DELAY_MS: u32 = 5000;
pub const REGEN_EVERY_MS: u32 = 2500;
pub const COUNTDOWN_MS: u32 = 3500;
pub const RESULTS_MS: u32 = 9000;
pub const MATCH_MS: u32 = 8 * 60_000;
pub const PAD_EVERY_MS: u32 = 12_000;
pub const STREAK_HOT: u8 = 3;
/// In a hedge you're hidden, unless you shot this recently or an enemy is this close.
pub const HIDE_AFTER_SHOT_MS: u32 = 1200;
pub const REVEAL_R: f64 = 2.2;

/// Obstacles (`pb_*` map objects).
pub mod ob {
    pub const HAY: u8 = 1;
    pub const CRATE: u8 = 2;
    pub const TIRES: u8 = 3;
    /// Steel: balls always glance off it.
    pub const DRUM: u8 = 4;
    pub const SNAKE: u8 = 5;
    pub const XBUNK: u8 = 6;
    /// Walk and shoot through it; hides you.
    pub const HEDGE: u8 = 7;
}

/// The modes (`Match::mode`).
pub mod mode {
    /// Team Splat: every out a point.
    pub const TEAM: u8 = 0;
    /// Capture the Flag.
    pub const FLAG: u8 = 1;
    /// Control Point.
    pub const POINT: u8 = 2;
    /// Goliath: five hunters against one giant.
    pub const GOLIATH: u8 = 3;
    /// Free-for-all: everyone for themselves.
    pub const FFA: u8 = 4;
    pub const COUNT: u8 = 5;
    /// What wins a match of each (in Goliath, the giant's: the hunters' is its hearts).
    pub fn to_win(m: u8) -> u8 {
        match m {
            FLAG => 3,
            POINT => 200,
            GOLIATH => super::GIANT_OUTS,
            _ => super::TO_WIN,
        }
    }
    /// The modes the bots put on by themselves (out in the city, to bet on: one side or the other).
    pub const EXHIBITED: [u8; 4] = [TEAM, FLAG, POINT, GOLIATH];
}

/// Goliath: the giant's place (Red's first), its hearts, how far its body
/// reaches a ball, how fast it goes (of anyone's), the hunters it must
/// splat, and how long the hunters have to bring it down.
pub const GIANT_SLOT: usize = 3;
pub const GIANT_HP: u8 = 160;
/// A person playing the giant (who aims far better than a bot): fewer hearts, a
/// slower trigger (of its gun's), and the bot hunters a level sharper.
pub const GIANT_HP_HUMAN: u8 = 110;
pub const GIANT_HUMAN_FIRE: f64 = 1.25;
/// Goliath's hunters come back quicker against a person playing the giant.
pub const GOLIATH_RESPAWN_MS: u32 = 2000;
pub const GIANT_HIT_R: f64 = 0.75;
pub const GIANT_SPEED: f64 = 0.8;
pub const GIANT_OUTS: u8 = 15;
pub const GIANT_MATCH_MS: u32 = 5 * 60_000;
/// The giant's marker: a fan of three, quick, a hopper of sixty. (With its hearts,
/// tuned so bots win about as often as giant or hunters: `goliath_is_a_fair_fight`.)
pub const GIANT_GUN: Gun = Gun {
    fire_ms: 120,
    hopper: 60,
    reload_ms: 2600,
    speed: 15.0,
    range: 16.0,
    damage: 1,
    pellets: &[0.0, -0.11, 0.11],
};

/// How near a flag (tiles) you must be to take it, or bring theirs home to it.
pub const FLAG_R: f64 = 0.85;
/// A dropped flag goes home by itself after this long (ms).
pub const FLAG_RETURN_MS: u32 = 12_000;
/// The control points' rings (tiles from their middles): the middle one's, and those before the bases.
pub const POINT_R: f64 = 2.6;
pub const SIDE_POINT_R: f64 = 2.0;
/// How fast one person takes a point (of 100 a second: four seconds from
/// nobody's, eight from theirs); two take it twice as fast, three three times.
pub const POINT_RATE: f64 = 25.0;
/// The points score each second: a side one 1, the middle one half as much again.
pub const POINT_TICK_MS: u32 = 1000;
pub const SIDE_POINT_VALUE: f64 = 1.0;
pub const MID_POINT_VALUE: f64 = 1.5;

/// A team's flag: its stand (field tiles), where it is, who has it (0:
/// nobody), and when it was dropped (0: it's home, or carried).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Flag {
    pub home: (f64, f64),
    pub x: f64,
    pub y: f64,
    pub carrier: u32,
    pub dropped_at: u32,
}

impl Flag {
    fn at(home: (f64, f64)) -> Flag {
        Flag {
            home,
            x: home.0,
            y: home.1,
            carrier: 0,
            dropped_at: 0,
        }
    }
    pub fn is_home(&self) -> bool {
        self.carrier == 0 && self.dropped_at == 0
    }
    fn go_home(&mut self) {
        *self = Flag::at(self.home);
    }
}

/// A control point: its middle (field tiles) and ring, what it scores a
/// second, how far it's been taken (−100 all Blue's … 100 all Red's), and
/// whose it is (2: nobody's).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Point {
    pub x: f64,
    pub y: f64,
    pub r: f64,
    pub value: f64,
    pub progress: f64,
    pub owner: u8,
}

impl Point {
    fn on(&self, x: f64, y: f64) -> bool {
        (x - self.x).hypot(y - self.y) < self.r
    }
}

/// Where the control points are: one before Blue's base, the middle, one
/// before Red's (each on open ground, its ring's middle).
fn control_points(field: &Field) -> Vec<Point> {
    let open = |x: f64, y: f64| -> (f64, f64) {
        let (cx, cy) = (x.floor() + 0.5, y.floor() + 0.5);
        for r in 0..4i32 {
            for dy in -r..=r {
                for dx in -r..=r {
                    if dx.abs() != r && dy.abs() != r {
                        continue;
                    }
                    let (tx, ty) = (cx + dx as f64, cy + dy as f64);
                    if tx > 0.0
                        && ty > 0.0
                        && tx < field.w
                        && ty < field.h
                        && field.free(tx, ty, PLAYER_R)
                    {
                        return (tx, ty);
                    }
                }
            }
        }
        (x, y)
    };
    let (w, h) = (field.w, field.h);
    let side = |x: f64| {
        let (x, y) = open(x, h / 2.0);
        Point {
            x,
            y,
            r: SIDE_POINT_R,
            value: SIDE_POINT_VALUE,
            progress: 0.0,
            owner: 2,
        }
    };
    vec![
        side(w * 0.22),
        // (The middle's a bunker, in the yards: its ring goes round it.)
        Point {
            x: w / 2.0,
            y: h / 2.0,
            r: POINT_R,
            value: MID_POINT_VALUE,
            progress: 0.0,
            owner: 2,
        },
        side(w * 0.78),
    ]
}

/// Where team `team`'s flag stands: in front of its base (a step or two in
/// from the middle of its spawn points), on open ground.
fn flag_home(field: &Field, team: u8) -> (f64, f64) {
    let sp = &field.spawns[team as usize];
    let (mut x, y) = if sp.is_empty() {
        (
            if team == BLUE { 1.5 } else { field.w - 1.5 },
            field.h / 2.0,
        )
    } else {
        let n = sp.len() as f64;
        (
            sp.iter().map(|p| p.0).sum::<f64>() / n,
            sp.iter().map(|p| p.1).sum::<f64>() / n,
        )
    };
    let step = if team == BLUE { 1.0 } else { -1.0 };
    for _ in 0..2 {
        if field.free(x + step, y, PLAYER_R) {
            x += step;
        }
    }
    (x, y)
}

/// The classes (`Player::class`; `GUNS` by it).
pub mod class {
    pub const ASSAULT: u8 = 0;
    pub const SNIPER: u8 = 1;
    pub const SHOTGUN: u8 = 2;
    pub const GUNNER: u8 = 3;
    pub const COUNT: u8 = 4;
}

/// A class's marker: how often it fires, how many it holds and how long it
/// takes to fill again, how fast and far its balls go and how many hearts
/// one takes, and the fan of balls each shot (offsets from the aim).
#[derive(Debug, Clone, Copy)]
pub struct Gun {
    pub fire_ms: u32,
    pub hopper: u8,
    pub reload_ms: u32,
    pub speed: f64,
    pub range: f64,
    pub damage: u8,
    pub pellets: &'static [f64],
}

/// The Shotgun's three, close together (a Spread power-up's are wider).
pub const SHOTGUN_SPREAD: f64 = 0.07;

pub const GUNS: [Gun; class::COUNT as usize] = [
    // Assault.
    Gun {
        fire_ms: FIRE_MS,
        hopper: HOPPER,
        reload_ms: RELOAD_MS,
        speed: BALL_SPEED,
        range: RANGE,
        damage: 1,
        pellets: &[0.0],
    },
    // Sniper: fast and far, two hearts a hit; a long wait between shots, five to a load.
    Gun {
        fire_ms: 750,
        hopper: 5,
        reload_ms: 1800,
        speed: 30.0,
        range: 26.0,
        damage: 2,
        pellets: &[0.0],
    },
    // Shotgun: three at once, close together; slower to fire, six to a load.
    Gun {
        fire_ms: 480,
        hopper: 6,
        reload_ms: 1500,
        speed: BALL_SPEED,
        range: RANGE,
        damage: 1,
        pellets: &[0.0, -SHOTGUN_SPREAD, SHOTGUN_SPREAD],
    },
    // Machine Gun: fifty to a load, quicker to fire, the balls a bit slower.
    Gun {
        fire_ms: 100,
        hopper: 50,
        reload_ms: 2200,
        speed: 13.0,
        range: RANGE,
        damage: 1,
        pellets: &[0.0],
    },
];

/// A class's gun (an unknown class: the Assault's).
pub fn gun(class: u8) -> &'static Gun {
    GUNS.get(class as usize).unwrap_or(&GUNS[0])
}

/// The balls of one shot (offsets from the aim, in order: `n`'s top bits
/// say which): the class's, and a Spread power-up's two wider ones.
pub fn pellets(class: u8, spread: bool) -> Vec<f64> {
    gun_pellets(gun(class), spread)
}

/// The balls of one shot from `g` (a Spread power-up adds its two wider ones).
pub fn gun_pellets(g: &Gun, spread: bool) -> Vec<f64> {
    let mut v = g.pellets.to_vec();
    if spread {
        v.extend([-SPREAD, SPREAD]);
    }
    v
}

/// Power-ups (`Player::power`, a pad's kind).
pub mod power {
    pub const NONE: u8 = 0;
    pub const RAPID: u8 = 1;
    pub const SPREAD: u8 = 2;
    pub const SHIELD: u8 = 3;
    pub const BOUNCE: u8 = 4;
    pub const ALL: [u8; 4] = [RAPID, SPREAD, SHIELD, BOUNCE];
    /// How long each lasts (ms).
    pub fn lasts(kind: u8) -> u32 {
        match kind {
            RAPID => 7000,
            SPREAD => 8000,
            SHIELD => 12_000,
            BOUNCE => 9000,
            _ => 0,
        }
    }
}

/// `Event::kind` (protocol `PbEvent`).
pub mod ev {
    /// `a` hit `b` (one paint off), at x,y; `n` the ball.
    pub const HIT: u8 = 1;
    /// `a` put `b` out; `n` is `a`'s streak now.
    pub const OUT: u8 = 2;
    /// `b`'s shield took `a`'s ball.
    pub const SHIELDED: u8 = 3;
    /// `a` picked up power `b` (from the pad at x,y).
    pub const PICKUP: u8 = 5;
    /// A power-up `b` appeared on the pad at x,y.
    pub const PAD: u8 = 6;
    /// `a` ended `b`'s streak of `n`.
    pub const SHUTDOWN: u8 = 7;
    /// Team `a` is one away.
    pub const MATCH_POINT: u8 = 8;
    /// `a` is back in, at x,y.
    pub const RESPAWN: u8 = 9;
    /// `a` rolled, from x,y.
    pub const DASH: u8 = 10;
    /// The countdown's done: go!
    pub const START: u8 = 11;
    /// Over: `a` the winners (`BLUE`, `RED`, or 2 for a draw).
    pub const END: u8 = 12;
    /// `a` is reloading.
    pub const RELOAD: u8 = 13;
    /// `a` went On Fire.
    pub const HOT: u8 = 14;
    /// `a` took team `b`'s flag (at x,y).
    pub const FLAG_TAKEN: u8 = 15;
    /// `a` dropped team `b`'s flag (splatted, at x,y).
    pub const FLAG_DROPPED: u8 = 16;
    /// Team `b`'s flag went home (`a` brought it back, or 0: by itself).
    pub const FLAG_RETURNED: u8 = 17;
    /// `a` brought team `b`'s flag home: a capture for `a`'s team.
    pub const FLAG_CAPTURED: u8 = 18;
    /// Point `n` (0 west, 1 middle, 2 east) is now team `b`'s (2: nobody's; `a` someone who took it).
    pub const POINT_TAKEN: u8 = 19;
    /// `a`'s ball reached `b` just after they'd gone out: only a splat.
    pub const LATE: u8 = 20;
}

/// A flag in `Player::flags` (protocol `PbPlayer.flags`).
pub mod flag {
    pub const OUT: u8 = 1;
    pub const SPAWN_SHIELD: u8 = 2;
    pub const DASHING: u8 = 4;
    pub const HIDDEN: u8 = 8;
    pub const HOT: u8 = 16;
    pub const RELOADING: u8 = 32;
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Obstacle {
    pub kind: u8,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

impl Obstacle {
    pub fn blocks(&self) -> bool {
        self.kind != ob::HEDGE
    }
    fn contains(&self, x: f64, y: f64, pad: f64) -> bool {
        x > self.x - pad
            && x < self.x + self.w + pad
            && y > self.y - pad
            && y < self.y + self.h + pad
    }
}

/// The obstacle kind for a map object's kind (`pb_hay` …).
pub fn obstacle_kind(name: &str) -> Option<u8> {
    Some(match name {
        "pb_hay" => ob::HAY,
        "pb_crate" => ob::CRATE,
        "pb_tires" => ob::TIRES,
        "pb_drum" => ob::DRUM,
        "pb_snake" => ob::SNAKE,
        "pb_x" => ob::XBUNK,
        "pb_hedge" => ob::HEDGE,
        _ => return None,
    })
}

/// The field: its size, what's on it, where each side comes in, and the pads.
#[derive(Debug, Clone)]
pub struct Field {
    pub w: f64,
    pub h: f64,
    pub obstacles: Vec<Obstacle>,
    pub spawns: [Vec<(f64, f64)>; 2],
    pub pads: Vec<(f64, f64)>,
}

impl Field {
    /// Whether a circle of radius `r` at (x, y) is clear of everything that blocks, and on the field.
    pub fn free(&self, x: f64, y: f64, r: f64) -> bool {
        x >= r
            && y >= r
            && x <= self.w - r
            && y <= self.h - r
            && !self
                .obstacles
                .iter()
                .any(|o| o.blocks() && circle_hits(o, x, y, r))
    }

    /// Moving a body of radius `r` by (dx, dy), sliding along whatever it runs into.
    pub fn slide(&self, x: f64, y: f64, dx: f64, dy: f64, r: f64) -> (f64, f64) {
        let len = dx.hypot(dy);
        let n = (len / 0.15).ceil().max(1.0);
        let (sx, sy) = (dx / n, dy / n);
        let (mut x, mut y) = (x, y);
        for _ in 0..n as usize {
            if self.free(x + sx, y, r) {
                x += sx;
            }
            if self.free(x, y + sy, r) {
                y += sy;
            }
        }
        (x, y)
    }

    /// Whether nothing that stops a ball lies between a and b.
    pub fn clear_line(&self, ax: f64, ay: f64, bx: f64, by: f64) -> bool {
        let len = (bx - ax).hypot(by - ay);
        let n = (len / 0.25).ceil().max(1.0) as usize;
        (1..n).all(|i| {
            let t = i as f64 / n as f64;
            let (x, y) = (ax + (bx - ax) * t, ay + (by - ay) * t);
            !self
                .obstacles
                .iter()
                .any(|o| o.blocks() && o.contains(x, y, 0.0))
        })
    }

    /// The hedge (x, y) is in, if any.
    pub fn in_hedge(&self, x: f64, y: f64) -> bool {
        self.obstacles
            .iter()
            .any(|o| o.kind == ob::HEDGE && o.contains(x, y, -0.1))
    }

    fn cols(&self) -> usize {
        self.w.ceil() as usize
    }
    fn rows(&self) -> usize {
        self.h.ceil() as usize
    }
    /// The tiles a body can stand in the middle of.
    fn open_tile(&self, cx: usize, cy: usize) -> bool {
        self.free(cx as f64 + 0.5, cy as f64 + 0.5, PLAYER_R + 0.05)
    }
}

impl Field {
    /// The field laid out by a map's `pb_*` objects, and where its corner is
    /// (map tiles): obstacles, spawns (`pb_spawn` labelled blue or red),
    /// pads; None without a `pb_field`. Only what's on the field counts (out
    /// in the city, the kit piled up by the Splat Yard's door isn't in play).
    pub fn from_map(objects: &[crate::map::MapObject]) -> Option<(Field, (u16, u16))> {
        let f = objects.iter().find(|o| o.kind == "pb_field")?;
        let (ox, oy) = (f.x as f64, f.y as f64);
        let on = |o: &crate::map::MapObject| {
            o.x >= f.x && o.y >= f.y && o.x + o.w <= f.x + f.w && o.y + o.h <= f.y + f.h
        };
        let mut field = Field {
            w: f.w as f64,
            h: f.h as f64,
            obstacles: Vec::new(),
            spawns: [Vec::new(), Vec::new()],
            pads: Vec::new(),
        };
        for o in objects.iter().filter(|o| on(o)) {
            let (x, y) = (o.x as f64 - ox, o.y as f64 - oy);
            if let Some(kind) = obstacle_kind(&o.kind) {
                field.obstacles.push(Obstacle {
                    kind,
                    x,
                    y,
                    w: o.w as f64,
                    h: o.h as f64,
                });
            } else if o.kind == "pb_spawn" {
                let t = if o.label.as_deref() == Some("red") {
                    1
                } else {
                    0
                };
                field.spawns[t].push((x + 0.5, y + 0.5));
            } else if o.kind == "pb_pad" {
                field
                    .pads
                    .push((x + o.w as f64 / 2.0, y + o.h as f64 / 2.0));
            }
        }
        Some((field, (f.x, f.y)))
    }
}

fn circle_hits(o: &Obstacle, x: f64, y: f64, r: f64) -> bool {
    let nx = x.clamp(o.x, o.x + o.w);
    let ny = y.clamp(o.y, o.y + o.h);
    (x - nx).powi(2) + (y - ny).powi(2) < r * r
}

/// A ball in flight.
#[derive(Debug, Clone)]
pub struct Ball {
    pub by: u32,
    pub team: u8,
    /// The shot, and which of a spread's three (top bits).
    pub n: u16,
    pub x: f64,
    pub y: f64,
    pub vx: f64,
    pub vy: f64,
    /// How far it has left to go (tiles).
    pub left: f64,
    /// Bounces it may still make off anything (drums don't count).
    pub bounces: u8,
    /// Tiles a second, and the hearts it takes.
    pub speed: f64,
    pub damage: u8,
}

/// What a ball ran into this step.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Flight {
    Flying,
    /// Splatted on a wall or the ground, at x,y.
    Splat(f64, f64),
    /// Reached someone (by index) at x,y.
    Hit(usize, f64, f64),
}

impl Ball {
    /// A ball (or one of a spread) leaving a marker at (x, y) aimed `aim`.
    pub fn new(by: u32, team: u8, n: u16, x: f64, y: f64, aim: f64, bounce: bool) -> Ball {
        let (c, s) = (aim.cos(), aim.sin());
        Ball {
            by,
            team,
            n,
            x: x + c * MUZZLE,
            y: y + s * MUZZLE,
            vx: c,
            vy: s,
            left: RANGE,
            bounces: if bounce { 1 } else { 0 },
            speed: BALL_SPEED,
            damage: 1,
        }
    }

    /// Fired from `class`'s gun: its speed, its reach, its hearts.
    pub fn from_gun(self, class: u8) -> Ball {
        self.fired_by(gun(class))
    }

    /// Fired from gun `g`: its speed, its reach, its hearts.
    pub fn fired_by(mut self, g: &Gun) -> Ball {
        self.speed = g.speed;
        self.left = g.range;
        self.damage = g.damage;
        self
    }

    /// Flies `dist` tiles on (in `BALL_STEP`s), off drums and (with bounces
    /// left) walls; `hit` says whether a body at a point is splatted.
    pub fn advance(
        &mut self,
        field: &Field,
        dist: f64,
        mut hit: impl FnMut(f64, f64) -> Option<usize>,
    ) -> Flight {
        let mut todo = dist;
        while todo > 1e-9 {
            if self.left <= 1e-9 {
                return Flight::Splat(self.x, self.y);
            }
            let step = todo.min(BALL_STEP).min(self.left);
            todo -= step;
            let (px, py) = (self.x, self.y);
            let (nx, ny) = (px + self.vx * step, py + self.vy * step);
            self.left -= step;
            // The field's edge (its netting): a splat.
            if nx < 0.0 || ny < 0.0 || nx > field.w || ny > field.h {
                if self.bounces > 0 {
                    self.bounces -= 1;
                    if nx < 0.0 || nx > field.w {
                        self.vx = -self.vx;
                    } else {
                        self.vy = -self.vy;
                    }
                    continue;
                }
                return Flight::Splat(px.clamp(0.0, field.w), py.clamp(0.0, field.h));
            }
            if let Some(o) = field
                .obstacles
                .iter()
                .find(|o| o.blocks() && o.contains(nx, ny, BALL_R))
            {
                if o.kind == ob::DRUM || self.bounces > 0 {
                    if o.kind != ob::DRUM {
                        self.bounces -= 1;
                    }
                    // Off whichever face it came in through.
                    let inside_x = px > o.x - BALL_R && px < o.x + o.w + BALL_R;
                    if inside_x {
                        self.vy = -self.vy;
                    } else {
                        self.vx = -self.vx;
                    }
                    continue;
                }
                return Flight::Splat(px, py);
            }
            self.x = nx;
            self.y = ny;
            if let Some(i) = hit(nx, ny) {
                return Flight::Hit(i, nx, ny);
            }
            if self.left <= 1e-9 {
                return Flight::Splat(self.x, self.y);
            }
        }
        Flight::Flying
    }
}

/// How a bot plays, by level (`crate::level`): how quick it is to open
/// fire on someone it sees, how steady its aim and how well it leads a
/// runner, how far it sees, how long its bursts and breathers, how often it
/// rolls out of a ball's way, how fast it moves, how far it goes for a
/// power-up.
struct Skill {
    /// Before it shoots at someone new (ms: base, plus up to).
    react: (f64, f64),
    /// Aim drift: how much each shot, at most.
    wobble: (f64, f64),
    sight: f64,
    /// How much of a runner's run it aims ahead.
    lead: f64,
    /// Shots a burst (base, plus up to), and the breather after (ms: base, plus up to).
    burst: (u8, f64),
    pause: (f64, f64),
    /// Slower than the gun allows, between shots in a burst (ms: base, plus up to).
    slack: (f64, f64),
    /// Its chance of rolling out of a ball's way.
    dodge: f64,
    /// Of full speed.
    speed: f64,
    pad_r: f64,
    /// Back off to this far when it's down to its last hit.
    wary: f64,
}

fn skill(level: u8) -> Skill {
    match level {
        crate::level::EASY => Skill {
            react: (700.0, 650.0),
            wobble: (0.5, 0.55),
            sight: 10.0,
            lead: 0.15,
            burst: (2, 2.0),
            pause: (1100.0, 1000.0),
            slack: (170.0, 260.0),
            dodge: 0.04,
            speed: 0.78,
            pad_r: 8.0,
            wary: 6.5,
        },
        crate::level::HARD => Skill {
            react: (170.0, 170.0),
            wobble: (0.15, 0.16),
            sight: 14.5,
            lead: 1.0,
            burst: (4, 3.0),
            pause: (380.0, 380.0),
            slack: (20.0, 80.0),
            dodge: 0.7,
            speed: 0.98,
            pad_r: 17.0,
            wary: 10.0,
        },
        _ => Skill {
            react: (380.0, 380.0),
            wobble: (0.3, 0.32),
            sight: 13.0,
            lead: 0.8,
            burst: (3, 3.0),
            pause: (650.0, 700.0),
            slack: (60.0, 160.0),
            dodge: 0.3,
            speed: 0.92,
            pad_r: 14.0,
            wary: 9.0,
        },
    }
}

/// What a bot is up to.
#[derive(Debug, Clone, Default)]
pub struct Ai {
    target: Option<u32>,
    /// It reacts to a new target only after this.
    react_at: u32,
    strafe: f64,
    strafe_until: u32,
    /// Where it's heading when it has nobody to shoot at, and its way there.
    goal: Option<(usize, usize)>,
    goal_until: u32,
    nav: Vec<u16>,
    next_fire: u32,
    /// A little off with each shot (radians), drifting.
    wobble: f64,
    /// Shots left in this burst (then a breather).
    burst: u8,
}

#[derive(Debug, Clone)]
pub struct Player {
    pub id: u32,
    pub team: u8,
    pub bot: bool,
    /// Its class (`class`): its gun.
    pub class: u8,
    /// Goliath's giant: its own gun, its hearts, its size, its pace.
    pub giant: bool,
    pub x: f64,
    pub y: f64,
    pub aim: f64,
    pub hp: u8,
    pub ammo: u8,
    /// Reloading until (0: not).
    pub reload_until: u32,
    pub last_fire: u32,
    pub dash_until: u32,
    pub dash_ready: u32,
    pub out: bool,
    pub respawn_at: u32,
    pub shield_until: u32,
    pub power: u8,
    pub power_until: u32,
    /// Hits a Shield power-up still takes.
    pub shield_hits: u8,
    pub last_hit: u32,
    pub next_regen: u32,
    pub kills: u8,
    pub deaths: u8,
    pub streak: u8,
    /// Bumped whenever it's put somewhere (respawned, or corrected): the
    /// client takes the server's word for where it is then.
    pub fix: u8,
    /// When we last heard where it is, and how fast it's going (for the bots to lead it).
    pub moved_at: u32,
    /// Shots in hand (see `fire`), as of when.
    pub fire_credit: f64,
    pub credit_at: u32,
    pub vx: f64,
    pub vy: f64,
    pub hidden: bool,
    pub ai: Ai,
}

impl Player {
    fn new(id: u32, team: u8, bot: bool, at: (f64, f64)) -> Player {
        Player {
            id,
            team,
            bot,
            class: class::ASSAULT,
            giant: false,
            x: at.0,
            y: at.1,
            aim: if team == BLUE { 0.0 } else { PI },
            hp: HP,
            ammo: HOPPER,
            reload_until: 0,
            last_fire: 0,
            dash_until: 0,
            dash_ready: 0,
            out: false,
            respawn_at: 0,
            shield_until: 0,
            power: 0,
            power_until: 0,
            shield_hits: 0,
            last_hit: 0,
            next_regen: 0,
            kills: 0,
            deaths: 0,
            streak: 0,
            fix: 0,
            moved_at: 0,
            fire_credit: 3.0,
            credit_at: 0,
            vx: 0.0,
            vy: 0.0,
            hidden: false,
            ai: Ai::default(),
        }
    }

    pub fn hot(&self) -> bool {
        self.streak >= STREAK_HOT
    }

    pub fn flags(&self, now: u32) -> u8 {
        let mut f = 0;
        if self.out {
            f |= flag::OUT;
        }
        if now < self.shield_until {
            f |= flag::SPAWN_SHIELD;
        }
        if now < self.dash_until {
            f |= flag::DASHING;
        }
        if self.hidden {
            f |= flag::HIDDEN;
        }
        if self.hot() {
            f |= flag::HOT;
        }
        if self.reload_until > now {
            f |= flag::RELOADING;
        }
        f
    }

    /// Its gun.
    pub fn gun(&self) -> &'static Gun {
        if self.giant {
            &GIANT_GUN
        } else {
            gun(self.class)
        }
    }

    /// Its hearts when whole.
    pub fn max_hp(&self) -> u8 {
        match (self.giant, self.bot) {
            (true, true) => GIANT_HP,
            (true, false) => GIANT_HP_HUMAN,
            _ => HP,
        }
    }

    /// How near a ball must come to hit it.
    pub fn hit_r(&self) -> f64 {
        if self.giant { GIANT_HIT_R } else { HIT_R }
    }

    /// Made the giant: its hearts, its gun loaded.
    fn make_giant(&mut self) {
        self.giant = true;
        self.hp = self.max_hp();
        self.ammo = GIANT_GUN.hopper;
        self.reload_until = 0;
    }

    /// Takes up `class`: its gun, loaded.
    fn arm(&mut self, class: u8) {
        self.class = class.min(class::COUNT - 1);
        self.ammo = self.gun().hopper;
        self.reload_until = 0;
    }

    /// The shortest gap between shots for it now (its gun's; Rapid Fire
    /// halves it, being On Fire takes a quarter off).
    pub fn fire_ms(&self, now: u32) -> u32 {
        let base = if self.giant && !self.bot {
            (self.gun().fire_ms as f64 * GIANT_HUMAN_FIRE) as u32
        } else {
            self.gun().fire_ms
        };
        if self.power == power::RAPID && now < self.power_until {
            base * FIRE_RAPID_MS / FIRE_MS
        } else if self.hot() {
            base * FIRE_HOT_MS / FIRE_MS
        } else {
            base
        }
    }

    fn powered(&self, kind: u8, now: u32) -> bool {
        self.power == kind && now < self.power_until
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Event {
    pub kind: u8,
    pub a: u32,
    pub b: u32,
    pub x: f64,
    pub y: f64,
    pub n: u16,
}

/// A shot fired (protocol `PbShot`), for everyone to fly the same.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Shot {
    pub by: u32,
    pub n: u16,
    pub x: f64,
    pub y: f64,
    pub aim: f64,
    /// Bit 0: bouncing; bit 1: a Spread power-up's; bits 2–3: the class (its gun); bit 4: the giant's gun.
    pub kind: u8,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Pad {
    pub x: f64,
    pub y: f64,
    /// What's on it (`power::*`), 0 for nothing yet.
    pub kind: u8,
    pub next: u32,
}

/// A match (and the lobby before it).
#[derive(Debug, Clone)]
pub struct Match {
    pub field: Field,
    pub status: u8,
    /// When the countdown, the match (its time limit) or the results end.
    pub phase_end: u32,
    pub score: [u8; 2],
    /// Who has which place (0: free; bots are `BOT_BASE + place`).
    pub slots: [u32; SLOTS],
    pub players: Vec<Player>,
    pub balls: Vec<Ball>,
    pub pads: Vec<Pad>,
    /// The winners when it's over (`BLUE`, `RED`, 2: a draw; Free-for-all: 2, and `winner_id`).
    pub winner: u8,
    /// Free-for-all's winner (0: a draw).
    pub winner_id: u32,
    /// How good the bots are (`crate::level`), picked in the lobby.
    pub level: u8,
    next_bot_shot: u16,
    match_point: [bool; 2],
    /// Bots playing as players (botswarm's): their seats are played by the
    /// server's bots, at the sharpest (`pilot`).
    pub pilots: Vec<u32>,
    /// Who's picked which class (`pick_class`), by id.
    picks: Vec<(u32, u8)>,
    /// The mode (`mode`), picked in the lobby.
    pub mode: u8,
    /// Capture the Flag: each team's flag (by team).
    pub flags: [Flag; 2],
    /// Control Point: the points (west, middle, east), the score they've
    /// built up toward the next whole point, and when they next score.
    pub points: Vec<Point>,
    point_bank: [f64; 2],
    point_tick: u32,
    /// The bots' classes this match (a mix, the same for each side).
    bot_classes: [u8; 3],
}

pub fn team_of_slot(s: usize) -> u8 {
    if s < 3 { BLUE } else { RED }
}

pub fn is_bot(id: u32) -> bool {
    (BOT_BASE..BOT_BASE + SLOTS as u32).contains(&id)
}

/// Angles on the wire: a fraction of a full turn.
pub fn aim_to_u16(a: f64) -> u16 {
    ((a.rem_euclid(TAU) / TAU) * 65536.0).round() as u32 as u16
}
pub fn aim_from_u16(v: u16) -> f64 {
    v as f64 / 65536.0 * TAU
}

impl Match {
    pub fn new(field: Field) -> Match {
        let homes = [flag_home(&field, BLUE), flag_home(&field, RED)];
        let points = control_points(&field);
        let pads = field
            .pads
            .iter()
            .map(|&(x, y)| Pad {
                x,
                y,
                kind: 0,
                next: 0,
            })
            .collect();
        Match {
            field,
            status: LOBBY,
            phase_end: 0,
            score: [0, 0],
            slots: [0; SLOTS],
            players: Vec::new(),
            balls: Vec::new(),
            pads,
            winner: 2,
            winner_id: 0,
            level: crate::level::MEDIUM,
            next_bot_shot: 0,
            match_point: [false; 2],
            pilots: Vec::new(),
            picks: Vec::new(),
            bot_classes: [class::ASSAULT, class::SHOTGUN, class::GUNNER],
            mode: mode::TEAM,
            flags: [Flag::at(homes[0]), Flag::at(homes[1])],
            points,
            point_bank: [0.0; 2],
            point_tick: 0,
        }
    }

    /// What wins this match.
    pub fn to_win(&self) -> u8 {
        mode::to_win(self.mode)
    }

    /// The side place `s` plays on: Blue's three and Red's three; in Goliath,
    /// the giant Red and the rest Blue; in Free-for-all, every other place
    /// starts from each end (each on their own all the same).
    pub fn team_of(&self, s: usize) -> u8 {
        match self.mode {
            mode::GOLIATH => {
                if s == GIANT_SLOT {
                    RED
                } else {
                    BLUE
                }
            }
            mode::FFA => (s % 2) as u8,
            _ => team_of_slot(s),
        }
    }

    /// Whether `a` and `b` are against each other (in Free-for-all, everyone else is).
    pub fn foes(&self, a: &Player, b: &Player) -> bool {
        if self.mode == mode::FFA {
            a.id != b.id
        } else {
            a.team != b.team
        }
    }

    /// Whether the giant's been brought down (Goliath).
    fn giant_down(&self) -> bool {
        self.players.iter().any(|p| p.giant && p.out)
    }

    /// In the lobby, someone with a place picks the mode. Returns whether it changed.
    pub fn set_mode(&mut self, by: u32, m: u8) -> bool {
        if self.status != LOBBY || self.slot_of(by).is_none() || m >= mode::COUNT || self.mode == m
        {
            return false;
        }
        self.mode = m;
        true
    }

    /// The class `id` plays as: their pick (a bot: this match's mix, by its place).
    pub fn class_of(&self, id: u32) -> u8 {
        if is_bot(id) {
            return self.bot_classes[(id.wrapping_sub(BOT_BASE) as usize) % 3];
        }
        self.picks
            .iter()
            .find(|p| p.0 == id)
            .map_or(class::ASSAULT, |p| p.1)
    }

    /// `id` (with a place) picks a class: before the match starts, they're
    /// it at once; during it, from their next life. Returns whether it took.
    pub fn pick_class(&mut self, id: u32, class: u8) -> bool {
        if class >= class::COUNT || self.slot_of(id).is_none() || is_bot(id) {
            return false;
        }
        match self.picks.iter_mut().find(|p| p.0 == id) {
            Some(p) => p.1 = class,
            None => self.picks.push((id, class)),
        }
        if self.status == COUNTDOWN
            && let Some(i) = self.index(id)
        {
            self.players[i].arm(class);
        }
        true
    }

    pub fn slot_of(&self, id: u32) -> Option<usize> {
        self.slots.iter().position(|&s| s == id && id != 0)
    }

    pub fn player(&self, id: u32) -> Option<&Player> {
        self.players.iter().find(|p| p.id == id)
    }

    fn index(&self, id: u32) -> Option<usize> {
        self.players.iter().position(|p| p.id == id)
    }

    /// Whether `id` is out on the field now (they don't walk about the hall).
    pub fn playing(&self, id: u32) -> bool {
        matches!(self.status, COUNTDOWN | PLAYING) && self.index(id).is_some()
    }

    pub fn humans(&self) -> usize {
        self.slots.iter().filter(|&&s| s != 0 && !is_bot(s)).count()
    }

    /// `id` takes a place on `team` (`2`: whichever has room): a free one,
    /// else a bot's (the bot steps aside). The first to sign up in the lobby
    /// gets bots in all the other places (to take out, or put back, with
    /// `set_bot`). Returns whether they're in.
    pub fn join(&mut self, id: u32, team: u8, now: u32) -> bool {
        if let Some(s) = self.slot_of(id) {
            // Already in: switching sides in the lobby (with a bot, if it takes one's place, swapping over).
            if self.status != LOBBY || team == 2 || self.team_of(s) == team {
                return true;
            }
            if let Some(f) = self.free_slot(team, true) {
                let had_bot = is_bot(self.slots[f]);
                self.slots[s] = if had_bot { BOT_BASE + s as u32 } else { 0 };
                self.slots[f] = id;
            }
            return true;
        }
        let in_match = matches!(self.status, COUNTDOWN | PLAYING);
        let pick = |m: &Match, t: u8| m.free_slot(t, true);
        let s = match team {
            BLUE | RED => pick(self, team),
            _ => {
                let blue = (0..3)
                    .filter(|&i| self.slots[i] != 0 && !is_bot(self.slots[i]))
                    .count();
                let red = (3..6)
                    .filter(|&i| self.slots[i] != 0 && !is_bot(self.slots[i]))
                    .count();
                let first = if self.mode == mode::GOLIATH || blue <= red {
                    BLUE
                } else {
                    RED
                };
                pick(self, first).or_else(|| pick(self, 1 - first))
            }
        };
        let Some(s) = s else { return false };
        let old = self.slots[s];
        self.slots[s] = id;
        if self.status == LOBBY && self.humans() == 1 {
            for k in 0..SLOTS {
                if self.slots[k] == 0 {
                    self.slots[k] = BOT_BASE + k as u32;
                }
            }
        }
        if in_match {
            let t = self.team_of(s);
            if let Some(i) = self.index(old) {
                self.players.remove(i);
            }
            let at = self.spawn_point(t, s % 3);
            let mut p = Player::new(id, t, self.pilots.contains(&id), at);
            p.arm(self.class_of(id));
            if self.mode == mode::GOLIATH && s == GIANT_SLOT {
                p.make_giant();
            }
            p.shield_until = now + SPAWN_SHIELD_MS;
            self.players.push(p);
        }
        true
    }

    /// A place on `team`: a free one, or (in a match) one a bot holds.
    fn free_slot(&self, team: u8, take_bot: bool) -> Option<usize> {
        let range: Vec<usize> = match self.mode {
            mode::GOLIATH if team == RED => vec![GIANT_SLOT],
            mode::GOLIATH => (0..SLOTS).filter(|&s| s != GIANT_SLOT).collect(),
            mode::FFA => (0..SLOTS).collect(),
            _ if team == BLUE => (0..3).collect(),
            _ => (3..6).collect(),
        };
        range
            .iter()
            .copied()
            .find(|&i| self.slots[i] == 0)
            .or_else(|| {
                if take_bot {
                    range.iter().copied().find(|&i| is_bot(self.slots[i]))
                } else {
                    None
                }
            })
    }

    /// In the lobby, someone with a place puts a bot in place `slot` (`on`) or
    /// takes it out. Returns whether anything changed.
    pub fn set_bot(&mut self, by: u32, slot: usize, on: bool) -> bool {
        if self.status != LOBBY || self.slot_of(by).is_none() || slot >= SLOTS {
            return false;
        }
        match (on, self.slots[slot]) {
            (true, 0) => self.slots[slot] = BOT_BASE + slot as u32,
            (false, s) if is_bot(s) => self.slots[slot] = 0,
            _ => return false,
        }
        true
    }

    /// In the lobby, someone with a place picks how good the bots are.
    /// Returns whether it changed.
    pub fn set_level(&mut self, by: u32, level: u8) -> bool {
        let level = crate::level::clamp(level).min(crate::level::HARD);
        if self.status != LOBBY || self.slot_of(by).is_none() || self.level == level {
            return false;
        }
        self.level = level;
        true
    }

    /// Whether each side has someone (a player or a bot): a match can start.
    pub fn sides_filled(&self) -> bool {
        let filled = |s: usize| self.slots[s] != 0;
        match self.mode {
            // A giant, and someone to hunt it.
            mode::GOLIATH => filled(GIANT_SLOT) && (0..SLOTS).any(|s| s != GIANT_SLOT && filled(s)),
            // Two at least, to have a go at each other.
            mode::FFA => (0..SLOTS).filter(|&s| filled(s)).count() >= 2,
            _ => (0..3).any(filled) && (3..6).any(filled),
        }
    }

    /// `id` leaves: in a match, a bot takes their place (or, with no one
    /// left, it's called off).
    pub fn leave(&mut self, id: u32, now: u32) {
        let Some(s) = self.slot_of(id) else { return };
        let in_match = matches!(self.status, COUNTDOWN | PLAYING);
        self.slots[s] = 0;
        self.picks.retain(|p| p.0 != id);
        if !in_match {
            // Nobody left in the lobby: the bots go too (and the level's back to medium).
            if self.humans() == 0 {
                self.clear_bots();
                self.level = crate::level::MEDIUM;
            }
            return;
        }
        if self.humans() == 0 {
            self.back_to_lobby();
            return;
        }
        let bot = BOT_BASE + s as u32;
        self.slots[s] = bot;
        if let Some(i) = self.index(id) {
            let old = self.players[i].clone();
            let mut b = Player::new(bot, old.team, true, (old.x, old.y));
            b.class = old.class;
            b.giant = old.giant;
            b.ammo = old.ammo;
            b.reload_until = old.reload_until;
            b.hp = old.hp;
            b.out = old.out;
            b.respawn_at = old.respawn_at;
            b.kills = old.kills;
            b.deaths = old.deaths;
            b.shield_until = now + 600;
            self.players[i] = b;
            for f in self.flags.iter_mut() {
                if f.carrier == id {
                    f.carrier = bot;
                }
            }
        }
    }

    /// Back to the lobby: the same places (bots and all) for a rematch, unless nobody's left.
    fn back_to_lobby(&mut self) {
        self.status = LOBBY;
        self.players.clear();
        self.balls.clear();
        if self.humans() == 0 {
            self.clear_bots();
        }
        for p in self.pads.iter_mut() {
            p.kind = 0;
        }
    }

    fn clear_bots(&mut self) {
        for s in self.slots.iter_mut() {
            if is_bot(*s) {
                *s = 0;
            }
        }
    }

    /// The match begins (from the lobby): with `bots`, the empty places are
    /// filled; without, each side needs someone. Returns whether it started.
    pub fn start(&mut self, by: u32, bots: bool, now: u32) -> bool {
        if self.status != LOBBY || self.slot_of(by).is_none() {
            return false;
        }
        if bots {
            for s in 0..SLOTS {
                if self.slots[s] == 0 {
                    self.slots[s] = BOT_BASE + s as u32;
                }
            }
        } else if !self.sides_filled() {
            return false;
        }
        self.begin(now);
        true
    }

    /// Nobody's playing: the bots put on a match of their own, three a side
    /// (out in the city, there's always a game to watch, and bet on).
    /// Returns whether it started.
    pub fn exhibit(&mut self, now: u32) -> bool {
        if self.status != LOBBY || self.humans() > 0 {
            return false;
        }
        // (Each bots' match a different mode from the last.)
        let k = mode::EXHIBITED
            .iter()
            .position(|&m| m == self.mode)
            .map_or(0, |k| k + 1);
        self.mode = mode::EXHIBITED[k % mode::EXHIBITED.len()];
        for s in 0..SLOTS {
            self.slots[s] = BOT_BASE + s as u32;
        }
        self.begin(now);
        true
    }

    /// A match on with only bots in it (an exhibition).
    pub fn exhibition(&self) -> bool {
        self.status != LOBBY && self.humans() == 0
    }

    /// The bots' match is called off (someone's come to play): back to an
    /// empty lobby.
    pub fn call_off(&mut self) {
        if self.humans() == 0 {
            self.back_to_lobby();
        }
    }

    fn begin(&mut self, now: u32) {
        let turn = (now / 1000) as usize;
        let mix = [class::ASSAULT, class::SNIPER, class::SHOTGUN, class::GUNNER];
        self.bot_classes = [0, 1, 2].map(|k| mix[(k + turn) % mix.len()]);
        let classes: Vec<u8> = (0..SLOTS).map(|s| self.class_of(self.slots[s])).collect();
        self.players = (0..SLOTS)
            .filter(|&s| self.slots[s] != 0)
            .map(|s| {
                let t = self.team_of(s);
                let id = self.slots[s];
                let mut p = Player::new(
                    id,
                    t,
                    is_bot(id) || self.pilots.contains(&id),
                    self.spawn_point(t, s % 3),
                );
                p.arm(classes[s]);
                if self.mode == mode::GOLIATH && s == GIANT_SLOT {
                    p.make_giant();
                }
                p.ai.react_at = now + COUNTDOWN_MS;
                p
            })
            .collect();
        self.score = [0, 0];
        self.balls.clear();
        self.match_point = [false; 2];
        self.winner_id = 0;
        for f in self.flags.iter_mut() {
            f.go_home();
        }
        for p in self.points.iter_mut() {
            p.progress = 0.0;
            p.owner = 2;
        }
        self.point_bank = [0.0; 2];
        self.point_tick = now + COUNTDOWN_MS + POINT_TICK_MS;
        self.winner = 2;
        for p in self.pads.iter_mut() {
            p.kind = 0;
            p.next = now + COUNTDOWN_MS + 5000;
        }
        self.status = COUNTDOWN;
        self.phase_end = now + COUNTDOWN_MS;
    }

    fn spawn_point(&self, team: u8, k: usize) -> (f64, f64) {
        let sp = &self.field.spawns[team as usize];
        if sp.is_empty() {
            let x = if team == BLUE {
                1.5
            } else {
                self.field.w - 1.5
            };
            return (x, self.field.h / 2.0);
        }
        sp[k % sp.len()]
    }

    /// The client says where it is (and aims): taken if it could have got
    /// there, else as far as it could (and it's told: `fix`).
    pub fn claim_move(&mut self, id: u32, x: f64, y: f64, aim: f64, now: u32) {
        let Some(i) = self.index(id) else { return };
        let p = &mut self.players[i];
        p.aim = aim;
        if self.status != PLAYING || p.out {
            return;
        }
        // (At least 50 ms: moves that reach us in the same tick are still fair.)
        let dt = (now.saturating_sub(p.moved_at)).clamp(50, 500) as f64 / 1000.0;
        let dash = if now < p.dash_until + 250 {
            DASH_SPEED
        } else {
            SPEED * if p.giant { GIANT_SPEED } else { 1.0 }
        };
        let allowed = dash * dt * 1.4 + 0.4;
        let (dx, dy) = (x - p.x, y - p.y);
        let d = dx.hypot(dy);
        let (tx, ty) = if d <= allowed {
            (x, y)
        } else {
            (p.x + dx / d * allowed, p.y + dy / d * allowed)
        };
        let ok = d <= allowed && self.field.free(tx, ty, PLAYER_R - 0.05);
        let p = &mut self.players[i];
        if ok {
            p.vx = (tx - p.x) / dt;
            p.vy = (ty - p.y) / dt;
            p.x = tx;
            p.y = ty;
        } else {
            let (sx, sy) = self.field.slide(p.x, p.y, tx - p.x, ty - p.y, PLAYER_R);
            let p = &mut self.players[i];
            p.x = sx;
            p.y = sy;
            p.fix = p.fix.wrapping_add(1);
        }
        self.players[i].moved_at = now;
    }

    /// A roll: quick and untouchable, then a while before the next.
    pub fn dash(&mut self, id: u32, now: u32) -> Option<Event> {
        let i = self.index(id)?;
        let p = &mut self.players[i];
        if self.status != PLAYING || p.out || now < p.dash_ready {
            return None;
        }
        p.dash_until = now + DASH_MS;
        p.dash_ready = now + DASH_CD_MS;
        Some(Event {
            kind: ev::DASH,
            a: id,
            b: 0,
            x: p.x,
            y: p.y,
            n: 0,
        })
    }

    pub fn reload(&mut self, id: u32, now: u32) -> Option<Event> {
        let i = self.index(id)?;
        let p = &mut self.players[i];
        if p.out || p.reload_until > now || p.ammo >= p.gun().hopper {
            return None;
        }
        p.reload_until = now + p.gun().reload_ms;
        Some(Event {
            kind: ev::RELOAD,
            a: id,
            b: 0,
            x: p.x,
            y: p.y,
            n: 0,
        })
    }

    /// `id` fires shot `n` from (x, y) (near where they are) toward `aim`.
    pub fn fire(&mut self, id: u32, n: u16, x: f64, y: f64, aim: f64, now: u32) -> Option<Shot> {
        let i = self.index(id)?;
        let field = &self.field;
        let p = &mut self.players[i];
        if self.status != PLAYING || p.out || p.reload_until > now + RELOAD_SLACK_MS {
            return None;
        }
        // A reload all but done here is done (the shooter's clock ran it a beat ahead).
        if p.reload_until != 0 {
            p.reload_until = 0;
            p.ammo = p.gun().hopper;
        }
        // The rate: shots earn back a credit each fire_ms (up to a few), so
        // ones the network (or the tick) bunches together still count, but
        // nobody fires faster than the rate for long.
        // (A slow gun keeps fewer in hand: about a third of a second's worth, at least one.)
        let gap = p.fire_ms(now) as f64;
        let most = (1.0 + 340.0 / gap).min(3.0);
        p.fire_credit = (p.fire_credit + now.saturating_sub(p.credit_at) as f64 / gap).min(most);
        p.credit_at = now;
        if p.fire_credit < 0.7 {
            return None;
        }
        p.fire_credit -= 1.0;
        let rapid = p.powered(power::RAPID, now);
        if p.ammo == 0 && !rapid {
            return None;
        }
        let (ox, oy) = if (x - p.x).hypot(y - p.y) < 1.2 && field.free(x, y, 0.05) {
            (x, y)
        } else {
            (p.x, p.y)
        };
        p.last_fire = now;
        p.aim = aim;
        if !rapid {
            p.ammo -= 1;
        }
        // Shooting gives you away, and ends the spawn shield.
        p.shield_until = 0;
        p.ai.next_fire = p.ai.next_fire.max(now);
        let bounce = p.powered(power::BOUNCE, now);
        let spread = p.powered(power::SPREAD, now);
        let team = p.team;
        let class = p.class;
        let giant = p.giant;
        let g = p.gun();
        let auto_reload = p.ammo == 0 && !rapid;
        let reload_ms = g.reload_ms;
        let n = n & 0x0fff;
        // (The shooter's own gun: its class's, or the giant's.)
        for (k, off) in gun_pellets(g, spread).into_iter().enumerate() {
            self.balls.push(
                Ball::new(id, team, n | (k as u16) << 12, ox, oy, aim + off, bounce).fired_by(g),
            );
        }
        if auto_reload {
            self.players[i].reload_until = now + reload_ms;
        }
        Some(Shot {
            by: id,
            n,
            x: ox,
            y: oy,
            aim,
            kind: bounce as u8 | (spread as u8) << 1 | class << 2 | (giant as u8) << 4,
        })
    }

    /// A tick: the countdown, the bots, the balls, the hits, respawns,
    /// regen, the pads and the score. Returns what happened, and the bots' shots.
    pub fn step(
        &mut self,
        now: u32,
        dt_ms: u32,
        rng: &mut impl FnMut() -> f64,
    ) -> (Vec<Event>, Vec<Shot>) {
        let mut evs = Vec::new();
        let mut shots = Vec::new();
        match self.status {
            COUNTDOWN if now >= self.phase_end => {
                self.status = PLAYING;
                self.phase_end = now
                    + if self.mode == mode::GOLIATH {
                        GIANT_MATCH_MS
                    } else {
                        MATCH_MS
                    };
                for p in self.players.iter_mut() {
                    p.moved_at = now;
                    p.shield_until = now + 800;
                }
                evs.push(Event {
                    kind: ev::START,
                    a: 0,
                    b: 0,
                    x: 0.0,
                    y: 0.0,
                    n: 0,
                });
            }
            OVER if now >= self.phase_end => self.back_to_lobby(),
            _ => {}
        }
        if self.status != PLAYING {
            return (evs, shots);
        }
        let dt = dt_ms as f64 / 1000.0;
        // The bots think and move (and shoot), all from where everyone was as
        // the tick began: none of them sees where another's just moved to
        // (which favoured whichever side went second).
        // (Nor the balls another's just fired: those it sees next tick, as the others do.)
        let seen = self.players.clone();
        let balls_seen = self.balls.len();
        // (And they take turns going first, a tick each way: whatever's left of going second evens out.)
        let n = self.players.len();
        let flip = (now / 100) % 2 == 1;
        for k in 0..n {
            let i = if flip { n - 1 - k } else { k };
            if self.players[i].bot {
                self.bot(i, now, dt, rng, &mut shots, &mut evs, &seen, balls_seen);
            }
        }
        // Reloads finish; power-ups wear off; paint washes off; the out come back.
        for p in self.players.iter_mut() {
            if p.reload_until != 0 && now >= p.reload_until {
                p.reload_until = 0;
                p.ammo = p.gun().hopper;
            }
            if p.power != 0 && now >= p.power_until {
                p.power = 0;
                p.shield_hits = 0;
            }
            if p.out && now >= p.respawn_at {
                p.out = false;
                p.hp = p.max_hp();
                // Back as whatever they've picked since.
                let class = if p.bot {
                    p.class
                } else {
                    self.picks
                        .iter()
                        .find(|k| k.0 == p.id)
                        .map_or(p.class, |k| k.1)
                };
                p.arm(class);
                p.shield_until = now + SPAWN_SHIELD_MS;
                p.fix = p.fix.wrapping_add(1);
                p.moved_at = now;
                evs.push(Event {
                    kind: ev::RESPAWN,
                    a: p.id,
                    b: 0,
                    x: p.x,
                    y: p.y,
                    n: 0,
                });
            } else if !p.out
                && p.hp < p.max_hp()
                && now >= p.last_hit + REGEN_DELAY_MS
                && now >= p.next_regen
            {
                p.hp += 1;
                p.next_regen = now + REGEN_EVERY_MS;
            }
        }
        // Hidden in a hedge?
        for i in 0..self.players.len() {
            let p = &self.players[i];
            let hid = !p.out
                && self.field.in_hedge(p.x, p.y)
                && now >= p.last_fire + HIDE_AFTER_SHOT_MS
                && !self
                    .players
                    .iter()
                    .any(|q| self.foes(q, p) && !q.out && (q.x - p.x).hypot(q.y - p.y) < REVEAL_R);
            self.players[i].hidden = hid;
        }
        // The balls fly.
        let ffa = self.mode == mode::FFA;
        let mut balls = std::mem::take(&mut self.balls);
        let mut hits: Vec<(usize, usize, f64, f64, u8)> = Vec::new();
        balls.retain_mut(|b| {
            let players = &self.players;
            let (team, by) = (b.team, b.by);
            let flight = b.advance(&self.field, b.speed * dt, |x, y| {
                players.iter().position(|p| {
                    (if ffa { p.id != by } else { p.team != team })
                        && !p.out
                        && now >= p.dash_until
                        && (p.x - x).hypot(p.y - y) < p.hit_r()
                })
            });
            match flight {
                Flight::Flying => true,
                Flight::Splat(..) => false,
                Flight::Hit(i, x, y) => {
                    hits.push((usize::MAX, i, x, y, b.damage));
                    let k = hits.len() - 1;
                    // Who threw it.
                    hits[k].0 = players
                        .iter()
                        .position(|p| p.id == b.by)
                        .unwrap_or(usize::MAX);
                    evs.push(Event {
                        kind: 0,
                        a: b.by,
                        b: players[i].id,
                        x,
                        y,
                        n: b.n,
                    });
                    false
                }
            }
        });
        self.balls = balls;
        // Settle the hits (in order: each placeholder event above becomes its outcome).
        let mut hit_ev = evs
            .iter()
            .enumerate()
            .filter(|(_, e)| e.kind == 0)
            .map(|(k, _)| k)
            .collect::<Vec<_>>()
            .into_iter();
        let mut extra = Vec::new();
        for (shooter, victim, x, y, damage) in hits {
            let k = hit_ev.next().unwrap();
            let outcome = self.splat(shooter, victim, x, y, damage, now, &mut extra);
            evs[k].kind = outcome;
        }
        evs.extend(extra);
        // The pads.
        for k in 0..self.pads.len() {
            let pad = self.pads[k];
            if pad.kind == 0 && now >= pad.next {
                let kind =
                    power::ALL[(rng() * power::ALL.len() as f64) as usize % power::ALL.len()];
                self.pads[k].kind = kind;
                evs.push(Event {
                    kind: ev::PAD,
                    a: 0,
                    b: kind as u32,
                    x: pad.x,
                    y: pad.y,
                    n: 0,
                });
            } else if pad.kind != 0
                && let Some(p) = self
                    .players
                    .iter_mut()
                    .find(|p| !p.out && (p.x - pad.x).hypot(p.y - pad.y) < 0.75)
            {
                p.power = pad.kind;
                p.power_until = now + power::lasts(pad.kind);
                p.shield_hits = if pad.kind == power::SHIELD { 2 } else { 0 };
                if pad.kind == power::RAPID {
                    p.ammo = p.gun().hopper;
                    p.reload_until = 0;
                }
                evs.push(Event {
                    kind: ev::PICKUP,
                    a: p.id,
                    b: pad.kind as u32,
                    x: pad.x,
                    y: pad.y,
                    n: 0,
                });
                self.pads[k].kind = 0;
                self.pads[k].next = now + PAD_EVERY_MS;
            }
        }
        // Won? (Or out of time: the side ahead, or a draw.)
        // The flags and the point.
        match self.mode {
            mode::FLAG => self.step_flags(now, &mut evs),
            mode::POINT => self.step_point(now, dt, &mut evs),
            _ => {}
        }
        let to_win = self.to_win();
        let timeup = now >= self.phase_end;
        let won = if self.mode == mode::FFA {
            // The first to ten outs; or, out of time, whoever has most (alone).
            let mut best: Vec<&Player> = self.players.iter().collect();
            best.sort_by(|a, b| b.kills.cmp(&a.kills));
            let top = best.first().map(|p| (p.id, p.kills));
            let tied = best.len() > 1 && best[1].kills == best[0].kills;
            match top {
                Some((id, k)) if k >= to_win || (timeup && !tied) => {
                    self.winner_id = id;
                    Some(2)
                }
                Some(_) if timeup => Some(2),
                _ => None,
            }
        } else if self.mode == mode::GOLIATH {
            // Down: the hunters'. Fifteen hunters splatted, or still standing at the end: the giant's.
            if self.giant_down() {
                Some(BLUE)
            } else if self.score[1] >= to_win || timeup {
                Some(RED)
            } else {
                None
            }
        } else if self.score[0] >= to_win {
            Some(BLUE)
        } else if self.score[1] >= to_win {
            Some(RED)
        } else if timeup {
            Some(match self.score[0].cmp(&self.score[1]) {
                std::cmp::Ordering::Greater => BLUE,
                std::cmp::Ordering::Less => RED,
                std::cmp::Ordering::Equal => 2,
            })
        } else {
            None
        };
        if let Some(w) = won {
            self.winner = w;
            self.status = OVER;
            self.phase_end = now + RESULTS_MS;
            self.balls.clear();
            evs.push(Event {
                kind: ev::END,
                a: w as u32,
                b: 0,
                x: 0.0,
                y: 0.0,
                n: 0,
            });
        }
        (evs, shots)
    }

    /// A ball from `shooter` reached `victim`: shielded, a hit, or out.
    fn splat(
        &mut self,
        shooter: usize,
        victim: usize,
        x: f64,
        y: f64,
        damage: u8,
        now: u32,
        evs: &mut Vec<Event>,
    ) -> u8 {
        let shooter_id = self.players.get(shooter).map_or(0, |p| p.id);
        // (Hunting a person playing the giant: back in quicker.)
        let respawn =
            if self.mode == mode::GOLIATH && self.players.iter().any(|p| p.giant && !p.bot) {
                GOLIATH_RESPAWN_MS
            } else {
                RESPAWN_MS
            };
        let v = &mut self.players[victim];
        // Already out (another ball of the same shot, or someone else's, got
        // there first this tick): just paint on the grass, not a second out.
        if v.out {
            return ev::LATE;
        }
        if now < v.shield_until {
            return ev::SHIELDED;
        }
        if v.shield_hits > 0 && v.powered(power::SHIELD, now) {
            v.shield_hits -= 1;
            if v.shield_hits == 0 {
                v.power = 0;
            }
            return ev::SHIELDED;
        }
        let taken = damage.max(1).min(v.hp);
        v.hp -= taken;
        v.last_hit = now;
        if v.giant {
            self.score[BLUE as usize] = self.score[BLUE as usize].saturating_add(taken);
        }
        let v = &mut self.players[victim];
        v.next_regen = now + REGEN_DELAY_MS;
        if v.hp > 0 {
            return ev::HIT;
        }
        // Out: back to base, and a point to the others.
        let (vid, vteam, vstreak) = (v.id, v.team, v.streak);
        v.out = true;
        v.deaths += 1;
        v.streak = 0;
        v.power = 0;
        v.shield_hits = 0;
        v.respawn_at = now + respawn;
        v.reload_until = 0;
        let slot = self.slots.iter().position(|&s| s == vid).unwrap_or(0);
        let home = self.spawn_point(vteam, slot % 3);
        let v = &mut self.players[victim];
        v.x = home.0;
        v.y = home.1;
        let other = 1 - vteam as usize;
        match self.mode {
            mode::TEAM => self.score[other] = self.score[other].saturating_add(1),
            // (A hunter out: one for the giant. The giant out: it doesn't come back.)
            mode::GOLIATH if vteam == BLUE => {
                self.score[RED as usize] = self.score[RED as usize].saturating_add(1)
            }
            mode::GOLIATH => self.players[victim].respawn_at = u32::MAX,
            _ => {}
        }
        for (t, f) in self.flags.iter_mut().enumerate() {
            if f.carrier == vid {
                f.carrier = 0;
                f.dropped_at = now.max(1);
                f.x = x.clamp(0.5, self.field.w - 0.5);
                f.y = y.clamp(0.5, self.field.h - 0.5);
                evs.push(Event {
                    kind: ev::FLAG_DROPPED,
                    a: vid,
                    b: t as u32,
                    x: f.x,
                    y: f.y,
                    n: 0,
                });
            }
        }
        if let Some(s) = self.players.get_mut(shooter) {
            s.kills += 1;
            s.streak += 1;
            if s.streak == STREAK_HOT {
                evs.push(Event {
                    kind: ev::HOT,
                    a: s.id,
                    b: 0,
                    x: s.x,
                    y: s.y,
                    n: s.streak as u16,
                });
            }
        }
        if vstreak >= STREAK_HOT {
            evs.push(Event {
                kind: ev::SHUTDOWN,
                a: shooter_id,
                b: vid,
                x,
                y,
                n: vstreak as u16,
            });
        }
        if self.mode == mode::TEAM && self.score[other] == TO_WIN - 1 && !self.match_point[other] {
            self.match_point[other] = true;
            evs.push(Event {
                kind: ev::MATCH_POINT,
                a: other as u32,
                b: 0,
                x: 0.0,
                y: 0.0,
                n: 0,
            });
        }
        ev::OUT
    }

    // ---- the objectives ------------------------------------------------------

    /// Capture the Flag: carried flags go with their carriers; a flag on the
    /// ground is taken by the other side, sent home by its own (or by
    /// itself, after a while); theirs brought to yours, while yours is home,
    /// is a capture.
    fn step_flags(&mut self, now: u32, evs: &mut Vec<Event>) {
        let mut caps: Vec<(u32, u8, usize)> = Vec::new();
        for t in 0..2usize {
            let f = self.flags[t];
            if f.carrier != 0 {
                match self.players.iter().find(|p| p.id == f.carrier && !p.out) {
                    Some(p) => {
                        self.flags[t].x = p.x;
                        self.flags[t].y = p.y;
                        // Home with it, while ours is there: a capture.
                        let mine = self.flags[1 - t];
                        if mine.is_home()
                            && (p.x - mine.home.0).hypot(p.y - mine.home.1) < FLAG_R * 1.4
                        {
                            caps.push((p.id, p.team, t));
                        }
                    }
                    // (Gone without being splatted: home it goes.)
                    None => self.flags[t].go_home(),
                }
                continue;
            }
            if f.dropped_at != 0 && now >= f.dropped_at + FLAG_RETURN_MS {
                self.flags[t].go_home();
                evs.push(Event {
                    kind: ev::FLAG_RETURNED,
                    a: 0,
                    b: t as u32,
                    x: f.home.0,
                    y: f.home.1,
                    n: 0,
                });
                continue;
            }
            let by = self
                .players
                .iter()
                .filter(|p| !p.out && (p.x - f.x).hypot(p.y - f.y) < FLAG_R)
                .min_by(|a, b| {
                    (a.x - f.x)
                        .hypot(a.y - f.y)
                        .total_cmp(&(b.x - f.x).hypot(b.y - f.y))
                })
                .map(|p| (p.id, p.team));
            match by {
                Some((id, team)) if team as usize != t => {
                    self.flags[t].carrier = id;
                    self.flags[t].dropped_at = 0;
                    evs.push(Event {
                        kind: ev::FLAG_TAKEN,
                        a: id,
                        b: t as u32,
                        x: f.x,
                        y: f.y,
                        n: 0,
                    });
                }
                Some((id, _)) if f.dropped_at != 0 => {
                    self.flags[t].go_home();
                    evs.push(Event {
                        kind: ev::FLAG_RETURNED,
                        a: id,
                        b: t as u32,
                        x: f.home.0,
                        y: f.home.1,
                        n: 0,
                    });
                }
                _ => {}
            }
        }
        for (id, team, t) in caps {
            self.flags[t].go_home();
            let k = team as usize;
            self.score[k] = self.score[k].saturating_add(1);
            let (x, y) = self.flags[1 - t].home;
            evs.push(Event {
                kind: ev::FLAG_CAPTURED,
                a: id,
                b: t as u32,
                x,
                y,
                n: self.score[k] as u16,
            });
            if self.score[k] + 1 == self.to_win() && !self.match_point[k] {
                self.match_point[k] = true;
                evs.push(Event {
                    kind: ev::MATCH_POINT,
                    a: k as u32,
                    b: 0,
                    x: 0.0,
                    y: 0.0,
                    n: 0,
                });
            }
        }
    }

    /// Control Point: on each point, whoever's on it takes it (one alone
    /// does; two twice as fast, three three times; with the others on it
    /// too, the side with more, by how many more; even, it holds), back
    /// through nobody's if it was the others'; nobody on it, it settles back
    /// to whoever has it. Every second each scores for its owners.
    fn step_point(&mut self, now: u32, dt: f64, evs: &mut Vec<Event>) {
        for k in 0..self.points.len() {
            self.step_one_point(k, dt, evs);
        }
        if now >= self.point_tick {
            self.point_tick = now + POINT_TICK_MS;
            for p in &self.points {
                if p.owner < 2 {
                    self.point_bank[p.owner as usize] += p.value;
                }
            }
            for k in 0..2 {
                let whole = self.point_bank[k].floor();
                self.point_bank[k] -= whole;
                self.score[k] = self.score[k].saturating_add(whole as u8);
                if self.score[k] + 25 >= self.to_win() && !self.match_point[k] {
                    self.match_point[k] = true;
                    evs.push(Event {
                        kind: ev::MATCH_POINT,
                        a: k as u32,
                        b: 0,
                        x: 0.0,
                        y: 0.0,
                        n: 0,
                    });
                }
            }
        }
    }

    fn step_one_point(&mut self, k: usize, dt: f64, evs: &mut Vec<Event>) {
        let pt = self.points[k];
        let on = |t: u8| {
            self.players
                .iter()
                .filter(|p| p.team == t && !p.out && pt.on(p.x, p.y))
                .count()
        };
        let (blue, red) = (on(BLUE), on(RED));
        // The side with more on it pushes it their way, as fast as how many more; even, it holds.
        let rate = |n: usize| POINT_RATE * n as f64 * dt;
        let mut p = pt.progress;
        if blue > red {
            p -= rate(blue - red);
        } else if red > blue {
            p += rate(red - blue);
        } else if blue == 0 && red == 0 {
            // Nobody on it: back to whose it is (or to nobody's), slowly.
            let rest = match pt.owner {
                BLUE => -100.0,
                RED => 100.0,
                _ => 0.0,
            };
            let d = rest - p;
            p += d.signum() * d.abs().min(10.0 * dt);
        }
        p = p.clamp(-100.0, 100.0);
        self.points[k].progress = p;
        let was = pt.owner;
        let owner = if p <= -100.0 {
            BLUE
        } else if p >= 100.0 {
            RED
        } else if (was == BLUE && p > 0.0) || (was == RED && p < 0.0) {
            2
        } else {
            was
        };
        if owner != was {
            self.points[k].owner = owner;
            let who = self
                .players
                .iter()
                .find(|q| q.team == owner && !q.out && pt.on(q.x, q.y))
                .map_or(0, |q| q.id);
            evs.push(Event {
                kind: ev::POINT_TAKEN,
                a: who,
                b: owner as u32,
                x: pt.x,
                y: pt.y,
                n: k as u16,
            });
        }
    }

    /// The middle of the open tile nearest (x, y): somewhere to stand.
    fn open_near(&self, x: f64, y: f64) -> (f64, f64) {
        // (The nearest by distance, not the first found: a search that always
        // looked one way first put one side's spots forward and the other's back.)
        let (cx, cy) = (x.floor() + 0.5, y.floor() + 0.5);
        let mut best: Option<(f64, (f64, f64))> = None;
        for dy in -3..=3i32 {
            for dx in -3..=3i32 {
                let (tx, ty) = (cx + dx as f64, cy + dy as f64);
                if tx <= 0.0
                    || ty <= 0.0
                    || tx >= self.field.w
                    || ty >= self.field.h
                    || !self.field.free(tx, ty, PLAYER_R)
                {
                    continue;
                }
                let d = (tx - x).hypot(ty - y);
                if best.is_none_or(|b| d < b.0 - 1e-9) {
                    best = Some((d, (tx, ty)));
                }
            }
        }
        best.map_or((x, y), |b| b.1)
    }

    /// Where a bot's after, the match's objective (field tiles), and whether
    /// it goes there whatever it's fighting: a flag-carrier runs for home; on
    /// Control Point, anyone off the ring makes for it.
    fn objective(&self, me: &Player, slot: usize, seen: &[Player]) -> Option<((f64, f64), bool)> {
        match self.mode {
            mode::FLAG => {
                let t = me.team as usize;
                let (mine, theirs) = (self.flags[t], self.flags[1 - t]);
                if theirs.carrier == me.id {
                    return Some((mine.home, true));
                }
                // Ours taken or lying about: after it. Else one keeps guard, the rest go for theirs.
                if !mine.is_home() {
                    return Some(((mine.x, mine.y), false));
                }
                if slot % 3 == 2 {
                    let off = if me.team == BLUE { 2.5 } else { -2.5 };
                    return Some(((mine.home.0 + off, mine.home.1), false));
                }
                if theirs.carrier != 0 {
                    // A teammate has it: go with them.
                    return seen
                        .iter()
                        .find(|p| p.id == theirs.carrier)
                        .map(|p| ((p.x, p.y), false));
                }
                Some(((theirs.x, theirs.y), false))
            }
            mode::POINT => {
                // Its points, ours first: one makes for ours, then the middle; the others the
                // middle, then whichever. The first that isn't safely ours (taken, nobody of
                // theirs on it), or the middle if all are.
                let n = self.points.len();
                if n == 0 {
                    return None;
                }
                let (own, mid, far) = if me.team == BLUE {
                    (0, n / 2, n - 1)
                } else {
                    (n - 1, n / 2, 0)
                };
                let order = match slot % 3 {
                    0 => [own, mid, far],
                    1 => [mid, far, own],
                    _ => [mid, own, far],
                };
                let safe = |k: usize| {
                    let p = self.points[k];
                    p.owner == me.team
                        && p.progress.abs() >= 100.0
                        && !seen
                            .iter()
                            .any(|q| q.team != me.team && !q.out && p.on(q.x, q.y))
                };
                let k = order.into_iter().find(|&k| !safe(k)).unwrap_or(mid);
                let pt = self.points[k];
                let off = (me.x - pt.x).hypot(me.y - pt.y) > pt.r - 0.6;
                // On it with one of theirs (out of sight round the bunker): go and find them.
                let rival = seen
                    .iter()
                    .filter(|q| q.team != me.team && !q.out && pt.on(q.x, q.y))
                    .min_by(|a, b| {
                        (a.x - me.x)
                            .hypot(a.y - me.y)
                            .total_cmp(&(b.x - me.x).hypot(b.y - me.y))
                    });
                if !off && let Some(q) = rival {
                    return Some(((q.x, q.y), false));
                }
                // (Each a spot of its own round the ring; Red's the mirror of Blue's.)
                let k = (slot % 3) as f64 * 2.1;
                let a = if me.team == BLUE { PI + k } else { -k };
                let spot =
                    self.open_near(pt.x + a.cos() * pt.r * 0.6, pt.y + a.sin() * pt.r * 0.45);
                Some((spot, off))
            }
            _ => None,
        }
    }

    // ---- the bots ----------------------------------------------------------

    fn bot(
        &mut self,
        i: usize,
        now: u32,
        dt: f64,
        rng: &mut impl FnMut() -> f64,
        shots: &mut Vec<Shot>,
        evs: &mut Vec<Event>,
        seen: &[Player],
        balls_seen: usize,
    ) {
        if self.players[i].out {
            return;
        }
        let me = self.players[i].clone();
        // (Hunting a person playing the giant: a level sharper.)
        let boost = self.mode == mode::GOLIATH
            && !me.giant
            && self.players.iter().any(|p| p.giant && !p.bot);
        // (A bot playing as a player: the server plays its seat, as sharp as bots come.)
        let piloted = !is_bot(me.id);
        let sk = skill(if piloted {
            crate::level::HARD
        } else if boost {
            (self.level + 1).min(crate::level::HARD)
        } else {
            self.level
        });
        // Who can it see (as everyone was at the tick's start)?
        let target = seen
            .iter()
            .filter(|q| {
                self.foes(&me, q)
                    && !q.out
                    && (!q.hidden || (q.x - me.x).hypot(q.y - me.y) < REVEAL_R)
            })
            .filter(|q| {
                (q.x - me.x).hypot(q.y - me.y) < sk.sight
                    && self.field.clear_line(me.x, me.y, q.x, q.y)
            })
            .min_by(|a, b| {
                let da = (a.x - me.x).hypot(a.y - me.y);
                let db = (b.x - me.x).hypot(b.y - me.y);
                da.total_cmp(&db)
            })
            .cloned();
        let ai = &mut self.players[i].ai;
        match &target {
            Some(t) if ai.target != Some(t.id) => {
                ai.target = Some(t.id);
                ai.react_at = now + (sk.react.0 + rng() * sk.react.1) as u32;
            }
            None => ai.target = None,
            _ => {}
        }
        // Where to go: the objective, if it's pressing; else at whoever's in sight; else about.
        let slot = self.slots.iter().position(|&s| s == me.id).unwrap_or(0);
        let objective = self.objective(&me, slot, seen);
        let ai = &mut self.players[i].ai;
        let (mut mx, mut my) = (0.0, 0.0);
        let rush = objective.is_some_and(|o| o.1) || (objective.is_some() && target.is_none());
        if rush && let Some(((gx, gy), _)) = objective {
            let g = (gx.floor().max(0.0) as usize, gy.floor().max(0.0) as usize);
            if ai.goal != Some(g) || ai.nav.is_empty() {
                ai.goal = Some(g);
                ai.nav = nav_field(&self.field, g);
            }
            if let Some((nx, ny)) = nav_step(&self.field, &ai.nav, me.x, me.y) {
                let (dx, dy) = (nx - me.x, ny - me.y);
                let d = dx.hypot(dy);
                if d > 0.05 {
                    mx = dx / d;
                    my = dy / d;
                }
            } else {
                let (dx, dy) = (gx - me.x, gy - me.y);
                let d = dx.hypot(dy);
                if d > 0.3 {
                    mx = dx / d;
                    my = dy / d;
                }
            }
        } else if let Some(t) = &target {
            let (dx, dy) = (t.x - me.x, t.y - me.y);
            let d = dx.hypot(dy).max(0.01);
            let (ux, uy) = (dx / d, dy / d);
            if now >= ai.strafe_until {
                ai.strafe = if rng() < 0.5 { -1.0 } else { 1.0 } * (0.6 + rng() * 0.4);
                ai.strafe_until = now + 500 + (rng() * 900.0) as u32;
            }
            // Keep a fighting distance; back off when hurt and the other isn't.
            let want = if me.hp == 1 && t.hp > 1 { sk.wary } else { 5.5 };
            let radial = ((d - want) / 2.0).clamp(-1.0, 1.0);
            mx = ux * radial - uy * ai.strafe;
            my = uy * radial + ux * ai.strafe;
        } else {
            // Nobody in sight: a power-up nearby, else out to somewhere on their side.
            let pad = self
                .pads
                .iter()
                .filter(|p| p.kind != 0 && (p.x - me.x).hypot(p.y - me.y) < sk.pad_r)
                .min_by(|a, b| {
                    (a.x - me.x)
                        .hypot(a.y - me.y)
                        .total_cmp(&(b.x - me.x).hypot(b.y - me.y))
                })
                .copied();
            let goal_tile =
                |x: f64, y: f64| (x.floor().max(0.0) as usize, y.floor().max(0.0) as usize);
            let want = match pad {
                Some(p) => Some(goal_tile(p.x, p.y)),
                None if ai.goal.is_none() || now >= ai.goal_until => {
                    // Somewhere across the middle, toward them.
                    let (w, h) = (self.field.w, self.field.h);
                    let x = if me.team == BLUE {
                        w * (0.45 + rng() * 0.35)
                    } else {
                        w * (0.2 + rng() * 0.35)
                    };
                    let y = 1.5 + rng() * (h - 3.0);
                    ai.goal_until = now + 2500 + (rng() * 3000.0) as u32;
                    Some(goal_tile(x, y))
                }
                None => ai.goal,
            };
            if want != ai.goal || ai.nav.is_empty() {
                ai.goal = want;
                ai.nav = want.map(|g| nav_field(&self.field, g)).unwrap_or_default();
            }
            if let Some(g) = ai.goal
                && let Some((nx, ny)) = nav_step(&self.field, &ai.nav, me.x, me.y)
            {
                let (dx, dy) = (nx - me.x, ny - me.y);
                let d = dx.hypot(dy);
                if d > 0.05 {
                    mx = dx / d;
                    my = dy / d;
                }
                if (me.x.floor() as usize, me.y.floor() as usize) == g {
                    ai.goal_until = now;
                }
            }
        }
        // Dodge a ball coming at it.
        let threat = self.balls[..balls_seen.min(self.balls.len())]
            .iter()
            .any(|b| {
                if (self.mode == mode::FFA && b.by == me.id)
                    || (self.mode != mode::FFA && b.team == me.team)
                {
                    return false;
                }
                let (rx, ry) = (me.x - b.x, me.y - b.y);
                let along = rx * b.vx + ry * b.vy;
                along > 0.0 && along < 4.0 && (rx * b.vy - ry * b.vx).abs() < 0.7
            });
        let can_dash = now >= me.dash_ready;
        let len = mx.hypot(my);
        if len > 1.0 {
            mx /= len;
            my /= len;
        }
        let ai_wobble = {
            let ai = &mut self.players[i].ai;
            ai.wobble =
                (ai.wobble * 0.6 + (rng() - 0.5) * sk.wobble.0).clamp(-sk.wobble.1, sk.wobble.1);
            ai.wobble
        };
        if threat
            && can_dash
            && rng() < sk.dodge
            && let Some(e) = self.dash(me.id, now)
        {
            evs.push(e);
        }
        let p = &mut self.players[i];
        let speed = if now < p.dash_until {
            DASH_SPEED
        } else {
            SPEED * sk.speed * if p.giant { GIANT_SPEED } else { 1.0 }
        };
        let (dx, dy) = if now < p.dash_until && len < 0.1 {
            (p.aim.cos(), p.aim.sin())
        } else {
            (mx, my)
        };
        let (nx, ny) = self
            .field
            .slide(p.x, p.y, dx * speed * dt, dy * speed * dt, PLAYER_R);
        let p = &mut self.players[i];
        p.vx = (nx - p.x) / dt;
        p.vy = (ny - p.y) / dt;
        p.x = nx;
        p.y = ny;
        // Aim (leading a little) and shoot.
        if let Some(t) = &target {
            let d = (t.x - p.x).hypot(t.y - p.y);
            let lead = d / p.gun().speed * sk.lead;
            let in_reach = d <= p.gun().range + 0.5;
            let (ax, ay) = (t.x + t.vx * lead, t.y + t.vy * lead);
            let moving = (t.vx.hypot(t.vy) > 1.0) as u8 as f64;
            let aim = (ay - p.y).atan2(ax - p.x) + ai_wobble * (0.6 + moving);
            p.aim = aim;
            if in_reach && now >= p.ai.react_at && now >= p.ai.next_fire && p.reload_until <= now {
                if p.ammo == 0 && !p.powered(power::RAPID, now) {
                    p.reload_until = now + p.gun().reload_ms;
                } else {
                    // Bursts of three to five, then a breather (the giant: long sprays, short breaths).
                    if p.ai.burst == 0 {
                        p.ai.burst = if p.giant {
                            12 + (rng() * 10.0) as u8
                        } else {
                            sk.burst.0 + (rng() * sk.burst.1) as u8
                        };
                    }
                    p.ai.burst -= 1;
                    let gap = if p.ai.burst == 0 {
                        (if p.giant {
                            250.0 + rng() * 350.0
                        } else {
                            sk.pause.0 + rng() * sk.pause.1
                        }) as u32
                    } else {
                        p.fire_ms(now) + (sk.slack.0 + rng() * sk.slack.1) as u32
                    };
                    p.ai.next_fire = now + gap;
                    p.last_fire = now.saturating_sub(1000);
                    self.next_bot_shot = self.next_bot_shot.wrapping_add(1) & 0x0fff;
                    let (id, x, y, n) = (p.id, p.x, p.y, self.next_bot_shot);
                    if let Some(s) = self.fire(id, n, x, y, aim, now) {
                        shots.push(s);
                    }
                }
            }
        } else {
            if len > 0.1 {
                p.aim = my.atan2(mx);
            }
            if p.ammo < p.gun().hopper / 2 && p.reload_until <= now {
                p.reload_until = now + p.gun().reload_ms;
            }
        }
    }
}

/// Steps to `goal` from every tile (8 ways, no corner cutting), 0xffff where it can't.
fn nav_field(field: &Field, goal: (usize, usize)) -> Vec<u16> {
    let (cols, rows) = (field.cols(), field.rows());
    let mut d = vec![u16::MAX; cols * rows];
    let g = (goal.0.min(cols - 1), goal.1.min(rows - 1));
    let mut q = std::collections::VecDeque::new();
    d[g.1 * cols + g.0] = 0;
    q.push_back(g);
    while let Some((x, y)) = q.pop_front() {
        let here = d[y * cols + x];
        for (dx, dy) in [
            (1i32, 0i32),
            (-1, 0),
            (0, 1),
            (0, -1),
            (1, 1),
            (1, -1),
            (-1, 1),
            (-1, -1),
        ] {
            let (nx, ny) = (x as i32 + dx, y as i32 + dy);
            if nx < 0 || ny < 0 || nx >= cols as i32 || ny >= rows as i32 {
                continue;
            }
            let (nx, ny) = (nx as usize, ny as usize);
            if !field.open_tile(nx, ny) || d[ny * cols + nx] != u16::MAX {
                continue;
            }
            if dx != 0 && dy != 0 && (!field.open_tile(x, ny) || !field.open_tile(nx, y)) {
                continue;
            }
            d[ny * cols + nx] = here + 1;
            q.push_back((nx, ny));
        }
    }
    d
}

/// The middle of the next tile on the way, from (x, y).
fn nav_step(field: &Field, nav: &[u16], x: f64, y: f64) -> Option<(f64, f64)> {
    let cols = field.cols();
    let (cx, cy) = (x.floor() as i32, y.floor() as i32);
    let at = |tx: i32, ty: i32| -> u16 {
        if tx < 0 || ty < 0 || tx >= cols as i32 || ty >= field.rows() as i32 {
            u16::MAX
        } else {
            nav[ty as usize * cols + tx as usize]
        }
    };
    let here = at(cx, cy);
    if here == 0 {
        return Some((cx as f64 + 0.5, cy as f64 + 0.5));
    }
    let mut best = (here, None);
    for (dx, dy) in [
        (1, 0),
        (-1, 0),
        (0, 1),
        (0, -1),
        (1, 1),
        (1, -1),
        (-1, 1),
        (-1, -1),
    ] {
        let v = at(cx + dx, cy + dy);
        if v < best.0 {
            best = (v, Some((cx + dx, cy + dy)));
        }
    }
    best.1.map(|(tx, ty)| (tx as f64 + 0.5, ty as f64 + 0.5))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn field() -> Field {
        Field {
            w: 40.0,
            h: 24.0,
            obstacles: vec![
                Obstacle {
                    kind: ob::HAY,
                    x: 10.0,
                    y: 11.0,
                    w: 2.0,
                    h: 1.0,
                },
                Obstacle {
                    kind: ob::DRUM,
                    x: 20.0,
                    y: 5.0,
                    w: 1.0,
                    h: 1.0,
                },
                Obstacle {
                    kind: ob::HEDGE,
                    x: 30.0,
                    y: 11.0,
                    w: 2.0,
                    h: 2.0,
                },
            ],
            spawns: [
                vec![(1.5, 10.5), (1.5, 12.5), (1.5, 14.5)],
                vec![(38.5, 10.5), (38.5, 12.5), (38.5, 14.5)],
            ],
            pads: vec![(20.5, 2.5), (20.5, 21.5)],
        }
    }

    fn rng() -> impl FnMut() -> f64 {
        let mut s = 12345u64;
        move || {
            s = s
                .wrapping_mul(6364136223846793005)
                .wrapping_add(1442695040888963407);
            (s >> 11) as f64 / (1u64 << 53) as f64
        }
    }

    fn yard() -> Field {
        let text = std::fs::read_to_string(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../../assets/maps/paintball.json"
        ))
        .unwrap();
        let map = crate::map::MapFile::from_json(&text).unwrap();
        Field::from_map(&map.objects).unwrap().0
    }

    #[test]
    fn the_yard_is_open_end_to_end_and_fair() {
        let f = yard();
        assert_eq!((f.w, f.h), (40.0, 24.0));
        assert_eq!(f.spawns[0].len(), 3);
        assert_eq!(f.pads.len(), 2);
        for side in 0..2 {
            for &(x, y) in &f.spawns[side] {
                assert!(f.free(x, y, PLAYER_R), "spawn {x},{y} is clear");
            }
        }
        // From every spawn, the other base can be reached.
        let red = f.spawns[1][1];
        let nav = nav_field(&f, (red.0 as usize, red.1 as usize));
        for &(x, y) in &f.spawns[0] {
            assert!(
                nav[y as usize * 40 + x as usize] < u16::MAX,
                "blue {x},{y} reaches red"
            );
        }
        // Mirrored: each obstacle has its twin.
        for o in &f.obstacles {
            assert!(
                f.obstacles.iter().any(|p| p.kind == o.kind
                    && (p.x - (f.w - o.x - o.w)).abs() < 1e-9
                    && p.y == o.y),
                "{o:?} has a twin"
            );
        }
    }

    #[test]
    fn bot_matches_on_the_yard_last_a_while() {
        let mut total = 0;
        for seed in 0..4u64 {
            let mut m = Match::new(yard());
            m.join(1, BLUE, 0);
            m.start(1, true, 0);
            m.leave(1, 0);
            // (Called off with nobody left: so a bot-only match, by hand.)
            m.join(1, BLUE, 0);
            m.start(1, true, 0);
            let i = m.players.iter().position(|p| p.id == 1).unwrap();
            m.players[i].bot = true;
            let mut s = 99 + seed * 7919;
            let mut r = move || {
                s = s
                    .wrapping_mul(6364136223846793005)
                    .wrapping_add(1442695040888963407);
                (s >> 11) as f64 / (1u64 << 53) as f64
            };
            let mut now = 0;
            let mut shots = 0;
            while m.status != OVER && now < MATCH_MS + 10_000 {
                now += 100;
                shots += m.step(now, 100, &mut r).1.len();
            }
            eprintln!("YARD: {}s, {:?}, {shots} shots", now / 1000, m.score);
            total += now;
        }
        let avg = total / 4 / 1000;
        // (The bots play a mix of classes: snipers and shotguns end fights quicker.)
        assert!(
            (75..=420).contains(&avg),
            "a bot match takes {avg}s on average"
        );
    }

    #[test]
    fn the_lobby_gets_bots_to_take_out_or_put_back() {
        let mut m = Match::new(field());
        assert!(m.join(7, BLUE, 0));
        assert_eq!(
            m.slots.iter().filter(|&&s| is_bot(s)).count(),
            5,
            "bots everywhere else"
        );
        // Out with the red bots: no one on red, so no match.
        for k in 3..6 {
            assert!(m.set_bot(7, k, false));
        }
        assert!(!m.set_bot(9, 1, false), "only those in can");
        assert!(!m.start(7, false, 0));
        // One back: a 3 v 1.
        assert!(m.set_bot(7, 4, true));
        assert!(!m.set_bot(7, 4, true), "already there");
        // Someone else comes for red: they take a free place, not the bot's.
        assert!(m.join(8, RED, 0));
        assert_eq!(m.slot_of(8), Some(3));
        // And a third, for blue: a bot steps aside.
        assert!(m.join(9, BLUE, 0));
        assert_eq!(m.slots.iter().filter(|&&s| is_bot(s)).count(), 2);
        // Switching sides.
        assert!(m.join(9, RED, 0));
        assert_eq!(team_of_slot(m.slot_of(9).unwrap()), RED);
        assert_eq!(m.slots.iter().filter(|&&s| s != 0).count(), 5);
        // The level: picked by those in, in the lobby.
        assert!(m.set_level(7, crate::level::HARD));
        // (No extreme here: the Splat Yard's bots go up to hard.)
        assert!(!m.set_level(7, crate::level::EXTREME));
        assert_eq!(m.level, crate::level::HARD);
        assert!(!m.set_level(42, crate::level::EASY));
        assert!(m.start(7, false, 0));
        assert_eq!(m.players.len(), 5);
        assert!(!m.set_level(7, crate::level::EASY), "not mid-match");
        // Everyone gone: the bots go, the level's back to medium.
        let mut m = Match::new(field());
        m.join(7, BLUE, 0);
        m.set_level(7, crate::level::EASY);
        m.leave(7, 0);
        assert!(m.slots.iter().all(|&s| s == 0));
        assert_eq!(m.level, crate::level::MEDIUM);
    }

    #[test]
    fn harder_bots_hit_harder() {
        // One red bot against someone standing about in the open: how often it gets them.
        let outs = |level: u8| {
            let mut total = 0;
            for seed in 0..4u64 {
                let mut m = Match::new(field());
                m.join(1, BLUE, 0);
                for k in [0, 1, 2, 4, 5] {
                    m.set_bot(1, k, false);
                }
                m.set_level(1, level);
                assert!(m.start(1, false, 0));
                let mut s = 7 + seed * 104_729;
                let mut r = move || {
                    s = s
                        .wrapping_mul(6364136223846793005)
                        .wrapping_add(1442695040888963407);
                    (s >> 11) as f64 / (1u64 << 53) as f64
                };
                let mut now = 0;
                while now < COUNTDOWN_MS + 60_000 {
                    now += 100;
                    let me = m.players.iter_mut().find(|p| p.id == 1).unwrap();
                    if !me.out {
                        me.x = 12.0;
                        me.y = 6.0;
                    }
                    total += m
                        .step(now, 100, &mut r)
                        .0
                        .iter()
                        .filter(|e| e.kind == ev::OUT)
                        .count();
                }
            }
            total
        };
        let (easy, medium, hard) = (
            outs(crate::level::EASY),
            outs(crate::level::MEDIUM),
            outs(crate::level::HARD),
        );
        eprintln!("PB LEVELS: easy {easy}, medium {medium}, hard {hard}");
        assert!(
            easy < medium && medium < hard,
            "easy {easy}, medium {medium}, hard {hard}"
        );
    }

    #[test]
    fn lobby_fills_with_bots_and_counts_down() {
        let mut m = Match::new(field());
        assert!(m.join(7, BLUE, 0));
        assert!(!m.start(8, true, 0), "only those in can start");
        assert!(m.start(7, true, 0));
        assert_eq!(m.players.len(), 6);
        assert_eq!(m.slots.iter().filter(|&&s| is_bot(s)).count(), 5);
        let mut r = rng();
        let (evs, _) = m.step(COUNTDOWN_MS, 100, &mut r);
        assert_eq!(m.status, PLAYING);
        assert!(evs.iter().any(|e| e.kind == ev::START));
    }

    #[test]
    fn three_hits_put_you_out_and_score() {
        let mut m = Match::new(field());
        m.join(1, BLUE, 0);
        m.join(2, RED, 0);
        for k in 0..SLOTS {
            m.set_bot(1, k, false);
        }
        assert!(m.start(1, false, 0));
        let mut r = rng();
        m.step(COUNTDOWN_MS, 100, &mut r);
        let t0 = COUNTDOWN_MS + 2000;
        // Face to face across open grass.
        m.players[0].x = 5.0;
        m.players[0].y = 5.0;
        m.players[1].x = 9.0;
        m.players[1].y = 5.0;
        m.players[1].shield_until = 0;
        let mut outs = 0;
        let mut now = t0;
        for k in 0..3u16 {
            now += 300;
            m.players[1].x = 9.0;
            m.players[1].y = 5.0;
            assert!(m.fire(1, k, 5.0, 5.0, 0.0, now).is_some());
            for _ in 0..5 {
                now += 100;
                let (evs, _) = m.step(now, 100, &mut r);
                outs += evs.iter().filter(|e| e.kind == ev::OUT).count();
            }
        }
        assert_eq!(outs, 1);
        assert_eq!(m.score, [1, 0]);
        assert!(m.players[1].out);
        // Back in after a while, shielded.
        let (evs, _) = m.step(now + RESPAWN_MS, 100, &mut r);
        assert!(evs.iter().any(|e| e.kind == ev::RESPAWN));
        assert!(!m.players[1].out);
    }

    /// Two people face to face (1 Blue at (5, 5) as `class_1`, 2 Red `gap` east), playing.
    fn duel(class_1: u8, gap: f64) -> (Match, impl FnMut() -> f64, u32) {
        let mut m = Match::new(field());
        m.join(1, BLUE, 0);
        m.join(2, RED, 0);
        for k in 0..SLOTS {
            m.set_bot(1, k, false);
        }
        assert!(m.pick_class(1, class_1));
        assert!(m.start(1, false, 0));
        let mut r = rng();
        m.step(COUNTDOWN_MS, 100, &mut r);
        // (Along y = 8: clear of the drum.)
        m.players[0].x = 5.0;
        m.players[0].y = 8.0;
        m.players[1].x = 5.0 + gap;
        m.players[1].y = 8.0;
        m.players[1].shield_until = 0;
        (m, r, COUNTDOWN_MS + 2000)
    }

    #[test]
    fn each_class_has_its_gun() {
        // Picked in the lobby: armed with it from the start.
        let mut m = Match::new(field());
        m.join(1, BLUE, 0);
        assert!(m.pick_class(1, class::GUNNER));
        assert!(!m.pick_class(1, class::COUNT), "no such class");
        assert!(!m.pick_class(9, class::SNIPER), "not playing");
        m.start(1, true, 0);
        let p = m.player(1).unwrap();
        assert_eq!((p.class, p.ammo), (class::GUNNER, 50));
        // The machine gun fires quicker than the assault, its balls slower; the sniper the other way.
        let (a, s, g) = (gun(class::ASSAULT), gun(class::SNIPER), gun(class::GUNNER));
        assert!(g.fire_ms < a.fire_ms && g.speed < a.speed);
        assert!(s.fire_ms > a.fire_ms && s.speed > a.speed && s.range > a.range && s.damage == 2);
        let sg = gun(class::SHOTGUN);
        assert!(sg.fire_ms > a.fire_ms && sg.speed == a.speed && sg.pellets.len() == 3);
        assert!(SHOTGUN_SPREAD < SPREAD, "tighter than a Spread power-up");
    }

    #[test]
    fn a_sniper_takes_two_hearts_from_far_off() {
        // Further than an assault's ball goes.
        let (mut m, mut r, mut now) = duel(class::SNIPER, 20.0);
        assert!(m.fire(1, 1, 5.0, 8.0, 0.0, now).is_some());
        for _ in 0..10 {
            now += 100;
            m.players[1].x = 25.0;
            m.players[1].y = 8.0;
            m.step(now, 100, &mut r);
        }
        assert_eq!(m.players[1].hp, HP - 2);
        // A slow gun: one more in hand, then a wait.
        assert!(m.fire(1, 2, 5.0, 8.0, 0.0, now).is_some(), "a shot in hand");
        assert!(
            m.fire(1, 3, 5.0, 8.0, 0.0, now + 50).is_none(),
            "not another so soon"
        );
        // The assault's ball doesn't reach that far.
        let (mut m, mut r, mut now) = duel(class::ASSAULT, 20.0);
        assert!(m.fire(1, 1, 5.0, 8.0, 0.0, now).is_some());
        for _ in 0..20 {
            now += 100;
            m.step(now, 100, &mut r);
        }
        assert_eq!(m.players[1].hp, HP);
    }

    #[test]
    fn a_shotgun_fires_three_close_together() {
        let (mut m, mut r, mut now) = duel(class::SHOTGUN, 4.0);
        let shot = m.fire(1, 1, 5.0, 8.0, 0.0, now).unwrap();
        assert_eq!(shot.kind >> 2, class::SHOTGUN);
        assert_eq!(m.balls.len(), 3);
        for _ in 0..5 {
            now += 100;
            m.step(now, 100, &mut r);
        }
        // Up close, all three land: out in one.
        assert!(m.players[1].out);
    }

    #[test]
    fn a_new_class_comes_with_the_next_life() {
        let (mut m, mut r, now) = duel(class::ASSAULT, 4.0);
        assert!(m.pick_class(1, class::SNIPER));
        assert_eq!(m.players[0].class, class::ASSAULT, "not mid-life");
        // One heart left (just hit, so not healing).
        m.players[0].hp = 1;
        m.players[0].last_hit = now;
        m.players[0].next_regen = now + REGEN_DELAY_MS;
        m.players[0].shield_until = 0;
        let mut t = now;
        assert!(m.fire(2, 1, 9.0, 8.0, PI, t).is_some());
        for _ in 0..5 {
            t += 100;
            m.players[0].x = 5.0;
            m.players[0].y = 8.0;
            m.step(t, 100, &mut r);
        }
        assert!(m.players[0].out);
        m.step(t + RESPAWN_MS, 100, &mut r);
        let p = &m.players[0];
        assert_eq!((p.out, p.class, p.ammo), (false, class::SNIPER, 5));
    }

    /// Two people (1 Blue, 2 Red), no bots, playing \`m\`.
    fn two_playing(m_: u8) -> (Match, impl FnMut() -> f64, u32) {
        let mut m = Match::new(field());
        m.join(1, BLUE, 0);
        m.join(2, RED, 0);
        for k in 0..SLOTS {
            m.set_bot(1, k, false);
        }
        assert!(m.set_mode(1, m_));
        assert!(m.start(1, false, 0));
        let mut r = rng();
        m.step(COUNTDOWN_MS, 100, &mut r);
        (m, r, COUNTDOWN_MS + 100)
    }

    fn put(m: &mut Match, id: u32, x: f64, y: f64) {
        let i = m.players.iter().position(|p| p.id == id).unwrap();
        m.players[i].x = x;
        m.players[i].y = y;
    }

    #[test]
    fn the_mode_is_picked_in_the_lobby() {
        let mut m = Match::new(field());
        assert!(!m.set_mode(1, mode::FLAG), "no place, no say");
        m.join(1, BLUE, 0);
        assert!(m.set_mode(1, mode::FLAG));
        assert!(!m.set_mode(1, mode::COUNT));
        assert_eq!(m.to_win(), 3);
        m.start(1, true, 0);
        assert!(!m.set_mode(1, mode::POINT), "not mid-match");
        // The flags stand in front of each base, on open ground.
        let (b, r) = (m.flags[0].home, m.flags[1].home);
        assert!(b.0 < m.field.w / 3.0 && r.0 > m.field.w * 2.0 / 3.0);
        assert!(m.field.free(b.0, b.1, PLAYER_R) && m.field.free(r.0, r.1, PLAYER_R));
    }

    #[test]
    fn capture_the_flag_take_it_home_and_score() {
        let (mut m, mut r, mut now) = two_playing(mode::FLAG);
        // An out doesn't score in this mode.
        m.players[1].shield_until = 0;
        m.players[1].hp = 1;
        m.players[1].last_hit = now;
        m.players[1].next_regen = now + REGEN_DELAY_MS;
        put(&mut m, 1, 5.0, 8.0);
        put(&mut m, 2, 8.0, 8.0);
        m.fire(1, 1, 5.0, 8.0, 0.0, now).unwrap();
        for _ in 0..4 {
            now += 100;
            m.step(now, 100, &mut r);
        }
        assert!(m.players[1].out);
        assert_eq!(m.score, [0, 0]);
        // Blue walks onto Red's flag: takes it; runs home with it: a capture.
        let red = m.flags[1].home;
        put(&mut m, 1, red.0, red.1);
        now += 100;
        let (evs, _) = m.step(now, 100, &mut r);
        assert!(
            evs.iter()
                .any(|e| e.kind == ev::FLAG_TAKEN && e.a == 1 && e.b == 1)
        );
        assert_eq!(m.flags[1].carrier, 1);
        let blue = m.flags[0].home;
        put(&mut m, 1, blue.0, blue.1);
        now += 100;
        let (evs, _) = m.step(now, 100, &mut r);
        assert!(evs.iter().any(|e| e.kind == ev::FLAG_CAPTURED && e.a == 1));
        assert_eq!(m.score, [1, 0]);
        assert!(m.flags[1].is_home(), "their flag's back on its stand");
    }

    #[test]
    fn a_splatted_carrier_drops_the_flag_and_it_goes_home() {
        let (mut m, mut r, mut now) = two_playing(mode::FLAG);
        let red = m.flags[1].home;
        put(&mut m, 1, red.0, red.1);
        now += 100;
        m.step(now, 100, &mut r);
        assert_eq!(m.flags[1].carrier, 1);
        // Splatted, mid-field: it's dropped there.
        put(&mut m, 1, 20.0, 8.0);
        put(&mut m, 2, 24.0, 8.0);
        m.players[0].shield_until = 0;
        m.players[0].hp = 1;
        m.players[0].last_hit = now;
        m.players[0].next_regen = now + REGEN_DELAY_MS;
        m.fire(2, 1, 24.0, 8.0, PI, now).unwrap();
        let mut dropped = false;
        for _ in 0..4 {
            now += 100;
            put(&mut m, 2, 24.0, 8.0);
            let (evs, _) = m.step(now, 100, &mut r);
            dropped |= evs.iter().any(|e| e.kind == ev::FLAG_DROPPED && e.a == 1);
        }
        assert!(dropped);
        let f = m.flags[1];
        assert!(f.carrier == 0 && f.dropped_at != 0 && (f.x - 20.0).abs() < 1.5);
        // Red touches its own flag: home it goes.
        put(&mut m, 2, f.x, f.y);
        now += 100;
        let (evs, _) = m.step(now, 100, &mut r);
        assert!(evs.iter().any(|e| e.kind == ev::FLAG_RETURNED && e.a == 2));
        assert!(m.flags[1].is_home());
        // And one left lying goes home by itself.
        m.flags[0].dropped_at = now;
        m.flags[0].x = 20.0;
        put(&mut m, 2, 30.0, 20.0);
        put(&mut m, 1, 2.0, 20.0);
        let (evs, _) = m.step(now + FLAG_RETURN_MS, 100, &mut r);
        assert!(
            evs.iter()
                .any(|e| e.kind == ev::FLAG_RETURNED && e.a == 0 && e.b == 0)
        );
    }

    #[test]
    fn control_points_one_takes_one_two_take_it_twice_as_fast_and_they_score() {
        // Blue: 1 and 3; Red: 2. No bots.
        let mut m = Match::new(field());
        m.join(1, BLUE, 0);
        m.join(3, BLUE, 0);
        m.join(2, RED, 0);
        for k in 0..SLOTS {
            m.set_bot(1, k, false);
        }
        assert!(m.set_mode(1, mode::POINT));
        assert!(m.start(1, false, 0));
        let mut r = rng();
        m.step(COUNTDOWN_MS, 100, &mut r);
        let mut now = COUNTDOWN_MS + 100;
        // Three points: one before each base, the middle (worth half as much again).
        assert_eq!(m.points.len(), 3);
        let (w, mid, e) = (m.points[0], m.points[1], m.points[2]);
        assert!(w.x < mid.x && mid.x < e.x);
        assert_eq!((w.value, mid.value, e.value), (1.0, 1.5, 1.0));
        let park = |m: &mut Match, at: [(u32, f64, f64); 3]| {
            for (id, x, y) in at {
                put(m, id, x, y);
            }
        };
        // One alone on the west point: a second takes it a quarter of the way.
        let away = [(2, 38.0, 22.0), (3, 2.0, 22.0)];
        let mut tick = |m: &mut Match, now: &mut u32, at: [(u32, f64, f64); 3], n: u32| {
            let mut evs = Vec::new();
            for _ in 0..n {
                *now += 100;
                park(m, at);
                evs.extend(m.step(*now, 100, &mut r).0);
            }
            evs
        };
        tick(&mut m, &mut now, [(1, w.x, w.y), away[0], away[1]], 10);
        let one = -m.points[0].progress;
        assert!((one - 25.0).abs() < 3.0, "one: {one}");
        // Two on the middle: twice as fast.
        tick(
            &mut m,
            &mut now,
            [
                (1, mid.x - 1.5, mid.y),
                (3, mid.x - 1.5, mid.y + 0.5),
                away[0],
            ],
            10,
        );
        let two = -m.points[1].progress;
        assert!((two - 50.0).abs() < 3.0, "two: {two}");
        let evs = tick(
            &mut m,
            &mut now,
            [
                (1, mid.x - 1.5, mid.y),
                (3, mid.x - 1.5, mid.y + 0.5),
                away[0],
            ],
            12,
        );
        assert!(
            evs.iter()
                .any(|e| e.kind == ev::POINT_TAKEN && e.b == BLUE as u32 && e.n == 1)
        );
        assert_eq!(m.points[1].owner, BLUE);
        // Even (one each): it holds.
        let p0 = m.points[2].progress;
        tick(
            &mut m,
            &mut now,
            [(1, e.x, e.y), (2, e.x + 0.5, e.y), (3, 2.0, 22.0)],
            10,
        );
        assert_eq!(m.points[2].progress, p0);
        // The middle scores 1.5 a second: three in two seconds.
        let before = m.score[0];
        tick(&mut m, &mut now, [(1, 2.0, 2.0), away[0], away[1]], 20);
        assert_eq!(m.score[0] - before, 3, "{:?}", m.score);
        assert_eq!(m.to_win(), 200);
    }

    #[test]
    fn bots_play_each_mode_to_the_end() {
        for md in [mode::FLAG, mode::POINT] {
            let mut m = Match::new(yard());
            m.join(1, BLUE, 0);
            m.set_mode(1, md);
            m.start(1, true, 0);
            let i = m.players.iter().position(|p| p.id == 1).unwrap();
            m.players[i].bot = true;
            let mut r = rng();
            let mut now = 0;
            let mut objective = 0;
            while m.status != OVER && now < MATCH_MS + 10_000 {
                now += 100;
                let (evs, _) = m.step(now, 100, &mut r);
                objective += evs
                    .iter()
                    .filter(|e| {
                        matches!(e.kind, ev::FLAG_TAKEN | ev::FLAG_CAPTURED | ev::POINT_TAKEN)
                    })
                    .count();
            }
            eprintln!(
                "MODE {md}: {}s, {:?}, {objective} objective events",
                now / 1000,
                m.score
            );
            assert!(
                objective > 0,
                "the bots went for the objective in mode {md}"
            );
            assert!(
                m.score[0] as u32 + m.score[1] as u32 > 0,
                "and scored, mode {md}"
            );
        }
    }

    /// Bots against bots, many times over, each mode on each field: neither
    /// side should win much more than half (slow: run with `--ignored --release`).
    #[test]
    #[ignore]
    fn bots_are_fair_to_both_sides() {
        let city = {
            let text = std::fs::read_to_string(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/../../../assets/maps/city.json"
            ))
            .unwrap();
            let map = crate::map::MapFile::from_json(&text).unwrap();
            Field::from_map(&map.objects).unwrap().0
        };
        for (fname, field) in [("hall", yard()), ("city", city)] {
            for md in [mode::TEAM, mode::FLAG, mode::POINT] {
                let mut wins = [0, 0, 0];
                let mut pts = [0u32, 0];
                for seed in 0..64u64 {
                    let mut m = Match::new(field.clone());
                    m.mode = md;
                    m.exhibit(seed as u32 * 1000);
                    m.mode = md;
                    let mut s = 7 + seed * 104729;
                    let mut r = move || {
                        s = s
                            .wrapping_mul(6364136223846793005)
                            .wrapping_add(1442695040888963407);
                        (s >> 11) as f64 / (1u64 << 53) as f64
                    };
                    let mut now = seed as u32 * 1000;
                    while m.status != OVER && now < seed as u32 * 1000 + MATCH_MS + 10_000 {
                        now += 100;
                        m.step(now, 100, &mut r);
                    }
                    wins[m.winner as usize] += 1;
                    pts[0] += m.score[0] as u32;
                    pts[1] += m.score[1] as u32;
                }
                eprintln!(
                    "{fname} mode {md}: blue {} red {} draw {} · points {:?}",
                    wins[0], wins[1], wins[2], pts
                );
                assert!((20..=44).contains(&wins[0]), "{fname} mode {md}: {wins:?}");
            }
        }
    }

    #[test]
    fn goliath_is_one_giant_against_five_hunters() {
        let mut m = Match::new(field());
        m.join(1, BLUE, 0);
        assert!(m.set_mode(1, mode::GOLIATH));
        assert!(m.start(1, true, 0));
        let mut r = rng();
        m.step(COUNTDOWN_MS, 100, &mut r);
        let giants: Vec<&Player> = m.players.iter().filter(|p| p.giant).collect();
        assert_eq!(giants.len(), 1);
        let g = giants[0].clone();
        assert_eq!((g.team, g.hp, g.ammo), (RED, GIANT_HP, GIANT_GUN.hopper));
        assert_eq!(m.players.iter().filter(|p| p.team == BLUE).count(), 5);
        assert_eq!(m.slot_of(g.id), Some(GIANT_SLOT));
        // We joined as a hunter; a hit on the giant counts for the hunters.
        assert_eq!(m.player(1).unwrap().team, BLUE);
        let gi = m.players.iter().position(|p| p.giant).unwrap();
        let me = m.players.iter().position(|p| p.id == 1).unwrap();
        let now = COUNTDOWN_MS + 2000;
        m.players[gi].x = 12.0;
        m.players[gi].y = 8.0;
        m.players[gi].shield_until = 0;
        m.players[me].x = 8.0;
        m.players[me].y = 8.0;
        m.fire(1, 1, 8.0, 8.0, 0.0, now).unwrap();
        let mut t = now;
        for _ in 0..4 {
            t += 100;
            m.players[gi].x = 12.0;
            m.players[gi].y = 8.0;
            m.step(t, 100, &mut r);
        }
        assert_eq!(m.score[0], 1, "one of its hearts");
        // Brought down: the hunters win, and it doesn't come back.
        m.players[gi].hp = 1;
        m.fire(1, 2, 8.0, 8.0, 0.0, t + 300).unwrap();
        let mut over = false;
        for _ in 0..6 {
            t += 100;
            m.players[gi].x = 12.0;
            m.players[gi].y = 8.0;
            let (evs, _) = m.step(t + 300, 100, &mut r);
            over |= evs.iter().any(|e| e.kind == ev::END && e.a == BLUE as u32);
        }
        assert!(over, "{:?}", m.status);
        assert_eq!(m.winner, BLUE);
    }

    #[test]
    fn a_person_playing_the_giant_has_it_harder() {
        let mut m = Match::new(field());
        m.join(1, BLUE, 0);
        assert!(m.set_mode(1, mode::GOLIATH));
        assert!(m.join(1, RED, 0));
        assert_eq!(m.slot_of(1), Some(GIANT_SLOT));
        assert!(m.start(1, true, 0));
        let mut r = rng();
        m.step(COUNTDOWN_MS, 100, &mut r);
        let g = m.player(1).unwrap();
        assert!(g.giant);
        assert_eq!((g.hp, g.max_hp()), (GIANT_HP_HUMAN, GIANT_HP_HUMAN));
        assert!(g.fire_ms(0) > GIANT_GUN.fire_ms, "a slower trigger");
    }

    #[test]
    fn free_for_all_is_everyone_against_everyone() {
        let mut m = Match::new(field());
        m.join(1, 2, 0);
        assert!(m.set_mode(1, mode::FFA));
        assert!(m.start(1, true, 0));
        let mut r = rng();
        m.step(COUNTDOWN_MS, 100, &mut r);
        assert_eq!(m.players.len(), 6);
        // Even one who started at the same end is fair game.
        let me = m.players.iter().position(|p| p.id == 1).unwrap();
        let mate = m
            .players
            .iter()
            .position(|p| p.id != 1 && p.team == m.players[me].team)
            .unwrap();
        assert!(m.foes(&m.players[me], &m.players[mate]));
        let other = m.players[mate].id;
        let now = COUNTDOWN_MS + 2000;
        // (Held still: a bot would roll out of the way.)
        m.players[mate].bot = false;
        m.players[mate].shield_until = 0;
        m.players[mate].hp = 1;
        m.players[mate].last_hit = now;
        m.players[mate].next_regen = now + REGEN_DELAY_MS;
        m.players[me].x = 5.0;
        m.players[me].y = 8.0;
        m.fire(1, 1, 5.0, 8.0, 0.0, now).unwrap();
        let mut t = now;
        for _ in 0..4 {
            t += 100;
            let i = m.players.iter().position(|p| p.id == other).unwrap();
            m.players[i].x = 8.0;
            m.players[i].y = 8.0;
            m.step(t, 100, &mut r);
        }
        assert_eq!(m.player(1).unwrap().kills, 1);
        assert_eq!(m.score, [0, 0], "no sides to score");
        // Ten: the winner.
        let i = m.players.iter().position(|p| p.id == 1).unwrap();
        m.players[i].kills = TO_WIN;
        let (evs, _) = m.step(t + 100, 100, &mut r);
        assert!(evs.iter().any(|e| e.kind == ev::END));
        assert_eq!(m.winner_id, 1);
    }

    /// Goliath, bots against bots, many times: the giant should win about as
    /// often as the hunters (slow: run with \`--ignored --release\`).
    #[test]
    #[ignore]
    fn goliath_is_a_fair_fight() {
        let mut wins = [0, 0, 0];
        let mut secs = 0;
        let mut outs = 0u32;
        for seed in 0..40u64 {
            let mut m = Match::new(yard());
            m.mode = mode::GOLIATH;
            m.exhibit(0);
            m.mode = mode::GOLIATH;
            m.begin(0);
            let mut s = 11 + seed * 7919;
            let mut r = move || {
                s = s
                    .wrapping_mul(6364136223846793005)
                    .wrapping_add(1442695040888963407);
                (s >> 11) as f64 / (1u64 << 53) as f64
            };
            let mut now = 0;
            while m.status != OVER && now < GIANT_MATCH_MS + 20_000 {
                now += 100;
                m.step(now, 100, &mut r);
            }
            wins[m.winner as usize] += 1;
            secs += now / 1000;
            outs += m.score[1] as u32;
        }
        eprintln!(
            "GOLIATH: hunters {} giant {} draw {} · {}s a match · {} outs",
            wins[0],
            wins[1],
            wins[2],
            secs / 40,
            outs / 40
        );
        assert!((12..=28).contains(&wins[0]), "{wins:?}");
    }

    #[test]
    fn a_shotgun_point_blank_puts_you_out_once() {
        let (mut m, mut r, mut now) = duel(class::SHOTGUN, 1.6);
        // One heart left (just hit, so not healing): all three balls land in the same tick.
        m.players[1].hp = 1;
        m.players[1].last_hit = now;
        m.players[1].next_regen = now + REGEN_DELAY_MS;
        m.fire(1, 1, 5.0, 8.0, 0.0, now).unwrap();
        let mut outs = 0;
        for _ in 0..4 {
            now += 100;
            let (evs, _) = m.step(now, 100, &mut r);
            outs += evs.iter().filter(|e| e.kind == ev::OUT).count();
        }
        assert_eq!(outs, 1);
        assert_eq!((m.players[0].kills, m.players[1].deaths), (1, 1));
        assert_eq!(m.score, [1, 0]);
    }

    #[test]
    fn hay_stops_balls_and_drums_send_them_back() {
        let f = field();
        // Into the hay bale: a splat on its face.
        let mut b = Ball::new(1, BLUE, 0, 8.0, 11.5, 0.0, false);
        let fl = b.advance(&f, 10.0, |_, _| None);
        assert!(
            matches!(fl, Flight::Splat(x, _) if x < 10.0 && x > 9.0),
            "{fl:?}"
        );
        // Off the drum: comes back.
        let mut b = Ball::new(1, BLUE, 0, 17.0, 5.5, 0.0, false);
        b.advance(&f, 4.0, |_, _| None);
        assert!(b.vx < 0.0, "bounced back off the drum");
    }

    #[test]
    fn a_reload_refills_and_a_shot_just_before_it_ends_counts() {
        let mut m = Match::new(field());
        m.join(1, BLUE, 0);
        m.start(1, true, 0);
        let mut r = rng();
        m.step(COUNTDOWN_MS, 100, &mut r);
        let mut now = COUNTDOWN_MS + 100;
        // Empty the hopper: it reloads by itself.
        for k in 0..HOPPER as u16 {
            now += FIRE_MS;
            assert!(m.fire(1, k, 2.0, 12.0, 0.0, now).is_some(), "shot {k}");
        }
        let p = m.player(1).unwrap();
        assert_eq!(p.ammo, 0);
        assert!(p.reload_until > now);
        // No shooting mid-reload…
        assert!(m.fire(1, 50, 2.0, 12.0, 0.0, now + 300).is_none());
        // …but a shot a beat before it ends (by the server's clock) is taken, from a full hopper.
        let done = m.player(1).unwrap().reload_until;
        assert!(m.fire(1, 51, 2.0, 12.0, 0.0, done - 150).is_some());
        assert_eq!(m.player(1).unwrap().ammo, HOPPER - 1);
        // R: reloads, and the tick refills it.
        let t = done + 500;
        assert!(m.reload(1, t).is_some());
        assert!(m.reload(1, t + 100).is_none(), "already reloading");
        m.step(t + RELOAD_MS, 100, &mut r);
        assert_eq!(m.player(1).unwrap().ammo, HOPPER);
    }

    #[test]
    fn shots_bunched_into_one_tick_all_count_but_the_rate_holds() {
        let mut m = Match::new(field());
        m.join(1, BLUE, 0);
        m.start(1, true, 0);
        let mut r = rng();
        m.step(COUNTDOWN_MS, 100, &mut r);
        let t = COUNTDOWN_MS + 1000;
        // Two that arrive together (sent 170 ms apart): both taken.
        assert!(m.fire(1, 1, 2.0, 12.0, 0.0, t).is_some());
        assert!(m.fire(1, 2, 2.0, 12.0, 0.0, t).is_some());
        // Spamming: soon refused, then allowed again at the rate.
        let taken = (3..20)
            .filter(|&k| m.fire(1, k, 2.0, 12.0, 0.0, t).is_some())
            .count();
        assert!(taken <= 2, "{taken} more in the same instant");
        let mut ok = 0;
        for k in 0..20u16 {
            if m.fire(1, 100 + k, 2.0, 12.0, 0.0, t + 100 + k as u32 * FIRE_MS)
                .is_some()
            {
                ok += 1;
            }
        }
        assert!(ok >= 8, "at the rate: {ok}");
    }

    #[test]
    fn moves_too_far_are_cut_short() {
        let mut m = Match::new(field());
        m.join(1, BLUE, 0);
        m.start(1, true, 0);
        let mut r = rng();
        m.step(COUNTDOWN_MS, 100, &mut r);
        let (x0, y0) = (m.players[0].x, m.players[0].y);
        m.claim_move(1, x0 + 10.0, y0, 0.0, COUNTDOWN_MS + 100);
        let p = &m.players[0];
        assert!(p.x - x0 < 1.5, "teleport refused");
        assert_eq!(p.fix, 1);
    }

    #[test]
    fn bots_play_a_whole_match() {
        let mut m = Match::new(field());
        m.join(1, BLUE, 0);
        m.start(1, true, 0);
        // The human stands aside (a bot takes their place).
        m.leave(1, 0);
        assert_eq!(m.status, LOBBY, "nobody left: called off");
        m.join(1, BLUE, 0);
        m.start(1, true, 0);
        let mut r = rng();
        let mut now = 0;
        let mut shots = 0;
        while m.status != OVER && now < MATCH_MS + 10_000 {
            now += 100;
            // The human just stands at home.
            let (_, s) = m.step(now, 100, &mut r);
            shots += s.len();
        }
        eprintln!(
            "PACE: over at {}s, score {:?}, shots {shots}, kd {:?}",
            now / 1000,
            m.score,
            m.players
                .iter()
                .map(|p| (p.kills, p.deaths))
                .collect::<Vec<_>>()
        );
        assert_eq!(m.status, OVER);
        assert!(shots > 20, "the bots shot ({shots})");
        assert!(
            m.score[0] + m.score[1] > 0,
            "and splatted somebody: {:?}",
            m.score
        );
    }
}
