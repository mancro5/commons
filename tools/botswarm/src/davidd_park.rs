//! Davidd in the skatepark: riding its features the way a player does. The
//! park's shapes as the client's skate sim has them (`skatesim.ts`: ramps,
//! quarter pipes, mounds, boxes, rails, as heights), and lines through them:
//! he picks a feature (not the ones he's just done), rolls round to line up
//! on it, and hits it: airs off kickers and mound tops with a flip, a grab or
//! a 360; a 180 out of a quarter pipe; an ollie up onto a box to manual it;
//! onto a rail to grind it. Tricks strung together are a combo, banked when
//! he's back on the flat (and now and then he bails).

use commons_sim::{Grid, MapFile, TilePos};
use rand::Rng;
use rand::rngs::SmallRng;
use rand::seq::IndexedRandom;
use std::collections::VecDeque;
use std::f64::consts::{PI, TAU};

const T: f64 = 32.0;
const G: f64 = 700.0;

#[derive(Clone, Copy, PartialEq)]
enum RampKind {
    Quarter,
    Kicker,
}

struct Ramp {
    r: Rect,
    up: (f64, f64),
    h: f64,
    kind: RampKind,
}

struct Mound {
    r: Rect,
    h: f64,
    top: f64,
    volcano: bool,
}

struct Block {
    r: Rect,
    h: f64,
}

struct Rail {
    a: (f64, f64),
    b: (f64, f64),
    za: f64,
    zb: f64,
}

#[derive(Clone, Copy)]
struct Rect {
    x0: f64,
    y0: f64,
    x1: f64,
    y1: f64,
}

impl Rect {
    fn has(&self, x: f64, y: f64) -> bool {
        x >= self.x0 && x < self.x1 && y >= self.y0 && y < self.y1
    }
    fn mid(&self) -> (f64, f64) {
        ((self.x0 + self.x1) / 2.0, (self.y0 + self.y1) / 2.0)
    }
}

#[derive(Clone, Copy, PartialEq)]
enum Surf {
    Flat,
    Slope,
    Vert(usize),
    Top,
    Grind(usize),
}

#[derive(Clone, Copy, PartialEq)]
enum Feat {
    Kicker(usize),
    Quarter(usize),
    Mound(usize),
    Block(usize),
    Rail(usize),
}

pub struct Park {
    ramps: Vec<Ramp>,
    mounds: Vec<Mound>,
    blocks: Vec<Block>,
    rails: Vec<Rail>,
    feats: Vec<Feat>,
    area: Rect,
}

impl Park {
    pub fn from(map: &MapFile) -> Option<Park> {
        let p = map.objects.iter().find(|o| o.kind == "sk_park")?;
        let area = Rect {
            x0: p.x as f64 * T,
            y0: p.y as f64 * T,
            x1: (p.x + p.w) as f64 * T,
            y1: (p.y + p.h) as f64 * T,
        };
        let mut park = Park {
            ramps: vec![],
            mounds: vec![],
            blocks: vec![],
            rails: vec![],
            feats: vec![],
            area,
        };
        let dir = |d: &str| match d {
            "n" => (0.0, -1.0),
            "s" => (0.0, 1.0),
            "e" => (1.0, 0.0),
            _ => (-1.0, 0.0),
        };
        for o in &map.objects {
            let r = Rect {
                x0: o.x as f64 * T,
                y0: o.y as f64 * T,
                x1: (o.x + o.w) as f64 * T,
                y1: (o.y + o.h) as f64 * T,
            };
            if !(area.has(r.x0, r.y0) || area.has(r.x1 - 1.0, r.y1 - 1.0)) {
                continue;
            }
            let label = o.label.clone().unwrap_or_default();
            let mut parts = label.split(':');
            let first = parts.next().unwrap_or("");
            let num = |s: Option<&str>, d: f64| {
                s.and_then(|v| v.parse::<f64>().ok())
                    .filter(|v| *v > 0.0)
                    .unwrap_or(d)
            };
            match o.kind.as_str() {
                "sk_quarter" => {
                    park.feats.push(Feat::Quarter(park.ramps.len()));
                    park.ramps.push(Ramp {
                        r,
                        up: dir(first),
                        h: num(parts.next(), 46.0),
                        kind: RampKind::Quarter,
                    });
                }
                "sk_kicker" => {
                    let big = o.w * o.h >= 12;
                    park.feats.push(Feat::Kicker(park.ramps.len()));
                    park.ramps.push(Ramp {
                        r,
                        up: dir(first),
                        h: num(parts.next(), if big { 22.0 } else { 16.0 }),
                        kind: RampKind::Kicker,
                    });
                }
                "sk_box" => {
                    let h = num(Some(first), 12.0);
                    park.feats.push(Feat::Block(park.blocks.len()));
                    park.blocks.push(Block { r, h });
                }
                "sk_volcano" | "sk_pyramid" => {
                    let volcano = o.kind == "sk_volcano";
                    park.feats.push(Feat::Mound(park.mounds.len()));
                    park.mounds.push(Mound {
                        r,
                        h: num(Some(first), if volcano { 26.0 } else { 20.0 }),
                        top: if volcano { 0.34 } else { 0.3 },
                        volcano,
                    });
                }
                "sk_rail" => {
                    let za = num(parts.next(), 14.0);
                    let zb = num(parts.next(), za);
                    let (a, b) = if first == "v" {
                        let x = (r.x0 + r.x1) / 2.0;
                        ((x, r.y0 + 4.0), (x, r.y1 - 4.0))
                    } else {
                        let y = (r.y0 + r.y1) / 2.0;
                        ((r.x0 + 4.0, y), (r.x1 - 4.0, y))
                    };
                    park.feats.push(Feat::Rail(park.rails.len()));
                    park.rails.push(Rail { a, b, za, zb });
                }
                // (The van and the boards: walls, too tall to get on.)
                "sk_shop" | "sk_board" => park.blocks.push(Block { r, h: 120.0 }),
                _ => {}
            }
        }
        Some(park)
    }

    fn up_along(r: &Ramp, x: f64, y: f64) -> f64 {
        let f = match r.up {
            (_, u) if u < 0.0 => (r.r.y1 - y) / (r.r.y1 - r.r.y0),
            (_, u) if u > 0.0 => (y - r.r.y0) / (r.r.y1 - r.r.y0),
            (u, _) if u > 0.0 => (x - r.r.x0) / (r.r.x1 - r.r.x0),
            _ => (r.r.x1 - x) / (r.r.x1 - r.r.x0),
        };
        f.clamp(0.0, 1.0)
    }

    /// What's underfoot at (x, y) for someone at height z: how high, and what it is.
    /// (A box or a rail only from above: from below it's a wall, gone through.)
    fn ground(&self, x: f64, y: f64, z: f64) -> (f64, Surf) {
        let mut best = (0.0, Surf::Flat);
        for (i, r) in self.ramps.iter().enumerate() {
            if r.r.has(x, y) {
                let f = Self::up_along(r, x, y);
                let h = match r.kind {
                    RampKind::Quarter => r.h * f.powf(2.5),
                    RampKind::Kicker => r.h * f.powf(1.35),
                };
                if h >= best.0 {
                    best = (
                        h,
                        if r.kind == RampKind::Quarter {
                            Surf::Vert(i)
                        } else {
                            Surf::Slope
                        },
                    );
                }
            }
        }
        for m in &self.mounds {
            if !m.r.has(x, y) {
                continue;
            }
            let (cx, cy) = m.r.mid();
            let (hw, hh) = ((m.r.x1 - m.r.x0) / 2.0, (m.r.y1 - m.r.y0) / 2.0);
            let (dx, dy) = ((x - cx) / hw, (y - cy) / hh);
            let d = if m.volcano {
                dx.hypot(dy)
            } else {
                dx.abs().max(dy.abs())
            };
            let h = if d >= 1.0 {
                0.0
            } else if d <= m.top {
                m.h
            } else {
                m.h * ((1.0 - d) / (1.0 - m.top)).powf(if m.volcano { 2.8 } else { 1.1 })
            };
            if h > best.0 {
                best = (h, Surf::Slope);
            }
        }
        for b in &self.blocks {
            if b.r.has(x, y) && z >= b.h - 12.0 && b.h > best.0 {
                best = (b.h, Surf::Top);
            }
        }
        for (i, l) in self.rails.iter().enumerate() {
            let (t, d) = along(l.a, l.b, x, y);
            let h = l.za + (l.zb - l.za) * t;
            if (0.0..=1.0).contains(&t) && d <= 8.0 && z >= h - 12.0 && h > best.0 {
                best = (h, Surf::Grind(i));
            }
        }
        best
    }

    /// A way across the park (never out of it: the server keeps skaters in).
    fn route(&self, grid: &Grid, from: TilePos, to: TilePos) -> Vec<TilePos> {
        let (x0, y0) = ((self.area.x0 / T) as i32, (self.area.y0 / T) as i32);
        let (w, h) = (
            ((self.area.x1 - self.area.x0) / T) as i32,
            ((self.area.y1 - self.area.y0) / T) as i32,
        );
        let idx = |t: (i32, i32)| ((t.1 - y0) * w + (t.0 - x0)) as usize;
        let ok = |t: (i32, i32)| {
            t.0 >= x0
                && t.1 >= y0
                && t.0 < x0 + w
                && t.1 < y0 + h
                && grid.walkable(t.0 as u16, t.1 as u16)
        };
        let (f, g) = ((from.0 as i32, from.1 as i32), (to.0 as i32, to.1 as i32));
        if !ok(f) || !ok(g) {
            return vec![];
        }
        let mut prev = vec![u32::MAX; (w * h) as usize];
        let mut q = VecDeque::from([f]);
        prev[idx(f)] = idx(f) as u32;
        while let Some(t) = q.pop_front() {
            if t == g {
                let mut path = vec![(t.0 as u16, t.1 as u16)];
                let mut i = idx(t);
                while i != idx(f) {
                    i = prev[i] as usize;
                    path.push(((i as i32 % w + x0) as u16, (i as i32 / w + y0) as u16));
                }
                path.reverse();
                return path;
            }
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
                let n = (t.0 + dx, t.1 + dy);
                // (Diagonally only past two open sides: no cutting corners.)
                if ok(n) && prev[idx(n)] == u32::MAX && ok((t.0 + dx, t.1)) && ok((t.0, t.1 + dy)) {
                    prev[idx(n)] = idx(t) as u32;
                    q.push_back(n);
                }
            }
        }
        vec![]
    }

    fn inside(&self, (x, y): (f64, f64)) -> (f64, f64) {
        (
            x.clamp(self.area.x0 + T, self.area.x1 - T),
            y.clamp(self.area.y0 + T, self.area.y1 - T),
        )
    }

    /// A line through feature `f`: where to start from, the points to ride
    /// through, where to pop (if anywhere), what kind of air it's for.
    fn line(&self, f: Feat, rng: &mut SmallRng) -> Line {
        let at = |c: (f64, f64), d: (f64, f64), k: f64| (c.0 + d.0 * k, c.1 + d.1 * k);
        match f {
            Feat::Kicker(i) => {
                let r = &self.ramps[i];
                let len = if r.up.0 != 0.0 {
                    r.r.x1 - r.r.x0
                } else {
                    r.r.y1 - r.r.y0
                };
                let c = r.r.mid();
                let lip = at(c, r.up, len / 2.0);
                Line {
                    start: at(c, r.up, -(len / 2.0 + 4.0 * T)),
                    points: vec![
                        at(c, r.up, -(len / 2.0)),
                        at(lip, r.up, 0.3 * T),
                        at(lip, r.up, 5.5 * T),
                    ],
                    pop: Some((lip, 260.0 + rng.random_range(0.0..60.0))),
                    air: Air::Big,
                    what: "the kicker",
                }
            }
            Feat::Quarter(i) => {
                let r = &self.ramps[i];
                let len = if r.up.0 != 0.0 {
                    r.r.x1 - r.r.x0
                } else {
                    r.r.y1 - r.r.y0
                };
                let c = r.r.mid();
                // A little off the middle, so it's not the same spot each time.
                let side = (-r.up.1, r.up.0);
                let off = rng.random_range(-1.5..1.5) * T;
                let c = at(c, side, off);
                Line {
                    start: at(c, r.up, -(len / 2.0 + 5.0 * T)),
                    points: vec![
                        at(c, r.up, len / 2.0 - 4.0),
                        at(c, r.up, -(len / 2.0 + 4.0 * T)),
                    ],
                    pop: None,
                    air: Air::Vert,
                    what: "the quarter pipe",
                }
            }
            Feat::Mound(i) => {
                let m = &self.mounds[i];
                let c = m.r.mid();
                let rad = (m.r.x1 - m.r.x0).max(m.r.y1 - m.r.y0) / 2.0;
                let a = rng.random_range(0..8) as f64 * PI / 4.0;
                let d = (a.cos(), a.sin());
                Line {
                    start: at(c, d, -(rad + 4.0 * T)),
                    points: vec![c, at(c, d, rad + 5.0 * T)],
                    // Off the far edge of its top.
                    pop: Some((at(c, d, rad * m.top * 0.9), 230.0 + m.h * 1.5)),
                    air: Air::Big,
                    what: if m.volcano {
                        "the volcano"
                    } else {
                        "the pyramid"
                    },
                }
            }
            Feat::Block(i) => {
                let b = &self.blocks[i];
                let c = b.r.mid();
                // Across it the long way.
                let (w, h) = (b.r.x1 - b.r.x0, b.r.y1 - b.r.y0);
                let mut d = if w >= h { (1.0, 0.0) } else { (0.0, 1.0) };
                if rng.random_bool(0.5) {
                    d = (-d.0, -d.1);
                }
                let half = if d.0 != 0.0 { w / 2.0 } else { h / 2.0 };
                Line {
                    start: at(c, d, -(half + 4.0 * T)),
                    points: vec![at(c, d, -(half - 6.0)), at(c, d, half + 3.0 * T)],
                    pop: Some(onto(at(c, d, -half), d, b.h, 20.0)),
                    air: Air::Onto,
                    what: "the box",
                }
            }
            Feat::Rail(i) => {
                let l = &self.rails[i];
                // Down it from its high end (or either way, a flat one).
                let (a, b, za) = if l.za > l.zb || (l.za == l.zb && rng.random_bool(0.5)) {
                    (l.a, l.b, l.za)
                } else {
                    (l.b, l.a, l.zb)
                };
                let len = (b.0 - a.0).hypot(b.1 - a.1).max(1.0);
                let d = ((b.0 - a.0) / len, (b.1 - a.1) / len);
                Line {
                    start: at(a, d, -4.0 * T),
                    points: vec![at(a, d, 6.0), b, at(b, d, 3.0 * T)],
                    pop: Some(onto(a, d, za, (len * 0.25).min(48.0))),
                    air: Air::Onto,
                    what: "the rail",
                }
            }
        }
    }
}

/// The speed he hits a line at (px/s).
const LINE_SPEED: f64 = 340.0;

/// Up onto something `h` high whose edge is at `edge` (going `d`), to come
/// down `land` past the edge: where to pop, and how hard (just clearing it).
fn onto(edge: (f64, f64), d: (f64, f64), h: f64, land: f64) -> ((f64, f64), f64) {
    let vz = (2.0 * G * (h + 10.0)).sqrt();
    // Up, over the top, and down to its height again.
    let t = (vz + (vz * vz - 2.0 * G * h).max(0.0).sqrt()) / G;
    let lead = LINE_SPEED * t - land;
    ((edge.0 - d.0 * lead, edge.1 - d.1 * lead), vz)
}

/// How far along a→b the point is (0–1), and how far off the line.
fn along(a: (f64, f64), b: (f64, f64), x: f64, y: f64) -> (f64, f64) {
    let (dx, dy) = (b.0 - a.0, b.1 - a.1);
    let l2 = (dx * dx + dy * dy).max(1e-6);
    let t = ((x - a.0) * dx + (y - a.1) * dy) / l2;
    let (px, py) = (a.0 + dx * t, a.1 + dy * t);
    (t, (x - px).hypot(y - py))
}

#[derive(Clone, Copy, PartialEq)]
enum Air {
    /// Off a lip: a flip, a grab, a spin.
    Big,
    /// Out of a quarter pipe and back in: a grab (a flip, a backflip if it's big).
    Vert,
    /// Up onto something (a box, a rail): an ollie, maybe a flip in.
    Onto,
}

struct Line {
    start: (f64, f64),
    points: Vec<(f64, f64)>,
    pop: Option<((f64, f64), f64)>,
    air: Air,
    what: &'static str,
}

/// Up in the air: for how long, what he's doing up there.
struct Flight {
    t: f64,
    long: f64,
    trick: u8,
    trick_for: f64,
    name: String,
    pts: u32,
    spin: f64,
    vert: Option<f64>,
    from_heading: f64,
}

pub enum Out {
    Combo(u32, String),
    Bail,
}

pub struct Rider {
    pub x: f64,
    pub y: f64,
    pub heading: f64,
    pub z: f64,
    pub pose: u8,
    pub trick: u8,
    pub spin: f64,
    speed: f64,
    vz: f64,
    flight: Option<Flight>,
    line: Option<Line>,
    /// Rolling round to the line's start (tiles, as px).
    approach: Vec<(f64, f64)>,
    grind: Option<(usize, &'static str)>,
    manual: Option<f64>,
    recent: VecDeque<Feat>,
    tricks: Vec<String>,
    pts: u32,
    ground: f64,
    climb: f64,
    bail: f64,
    /// Just rolling about, to somewhere, before the next line.
    cruise: bool,
    /// What he's at, for chat ("hitting the volcano").
    pub at: &'static str,
}

impl Rider {
    pub fn new(x: f64, y: f64) -> Rider {
        Rider {
            x,
            y,
            heading: 0.0,
            z: 0.0,
            pose: 0,
            trick: 0,
            spin: 0.0,
            speed: 0.0,
            vz: 0.0,
            flight: None,
            line: None,
            approach: vec![],
            grind: None,
            manual: None,
            recent: VecDeque::new(),
            tricks: vec![],
            pts: 0,
            ground: 0.0,
            climb: 0.0,
            bail: 0.0,
            cruise: false,
            at: "the park",
        }
    }

    /// A tenth of a second of skating (in finer steps, so ramps are ramps).
    pub fn step(&mut self, park: &Park, grid: &Grid, rng: &mut SmallRng) -> Vec<Out> {
        let mut out = vec![];
        if self.line.is_none() && self.approach.is_empty() {
            self.next_line(park, grid, rng);
        }
        for _ in 0..4 {
            self.sub(park, rng, 0.025, &mut out);
        }
        out
    }

    fn next_line(&mut self, park: &Park, grid: &Grid, rng: &mut SmallRng) {
        let here = ((self.x / T) as u16, (self.y / T) as u16);
        // Now and then just rolling round a bit first.
        if !self.cruise && rng.random_bool(0.2) {
            self.cruise = true;
            let a = park.area;
            let to = (
                rng.random_range(a.x0 + 2.0 * T..a.x1 - 2.0 * T),
                rng.random_range(a.y0 + 2.0 * T..a.y1 - 2.0 * T),
            );
            self.approach = self.route(park, grid, here, to);
            self.at = "the park";
            return;
        }
        self.cruise = false;
        for _ in 0..8 {
            let fresh: Vec<Feat> = park
                .feats
                .iter()
                .copied()
                .filter(|f| !self.recent.contains(f))
                .collect();
            let Some(&f) = fresh.choose(rng).or_else(|| park.feats.choose(rng)) else {
                return;
            };
            let mut l = park.line(f, rng);
            l.start = park.inside(l.start);
            for p in &mut l.points {
                *p = park.inside(*p);
            }
            let path = self.route(park, grid, here, l.start);
            if path.is_empty() && (self.x - l.start.0).hypot(self.y - l.start.1) > 2.0 * T {
                self.recent.push_back(f);
                continue;
            }
            self.recent.push_back(f);
            while self.recent.len() > 4 {
                self.recent.pop_front();
            }
            self.approach = path;
            self.approach.push(l.start);
            self.at = l.what;
            self.line = Some(l);
            return;
        }
    }

    fn route(&self, park: &Park, grid: &Grid, from: TilePos, to: (f64, f64)) -> Vec<(f64, f64)> {
        let goal = ((to.0 / T) as u16, (to.1 / T) as u16);
        let goal = grid.nearest_walkable(goal, 3).unwrap_or(goal);
        let from = grid.nearest_walkable(from, 3).unwrap_or(from);
        let mut p: Vec<(f64, f64)> = park
            .route(grid, from, goal)
            .into_iter()
            .map(|t| ((t.0 as f64 + 0.5) * T, (t.1 as f64 + 0.5) * T))
            .collect();
        if !p.is_empty() {
            p.remove(0);
        }
        // Every other tile: smoother lines than tile by tile.
        let last = p.last().copied();
        let mut p: Vec<_> = p.into_iter().step_by(2).collect();
        if let Some(l) = last
            && p.last() != Some(&l)
        {
            p.push(l);
        }
        p
    }

    fn target(&self) -> Option<(f64, f64)> {
        self.approach
            .first()
            .copied()
            .or_else(|| self.line.as_ref().and_then(|l| l.points.first().copied()))
    }

    fn sub(&mut self, park: &Park, rng: &mut SmallRng, dt: f64, out: &mut Vec<Out>) {
        // Down: back up in a moment.
        if self.bail > 0.0 {
            self.bail -= dt;
            self.speed = (self.speed - 400.0 * dt).max(0.0);
            self.pose = 5;
            self.z = self.ground;
            if self.bail <= 0.0 {
                self.pose = 0;
            }
            return;
        }
        let on_line = self.approach.is_empty() && self.line.is_some();
        // Steering (on the ground; in the air you go where you're going).
        if let Some((tx, ty)) = self.target() {
            let (dx, dy) = (tx - self.x, ty - self.y);
            let reach = if on_line { 10.0 } else { 22.0 };
            // Got there, or gone past it (flying over it, or just wide).
            let ahead = dx * self.heading.cos() + dy * self.heading.sin();
            if dx.hypot(dy) < reach || (dx.hypot(dy) < 2.0 * T && ahead < 0.0) {
                if !self.approach.is_empty() {
                    self.approach.remove(0);
                } else if let Some(l) = &mut self.line {
                    l.points.remove(0);
                }
            }
            let mut d = dy.atan2(dx) - self.heading;
            d = (d + PI).rem_euclid(TAU) - PI;
            if self.flight.is_none() && self.grind.is_none() {
                let rate = if on_line { 6.0 } else { 5.0 };
                self.heading += d.clamp(-rate * dt, rate * dt);
            }
            // A sharp turn: slowed right down to carve round it (not round and round it).
            let top = if d.abs() > 0.7 {
                110.0
            } else if on_line {
                LINE_SPEED
            } else {
                270.0
            };
            if self.flight.is_none() {
                self.speed += (top - self.speed).clamp(-220.0 * dt, 180.0 * dt);
            }
        } else if self.flight.is_none() {
            self.speed = (self.speed - 140.0 * dt).max(0.0);
        }
        // Pop: just before the spot the line says.
        if self.flight.is_none() && self.grind.is_none() && on_line {
            let pop = self.line.as_ref().and_then(|l| l.pop.map(|p| (p, l.air)));
            if let Some((((px, py), vz), air)) = pop {
                let (hx, hy) = (self.heading.cos(), self.heading.sin());
                let ahead = (px - self.x) * hx + (py - self.y) * hy;
                if ahead < 12.0 {
                    if let Some(l) = &mut self.line {
                        l.pop = None;
                    }
                    self.take_off(vz, air, rng);
                }
            }
        }
        // Along a rail.
        if let Some((i, name)) = self.grind {
            let l = &park.rails[i];
            let (dx, dy) = (l.b.0 - l.a.0, l.b.1 - l.a.1);
            let fwd = (self.heading.cos() * dx + self.heading.sin() * dy).signum();
            self.heading = (dy * fwd).atan2(dx * fwd);
            self.x += self.heading.cos() * self.speed * dt;
            self.y += self.heading.sin() * self.speed * dt;
            let (t2, _) = along(l.a, l.b, self.x, self.y);
            self.z = l.za + (l.zb - l.za) * t2.clamp(0.0, 1.0);
            self.pose = 3;
            if !(0.0..=1.0).contains(&t2) {
                // Off the end: a little hop off it.
                self.grind = None;
                self.tricks.push(name.to_string());
                self.pts += 120;
                self.vz = 120.0;
                self.flight = Some(Flight {
                    t: 0.0,
                    long: 0.3,
                    trick: 0,
                    trick_for: 0.0,
                    name: String::new(),
                    pts: 0,
                    spin: 0.0,
                    vert: None,
                    from_heading: self.heading,
                });
            }
            return;
        }
        let vert_air = self.flight.as_ref().and_then(|f| f.vert).is_some();
        let horiz = if vert_air { 0.0 } else { self.speed };
        self.x += self.heading.cos() * horiz * dt;
        self.y += self.heading.sin() * horiz * dt;
        // The fence: kept in, as the server keeps skaters in, and slowed against it.
        let (cx, cy) = (
            self.x.clamp(park.area.x0 + 6.0, park.area.x1 - 6.0),
            self.y.clamp(park.area.y0 + 6.0, park.area.y1 - 6.0),
        );
        if (cx, cy) != (self.x, self.y) {
            (self.x, self.y) = (cx, cy);
            self.speed *= 0.5;
        }
        let (g, surf) = park.ground(self.x, self.y, self.z);
        if self.flight.is_some() {
            self.z += self.vz * dt;
            self.vz -= G * dt;
            self.fly(dt);
            if self.z <= g && self.vz < 0.0 {
                self.land(g, surf, rng, out);
            }
            return;
        }
        let climb = (g - self.ground) / dt;
        // Up a quarter pipe to its lip, going up it: out into the air, and back in.
        if let Surf::Vert(i) = surf {
            let r = &park.ramps[i];
            let up = Park::up_along(r, self.x, self.y);
            let facing = self.heading.cos() * r.up.0 + self.heading.sin() * r.up.1;
            if up >= 0.9 && facing > 0.3 && self.speed > 150.0 {
                self.z = g;
                self.take_off((self.speed * 1.05).clamp(300.0, 430.0), Air::Vert, rng);
                return;
            }
        }
        if g < self.z - 4.0 {
            if self.climb > 25.0 {
                // Off a lip: air.
                let vz = self.climb * 0.9 + 140.0;
                self.take_off(vz, Air::Big, rng);
            } else {
                // Off an edge: down.
                self.vz = 0.0;
                self.flight = Some(Flight {
                    t: 0.0,
                    long: 0.2,
                    trick: 0,
                    trick_for: 0.0,
                    name: String::new(),
                    pts: 0,
                    spin: 0.0,
                    vert: None,
                    from_heading: self.heading,
                });
            }
            return;
        }
        self.z = g;
        self.climb = climb;
        self.ground = g;
        self.pose = 0;
        if surf == Surf::Top {
            self.pose = 4;
            let m = self.manual.get_or_insert(0.0);
            *m += dt;
        } else if let Some(m) = self.manual.take()
            && m > 0.2
        {
            if self.tricks.last().map(String::as_str) != Some("Manual") {
                self.tricks.push("Manual".into());
            }
            self.pts += 60 + (m * 100.0) as u32;
        }
        // Back on the flat, the line done: the combo banked.
        if g <= 0.5 && self.line.as_ref().is_some_and(|l| l.points.is_empty()) {
            self.line = None;
            self.bank(out);
        }
        if self.line.is_none() && self.approach.is_empty() && !self.tricks.is_empty() {
            self.bank(out);
        }
    }

    fn take_off(&mut self, vz: f64, air: Air, rng: &mut SmallRng) {
        self.vz = vz;
        let long = 2.0 * vz / G;
        let (trick, name, pts, trick_for, spin) = match air {
            Air::Vert => {
                if long > 1.05 && rng.random_bool(0.2) {
                    (24, "Backflip".to_string(), 400, long - 0.15, 0.0)
                } else if rng.random_bool(0.7) {
                    let g = *["Indy", "Melon", "Stalefish", "Nosegrab", "Tailgrab"]
                        .choose(rng)
                        .unwrap();
                    (16, format!("Frontside {g}"), 150, long - 0.15, 0.0)
                } else {
                    (1, "Kickflip Indy".into(), 180, 0.4, 0.0)
                }
            }
            Air::Onto => {
                if rng.random_bool(0.35) {
                    let (k, n) = *[(1, "Kickflip"), (2, "Heelflip"), (5, "Pop Shove-It")]
                        .choose(rng)
                        .unwrap();
                    (k, n.to_string(), 100, 0.33, 0.0)
                } else {
                    (0, "Ollie".to_string(), 30, 0.0, 0.0)
                }
            }
            Air::Big => {
                let flips = [
                    (1, "Kickflip", 100),
                    (2, "Heelflip", 100),
                    (3, "Varial Kickflip", 150),
                    (4, "Hardflip", 150),
                    (5, "Pop Shove-It", 80),
                ];
                match rng.random_range(0..10) {
                    0..=3 => {
                        let (k, n, p) = *flips.choose(rng).unwrap();
                        (k, n.to_string(), p, 0.35, 0.0)
                    }
                    4 if long > 0.6 => {
                        let (k, n, p) = *flips.choose(rng).unwrap();
                        (k + 8, format!("Double {n}"), p * 2 + 50, 0.6, 0.0)
                    }
                    5 | 6 if long > 0.55 => {
                        let (k, n, p) = *flips.choose(rng).unwrap();
                        (k, format!("360 {n}"), p + 140, 0.35, TAU)
                    }
                    7 if long > 0.8 => (25, "Frontflip".to_string(), 400, long - 0.15, 0.0),
                    _ => {
                        let g = *["Indy", "Melon", "Stalefish", "Nosegrab", "Tailgrab"]
                            .choose(rng)
                            .unwrap();
                        (16, g.to_string(), 130, (long - 0.15).max(0.2), 0.0)
                    }
                }
            }
        };
        self.flight = Some(Flight {
            t: 0.0,
            long,
            trick,
            trick_for,
            name,
            pts,
            spin,
            vert: (air == Air::Vert).then_some(PI),
            from_heading: self.heading,
        });
        if air == Air::Vert {
            self.speed = 0.0;
        }
    }

    fn fly(&mut self, dt: f64) {
        let Some(f) = &mut self.flight else { return };
        f.t += dt;
        self.pose = 2;
        let k = (f.t / (f.long - 0.08).max(0.1)).min(1.0);
        self.trick = if f.t > 0.05 && f.t < 0.05 + f.trick_for {
            f.trick
        } else {
            0
        };
        self.spin = f.spin * k;
        // Out of a quarter pipe: turning round, up there, to come back in.
        if let Some(turn) = f.vert {
            self.heading = f.from_heading + turn * k;
        }
    }

    fn land(&mut self, g: f64, surf: Surf, rng: &mut SmallRng, out: &mut Vec<Out>) {
        let Some(f) = self.flight.take() else { return };
        self.z = g;
        self.vz = 0.0;
        self.trick = 0;
        self.spin = 0.0;
        self.ground = g;
        self.climb = 0.0;
        if let Some(turn) = f.vert {
            self.heading = f.from_heading + turn;
            self.speed = 300.0;
        }
        // Not every landing's clean.
        let hard = f.trick != 0 && f.trick != 16;
        if hard && rng.random_bool(0.06) {
            self.bail = 1.2;
            self.tricks.clear();
            self.pts = 0;
            self.line = None;
            self.approach.clear();
            out.push(Out::Bail);
            return;
        }
        if !f.name.is_empty() {
            self.tricks.push(f.name.clone());
            self.pts += f.pts;
        }
        self.pose = 0;
        if let Surf::Grind(i) = surf {
            let name = *["50-50", "Boardslide", "Smith", "Nosegrind", "5-0", "Feeble"]
                .choose(rng)
                .unwrap();
            self.grind = Some((i, name));
            self.pose = 3;
        }
    }

    fn bank(&mut self, out: &mut Vec<Out>) {
        if self.tricks.is_empty() {
            return;
        }
        let n = self.tricks.len() as u32;
        let pts = self.pts * n;
        let label = self.tricks.join(" + ");
        self.tricks.clear();
        self.pts = 0;
        out.push(Out::Combo(pts.min(50_000), label));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rand::SeedableRng;

    /// Ridden for a while in the real park: he gets round its features (air,
    /// grinds, manuals), lands combos, and stays inside it.
    #[test]
    fn rides_the_park() {
        let text = std::fs::read_to_string("../../assets/maps/city.json").unwrap();
        let map = MapFile::from_json(&text).unwrap();
        let grid = map.grid();
        let park = Park::from(&map).unwrap();
        let mut rng = SmallRng::seed_from_u64(7);
        let (x0, y0) = (
            (park.area.x0 + park.area.x1) / 2.0,
            (park.area.y0 + park.area.y1) / 2.0,
        );
        let mut r = Rider::new(x0, y0);
        let (mut combos, mut airs, mut grinds, mut top) = (vec![], 0, 0, 0.0f64);
        let mut was_air = false;
        let mut whats = std::collections::HashSet::new();
        let (mut hist, mut circles): (Vec<(f64, f64, f64, u8)>, u32) = (vec![], 0);
        for _ in 0..6000 {
            for o in r.step(&park, &grid, &mut rng) {
                if let Out::Combo(_, l) = o {
                    combos.push(l);
                }
            }
            whats.insert(r.at);
            if r.pose == 2 && !was_air {
                airs += 1;
            }
            was_air = r.pose == 2;
            if r.pose == 3 {
                grinds += 1;
            }
            top = top.max(r.z);
            // Circling: a full turn (on the ground) without getting anywhere.
            hist.push((r.x, r.y, r.heading, r.pose));
            if hist.len() > 30 {
                hist.remove(0);
            }
            if hist.len() == 30 && hist.iter().all(|h| h.3 == 0) {
                let turn: f64 = hist
                    .windows(2)
                    .map(|w| ((w[1].2 - w[0].2 + PI).rem_euclid(TAU) - PI).abs())
                    .sum();
                let moved = (hist[29].0 - hist[0].0).hypot(hist[29].1 - hist[0].1);
                if turn > TAU && moved < 2.0 * T {
                    circles += 1;
                    hist.clear();
                }
            }
            assert!(
                park.area.x0 - T <= r.x && r.x <= park.area.x1 + T,
                "out of the park: {}",
                r.x
            );
            assert!(
                park.area.y0 - T <= r.y && r.y <= park.area.y1 + T,
                "out of the park: {}",
                r.y
            );
        }
        println!("circles: {circles}");
        println!(
            "{} combos, {airs} airs, {grinds} grind ticks, top {top:.0}px, at {whats:?}",
            combos.len()
        );
        for c in combos.iter().take(12) {
            println!("  {c}");
        }
        assert!(
            combos.len() >= 15,
            "only {} combos in 10 minutes",
            combos.len()
        );
        assert!(airs >= 25);
        assert!(grinds > 0, "never grinds");
        assert!(top > 40.0, "never gets up high");
        assert!(whats.len() >= 5, "only rides {whats:?}");
    }
}
