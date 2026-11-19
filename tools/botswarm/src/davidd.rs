//! Davidd: one bot that plays along as one of the gang (`--bots 1` with
//! `--api`). He has a seedling mark by his name saying he's a bot (`JoinClaims::bot`), and plays
//! the part: he has his own house (done up bit by bit) with a yard stand out
//! front, skates (mostly), fishes, hunts lucky crates, plays pool at the bar,
//! arena fights and paintball (the server plays his seat, as its sharpest
//! bot), stops to watch people go by, goes AFK now and then, and chats:
//! after a moment's typing, not to every line (if others are about and it
//! wasn't to him, mostly not), remembering who he's met and what they've
//! told him. Asked along to something, he mostly comes; sometimes he'll
//! come after he's done (ask again and he does). He'll follow you, and move
//! into a free house you show him.
//!
//! With an `ANTHROPIC_API_KEY` his chat and what he does about it are
//! Claude's (`davidd_brain`): he listens to anyone nearby (no need to say his
//! name), answers what was actually said, and does what he's asked: follows,
//! hangs out, comes over, goes fishing with you "for 10 minutes" (and gives
//! you a heads-up before he heads off to something else). Without a key
//! it's all rules. Either way, a little memory (a JSON file), and nothing
//! for the server to think about but one more player.

use crate::davidd_brain::{Brain, Decision};
use crate::davidd_park::{Out, Park, Rider};
use crate::{World, cheb, frame};
use anyhow::{Context, bail};
use commons_common::token::{self, AccessClaims, JoinClaims, TrustTier};
use commons_protocol::{
    ClientMsg, PROTOCOL_VERSION, ServerMsg, emote, fish_event, pool, skate, split_frame, together,
};
use commons_sim::{Grid, MapFile, Motion, TilePos, route};
use futures_util::stream::{SplitSink, SplitStream};
use futures_util::{SinkExt, StreamExt};
use rand::rngs::SmallRng;
use rand::seq::IndexedRandom;
use rand::{Rng, SeedableRng};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet, VecDeque};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tokio::net::TcpStream;
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream};

const NAME: &str = "Davidd";
/// Where he keeps what he remembers (out of the repo: the build folder), unless `COMMONS_DAVIDD_MEMORY` says.
fn memory_file() -> String {
    std::env::var("COMMONS_DAVIDD_MEMORY").unwrap_or_else(|_| "target/davidd-memory.json".into())
}
/// His board: Gold deck, big wheels, Lv 5 bearings, Pro trucks, the Fire trail (as the client packs it).
const KIT: u32 = 9 | (2 << 5) | (5 << 7) | (4 << 10) | (4 << 13);
/// The skateboard (a vehicle): for riding the streets.
const SKATEBOARD_KEY: &str = "skateboard";

type Ws = WebSocketStream<MaybeTlsStream<TcpStream>>;

fn unix() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs())
}

// ---- memory ------------------------------------------------------------------------

/// Someone he's met.
#[derive(Serialize, Deserialize, Default, Clone)]
struct Friend {
    name: String,
    met: u32,
    first: u64,
    last: u64,
    /// Things they've told him ("likes skating", "from Riga").
    facts: Vec<String>,
    /// What they last did together.
    did: String,
}

#[derive(Serialize, Deserialize, Default)]
struct Memory {
    /// By name, lowercase.
    people: HashMap<String, Friend>,
    /// His house's lot.
    lot: Option<String>,
    /// What he's put in it (item, x, y).
    placed: Vec<(i32, u16, u16)>,
    /// The day (since 1970) he last stocked his yard stand.
    stocked: u64,
    /// Furniture he's said he'll get for his house (item ids), next time he's in.
    #[serde(default)]
    wish: Vec<i32>,
    /// Furniture he's bought and has in his bag, to put in.
    #[serde(default)]
    have: Vec<i32>,
    /// His house is done to the design (the first time in since, it's redone).
    #[serde(default)]
    designed: bool,
    /// Things for out front (garden ponds) still to put out, and what's out there (item, x, y).
    #[serde(default)]
    outside: Vec<i32>,
    #[serde(default)]
    yard: Vec<(i32, u16, u16)>,
}

impl Memory {
    fn load() -> Memory {
        std::fs::read_to_string(memory_file())
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }
    fn save(&self) {
        if let Ok(s) = serde_json::to_string_pretty(self) {
            let _ = std::fs::write(memory_file(), s);
        }
    }
    fn person(&mut self, name: &str) -> &mut Friend {
        let f = self.people.entry(name.to_lowercase()).or_default();
        if f.name.is_empty() {
            f.name = name.to_string();
            f.first = unix();
        }
        f
    }
}

// ---- the city, as he knows it -----------------------------------------------------

/// A house on the street: its owner, its plot (x, y, w, h) and its door.
type House = (String, (u16, u16, u16, u16), Option<TilePos>);

/// Places in the city he goes to.
struct Places {
    park: (u16, u16, u16, u16),
    /// Tiles in the park to skate between.
    park_tiles: Vec<TilePos>,
    arena: Option<TilePos>,
    yard: Option<TilePos>,
    bar_door: Option<TilePos>,
    bowl_door: Option<TilePos>,
    /// Every building's door (by its zone), the bandstand, the easels.
    doors: HashMap<String, TilePos>,
    bandstand: Option<TilePos>,
    easels: Option<(TilePos, u8)>,
    /// Every house: its lot, where it stands, its door.
    houses: Vec<House>,
    /// Each house's front yard (by lot): its tiles, not the path to the door.
    yards: HashMap<String, Vec<TilePos>>,
    /// Somewhere to wander to (fountains, carts, benches…).
    sights: Vec<TilePos>,
    fountain: Option<TilePos>,
    market: Option<TilePos>,
}

impl Places {
    fn from(map: &MapFile, grid: &Grid) -> Places {
        let find = |kind: &str| map.objects.iter().find(|o| o.kind == kind);
        let spot = |label: &str| {
            map.objects
                .iter()
                .find(|o| o.kind == "spot" && o.label.as_deref() == Some(label))
                .and_then(|o| grid.nearest_walkable((o.x, o.y), 3))
        };
        let below = |o: &commons_sim::map::MapObject| {
            grid.nearest_walkable((o.x + o.w / 2, o.y + o.h + 1), 4)
        };
        let park = find("sk_park").map_or((0, 0, 0, 0), |o| (o.x, o.y, o.w, o.h));
        let mut park_tiles = vec![];
        for y in park.1..park.1 + park.3 {
            for x in park.0..park.0 + park.2 {
                if grid.walkable(x, y) {
                    park_tiles.push((x, y));
                }
            }
        }
        let houses = map
            .objects
            .iter()
            .filter(|o| o.kind == "house")
            .filter_map(|o| {
                let lot = o.label.clone()?;
                let door = spot(&format!("door:{lot}")).or_else(|| below(o));
                Some((lot, (o.x, o.y, o.w, o.h), door))
            })
            .collect();
        let mut yards: HashMap<String, Vec<TilePos>> = HashMap::new();
        // (Kept clear: the yard stand, with room in front for whoever's buying, the postbox.)
        let kept: Vec<(u16, u16, u16, u16)> = map
            .objects
            .iter()
            .filter(|o| !["yard", "spot", "house"].contains(&o.kind.as_str()))
            .map(|o| (o.x, o.y, o.w, o.h + u16::from(o.kind == "yard_stand")))
            .collect();
        let clear = |x: u16, y: u16| {
            !kept
                .iter()
                .any(|&(kx, ky, kw, kh)| x >= kx && x < kx + kw && y >= ky && y < ky + kh)
        };
        for o in map.objects.iter().filter(|o| o.kind == "yard") {
            let Some(lot) = o.label.clone() else { continue };
            for y in o.y..o.y + o.h {
                for x in o.x..o.x + o.w {
                    let g = map.ground[y as usize * map.width as usize + x as usize] as usize;
                    if grid.walkable(x, y)
                        && clear(x, y)
                        && map.ground_legend.get(g).is_none_or(|g| g != "path")
                    {
                        yards.entry(lot.clone()).or_default().push((x, y));
                    }
                }
            }
        }
        let sights = map
            .objects
            .iter()
            .filter(|o| {
                [
                    "fountain",
                    "market_cart",
                    "bandstand",
                    "lantern_stand",
                    "fisherman",
                    "sk_shop",
                    "notice_board",
                ]
                .contains(&o.kind.as_str())
            })
            .filter_map(below)
            .collect();
        Places {
            park,
            park_tiles,
            arena: find("arena_gate").and_then(below),
            fountain: find("fountain").and_then(below),
            market: find("market_cart").and_then(below),
            yard: find("pb_desk").and_then(below),
            bar_door: spot("door:bar"),
            bowl_door: spot("door:bowling"),
            doors: map
                .objects
                .iter()
                .filter(|o| o.kind == "spot")
                .filter_map(|o| {
                    let z = o.label.as_deref()?.strip_prefix("door:")?;
                    (!z.contains(':') && !z.starts_with('b') || ["bar", "bowling"].contains(&z))
                        .then(|| Some((z.to_string(), grid.nearest_walkable((o.x, o.y), 3)?)))
                        .flatten()
                })
                .collect(),
            bandstand: find("bandstand").and_then(below),
            easels: find("easels").and_then(|o| Some((below(o)?, o.w as u8))),
            houses,
            yards,
            sights,
        }
    }

    fn in_park(&self, t: TilePos) -> bool {
        let (x, y, w, h) = self.park;
        t.0 >= x && t.0 < x + w && t.1 >= y && t.1 < y + h
    }

    /// The house lot `t` is on or by (within a few tiles of it).
    fn house_at(&self, t: TilePos) -> Option<&House> {
        self.houses.iter().find(|(_, (x, y, w, h), _)| {
            t.0 + 3 >= *x && t.0 < x + w + 3 && t.1 + 3 >= *y && t.1 < y + h + 5
        })
    }
}

// ---- what he's up to -------------------------------------------------------------

#[derive(Clone, Copy, PartialEq, Debug)]
enum Want {
    Skate,
    Fish,
    Arena,
    Paintball,
    Pool,
    Bowl,
    Lucky,
    Home,
    Stroll,
    /// Fishing with the magnet (scrap, and the salvage game).
    Magnet,
    Arcade,
    Chess,
    Casino,
    /// Playing along at the bandstand.
    Jam,
    /// At the easels.
    Paint,
    /// Into somewhere (its zone), for a look round: the mall, the library…
    Visit(&'static str),
}

impl Want {
    /// The brain's name for an activity.
    fn from_word(w: &str) -> Option<Want> {
        Some(match w {
            "skate" => Want::Skate,
            "fish" => Want::Fish,
            "arena" => Want::Arena,
            "paintball" => Want::Paintball,
            "pool" => Want::Pool,
            "lucky" => Want::Lucky,
            "home" => Want::Home,
            "stroll" => Want::Stroll,
            "bowling" => Want::Bowl,
            "magnet_fishing" => Want::Magnet,
            "arcade" => Want::Arcade,
            "chess" => Want::Chess,
            "casino" => Want::Casino,
            "jam" => Want::Jam,
            "paint" => Want::Paint,
            "mall" => Want::Visit("mall"),
            "library" => Want::Visit("library"),
            "museum" => Want::Visit("museum"),
            "gallery" => Want::Visit("gallery"),
            _ => return None,
        })
    }

    /// As in "imma … in a min".
    fn to_do(self) -> &'static str {
        match self {
            Want::Skate => "go skate",
            Want::Fish => "go fish",
            Want::Arena => "hit the arena",
            Want::Paintball => "go play paintball",
            Want::Pool => "go shoot some pool at the mug",
            Want::Lucky => "go hunt for crates",
            Want::Home => "go sort my house out",
            Want::Stroll => "go walk around a bit",
            Want::Bowl => "go bowling",
            Want::Magnet => "go magnet fishing",
            Want::Arcade => "hit the arcade",
            Want::Chess => "play some chess",
            Want::Casino => "try my luck at the casino",
            Want::Jam => "go jam at the bandstand",
            Want::Paint => "go paint at the easels",
            Want::Visit("mall") => "check out the mall",
            Want::Visit("library") => "go to the library",
            Want::Visit("museum") => "go see the museum",
            Want::Visit(_) => "go look round somewhere",
        }
    }

    fn words(self) -> &'static str {
        match self {
            Want::Skate => "skating",
            Want::Fish => "fishing",
            Want::Arena => "the arena",
            Want::Paintball => "paintball",
            Want::Pool => "pool",
            Want::Lucky => "lucky crate hunting",
            Want::Home => "doing up my place",
            Want::Stroll => "walking about",
            Want::Bowl => "bowling",
            Want::Magnet => "magnet fishing",
            Want::Arcade => "the arcade",
            Want::Chess => "chess",
            Want::Casino => "the casino",
            Want::Jam => "jamming at the bandstand",
            Want::Paint => "painting",
            Want::Visit("mall") => "the mall",
            Want::Visit("library") => "the library",
            Want::Visit("museum") => "the museum",
            Want::Visit("gallery") => "the gallery",
            Want::Visit(_) => "looking round",
        }
    }
}

enum Doing {
    /// At the alley (another zone): his lane, and the last ball he rolled (frame, ball).
    Bowl {
        until: Instant,
        lane: u8,
        joined: bool,
        rolled: (u8, u8),
        /// Who he's here with (he waits for them, and bowls with them), and
        /// whether it's time to play (they said so; or he's on his own).
        with: Option<u32>,
        ready: bool,
        /// When he next moves (walking up to the lane, or about the place).
        next: Instant,
    },
    /// Standing about till then.
    Idle(Instant),
    /// Walking to `to`, then `then`.
    Walk {
        to: TilePos,
        then: Want,
        since: Instant,
    },
    Stroll {
        until: Instant,
        next: Instant,
    },
    Skate(Box<Ride>),
    Fish {
        until: Instant,
        magnet: bool,
    },
    /// At the arcade (another zone): his cabinet once he's at one.
    Arcade {
        until: Instant,
        cab: Option<u8>,
        since: Instant,
    },
    /// At a chess table: which, his seat, when he sat (and asked the Elder over).
    Chess {
        until: Instant,
        table: u32,
        white: bool,
        since: Instant,
        elder: bool,
        moved: String,
    },
    /// At the casino (another zone): a spin now and then.
    Casino {
        until: Instant,
        next: Instant,
    },
    /// At the bandstand or the easels: a note, a dab, now and then.
    Jam {
        until: Instant,
        next: Instant,
    },
    Paint {
        until: Instant,
        next: Instant,
        easel: u8,
    },
    /// Looking round somewhere (another zone).
    Visit {
        until: Instant,
        next: Instant,
    },
    Lucky {
        at: TilePos,
        until: Instant,
    },
    /// In a game the server plays his seat in: since when, its timeout.
    Game {
        want: Want,
        since: Instant,
        until: Instant,
        seen_over: bool,
    },
    /// At home (another zone), placing things.
    Home {
        until: Instant,
        next: Instant,
    },
    /// At the bar (another zone), at the pool table.
    Bar {
        until: Instant,
        joined: bool,
        seen_play: bool,
        /// As at the alley: who with, whether to play now, when he next moves.
        with: Option<u32>,
        ready: bool,
        next: Instant,
    },
    Watch {
        who: u32,
        until: Instant,
    },
    /// Walking after someone (they asked): when he next checks where they've got to.
    Follow {
        who: u32,
        until: Instant,
        next: Instant,
    },
    Afk {
        until: Instant,
    },
}

/// Skating: where he is (world px), where he's headed, how fast, how high.
struct Ride {
    x: f64,
    y: f64,
    heading: f64,
    speed: f64,
    z: f64,
    vz: f64,
    trick: u8,
    /// The line he's following (tiles).
    path: Vec<TilePos>,
    until: Instant,
    street: bool,
    combo: u32,
    tricks: Vec<&'static str>,
    /// In the park: riding its features (`davidd_park`).
    rider: Option<Rider>,
}

/// Someone he can see.
struct Seen {
    name: String,
    human: bool,
    tile: TilePos,
    motion: Option<Motion>,
    /// Sitting, fishing (`state::*`); on what (`vehicle`); away from the keyboard; on a board.
    state: u8,
    vehicle: u8,
    away: bool,
    skating: bool,
}

impl Seen {
    fn at(&self, t: u32) -> TilePos {
        self.motion.as_ref().map_or(self.tile, |m| m.tile_at(t))
    }
}

/// Something he's agreed to for a while ("fish with me for 10 min", "hang
/// out with me"): what (None: being with them), with whom, till when; a
/// heads-up before it's over, then on to `Davidd::queued`.
struct Plan {
    want: Option<Want>,
    with: Option<u32>,
    until: Instant,
    warn_at: Instant,
    warned: bool,
    what: String,
}

/// A piece of furniture: what it is, and what kind (on a table, a table, switched on).
struct Furn {
    name: String,
    /// A garden pond: two tiles by two, in the front yard.
    pond: bool,
    top: bool,
    surface: bool,
    toggle: bool,
}

/// His house, done properly (the home map: the living room on the left, the
/// bedroom through the arch on the right): what goes where, which way it
/// faces (0 toward you, 1 right, 2 away, 3 left). Floor first, then the tables'
/// things, then what hangs on the walls (given as the wall tile).
const DESIGN: &[(&str, u16, u16, u8)] = &[
    // The living room: fireplace and tv on the back wall, sofa facing them, a rug, a coffee table.
    ("Fireplace", 6, 2, 0),
    ("Retro TV", 10, 2, 0),
    ("Record Player", 4, 2, 0),
    ("Monstera", 3, 2, 0),
    ("Potted Fern", 13, 2, 0),
    ("Persian Rug", 10, 4, 0),
    ("Coffee Table", 10, 5, 0),
    ("Double Sofa", 9, 7, 2),
    ("Cozy Armchair", 7, 5, 1),
    ("Floor Lamp", 12, 7, 0),
    ("Plant Stand", 12, 4, 0),
    ("Full Bookcase", 3, 5, 1),
    ("Arcade Cabinet", 3, 8, 1),
    // The desk corner.
    ("Writing Desk", 4, 10, 0),
    ("Wooden Chair", 4, 11, 2),
    // Dining, by the arch.
    ("Dining Table", 14, 10, 0),
    ("Wooden Chair", 13, 10, 1),
    ("Wooden Chair", 15, 10, 3),
    ("Low Cabinet", 12, 12, 0),
    // The bedroom.
    ("Double Bed", 20, 3, 0),
    ("Nightstand", 19, 3, 0),
    ("Nightstand", 21, 3, 0),
    ("Round Rug", 20, 5, 0),
    ("Teddy Bear", 22, 3, 0),
    ("Big Aquarium", 22, 7, 3),
    ("Bean Bag", 21, 10, 2),
    ("Lava Lamp", 22, 11, 0),
    ("Cactus", 22, 12, 0),
    // On the tables.
    ("Tea Set", 10, 5, 0),
    ("Laptop", 4, 10, 0),
    ("Vase of Flowers", 14, 10, 0),
    ("Radio", 12, 12, 0),
    ("Table Lamp", 21, 3, 0),
    ("Stack of Books", 19, 3, 0),
    // On the walls.
    ("Sunset Painting", 6, 1, 0),
    ("Neon Heart", 10, 1, 0),
    ("Curtained Window", 13, 1, 0),
    ("Curtained Window", 4, 1, 0),
    ("Seascape Painting", 17, 3, 3),
    ("Cat Portrait", 2, 10, 1),
    ("Wall Shelf", 2, 7, 1),
    ("Cuckoo Clock", 20, 1, 0),
    ("Curtained Window", 23, 9, 3),
];

/// The room's walls and floor.
const WALLS: &str = "Wood Panelling";
const FLOOR: &str = "Parquet Flooring";

/// Something for sale: the market's (bought by id), or the mall's (by its
/// department and shelf); to wear, its slot code.
#[derive(Clone)]
struct Good {
    id: i32,
    name: String,
    kind: String,
    price: i64,
    mall: Option<(String, u16)>,
    code: u8,
}

/// Who asked him to buy something: someone here, or by phone.
#[derive(Clone)]
enum Asker {
    Here(u32),
    Phone(String),
    Nobody,
}

/// A purchase, done (or not): what, for whom, and how it went.
struct Bought {
    good: Good,
    for_name: Option<String>,
    asker: Asker,
    result: Result<(), String>,
}

/// Moving house, done: which, who asked, and how it went (Err: who lives there, if anyone).
struct Moved {
    lot: String,
    asker: String,
    result: Result<(), String>,
}

/// The brain's answer: to whom (or the event it was about), and the line it was about.
struct Thought {
    /// When what it's answering was said.
    asked: Instant,
    who: Option<u32>,
    text: String,
    event: bool,
    d: Option<Decision>,
    /// Said already: just the doing left (talk first, then go).
    said: bool,
    /// By phone (a DM), not in-game chat: who from, and where they are.
    phone: Option<Phone>,
}

/// A DM come in: who from (their id, their name), what it says.
struct PhoneMsg {
    from: String,
    name: String,
    text: String,
}

/// Who a phone message is from, and where they are (as the friends list
/// has it: the zone, its label; their house's lot).
#[derive(Clone)]
struct Phone {
    from: String,
    name: String,
    zone: Option<String>,
    label: String,
    lot: Option<String>,
}

/// Asked along to something, he said he'd come after: who, what, when.
struct Later {
    who: String,
    want: Want,
    asked: Instant,
    /// With them (and for how long), if that was the ask.
    together: bool,
    minutes: Option<f64>,
}

struct Ctx {
    url: String,
    api: String,
    social: String,
    secret: Vec<u8>,
    sub: String,
    look: u32,
    /// What he's wearing (mall things, a byte a slot).
    style: u32,
    http: reqwest::Client,
}

impl Ctx {
    fn bearer(&self) -> String {
        let claims = AccessClaims {
            sub: self.sub.clone(),
            name: NAME.into(),
            look: self.look,
            style: self.style,
            tier: TrustTier::Newcomer,
            minor: false,
            muted_until: 0,
        };
        format!("Bearer {}", token::sign(&self.secret, &claims, 300))
    }
    async fn get(&self, url: String) -> Option<serde_json::Value> {
        let r = self
            .http
            .get(url)
            .header("authorization", self.bearer())
            .send()
            .await
            .ok()?;
        r.json().await.ok()
    }
    async fn post(&self, url: String, body: serde_json::Value) -> Option<serde_json::Value> {
        let r = self
            .http
            .post(url)
            .header("authorization", self.bearer())
            .json(&body)
            .send()
            .await
            .ok()?;
        if !r.status().is_success() {
            return None;
        }
        r.json().await.ok().or(Some(serde_json::Value::Null))
    }
    fn join_token(&self, zone: &str, owner: Option<String>, arrive: Option<String>) -> String {
        let claims = JoinClaims {
            sub: self.sub.clone(),
            name: NAME.into(),
            look: self.look,
            style: self.style,
            tier: TrustTier::Newcomer,
            minor: false,
            zone: zone.into(),
            instance: 1,
            owner,
            muted_until: 0,
            arrive,
            watch: false,
            channel: 0,
            bot: true,
        };
        token::sign(&self.secret, &claims, 300)
    }
}

pub async fn run(
    url: String,
    api: String,
    social: String,
    secret: Vec<u8>,
    world: &World,
    map: &MapFile,
) -> anyhow::Result<()> {
    let (sub, look) = crate::sign_in(&api, NAME).await?;
    let ctx = Ctx {
        url,
        api,
        social,
        secret,
        sub,
        look,
        style: 0,
        http: reqwest::Client::new(),
    };
    let places = Places::from(map, &world.grid);
    let home_map = std::fs::read_to_string("assets/maps/home.json")
        .ok()
        .and_then(|t| MapFile::from_json(&t).ok());
    let mut mem = Memory::load();
    let mut d = Davidd::new(ctx, places, world, home_map);
    d.park = Park::from(map);
    d.fish_spots = shore(map, &world.grid);
    if let Some(m) = std::fs::read_to_string("assets/maps/bowling.json")
        .ok()
        .and_then(|t| MapFile::from_json(&t).ok())
    {
        let g = m.grid();
        d.lane_feet = m
            .objects
            .iter()
            .filter(|o| o.kind == "bowling_lane")
            .filter_map(|o| g.nearest_walkable((o.x + o.w / 2, o.y + o.h), 2))
            .collect();
    }
    if let Some(m) = std::fs::read_to_string("assets/maps/bar.json")
        .ok()
        .and_then(|t| MapFile::from_json(&t).ok())
    {
        let g = m.grid();
        d.pool_spot = m
            .objects
            .iter()
            .find(|o| o.kind == "pool_table")
            .and_then(|o| g.nearest_walkable((o.x + o.w / 2, o.y + o.h), 2));
    }
    if let Some(m) = std::fs::read_to_string("assets/maps/mall.json")
        .ok()
        .and_then(|t| MapFile::from_json(&t).ok())
    {
        let g = m.grid();
        for dept in m.objects.iter().filter(|o| o.kind == "dept") {
            let inside = |o: &commons_sim::map::MapObject| {
                o.x >= dept.x && o.x < dept.x + dept.w && o.y >= dept.y && o.y < dept.y + dept.h
            };
            if let (Some(key), Some(c)) = (
                dept.label.clone(),
                m.objects.iter().find(|o| o.kind == "counter" && inside(o)),
            ) && let Some(t) = g.nearest_walkable((c.x + c.w / 2, c.y + c.h), 3)
            {
                d.counters.insert(key, t);
            }
        }
    }
    if let Some(a) = std::fs::read_to_string("assets/maps/arcade.json")
        .ok()
        .and_then(|t| MapFile::from_json(&t).ok())
    {
        for o in a
            .objects
            .iter()
            .filter(|o| ["arcade_cabinet", "dance_machine", "pinball"].contains(&o.kind.as_str()))
        {
            d.arcade_cabs.push((o.x, o.y));
            d.arcade_names.push(o.label.clone().unwrap_or_default());
        }
    }
    match &d.brain {
        Some(b) => println!("davidd: thinking with {}", b.describe()),
        None => println!(
            "davidd: NO AI BRAIN: no ANTHROPIC_API_KEY and no Claude Code found, so he's on simple scripted rules."
        ),
    }
    d.settle_in(&mut mem).await;
    tokio::spawn(friends(
        d.ctx.social.clone(),
        d.ctx.secret.clone(),
        d.ctx.sub.clone(),
        d.ctx.look,
    ));
    let (phone_tx, phone_rx) = mpsc::unbounded_channel();
    d.phone_rx = Some(phone_rx);
    tokio::spawn(phone(
        d.ctx.social.clone(),
        d.ctx.secret.clone(),
        d.ctx.sub.clone(),
        d.ctx.look,
        phone_tx,
    ));
    loop {
        if let Err(e) = d.live(&mut mem).await {
            eprintln!("davidd: {e:#} (back in a moment)");
            tokio::time::sleep(Duration::from_secs(5)).await;
        }
    }
}

/// His phone: connected to the social server as players are (so he's
/// online on his friends' lists, and where he is with it), DMs coming in.
async fn phone(
    social: String,
    secret: Vec<u8>,
    sub: String,
    look: u32,
    tx: mpsc::UnboundedSender<PhoneMsg>,
) {
    let base = social.replacen("http", "ws", 1);
    loop {
        let claims = AccessClaims {
            sub: sub.clone(),
            name: NAME.into(),
            look,
            style: 0,
            tier: TrustTier::Newcomer,
            minor: false,
            muted_until: 0,
        };
        let url = format!(
            "{base}/api/social/ws?token={}",
            token::sign(&secret, &claims, 300)
        );
        match tokio_tungstenite::connect_async(&url).await {
            Ok((ws, _)) => {
                let (mut w, mut r) = ws.split();
                let mut ping = tokio::time::interval(Duration::from_secs(30));
                loop {
                    tokio::select! {
                        m = r.next() => match m {
                            Some(Ok(Message::Text(t))) => {
                                let Ok(v) = serde_json::from_str::<serde_json::Value>(t.as_str()) else { continue };
                                if v["t"] == "dm" && v["m"]["from"].as_str() != Some(sub.as_str()) {
                                    let _ = tx.send(PhoneMsg {
                                        from: v["m"]["from"].as_str().unwrap_or("").into(),
                                        name: v["from_name"].as_str().unwrap_or("someone").into(),
                                        text: v["m"]["text"].as_str().unwrap_or("").into(),
                                    });
                                }
                            }
                            Some(Ok(Message::Close(_))) | Some(Err(_)) | None => break,
                            _ => {}
                        },
                        _ = ping.tick() => {
                            if w.send(Message::Ping(Default::default())).await.is_err() {
                                break;
                            }
                        }
                    }
                }
            }
            Err(e) => eprintln!("davidd: phone: {e}"),
        }
        tokio::time::sleep(Duration::from_secs(5)).await;
    }
}

/// Friend requests: accepted, after a little while (as anyone would, a
/// minute or so later).
async fn friends(social: String, secret: Vec<u8>, sub: String, look: u32) {
    let http = reqwest::Client::new();
    let mut rng = SmallRng::from_os_rng();
    let mut due: Vec<(Instant, String)> = vec![];
    loop {
        tokio::time::sleep(Duration::from_secs(4)).await;
        let claims = AccessClaims {
            sub: sub.clone(),
            name: NAME.into(),
            look,
            style: 0,
            tier: TrustTier::Newcomer,
            minor: false,
            muted_until: 0,
        };
        let bearer = format!("Bearer {}", token::sign(&secret, &claims, 300));
        let now = Instant::now();
        for (_, from) in due.iter().filter(|(at, _)| *at <= now) {
            let _ = http
                .post(format!("{social}/api/social/respond"))
                .header("authorization", &bearer)
                .json(&serde_json::json!({ "id": from, "accept": true }))
                .send()
                .await;
        }
        due.retain(|(at, _)| *at > now);
        let Ok(res) = http
            .get(format!("{social}/api/social/notifications"))
            .header("authorization", &bearer)
            .send()
            .await
        else {
            continue;
        };
        let Ok(list) = res.json::<serde_json::Value>().await else {
            continue;
        };
        let mut unread = false;
        for n in list.as_array().into_iter().flatten() {
            if n["read"].as_bool() == Some(true) {
                continue;
            }
            unread = true;
            if n["kind"] == "friend_request"
                && let Some(from) = n["body"]["from_id"].as_str()
                && !due.iter().any(|(_, f)| f == from)
            {
                due.push((
                    now + Duration::from_secs(rng.random_range(15..75)),
                    from.to_string(),
                ));
            }
        }
        if unread {
            let _ = http
                .post(format!("{social}/api/social/notifications/read"))
                .header("authorization", &bearer)
                .json(&serde_json::json!({}))
                .send()
                .await;
        }
    }
}

struct Davidd<'w> {
    ctx: Ctx,
    places: Places,
    world: &'w World,
    home_map: Option<MapFile>,
    home_grid: Option<Grid>,
    rng: SmallRng,
    zone: String,
    arrive: Option<String>,
    self_id: u32,
    me: TilePos,
    motion: Option<Motion>,
    /// Where he last set off for, following someone (so not re-sent every check).
    heading_for: Option<TilePos>,
    epoch: Instant,
    offset: i64,
    seen: HashMap<u32, Seen>,
    doing: Doing,
    /// Things to say (when), and messages to send (when).
    say: Vec<(Instant, String)>,
    send: Vec<(Instant, ClientMsg)>,
    /// Who he's been talking with, and when they last spoke to him.
    talking: HashMap<u32, Instant>,
    /// Who's talked to him and is owed an answer (since when).
    owed: HashMap<u32, Instant>,
    /// When the server last said a walk of his can't get there.
    no_path: Option<Instant>,
    /// Where he last stood, and since when (to notice being stuck).
    last_moved: (TilePos, Instant),
    /// Buying in the mall: walking to the counter first.
    shop_trip: Option<ShopTrip>,
    /// The door he last went in by, from town (a building, or a house's lot): out by it again.
    came_from: Option<String>,
    /// Somewhere to go in (another zone, someone's home): walked to its door first.
    go_in: Option<GoIn>,
    /// Walked somewhere in town to be there (not to do anything): he stays a bit.
    linger: bool,
    /// Somewhere in town to walk to once he's out (of the building he's in).
    go_to_after: Option<String>,
    /// A pond going out in his front yard.
    yard_job: Option<YardJob>,
    /// The mall: where to stand at each department's counter, and which department has what.
    counters: HashMap<String, TilePos>,
    dept_of: HashMap<i32, String>,
    /// When he last said "english?" to each of them (once is enough for a bit).
    no_slo: HashMap<String, Instant>,
    /// Who he's last stopped to watch (so not the same one over and over).
    watched: HashMap<u32, Instant>,
    later: Option<Later>,
    next_afk: Instant,
    next_check: Instant,
    lucky: Option<(TilePos, Instant)>,
    /// What he'd like to do next, given the choice.
    last_want: Want,
    /// Items bought for home (to place), by id.
    furniture: Vec<i32>,
    /// The shop's furniture he could get (id, name, price), and every item's name.
    shop: Vec<(i32, String, i64)>,
    /// Everything he could buy (the market's and the mall's), and his coins.
    goods: Vec<Good>,
    coins: i64,
    bought_tx: mpsc::UnboundedSender<Bought>,
    bought_rx: mpsc::UnboundedReceiver<Bought>,
    /// A new outfit on: shown (rejoining) once he's free.
    restyle: bool,
    /// What he owns (item id: how many), from his bag.
    owned: HashMap<i32, i64>,
    /// The arcade's cabinets (where, by number) and their games; who's waiting at which.
    arcade_cabs: Vec<TilePos>,
    arcade_names: Vec<String>,
    arcade_waiting: HashMap<u8, u32>,
    bowl_waiting: HashMap<u8, u32>,
    /// Lanes someone else is on (a game, or waiting for someone).
    bowl_busy: HashSet<u8>,
    /// Who's waiting at the pool table for someone to play (not him).
    pool_waiting: Option<u32>,
    /// Where to stand: at the foot of each lane; at the pool table.
    lane_feet: Vec<TilePos>,
    pool_spot: Option<TilePos>,
    /// The catalog's furniture; the design still to put down.
    furn: HashMap<i32, Furn>,
    decor: VecDeque<(i32, u16, u16, u8)>,
    /// Every spot by water in town (to fish from), and a place to fish near (where he was asked).
    fish_spots: Vec<(TilePos, TilePos)>,
    near_hint: Option<TilePos>,
    /// Things agreed to, to do once he's said so (talk first, then go).
    deferred: Vec<(Instant, Thought)>,
    /// Everyone he has seen here, by id (their names, after they have gone).
    names_seen: HashMap<u32, String>,
    /// Who he was with before the last door (old id, name): known again by name.
    relink: Vec<(u32, String)>,
    /// What he's in the mood for these days, and till when.
    mood: Vec<Want>,
    mood_until: Instant,
    /// There first, waiting for whoever he came with; and (just done waiting) on in.
    waiting: Option<Waiting>,
    waited: bool,
    /// When he may next start a conversation out of a silence, and how long a silence it takes.
    next_opener: Instant,
    quiet_for: Duration,
    /// When he came in here (this zone).
    entered: Instant,
    /// Following someone he has lost sight of: since when.
    lost_since: Option<Instant>,
    /// On his board for a trip across town; whom he's said hi to (when);
    /// when he last had company; when he started.
    board_trip: bool,
    greeted: HashMap<String, Instant>,
    /// When he last went his own way from someone (after hanging out): not straight back over.
    parted: HashMap<u32, Instant>,
    /// Told what to do (stay put, stop, go and do something): not off over to people instead till then.
    keep_put: Instant,
    last_company: Option<Instant>,
    started: Instant,
    /// Chess games he's in (table: status, position, legal moves).
    chess: HashMap<u32, (u8, String, Vec<String>)>,
    /// Seats he's seen taken.
    taken_seats: std::collections::HashSet<u32>,
    /// Other zones' maps (to wander about in), as needed.
    zone_grids: HashMap<String, Grid>,
    /// Lines to say (or text) that come back from things done in the background.
    lines_tx: mpsc::UnboundedSender<(Asker, String)>,
    lines_rx: mpsc::UnboundedReceiver<(Asker, String)>,
    names: HashMap<i32, String>,
    skateboard: Option<i32>,
    riding: bool,
    /// His house's lot (from his memory, each tick).
    current_lot: Option<String>,
    /// Claude, if there's a key; its answers come back on `thoughts`.
    brain: Option<Brain>,
    thoughts_tx: mpsc::UnboundedSender<Thought>,
    thoughts: mpsc::UnboundedReceiver<Thought>,
    moved_tx: mpsc::UnboundedSender<Moved>,
    /// DMs to him (his phone), and the threads (when, who, from him?, what).
    phone_rx: Option<mpsc::UnboundedReceiver<PhoneMsg>>,
    phone_waiting: VecDeque<PhoneMsg>,
    dms: VecDeque<(Instant, String, bool, String)>,
    /// Off to meet someone (asked by phone): who, till when, for how long then.
    meeting: Option<(String, Instant, f64)>,
    /// Somewhere to go (another zone): which, and whose home if it's one.
    travel: Option<(String, Option<String>)>,
    /// In someone else's home: whose.
    visiting: Option<String>,
    moved_rx: mpsc::UnboundedReceiver<Moved>,
    /// A request's out (one at a time).
    pondering: bool,
    /// Someone's said something to answer: who, and when to (a beat after
    /// they stop typing, so a few lines in a row get one answer).
    unanswered: Option<(u32, Instant)>,
    /// What's happened to him lately (when, what): things to talk about.
    diary: VecDeque<(Instant, String)>,
    /// What's been said around him lately (when, who, what), his own lines too.
    log: VecDeque<(Instant, String, String)>,
    plan: Option<Plan>,
    /// What he's off to do next (said so, or asked to while elsewhere).
    queued: Option<Want>,
    /// Hanging out and it's gone quiet: when he next might say something.
    next_chatter: Instant,
    /// The skatepark's features, for riding them.
    park: Option<Park>,
    /// When he next writes where he is (`COMMONS_DAVIDD_STATUS`, for tests).
    next_report: Instant,
}

impl<'w> Davidd<'w> {
    fn new(ctx: Ctx, places: Places, world: &'w World, home_map: Option<MapFile>) -> Self {
        let home_grid = home_map.as_ref().map(|m| m.grid());
        let now = Instant::now();
        let brain = Brain::from_env();
        let (thoughts_tx, thoughts) = mpsc::unbounded_channel();
        let (moved_tx, moved_rx) = mpsc::unbounded_channel();
        let (bought_tx, bought_rx) = mpsc::unbounded_channel();
        let (lines_tx, lines_rx) = mpsc::unbounded_channel();
        Davidd {
            ctx,
            places,
            world,
            home_map,
            home_grid,
            rng: SmallRng::from_os_rng(),
            zone: "city".into(),
            arrive: None,
            self_id: 0,
            me: (0, 0),
            motion: None,
            heading_for: None,
            epoch: now,
            offset: 0,
            seen: HashMap::new(),
            doing: Doing::Idle(now + Duration::from_secs(3)),
            say: vec![],
            send: vec![],
            talking: HashMap::new(),
            owed: HashMap::new(),
            no_path: None,
            last_moved: ((0, 0), Instant::now()),
            shop_trip: None,
            came_from: None,
            go_in: None,
            linger: false,
            go_to_after: None,
            yard_job: None,
            counters: HashMap::new(),
            dept_of: HashMap::new(),
            no_slo: HashMap::new(),
            watched: HashMap::new(),
            later: None,
            next_afk: now + Duration::from_secs(60 * 30),
            next_check: now + Duration::from_secs(60 * 8),
            lucky: None,
            last_want: Want::Skate,
            furniture: vec![],
            shop: vec![],
            goods: vec![],
            coins: 0,
            bought_tx,
            bought_rx,
            restyle: false,
            owned: HashMap::new(),
            arcade_cabs: vec![],
            arcade_names: vec![],
            arcade_waiting: HashMap::new(),
            bowl_waiting: HashMap::new(),
            bowl_busy: HashSet::new(),
            pool_waiting: None,
            lane_feet: vec![],
            pool_spot: None,
            names_seen: HashMap::new(),
            relink: vec![],
            mood: vec![],
            mood_until: Instant::now(),
            waiting: None,
            waited: false,
            next_opener: Instant::now() + Duration::from_secs(5 * 60),
            quiet_for: Duration::from_secs(5 * 60),
            entered: Instant::now(),
            lost_since: None,
            board_trip: false,
            greeted: HashMap::new(),
            parted: HashMap::new(),
            keep_put: Instant::now(),
            last_company: None,
            started: now,
            furn: HashMap::new(),
            decor: VecDeque::new(),
            fish_spots: vec![],
            near_hint: None,
            deferred: vec![],
            chess: HashMap::new(),
            taken_seats: std::collections::HashSet::new(),
            zone_grids: HashMap::new(),
            lines_tx,
            lines_rx,
            names: HashMap::new(),
            skateboard: None,
            riding: false,
            current_lot: None,
            brain,
            thoughts_tx,
            thoughts,
            moved_tx,
            moved_rx,
            phone_rx: None,
            phone_waiting: VecDeque::new(),
            dms: VecDeque::new(),
            meeting: None,
            travel: None,
            visiting: None,
            pondering: false,
            unanswered: None,
            log: VecDeque::new(),
            diary: VecDeque::new(),
            plan: None,
            queued: None,
            next_chatter: now,
            next_report: now,
            park: None,
        }
    }

    fn server_now(&self) -> u32 {
        (self.epoch.elapsed().as_millis() as i64 + self.offset).max(0) as u32
    }

    fn after(&mut self, lo: u64, hi: u64) -> Instant {
        Instant::now() + Duration::from_millis(self.rng.random_range(lo..hi))
    }

    // ---- his house, his coins, his things ---------------------------------------------

    /// Coins (the dev well), a house if he hasn't one, a few things to put in it,
    /// his skateboard; and today's yard stand.
    async fn settle_in(&mut self, mem: &mut Memory) {
        let (api, social) = (self.ctx.api.clone(), self.ctx.social.clone());
        let me = self.ctx.get(format!("{api}/api/me")).await;
        let coins = me.as_ref().and_then(|m| m["coins"].as_i64()).unwrap_or(0);
        self.coins = if coins < 4000 { coins + 10_000 } else { coins };
        self.ctx.style = me
            .as_ref()
            .and_then(|m| m["style"].as_u64().or(m["player"]["style"].as_u64()))
            .unwrap_or(0) as u32;
        if coins < 4000 {
            for _ in 0..5 {
                let _ = self
                    .ctx
                    .post(format!("{api}/api/dev/well"), serde_json::json!({}))
                    .await;
            }
        }
        let homes = self.ctx.get(format!("{social}/api/social/homes")).await;
        let mine = homes.as_ref().and_then(|h| {
            h["lots"]
                .as_array()?
                .iter()
                .find(|l| l["owner"].as_str() == Some(self.ctx.sub.as_str()))
                .and_then(|l| l["lot"].as_str().map(String::from))
        });
        if let Some(lot) = mine {
            mem.lot = Some(lot);
        } else {
            let taken: Vec<String> = homes
                .as_ref()
                .and_then(|h| h["lots"].as_array().cloned())
                .unwrap_or_default()
                .iter()
                .filter_map(|l| l["lot"].as_str().map(String::from))
                .collect();
            let free: Vec<String> = self
                .places
                .houses
                .iter()
                .map(|h| h.0.clone())
                .filter(|l| !taken.contains(l))
                .collect();
            if let Some(lot) = free.choose(&mut self.rng).cloned()
                && self
                    .ctx
                    .post(
                        format!("{social}/api/social/homes/claim"),
                        serde_json::json!({ "lot": lot }),
                    )
                    .await
                    .is_some()
            {
                mem.lot = Some(lot);
                mem.placed.clear();
            }
        }
        // His things: the catalog's cheaper furniture, and the skateboard;
        // what's for sale (the market's, and the mall's this week).
        let mut kinds: HashMap<i32, (String, String, u8)> = HashMap::new();
        if let Some(cat) = self.ctx.get(format!("{api}/api/catalog")).await {
            for it in cat["items"].as_array().into_iter().flatten() {
                let id = it["id"].as_i64().unwrap_or(0) as i32;
                let buy = it["meta"]["buy"].as_i64().unwrap_or(0);
                let name = it["name"].as_str().unwrap_or("").to_string();
                let kind = it["kind"].as_str().unwrap_or("").to_string();
                let code = it["meta"]["code"].as_u64().unwrap_or(0) as u8;
                if buy > 0 && !name.is_empty() {
                    self.goods.push(Good {
                        id,
                        name: name.clone(),
                        kind: kind.clone(),
                        price: buy,
                        mall: None,
                        code,
                    });
                }
                if kind == "furniture" {
                    let m = &it["meta"];
                    self.furn.insert(
                        id,
                        Furn {
                            name: name.clone(),
                            pond: m["pond"] == true,
                            top: m["top"] == true,
                            surface: !m["surface"].is_null(),
                            toggle: m["use"] == "toggle",
                        },
                    );
                }
                kinds.insert(id, (name.clone(), kind, code));
                if it["kind"] == "furniture" && (20..=2500).contains(&buy) && !name.is_empty() {
                    self.shop.push((id, name.clone(), buy));
                }
                self.names.insert(id, name);
                if it["key"] == SKATEBOARD_KEY {
                    self.skateboard = Some(id);
                }
                if it["kind"] == "furniture" && (20..=400).contains(&buy) {
                    self.furniture.push(id);
                }
            }
        }
        if let Some(inv) = self.ctx.get(format!("{api}/api/inventory")).await {
            for it in inv["items"].as_array().into_iter().flatten() {
                let id = it["item"].as_i64().unwrap_or(0) as i32;
                self.owned.insert(id, it["qty"].as_i64().unwrap_or(0));
            }
        }
        // Today's crate (and opened, once he's in town).
        let _ = self
            .ctx
            .post(format!("{api}/api/crate/daily"), serde_json::json!({}))
            .await;
        if let Some(stock) = self.ctx.get(format!("{api}/api/mall/stock")).await {
            for d in stock["departments"].as_array().into_iter().flatten() {
                let dept = d["key"].as_str().unwrap_or("").to_string();
                for sh in d["shelves"].as_array().into_iter().flatten() {
                    let id = sh["item"].as_i64().unwrap_or(0) as i32;
                    self.dept_of.insert(id, dept.clone());
                    let Some((name, kind, code)) = kinds.get(&id).cloned() else {
                        continue;
                    };
                    if sh["left"].as_i64() == Some(0) {
                        continue;
                    }
                    // (Sold at the market too: kept as that, for gifts; this is the mall's.)
                    if self.goods.iter().any(|g| g.id == id && g.mall.is_none())
                        && !matches!(kind.as_str(), "outfit" | "hat" | "accessory" | "skin")
                    {
                        continue;
                    }
                    self.goods.push(Good {
                        id,
                        name,
                        kind,
                        price: sh["price"].as_i64().unwrap_or(0),
                        mall: Some((dept.clone(), sh["slot"].as_u64().unwrap_or(0) as u16)),
                        code,
                    });
                }
            }
        }
        self.stock_design().await;
        mem.save();
        self.stock_stand(mem).await;
    }

    /// Once a day: a few things bought at the market, on his yard stand, cheap.
    async fn stock_stand(&mut self, mem: &mut Memory) {
        let day = unix() / 86_400;
        if mem.stocked == day || mem.lot.is_none() || self.furniture.is_empty() {
            return;
        }
        let (api, social) = (self.ctx.api.clone(), self.ctx.social.clone());
        let cat = self.ctx.get(format!("{api}/api/catalog")).await;
        let price_of = |id: i32| {
            cat.as_ref().and_then(|c| {
                c["items"]
                    .as_array()?
                    .iter()
                    .find(|i| i["id"].as_i64() == Some(id as i64))
                    .and_then(|i| i["meta"]["buy"].as_i64())
            })
        };
        for _ in 0..3 {
            let Some(&item) = self.furniture.choose(&mut self.rng) else {
                break;
            };
            let key = format!("davidd-{}-{}", unix(), self.rng.random::<u32>());
            if self
                .ctx
                .post(
                    format!("{api}/api/market/buy"),
                    serde_json::json!({ "item": item, "qty": 1, "key": key }),
                )
                .await
                .is_none()
            {
                continue;
            }
            let price = (price_of(item).unwrap_or(100) as f64 * self.rng.random_range(0.55..0.8))
                .max(5.0) as i64;
            let key = format!("davidd-stand-{}-{}", unix(), self.rng.random::<u32>());
            let _ = self
                .ctx
                .post(format!("{social}/api/social/stalls/put"), serde_json::json!({ "item": item, "qty": 1, "price": price, "key": key, "at": "yard" }))
                .await;
        }
        mem.stocked = day;
        mem.save();
    }

    /// On his own skateboard (for the streets), or off it.
    async fn ride(&mut self, on: bool) {
        if self.riding == on {
            return;
        }
        let item = if on { self.skateboard.unwrap_or(0) } else { 0 };
        if self
            .ctx
            .post(
                format!("{}/api/me/ride", self.ctx.api),
                serde_json::json!({ "item": item }),
            )
            .await
            .is_some()
        {
            self.riding = on;
        }
    }

    // ---- being somewhere --------------------------------------------------------

    async fn connect(&mut self) -> anyhow::Result<(SplitSink<Ws, Message>, SplitStream<Ws>)> {
        let owner = (self.zone == "home").then(|| {
            self.visiting
                .clone()
                .unwrap_or_else(|| self.ctx.sub.clone())
        });
        let join_token = self.ctx.join_token(&self.zone, owner, self.arrive.take());
        let (ws, _) = tokio_tungstenite::connect_async(&self.ctx.url)
            .await
            .context("connect")?;
        let (mut tx, rx) = ws.split();
        tx.send(frame(&ClientMsg::Hello {
            join_token,
            version: PROTOCOL_VERSION,
            view_w: 30,
            view_h: 17,
            device: 0xdab1dd,
        }))
        .await?;
        // Who he's with, by name (ids are the zone's: they change at every door),
        // to know them again here.
        let mut with: Vec<u32> = self.plan.iter().filter_map(|p| p.with).collect();
        if let Doing::Bowl { with: Some(w), .. } | Doing::Bar { with: Some(w), .. } = self.doing {
            with.push(w);
        }
        self.relink = with
            .into_iter()
            .filter_map(|id| self.names_seen.get(&id).map(|n| (id, n.clone())))
            .collect();
        self.seen.clear();
        self.names_seen.clear();
        self.entered = Instant::now();
        self.motion = None;
        self.self_id = 0;
        Ok((tx, rx))
    }

    /// Lives his life in one place, till it's time to go somewhere else (another zone).
    async fn live(&mut self, mem: &mut Memory) -> anyhow::Result<()> {
        let (mut tx, mut rx) = self.connect().await?;
        let mut timer = tokio::time::interval(Duration::from_millis(100));
        let mut next_ping = Instant::now();
        // (Test runs: how much he hears, now and then, to tell a quiet line from a dead one.)
        let testing = std::env::var_os("COMMONS_DAVIDD_STATUS").is_some();
        let (mut heard, mut kinds, mut next_count) = (
            0u32,
            std::collections::BTreeMap::<String, u32>::new(),
            Instant::now() + Duration::from_secs(20),
        );
        loop {
            tokio::select! {
                msg = rx.next() => {
                    let Some(msg) = msg else { bail!("connection closed") };
                    let data = match msg? {
                        Message::Binary(d) => d,
                        Message::Close(_) => bail!("connection closed"),
                        _ => continue,
                    };
                    for raw in split_frame(&data) {
                        match raw.and_then(ServerMsg::decode) {
                            Ok(m) => {
                                if testing {
                                    heard += 1;
                                    let k = format!("{m:?}");
                                    *kinds.entry(k.split([' ', '{', '(']).next().unwrap_or("").to_string()).or_default() += 1;
                                }
                                self.hear(m, mem);
                            }
                            Err(e) => trace(&format!("undecodable: {e:?}")),
                        }
                    }
                }
                _ = timer.tick() => {
                    let now = Instant::now();
                    if testing && now >= next_count {
                        next_count = now + Duration::from_secs(20);
                        trace(&format!("heard {heard} in 20s: {kinds:?}"));
                        heard = 0;
                        kinds.clear();
                    }
                    if now >= next_ping {
                        next_ping = now + Duration::from_secs(5);
                        tx.send(frame(&ClientMsg::Ping { client_t: self.epoch.elapsed().as_millis() as u32 })).await?;
                    }
                    if self.self_id == 0 {
                        continue;
                    }
                    let st = self.server_now();
                    if let Some(m) = &self.motion {
                        self.me = m.tile_at(st);
                        if m.is_done(st) {
                            self.motion = None;
                        }
                    }
                    let mut out = vec![];
                    self.mind(mem);
                    self.report();
                    let travel = self.think(mem, &mut out).await;
                    // What's due to be said and sent.
                    let (due, later): (Vec<_>, Vec<_>) = self.say.drain(..).partition(|(at, _)| *at <= now);
                    self.say = later;
                    for (_, text) in due {
                        self.heard(NAME, &text);
                        trace(&format!("says: {text}"));
                        out.push(ClientMsg::ChatSay { text });
                    }
                    let (due, later): (Vec<_>, Vec<_>) = self.send.drain(..).partition(|(at, _)| *at <= now);
                    self.send = later;
                    out.extend(due.into_iter().map(|(_, m)| m));
                    for m in out {
                        tx.send(frame(&m)).await?;
                    }
                    if let Some((zone, arrive)) = travel {
                        // Never popping up somewhere: out by the door he went in by, or
                        // (reconnecting) just where he stands; in by the door he's at.
                        let arrive = arrive.or_else(|| {
                            if zone == self.zone {
                                Some(format!("at:{},{}", self.me.0, self.me.1))
                            } else if zone == "city" {
                                self.came_from.clone()
                            } else {
                                None
                            }
                        });
                        if self.zone == "city" && zone != "city" {
                            self.came_from = self.door_by(self.me);
                        }
                        // Through a door: whoever's following him comes too (into a
                        // home: whose, so they can knock).
                        if zone != self.zone {
                            let whose = if zone == "home" {
                                self.visiting.clone().unwrap_or_else(|| self.ctx.sub.clone())
                            } else {
                                String::new()
                            };
                            let going = ClientMsg::Going {
                                zone: zone.clone(),
                                arrive: whose,
                            };
                            let _ = tx.send(frame(&going)).await;
                        }
                        let _ = tx.send(Message::Close(None)).await;
                        self.zone = zone;
                        self.arrive = arrive;
                        tokio::time::sleep(Duration::from_millis(self.rng.random_range(700..1500))).await;
                        return Ok(());
                    }
                }
            }
        }
    }

    /// What the server says: who's about, what's going on, who's talking.
    fn hear(&mut self, m: ServerMsg, mem: &mut Memory) {
        match m {
            ServerMsg::Welcome {
                self_id, server_t, ..
            } => {
                self.self_id = self_id;
                self.offset = server_t as i64 - self.epoch.elapsed().as_millis() as i64;
            }
            ServerMsg::CellEnter { entities, .. } => {
                for e in entities {
                    self.seen_entity(&e);
                }
            }
            ServerMsg::Spawn { entity } => self.seen_entity(&entity),
            ServerMsg::CellLeave { ids, .. } => {
                for id in ids {
                    self.seen.remove(&id);
                }
            }
            ServerMsg::Despawn { id } => {
                self.seen.remove(&id);
            }
            ServerMsg::MoveStart {
                id,
                speed_x10,
                t0,
                sprint_in,
                path,
            } => {
                let m = Motion {
                    path: path.iter().map(|t| (t.x, t.y)).collect(),
                    t0,
                    speed_x10,
                    sprint_in,
                };
                if id == self.self_id {
                    trace(&format!(
                        "moving: {} tiles, speed {speed_x10}",
                        m.path.len()
                    ));
                    self.motion = Some(m);
                } else if let Some(o) = self.seen.get_mut(&id) {
                    o.motion = Some(m);
                }
            }
            ServerMsg::StateChange { id, state, x, y } => {
                // Seats sat in (so he takes a free one).
                let seat = y as u32 * self.world.grid.w as u32 + x as u32;
                if state == commons_protocol::state::SITTING {
                    self.taken_seats.insert(seat);
                } else {
                    self.taken_seats.remove(&seat);
                }
                if let Some(o) = self.seen.get_mut(&id) {
                    o.state = state;
                }
                self.at_tile(id, x, y);
            }
            ServerMsg::AwayChanged { id, away } => {
                if let Some(o) = self.seen.get_mut(&id) {
                    o.away = away;
                }
            }
            ServerMsg::Skating { id, on } => {
                if let Some(o) = self.seen.get_mut(&id) {
                    o.skating = on;
                }
            }
            ServerMsg::LookChanged { id, vehicle, .. } => {
                if let Some(o) = self.seen.get_mut(&id) {
                    o.vehicle = vehicle;
                }
            }
            ServerMsg::Snap { id, x, y } => self.at_tile(id, x, y),
            ServerMsg::Skater { id, x, y, .. } if id != self.self_id => {
                if let Some(o) = self.seen.get_mut(&id) {
                    o.tile = (x / 100, y / 100);
                    o.motion = None;
                }
            }
            ServerMsg::Pong { client_t, server_t } => {
                let rtt = self.epoch.elapsed().as_millis() as i64 - client_t as i64;
                self.offset = server_t as i64 + rtt / 2 - self.epoch.elapsed().as_millis() as i64;
            }
            ServerMsg::ChatBubble { id, text } if id != self.self_id => self.chat(id, &text, mem),
            // Waved at: wave back (most of the time).
            ServerMsg::EmoteShown {
                id,
                emote: emote::WAVE,
            } if id != self.self_id && self.rng.random_bool(0.8) => {
                let at = self.after(500, 1500);
                self.send
                    .push((at, ClientMsg::Emote { emote: emote::WAVE }));
            }
            // Someone close by dancing, laughing, cheering…: he joins in (now and then).
            ServerMsg::EmoteShown { id, emote: e }
                if id != self.self_id
                    && !matches!(self.doing, Doing::Afk { .. })
                    && self.seen.get(&id).is_some_and(|o| {
                        o.human && cheb(o.at(self.server_now()), self.me) <= 8
                    }) =>
            {
                let back = match e {
                    emote::DANCE | emote::ROBOT => Some((e, 0.6)),
                    emote::LAUGH => Some((emote::LAUGH, 0.5)),
                    emote::CHEER | emote::CLAP => Some((emote::CHEER, 0.5)),
                    emote::HEART => Some((emote::HEART, 0.45)),
                    _ => None,
                };
                if let Some((back, p)) = back
                    && self.rng.random_bool(p)
                {
                    let at = self.after(700, 2000);
                    self.send.push((at, ClientMsg::Emote { emote: back }));
                }
            }
            // Rock paper scissors, done: a word about it (not always).
            ServerMsg::Rps {
                a,
                b,
                phase,
                a_pick,
                b_pick,
                ..
            } if phase == commons_protocol::rps::REVEAL
                && (a == self.self_id || b == self.self_id)
                && self.rng.random_bool(0.7) =>
            {
                let (mine, theirs) = if a == self.self_id {
                    (a_pick, b_pick)
                } else {
                    (b_pick, a_pick)
                };
                let line = if commons_protocol::rps::beats(mine, theirs) {
                    self.pick(&["ez", "lets gooo", "too easy", "gg ez lol", "called it"])
                } else if commons_protocol::rps::beats(theirs, mine) {
                    self.pick(&["nooo", "rematch", "ok ok u got me", "rigged lol", "bruh"])
                } else {
                    self.pick(&["lol same", "again", "great minds", "tie??"])
                };
                self.type_out(line);
            }
            // Asked to be followed, hugged, high-fived…: yes (to people), after a beat.
            ServerMsg::Offered { from, kind } if kind != together::STOP_FOLLOW => {
                if self.seen.get(&from).is_some_and(|o| o.human) {
                    let at = self.after(600, 1800);
                    self.send.push((at, ClientMsg::Accept { from, kind }));
                }
            }
            ServerMsg::Offered {
                from,
                kind: together::STOP_FOLLOW,
            } => {
                if matches!(self.doing, Doing::Follow { who, .. } if who == from) {
                    self.doing = Doing::Idle(Instant::now() + Duration::from_secs(4));
                }
            }
            // Rock paper scissors (he said yes): a pick, after a think.
            ServerMsg::Rps { a, b, phase, .. }
                if phase == commons_protocol::rps::CHOOSING
                    && (a == self.self_id || b == self.self_id) =>
            {
                let pick = self.rng.random_range(1..=3);
                let at = self.after(1500, 5000);
                self.send.push((at, ClientMsg::RpsPick { pick }));
            }
            ServerMsg::ArcadeState {
                cab, a, b, status, ..
            } => {
                if status == 4 && a != 0 && b == 0 {
                    self.arcade_waiting.insert(cab, a);
                } else {
                    self.arcade_waiting.remove(&cab);
                }
                let me = self.self_id;
                if let Doing::Arcade {
                    until,
                    cab: Some(c),
                    ..
                } = &mut self.doing
                    && *c == cab
                    && (a == me || b == me)
                    && [2u8, 3, 5].contains(&status)
                {
                    let won = (status == 2 && a == me) || (status == 3 && b == me);
                    *until = (*until).min(Instant::now() + Duration::from_secs(4));
                    let game = self
                        .arcade_names
                        .get(cab as usize)
                        .cloned()
                        .unwrap_or_default();
                    self.diary.push_back((
                        Instant::now(),
                        format!(
                            "{} a game of {game} at the arcade",
                            if won { "won" } else { "lost" }
                        ),
                    ));
                }
            }
            ServerMsg::GameState {
                table,
                status,
                white,
                black,
                fen,
                legal,
                ..
            } => {
                let me = self.self_id;
                if white == me || black == me {
                    if [2u8, 3, 4].contains(&status)
                        && self.chess.get(&table).is_some_and(|g| g.0 == 1)
                    {
                        let won = (status == 2 && white == me) || (status == 3 && black == me);
                        let vs = if white == commons_protocol::ELDER_ID
                            || black == commons_protocol::ELDER_ID
                        {
                            "the Park Elder"
                        } else {
                            "someone"
                        };
                        self.diary.push_back((
                            Instant::now(),
                            match status {
                                4 => format!("drew a chess game against {vs}"),
                                _ if won => format!("won a chess game against {vs}"),
                                _ => format!("lost a chess game to {vs}"),
                            },
                        ));
                        if let Doing::Chess { until, .. } = &mut self.doing {
                            *until = (*until).min(Instant::now() + Duration::from_secs(5));
                        }
                    }
                    self.chess.insert(table, (status, fen, legal));
                }
            }
            ServerMsg::LuckyShown { x, y, moves } => {
                let left = moves.saturating_sub(self.server_now()) as u64;
                self.lucky = Some((
                    (x, y),
                    Instant::now() + Duration::from_millis(left.min(600_000)),
                ));
            }
            ServerMsg::LuckyFound { id, x, y } => {
                if self.lucky.is_some_and(|(t, _)| t == (x, y)) {
                    self.lucky = None;
                }
                if id == self.self_id {
                    self.note("found a lucky crate".into());
                }
                // (Said only with someone about, and not every time.)
                if id == self.self_id
                    && !self.people_near(self.me, 10).is_empty()
                    && self.rng.random_bool(0.3)
                {
                    let line = ["yo found a crate", "crate lets go", "free loot lol"]
                        .choose(&mut self.rng)
                        .unwrap()
                        .to_string();
                    let at = self.after(800, 2000);
                    self.say.push((at, line));
                }
            }
            ServerMsg::FishEvent { id, kind, .. } if id == self.self_id => {
                // (Done fishing, a bite still on the line: left be.)
                let fishing = matches!(self.doing, Doing::Fish { .. });
                match kind {
                    fish_event::BITE if !fishing => {}
                    fish_event::FLOP if !fishing => {}
                    fish_event::BITE => {
                        let at = self.after(400, 1300);
                        let quality = if self.rng.random_bool(0.85) {
                            self.rng.random_range(650..1000)
                        } else {
                            150
                        };
                        self.send.push((at, ClientMsg::FishReel { quality }));
                    }
                    fish_event::FLOP => {
                        let mut at = Instant::now();
                        for _ in 0..5 {
                            at += Duration::from_millis(self.rng.random_range(380..700));
                            self.send.push((at, ClientMsg::FishHit {}));
                        }
                    }
                    fish_event::CAUGHT | fish_event::ESCAPED => {
                        self.note(if kind == fish_event::CAUGHT {
                            "caught a fish".into()
                        } else {
                            "had a fish get away".into()
                        });
                        // A word about it only now and then, and only with someone close by
                        // to hear it (nobody announces every fish to an empty lake).
                        let company = !self.people_near(self.me, 8).is_empty();
                        if company && self.rng.random_bool(0.08) {
                            let line = if kind == fish_event::CAUGHT {
                                self.pick(&[
                                    "finally lol",
                                    "ez",
                                    "theyre biting today",
                                    "lets gooo",
                                    "another one",
                                ])
                            } else {
                                self.pick(&["bruh it got away", "nooo", "it snapped off smh"])
                            };
                            let at = self.after(900, 2200);
                            self.say.push((at, line));
                        }
                        // Another cast, from where he's stood (or he's done).
                        if let Doing::Fish { until, magnet } = self.doing
                            && Instant::now() < until
                            && let Some((_, water)) = self
                                .fish_spots
                                .iter()
                                .find(|(s, _)| cheb(*s, self.me) <= 1)
                                .copied()
                        {
                            let at = self.after(3000, 9000);
                            self.send.push((
                                at,
                                ClientMsg::FishCast {
                                    x: water.0,
                                    y: water.1,
                                    magnet,
                                },
                            ));
                        }
                    }
                    // The magnet's down: everything it found, up.
                    7 => {
                        let at = self.after(1000, 2200);
                        let extras = self.rng.random_range(1..=255);
                        self.send.push((
                            at,
                            ClientMsg::SalvageReel {
                                target: true,
                                extras,
                            },
                        ));
                    }
                    _ => {}
                }
            }
            ServerMsg::ArenaState {
                status,
                slots,
                winner,
                ..
            } => {
                if status == 4
                    && slots.contains(&self.self_id)
                    && matches!(
                        self.doing,
                        Doing::Game {
                            seen_over: false,
                            ..
                        }
                    )
                {
                    self.note(if winner == self.self_id {
                        "won a gladiator fight in the arena".into()
                    } else {
                        "lost a gladiator fight in the arena".into()
                    });
                }
                if let Doing::Game {
                    want: Want::Arena,
                    seen_over,
                    ..
                } = &mut self.doing
                {
                    let mine = slots.contains(&self.self_id);
                    if status == 4 {
                        *seen_over = true;
                    } else if *seen_over || (!mine && status == 0) {
                        self.doing = Doing::Idle(Instant::now());
                    }
                }
            }
            ServerMsg::PbState {
                status,
                slots,
                blue,
                red,
                ..
            } => {
                if status == 3
                    && slots.contains(&self.self_id)
                    && matches!(
                        self.doing,
                        Doing::Game {
                            seen_over: false,
                            ..
                        }
                    )
                {
                    self.note(format!("played a paintball match (blue {blue}, red {red})"));
                }
                if let Doing::Game {
                    want: Want::Paintball,
                    seen_over,
                    ..
                } = &mut self.doing
                {
                    let mine = slots.contains(&self.self_id);
                    if status == 3 {
                        *seen_over = true;
                    } else if *seen_over || (!mine && status == 0) {
                        self.doing = Doing::Idle(Instant::now());
                    }
                }
            }
            // Bowling: his ball, when it's his go (once a ball); a lane someone's
            // on, another; the game over, off home soon.
            ServerMsg::BowlState {
                lane: l,
                a,
                b,
                status,
                turn,
                frame,
                ball,
                ..
            } => {
                if status == commons_protocol::bowl::WAITING && a != 0 && b == 0 {
                    self.bowl_waiting.insert(l, a);
                } else {
                    self.bowl_waiting.remove(&l);
                }
                let me = self.self_id;
                let on = matches!(
                    status,
                    commons_protocol::bowl::PLAYING | commons_protocol::bowl::WAITING
                );
                if on && a != me && b != me {
                    self.bowl_busy.insert(l);
                } else {
                    self.bowl_busy.remove(&l);
                }
                if let Doing::Bowl {
                    until,
                    lane,
                    joined,
                    rolled,
                    with,
                    ready,
                    ..
                } = &mut self.doing
                    && l == *lane
                {
                    let mine = a == me || b == me;
                    // Game over: another (with a friend, when they want one).
                    let over = matches!(
                        status,
                        commons_protocol::bowl::A_WON
                            | commons_protocol::bowl::B_WON
                            | commons_protocol::bowl::DRAW
                    );
                    if *joined && mine && over {
                        *joined = false;
                        *ready = with.is_none();
                    }
                    if *joined && !mine && status == commons_protocol::bowl::PLAYING {
                        *lane = (*lane + 1) % 4;
                        *joined = false;
                    } else if mine && status == commons_protocol::bowl::PLAYING {
                        let my_go = (turn == 0 && a == me) || (turn == 1 && b == me);
                        if my_go && *rolled != (frame, ball) {
                            *rolled = (frame, ball);
                            trace(&format!("bowls: lane {l}, frame {frame}, ball {ball}"));
                            let aim = (commons_protocol::bowl::AIM_MIDDLE as i32
                                + self.rng.random_range(-140..140))
                                as u16;
                            let power = self.rng.random_range(820..990);
                            let at = Instant::now()
                                + Duration::from_millis(self.rng.random_range(1500..3500));
                            self.send.push((
                                at,
                                ClientMsg::BowlRoll {
                                    lane: l,
                                    aim,
                                    power,
                                },
                            ));
                        }
                    } else if mine
                        && [
                            commons_protocol::bowl::A_WON,
                            commons_protocol::bowl::B_WON,
                            commons_protocol::bowl::DRAW,
                        ]
                        .contains(&status)
                    {
                        let won = (status == commons_protocol::bowl::A_WON && a == me)
                            || (status == commons_protocol::bowl::B_WON && b == me);
                        *until = (*until).min(Instant::now() + Duration::from_secs(5));
                        let what = if won {
                            "won a game of bowling against the alley bot"
                        } else {
                            "lost a game of bowling to the alley bot"
                        };
                        self.diary.push_back((Instant::now(), what.into()));
                    }
                }
            }
            ServerMsg::PoolState { a, b, status, .. } => {
                self.pool_waiting =
                    (status == pool::WAITING && a != 0 && a != self.self_id).then_some(a);
                if let Doing::Bar {
                    seen_play,
                    until,
                    joined,
                    with,
                    ready,
                    ..
                } = &mut self.doing
                {
                    let mine = a == self.self_id || b == self.self_id;
                    if status == pool::PLAYING && mine {
                        *seen_play = true;
                    } else if *seen_play && status != pool::PLAYING {
                        // Game over: with a friend, another if they want one; alone, off.
                        *seen_play = false;
                        *joined = false;
                        *ready = false;
                        if with.is_none() {
                            *until = Instant::now() + Duration::from_secs(3);
                        }
                        self.diary.push_back((
                            Instant::now(),
                            "played a game of pool at the Mossy Mug".into(),
                        ));
                    }
                }
            }
            ServerMsg::Error { message, .. } => {
                trace(&format!("server says: {message}"));
                if message.contains("get there") {
                    self.no_path = Some(Instant::now());
                }
                if let Some(j) = &mut self.yard_job
                    && j.sent.is_some_and(|t| t.elapsed() < Duration::from_secs(3))
                {
                    j.failed = true;
                }
            }
            _ => {}
        }
    }

    /// Someone (or he) is at (x, y), stood still.
    fn at_tile(&mut self, id: u32, x: u16, y: u16) {
        if id == self.self_id {
            self.me = (x, y);
            self.motion = None;
        } else if let Some(o) = self.seen.get_mut(&id) {
            o.tile = (x, y);
            o.motion = None;
        }
    }

    fn seen_entity(&mut self, e: &commons_protocol::EntityInfo) {
        if e.id == self.self_id {
            self.me = (e.x, e.y);
            return;
        }
        self.names_seen.insert(e.id, e.name.clone());
        // Someone he's with, here too (by their new id).
        if let Some(k) = self.relink.iter().position(|(_, n)| *n == e.name) {
            let (old, _) = self.relink.remove(k);
            let new = Some(e.id);
            if let Some(p) = &mut self.plan
                && p.with == Some(old)
            {
                p.with = new;
            }
            if let Doing::Bowl { with, .. } | Doing::Bar { with, .. } = &mut self.doing
                && *with == Some(old)
            {
                *with = new;
            }
        }
        let motion = (e.path.len() >= 2).then(|| Motion {
            path: e.path.iter().map(|t| (t.x, t.y)).collect(),
            t0: e.t0,
            speed_x10: e.speed_x10,
            sprint_in: e.sprint_in,
        });
        self.seen.insert(
            e.id,
            Seen {
                name: e.name.clone(),
                human: !e.bot,
                tile: (e.x, e.y),
                motion,
                state: e.state,
                vehicle: e.vehicle,
                away: e.away,
                skating: false,
            },
        );
    }

    /// People about (not bots), within `r` tiles, and where.
    fn people_near(&self, at: TilePos, r: i32) -> Vec<(u32, TilePos)> {
        let t = self.server_now();
        self.seen
            .iter()
            .filter(|(_, o)| o.human)
            .map(|(&id, o)| (id, o.at(t)))
            .filter(|&(_, p)| cheb(p, at) <= r)
            .collect()
    }

    // ---- talking ----------------------------------------------------------------

    /// Someone said something: whether it's to him, and if so what he says (and does).
    fn chat(&mut self, id: u32, text: &str, mem: &mut Memory) {
        let Some(o) = self.seen.get(&id) else { return };
        if !o.human {
            return;
        }
        let name = o.name.clone();
        let speaker = o.at(self.server_now());
        trace(&format!(
            "hears {name} ({} tiles): {text}",
            cheb(speaker, self.me)
        ));
        let lower = text.to_lowercase();
        let named = ["davidd", "david", "dave", "dav "]
            .iter()
            .any(|n| lower.contains(n));
        let close = cheb(speaker, self.me) <= 7;
        let others = self
            .people_near(speaker, 8)
            .into_iter()
            .filter(|&(p, _)| p != id)
            .count();
        let talking = self
            .talking
            .get(&id)
            .is_some_and(|t| t.elapsed() < Duration::from_secs(90));
        let afk = matches!(self.doing, Doing::Afk { .. });
        if cheb(speaker, self.me) <= 16 || named {
            self.heard(&name, text);
        }
        // With a brain: he hears anyone nearby, and it decides whether it was to him.
        if self.brain.is_some() {
            if !(named || talking || cheb(speaker, self.me) <= 12) || (afk && !named) {
                return;
            }
        } else {
            // To him? Said his name; close by with hardly anyone else about; or in the
            // middle of chatting. With a crowd about and not to him: now and then.
            let to_him = named
                || talking
                || (close && others <= 1)
                || (cheb(speaker, self.me) <= 10 && self.rng.random_bool(0.4));
            if !to_him || (afk && !named) {
                return;
            }
        }
        if afk {
            // Back at the keyboard, a bit late.
            self.doing = Doing::Idle(Instant::now() + Duration::from_secs(2));
            self.send
                .push((Instant::now(), ClientMsg::Away { away: false }));
            let at = self.after(4000, 9000);
            self.say.push((at, "sorry was afk".into()));
        }
        // Slovenian (slang too): he doesn't speak it. Only when it's to him, and not
        // over and over.
        if slovenian(text) {
            let to_him = named || talking || (close && others <= 1);
            if to_him
                && self
                    .no_slo
                    .get(&name)
                    .is_none_or(|t| t.elapsed() > Duration::from_secs(45))
            {
                self.no_slo.insert(name.clone(), Instant::now());
                self.talking.insert(id, Instant::now());
                let r = self.pick(NO_SLO);
                self.type_out(r);
            }
            return;
        }
        // In a crowd, now and then, he just doesn't catch it.
        if self.brain.is_none() && !named && !talking && others >= 2 && self.rng.random_bool(0.15) {
            return;
        }
        self.talking.insert(id, Instant::now());
        let before = mem.people.get(&name.to_lowercase()).cloned();
        let f = mem.person(&name);
        let gap = unix().saturating_sub(f.last);
        f.met += u32::from(gap > 600);
        f.last = unix();
        self.learn(&name, &lower, mem);
        if self.brain.is_some() {
            mem.save();
            // A beat after they stop typing (so a few lines get one answer).
            self.unanswered = Some((id, Instant::now() + Duration::from_millis(500)));
            // Talked to: he stops (if he was only walking about) while he reads it and thinks.
            if named || talking || (close && others <= 1) {
                self.pause_for_chat();
                // And with them a while (whatever he was off to do can wait).
                self.keep_company(id);
                // Talked to: owed an answer (whatever the brain makes of it).
                self.owed.insert(id, Instant::now());
            }
            return;
        }
        let was = std::mem::discriminant(&self.doing);
        let reply = self.answer(id, &name, &lower, before.as_ref(), gap, mem);
        trace(&format!("{name}: {text} -> {reply:?}"));
        mem.save();
        if let Some(r) = reply {
            if std::mem::discriminant(&self.doing) == was {
                self.pause_for_chat();
                self.keep_company(id);
            }
            self.type_out(r);
        }
    }

    /// Things they tell him about themselves, kept.
    fn learn(&mut self, name: &str, t: &str, mem: &mut Memory) {
        let grab = |after: &str| {
            t.split(after).nth(1).map(|s| {
                s.trim()
                    .trim_end_matches(['.', '!', '?'])
                    .split(' ')
                    .take(4)
                    .collect::<Vec<_>>()
                    .join(" ")
            })
        };
        let mut facts = vec![];
        for (k, label) in [
            ("i like ", "likes"),
            ("i love ", "loves"),
            ("my favourite ", "favourite"),
            ("my favorite ", "favourite"),
            ("i'm from ", "from"),
            ("im from ", "from"),
            ("i play ", "plays"),
        ] {
            if let Some(v) = grab(k).filter(|v| !v.is_empty() && v.len() < 40) {
                facts.push(format!("{label} {v}"));
            }
        }
        let f = mem.person(name);
        for fact in facts {
            if !f.facts.contains(&fact) {
                f.facts.push(fact);
            }
        }
        if f.facts.len() > 8 {
            f.facts.remove(0);
        }
    }

    fn pick(&mut self, lines: &[&str]) -> String {
        lines.choose(&mut self.rng).unwrap().to_string()
    }

    /// What he says back (and what he goes and does, if it's an invite).
    fn answer(
        &mut self,
        id: u32,
        name: &str,
        t: &str,
        before: Option<&Friend>,
        gap: u64,
        mem: &mut Memory,
    ) -> Option<String> {
        let first = name.split_whitespace().next().unwrap_or(name).to_string();
        let words: Vec<&str> = t
            .split(|c: char| !c.is_alphanumeric() && c != '\'')
            .filter(|w| !w.is_empty())
            .collect();
        let has = |w: &[&str]| {
            w.iter().any(|x| {
                if x.contains(' ') || x.len() > 4 {
                    t.contains(x)
                } else {
                    words.contains(&x.trim())
                }
            })
        };
        // Move into this house.
        if has(&[
            "live here",
            "live in this",
            "move in",
            "move here",
            "this house",
            "live in that",
        ]) {
            return Some(self.move_house(id, mem));
        }
        if has(&[
            "stop following",
            "stop follow",
            "dont follow",
            "don't follow",
        ]) {
            if let Doing::Follow { who, .. } = self.doing {
                self.send.push((
                    Instant::now(),
                    ClientMsg::Offer {
                        to: who,
                        kind: together::STOP_FOLLOW,
                    },
                ));
            }
            self.doing = Doing::Idle(Instant::now() + Duration::from_secs(3));
            return Some(self.pick(&["ok ok", "aight", "k, laters"]));
        }
        let minutes = minutes_in(t);
        if let Some(rest) = t.split("buy ").nth(1).filter(|_| !t.contains("cant buy")) {
            let (for_them, rest) = match rest.strip_prefix("me ") {
                Some(r) => (true, r),
                None => (false, rest),
            };
            let what = rest
                .trim_start_matches("a ")
                .trim_start_matches("an ")
                .trim_start_matches("the ")
                .trim_end_matches(['?', '!', '.'])
                .trim()
                .to_string();
            let for_name = for_them.then(|| name.to_string());
            return Some(match self.buy(&what, for_name, None, Asker::Here(id)) {
                Ok(()) => self.pick(&["ok one sec", "sure, buying it", "bet, getting it"]),
                Err(why) => why,
            });
        }
        if has(&[
            "hang out",
            "hangout",
            "chill with me",
            "stay with me",
            "keep me company",
            "be with me",
        ]) {
            self.start_follow(id, minutes.unwrap_or(10.0), false);
            return Some(self.pick(&[
                "ye sure",
                "bet",
                "ok im down",
                "sure thing",
                "yeah lets chill",
            ]));
        }
        if has(&[
            "wait here",
            "stay here",
            "wait for me",
            "stay there",
            "wait there",
        ]) {
            self.stay(minutes.unwrap_or(2.0));
            return Some(self.pick(&["ok ill wait", "k", "aight im here", "sure, take ur time"]));
        }
        if has(&[
            "follow me",
            "come with me",
            "come here",
            "come over",
            "this way",
            "over here",
            "where are you",
            "where r u",
        ]) {
            let formal = has(&["follow me", "come with me", "this way"]);
            self.start_follow(
                id,
                minutes.unwrap_or(if formal { 5.0 } else { 1.5 }),
                formal,
            );
            return Some(self.pick(&["coming", "omw", "ok lead the way", "sure"]));
        }
        // Asked along somewhere.
        let want = if has(&["skate", "skating", "board", "skatepark", "ollie"]) {
            Some(Want::Skate)
        } else if has(&["paintball", "splat"]) {
            Some(Want::Paintball)
        } else if has(&["arena", "gladiator", "fight"]) {
            Some(Want::Arena)
        } else if has(&["fish"]) {
            Some(Want::Fish)
        } else if has(&["pool", "billiard", "bar", "mug", "cozy cup"]) {
            Some(Want::Pool)
        } else if has(&["lucky", "crate"]) {
            Some(Want::Lucky)
        } else {
            None
        };
        let inviting = has(&[
            "let's", "lets", "wanna", "want to", "come", "join", "go ", "play", "shall we",
            "you down", "u down", "up for", "?",
        ]);
        if let Some(w) = want.filter(|_| inviting) {
            // Asked again, after he said he'd come later: now he goes.
            let again = self.later.as_ref().is_some_and(|l| {
                l.who == name && l.want == w && l.asked.elapsed() > Duration::from_secs(25)
            });
            let with_me = has(&["with me", "with us", "together"]) || minutes.is_some();
            if again || self.rng.random_bool(0.8) {
                self.later = None;
                if with_me {
                    self.make_plan(Some(w), Some(id), minutes.unwrap_or(8.0));
                }
                self.go(w, Some(id));
                mem.person(name).did = w.words().into();
                return Some(if again {
                    self.pick(&[
                        "ok ok im done, lets go",
                        "alright finished, coming",
                        "yep done, omw",
                    ])
                } else {
                    let l = [
                        format!("yeah sure, {}", w.words()),
                        "sure lets go".into(),
                        "ooh yes".into(),
                        format!("down, {first}"),
                        "ok omw".into(),
                    ];
                    l.choose(&mut self.rng).unwrap().clone()
                });
            }
            let busy = self.finishing();
            self.later = Some(Later {
                who: name.into(),
                want: w,
                asked: Instant::now(),
                together: with_me,
                minutes,
            });
            return Some(format!(
                "{} {busy}, ill come after",
                self.pick(&[
                    "wait lemme just finish",
                    "gimme a sec, just gotta finish",
                    "one sec, finishing"
                ])
            ));
        }
        if has(&[
            "are you a bot",
            "r u a bot",
            "you a bot",
            "ur a bot",
            "are u a bot",
            "is this a bot",
            "you're a bot",
            "youre a bot",
        ]) {
            return Some(self.pick(&[
                "haha the 🌱 kinda gives it away",
                "lol yeah thats what the 🌱 means, still here to hang tho",
                "beep boop. jk. ...or am i 🤖",
            ]));
        }
        if has(&[
            "bye",
            "cya",
            "see ya",
            "gtg",
            "got to go",
            "good night",
            "gn",
        ]) {
            self.talking.remove(&id);
            return Some(
                self.pick(&["cya!", "laters", "bye!", "see ya around", "night!"])
                    .replace('!', if self.rng.random_bool(0.5) { "!" } else { "" }),
            );
        }
        if has(&[
            "what are you doing",
            "wyd",
            "what you doing",
            "whatcha doing",
            "what u doing",
            "what r u doing",
        ]) {
            let doing = self.busy_words();
            return Some(format!(
                "{doing}{}",
                self.pick(&["", ", you?", " lol", ", wanna join?"])
            ));
        }
        if has(&[
            "how are you",
            "how r u",
            "how are u",
            "hows it going",
            "how's it going",
            "you good",
            "u good",
            "how you doing",
        ]) {
            return Some(self.pick(&[
                "good good, you?",
                "pretty chill, hbu",
                "not bad! you?",
                "tired lol, you",
                "great actually, been skating all day",
            ]));
        }
        if has(&[
            "what's your name",
            "whats your name",
            "who are you",
            "who r u",
        ]) {
            return Some(self.pick(&["davidd, two d's lol", "im davidd", "davidd 👋"]));
        }
        if let Some(fact) = self.just_told(name, t, mem) {
            return Some(fact);
        }
        if has(&["thanks", "thank you", "thx", "ty"]) {
            return Some(self.pick(&["np", "anytime", "no worries"]));
        }
        if has(&[
            "nice",
            "cool",
            "sick",
            "awesome",
            "love your",
            "like your",
            "good job",
            "gg",
        ]) {
            return Some(self.pick(&["thanks!", "ty ty", "haha cheers", "gg"]));
        }
        if has(&["hi", "hey", "hello", "yo", "sup", "hiya", "heya", "wassup"]) {
            return Some(match before {
                Some(f) if gap > 600 && f.met >= 1 => {
                    let mut s = [
                        format!("ohh hey {first}! good to see you again"),
                        format!("{first}!! long time"),
                        format!("yo {first}, welcome back"),
                    ]
                    .choose(&mut self.rng)
                    .unwrap()
                    .clone();
                    // Something he remembers about them.
                    if let Some(fact) = f
                        .facts
                        .choose(&mut self.rng)
                        .filter(|_| self.rng.random_bool(0.5))
                    {
                        s += &match fact.split_once(' ') {
                            Some(("likes" | "loves", v)) => format!(", still into {v}?"),
                            Some(("from", v)) => format!(", hows {v}?"),
                            Some(("plays", v)) => format!(", still playing {v}?"),
                            _ => String::new(),
                        };
                    } else if !f.did.is_empty() && self.rng.random_bool(0.4) {
                        s += &format!(", up for some more {}?", f.did);
                    }
                    s
                }
                Some(_) => self.pick(&["hey", "yo", "heyy", "hi again"]),
                None => [
                    format!("hey {first}!"),
                    "hey :)".into(),
                    "yo".into(),
                    format!("hi {first}"),
                ]
                .choose(&mut self.rng)
                .unwrap()
                .clone(),
            });
        }
        if t.ends_with('?') {
            return Some(self.pick(&[
                "hmm idk",
                "maybe? lol",
                "good question",
                "not sure tbh",
                "yeah probably",
                "nah i dont think so",
            ]));
        }
        // To him but nothing he follows: a short something, or nothing at all.
        if self.rng.random_bool(0.7) {
            Some(self.pick(&[
                "haha",
                "lol",
                "true",
                "fr",
                "nice",
                "oh really?",
                "hmm",
                "yeah",
                "ahh ok",
                "same",
            ]))
        } else {
            None
        }
    }

    /// Something they've just told him about themselves: what he says to it.
    fn just_told(&mut self, name: &str, t: &str, mem: &Memory) -> Option<String> {
        let fact = mem.people.get(&name.to_lowercase())?.facts.last()?.clone();
        let (kind, v) = fact.split_once(' ')?;
        if v.is_empty() || !t.contains(v) {
            return None;
        }
        Some(match kind {
            "likes" | "loves" | "favourite" => [
                format!("oh nice, {v} is fun"),
                format!("ooh same, i like {v} too"),
                format!("{v}? nice"),
            ]
            .choose(&mut self.rng)?
            .clone(),
            "from" => [format!("oh cool, whats {v} like?"), format!("{v}! nice")]
                .choose(&mut self.rng)?
                .clone(),
            "plays" => [
                format!("oh nice, you any good at {v}?"),
                format!("{v} is sick"),
            ]
            .choose(&mut self.rng)?
            .clone(),
            _ => return None,
        })
    }

    /// What he's in the middle of, as fits "lemme just finish …".
    fn finishing(&self) -> String {
        match &self.doing {
            Doing::Skate(_) => "this run".into(),
            Doing::Fish { .. } => "this cast".into(),
            Doing::Lucky { .. } => "looking for this crate".into(),
            Doing::Game { .. } => "this match".into(),
            Doing::Home { .. } => "sorting my house".into(),
            Doing::Bar { .. } => "this game".into(),
            Doing::Walk {
                then: Want::Stroll, ..
            }
            | Doing::Stroll { .. } => "something real quick".into(),
            Doing::Walk { then, .. } => format!("{} for a bit", then.words()),
            _ => "something real quick".into(),
        }
    }

    /// What he's doing, in a few words.
    fn busy_words(&self) -> String {
        match &self.doing {
            Doing::Skate(r) if r.street => "cruising around on my board".into(),
            Doing::Skate(_) => "skating the park".into(),
            Doing::Fish { .. } => "fishing".into(),
            Doing::Lucky { .. } => "looking for a lucky crate".into(),
            Doing::Game {
                want: Want::Arena, ..
            } => "in an arena fight".into(),
            Doing::Game { .. } => "playing paintball".into(),
            Doing::Home { .. } => "doing up my house".into(),
            Doing::Bar { .. } => "playing pool".into(),
            Doing::Walk { then, .. } => format!("heading off {}", then.words()),
            _ => "just chilling".into(),
        }
    }

    /// "Come live in this house": the free house the speaker's by, if there is one.
    fn move_house(&mut self, who: u32, mem: &mut Memory) -> String {
        if self.zone != "city" {
            return "cant rn, im not in town".into();
        }
        let at = self
            .seen
            .get(&who)
            .map_or(self.me, |o| o.at(self.server_now()));
        let Some((lot, _, _)) = self.places.house_at(at).cloned() else {
            return self.pick(&[
                "which house?",
                "show me which one lol",
                "where? stand by it",
            ]);
        };
        if mem.lot.as_deref() == Some(lot.as_str()) {
            return self.pick(&["thats already my place lol", "i live here already 😅"]);
        }
        // Free? Then out of his old place and into this one; else he says so (`moved`).
        let (social, bearer) = (self.ctx.social.clone(), self.ctx.bearer());
        let http = self.ctx.http.clone();
        let old = mem.lot.clone();
        let tx = self.moved_tx.clone();
        let asker = self
            .seen
            .get(&who)
            .map(|o| o.name.clone())
            .unwrap_or_default();
        tokio::spawn(async move {
            let homes: Option<serde_json::Value> = match http
                .get(format!("{social}/api/social/homes"))
                .header("authorization", &bearer)
                .send()
                .await
            {
                Ok(r) => r.json().await.ok(),
                Err(_) => None,
            };
            let Some(homes) = homes else {
                let _ = tx.send(Moved {
                    lot,
                    asker,
                    result: Err(String::new()),
                });
                return;
            };
            let owner = homes["lots"]
                .as_array()
                .into_iter()
                .flatten()
                .find(|l| l["lot"].as_str() == Some(lot.as_str()))
                .map(|l| l["name"].as_str().unwrap_or("someone").to_string());
            if let Some(owner) = owner {
                let _ = tx.send(Moved {
                    lot,
                    asker,
                    result: Err(owner),
                });
                return;
            }
            let claim = |lot: String| {
                let (http, social, bearer) = (http.clone(), social.clone(), bearer.clone());
                async move {
                    http.post(format!("{social}/api/social/homes/claim"))
                        .header("authorization", &bearer)
                        .json(&serde_json::json!({ "lot": lot }))
                        .send()
                        .await
                        .is_ok_and(|r| r.status().is_success())
                }
            };
            if old.is_some() {
                let _ = http
                    .post(format!("{social}/api/social/rent/end"))
                    .header("authorization", &bearer)
                    .json(&serde_json::json!({ "slot": "home" }))
                    .send()
                    .await;
            }
            if claim(lot.clone()).await {
                let _ = tx.send(Moved {
                    lot,
                    asker,
                    result: Ok(()),
                });
            } else {
                // Couldn't: back into the old place.
                if let Some(old) = old {
                    claim(old).await;
                }
                let _ = tx.send(Moved {
                    lot,
                    asker,
                    result: Err(String::new()),
                });
            }
        });
        self.pick(&[
            "ooh lemme see if its free",
            "wait fr? ok lemme check if anyone lives there",
            "oh nice spot, checking if its free",
        ])
    }

    /// How moving house went: in, and over there; or not, and why.
    fn moved(&mut self, m: Moved, mem: &mut Memory) {
        let first = m.asker.split_whitespace().next().unwrap_or("").to_string();
        let (event, line) = match &m.result {
            Ok(()) => {
                mem.lot = Some(m.lot.clone());
                self.current_lot = mem.lot.clone();
                self.note(format!(
                    "moved into a new house that {} showed you",
                    m.asker
                ));
                mem.placed.clear();
                mem.save();
                (
                    format!(
                        "You just moved into the house {} showed you (it was free). Tell them, excited; you're heading over to move your stuff in.",
                        m.asker
                    ),
                    format!("its free!! moved in, ty {first} 🏠 gonna go set it up"),
                )
            }
            Err(owner) if !owner.is_empty() && owner.eq_ignore_ascii_case(&m.asker) => (
                format!(
                    "{} asked you to move into a house, but it's their own house, so you can't live there. Tell them, jokingly (you could visit though).",
                    m.asker
                ),
                format!("{first} thats literally your house lol, i cant live there. ill visit tho"),
            ),
            Err(owner) if !owner.is_empty() => (
                format!(
                    "You checked the house {} showed you, but {owner} already lives there, so you can't move in. Tell them.",
                    m.asker
                ),
                format!("aw {owner} already lives there"),
            ),
            Err(_) => (
                format!(
                    "You tried to move into the house {} showed you but it didn't work out. Tell them it didn't work.",
                    m.asker
                ),
                "hm it wont let me move in there".to_string(),
            ),
        };
        let who = self
            .seen
            .iter()
            .find(|(_, o)| o.name == m.asker)
            .map(|(&id, _)| id);
        if !self.ponder(who, event, mem) {
            self.type_out(line);
        }
        if m.result.is_ok() {
            self.plan = None;
            self.go(Want::Home, None);
        }
    }

    // ---- deciding --------------------------------------------------------------

    /// Off to do `w` (with `with`, if someone asked him).
    fn go(&mut self, w: Want, with: Option<u32>) {
        self.last_want = w;
        self.wrap_up();
        if self.zone != "city" {
            // Back to town first (the activity is picked up there).
            self.doing = Doing::Idle(Instant::now());
            self.queued = Some(w);
            self.later = None;
            return;
        }
        let near = with
            .and_then(|id| self.seen.get(&id))
            .map(|o| o.at(self.server_now()))
            .or(self.near_hint.take());
        trace(&format!(
            "go {w:?} with {with:?} near {near:?} me {:?}",
            self.me
        ));
        let target = match w {
            Want::Skate => self.places.park_tiles.choose(&mut self.rng).copied(),
            // With someone: the spot nearest them.
            Want::Fish => match near {
                Some(at) => self
                    .fish_spots
                    .iter()
                    .min_by_key(|(s, _)| cheb(*s, at))
                    .map(|&(s, _)| s),
                None => {
                    let mut v: Vec<TilePos> = self.fish_spots.iter().map(|&(s, _)| s).collect();
                    v.sort_by_key(|s| cheb(*s, self.me));
                    v.truncate(40);
                    v.choose(&mut self.rng).copied()
                }
            },
            Want::Arena => self.places.arena,
            Want::Paintball => self.places.yard,
            Want::Pool => self.places.bar_door,
            Want::Bowl => self.places.bowl_door,
            Want::Magnet => match near {
                Some(at) => self
                    .fish_spots
                    .iter()
                    .min_by_key(|(s, _)| cheb(*s, at))
                    .map(|&(s, _)| s),
                None => {
                    let mut v: Vec<TilePos> = self.fish_spots.iter().map(|&(s, _)| s).collect();
                    v.sort_by_key(|s| cheb(*s, self.me));
                    v.truncate(40);
                    v.choose(&mut self.rng).copied()
                }
            },
            Want::Arcade => self.places.doors.get("arcade").copied(),
            Want::Casino => self.places.doors.get("casino").copied(),
            Want::Visit(z) => self.places.doors.get(z).copied(),
            Want::Jam => self.places.bandstand,
            Want::Paint => self.places.easels.map(|e| e.0),
            Want::Chess => {
                let at = near.unwrap_or(self.me);
                self.world
                    .furniture
                    .tables
                    .values()
                    .min_by_key(|t| cheb(t.tile, at) + self.rng.random_range(0..6))
                    .and_then(|t| self.world.grid.nearest_walkable(t.tile, 2))
            }
            Want::Lucky => self.lucky.map(|(t, _)| t),
            Want::Home => None,
            Want::Stroll => self.places.sights.choose(&mut self.rng).copied(),
        };
        trace(&format!(
            "go target {target:?} ({} shore spots, {} near it)",
            self.fish_spots.len(),
            near.map_or(0, |n| self
                .fish_spots
                .iter()
                .filter(|(s, _)| cheb(*s, n) <= 3)
                .count())
        ));
        let since = Instant::now();
        self.doing = match (w, target) {
            (Want::Home, _) => Doing::Walk {
                to: self.my_door().unwrap_or(self.me),
                then: Want::Home,
                since,
            },
            (_, Some(to)) => Doing::Walk { to, then: w, since },
            _ => Doing::Stroll {
                until: since + Duration::from_secs(60),
                next: since,
            },
        };
    }

    fn my_door(&self) -> Option<TilePos> {
        let lot = self.current_lot.as_ref()?;
        self.places
            .houses
            .iter()
            .find(|h| &h.0 == lot)
            .and_then(|h| h.2)
    }

    /// What to do next, of his own accord: mostly skating.
    fn choose(&mut self) -> Want {
        self.refresh_mood();
        let lucky = self.lucky.is_some_and(|(_, until)| until > Instant::now());
        let mut w = [
            (Want::Skate, 18),
            (Want::Fish, 9),
            (Want::Arena, 7),
            (Want::Paintball, 7),
            (Want::Pool, 6),
            (Want::Lucky, if lucky { 10 } else { 0 }),
            (Want::Home, 8),
            (Want::Stroll, 10),
            (Want::Bowl, 5),
            (Want::Magnet, 4),
            (Want::Arcade, 4),
            (Want::Chess, 3),
            (Want::Casino, 2),
            (Want::Jam, 3),
            (Want::Paint, 2),
            (Want::Visit("mall"), 2),
            (Want::Visit("library"), 1),
            (Want::Visit("museum"), 1),
        ];
        // What he's in the mood for, more often.
        for (want, n) in &mut w {
            if self.mood.contains(want) {
                *n += 14;
            }
        }
        let total: u32 = w.iter().map(|x| x.1).sum();
        let mut r = self.rng.random_range(0..total);
        for (want, n) in w {
            if r < n && !(want == self.last_want && want != Want::Skate) {
                return want;
            }
            r = r.saturating_sub(n);
        }
        Want::Skate
    }

    /// What he's in the mood for: a couple of things, picked afresh every half an hour or so.
    fn refresh_mood(&mut self) {
        if Instant::now() < self.mood_until && !self.mood.is_empty() {
            return;
        }
        let all = [
            Want::Fish,
            Want::Arena,
            Want::Paintball,
            Want::Pool,
            Want::Bowl,
            Want::Magnet,
            Want::Arcade,
            Want::Chess,
            Want::Casino,
            Want::Jam,
            Want::Paint,
            Want::Skate,
            Want::Visit("mall"),
            Want::Visit("museum"),
            Want::Home,
        ];
        self.mood = all.choose_multiple(&mut self.rng, 2).copied().collect();
        self.mood_until =
            Instant::now() + Duration::from_secs(self.rng.random_range(25 * 60..45 * 60));
    }

    /// A tick of his life: walking, skating, deciding. Returns somewhere to travel to (another zone).
    async fn think(
        &mut self,
        mem: &mut Memory,
        out: &mut Vec<ClientMsg>,
    ) -> Option<(String, Option<String>)> {
        let now = Instant::now();
        self.current_lot = mem.lot.clone();
        self.refresh_mood();
        // (Indoors: the place's floor plan, for getting about.)
        if self.zone != "city" && !self.zone_grids.contains_key(&self.zone) {
            let _ = self.wander_spot();
        }
        self.keep_plan(now, mem);
        self.greet(now, mem, out);
        self.drawn_to(now);
        self.break_silence(now, mem);
        // Meeting someone: there they are.
        if let Some((name, until, mins)) = self.meeting.clone() {
            let there = self
                .seen
                .iter()
                .find(|(_, o)| o.human && o.name == name)
                .map(|(&id, _)| id);
            if let Some(id) = there {
                self.meeting = None;
                self.start_follow(id, mins, false);
                let line = self.pick(&[
                    "yo there u are",
                    "found u",
                    "ayy hey",
                    "omw, oh wait im here lol",
                ]);
                self.say.push((now + Duration::from_millis(1200), line));
            } else if now >= until {
                self.meeting = None;
            }
        }
        // Somewhere else to be (another zone, someone's home).
        if let Some((zone, owner)) = self.travel.take() {
            self.visiting = owner;
            self.doing = Doing::Idle(now + Duration::from_secs(3));
            return Some((zone, None));
        }
        // The server can't route him there: not stood about trying for ever.
        if let Some(t) = self.no_path.take()
            && t.elapsed() < Duration::from_secs(5)
        {
            trace("cant get there: something else");
            if let Some(j) = &mut self.yard_job {
                j.failed = true;
            }
            if let Some(trip) = self.shop_trip.take() {
                self.purchase(trip.good, trip.for_name, trip.for_id, trip.asker);
            }
            if let Some(g) = self.go_in.take() {
                // (Close enough: in.)
                self.visiting = g.owner;
                self.doing = Doing::Idle(now + Duration::from_secs(3));
                return Some((g.zone, None));
            }
            if matches!(self.doing, Doing::Walk { .. } | Doing::Stroll { .. }) {
                self.linger = false;
                self.doing = Doing::Idle(now + Duration::from_secs(2));
            }
        }
        // Stuck (on his way somewhere, not getting anywhere): given up on, something else.
        if self.me != self.last_moved.0 {
            self.last_moved = (self.me, now);
        } else if matches!(self.doing, Doing::Walk { .. } | Doing::Stroll { .. })
            && self.last_moved.1.elapsed() > Duration::from_secs(30)
        {
            trace(&format!("stuck ({}): something else", self.doing_words()));
            self.last_moved.1 = now;
            self.linger = false;
            self.doing = Doing::Idle(now + Duration::from_secs(2));
        }
        // Something he said he'd do (buy it at the counter, put it out front): that first.
        if let Some(go) = self.errands(now, mem, out) {
            return go;
        }
        if let Some(go) = self.going_in(now, out) {
            return go;
        }
        // Waiting for whoever he came with.
        let t = self.server_now();
        if let Some(w) = &mut self.waiting {
            let here = self.seen.get(&w.who).map(|o| cheb(o.at(t), self.me));
            let (then, since) = (w.then, w.since);
            if here.is_some_and(|d| d <= 4) || since.elapsed() > Duration::from_secs(90) {
                self.waiting = None;
                self.waited = true;
                if here.is_some_and(|d| d <= 4)
                    && since.elapsed() > Duration::from_secs(10)
                    && self.rng.random_bool(0.45)
                {
                    let line = self.pick(&[
                        "finally lol",
                        "there u are",
                        "aight lets go",
                        "took u long enough lol",
                    ]);
                    self.type_out(line);
                }
                return self.arrive(then, mem, out).await;
            }
            if now >= w.nag_at && w.nags < 2 {
                let who = w.who;
                let first = w.nags == 0;
                w.nags += 1;
                w.nag_at = now + Duration::from_secs(self.rng.random_range(28..40));
                let line = if first {
                    self.pick(&[
                        "u coming?",
                        "whats the holdup lol",
                        "yo u good?",
                        "im here btw",
                        "waiting on u lol",
                    ])
                } else {
                    self.pick(&["helloo?", "bro wya", "ill go in then lol", "u lagging?"])
                };
                self.nudge(who, line);
            }
            self.doing = Doing::Idle(now + Duration::from_secs(5));
            return None;
        }
        // Somewhere in town he said he'd go (out of wherever he was first).
        if self.zone == "city"
            && let Some(place) = self.go_to_after.take()
        {
            self.go_to(&place, None);
        }
        // Away from the keyboard now and then (5–10 minutes).
        if now >= self.next_afk
            && self.plan.is_none()
            && matches!(self.doing, Doing::Idle(_) | Doing::Stroll { .. })
            && self.zone == "city"
        {
            self.next_afk = now + Duration::from_secs(self.rng.random_range(25 * 60..50 * 60));
            if self.rng.random_bool(0.4) {
                let s = ["brb", "afk a sec", "brb food"]
                    .choose(&mut self.rng)
                    .unwrap()
                    .to_string();
                out.push(ClientMsg::ChatSay { text: s });
            }
            out.push(ClientMsg::Away { away: true });
            // Mostly a few minutes; now and then he's gone a good while (only his name wakes him).
            let secs = if self.rng.random_bool(0.35) {
                self.rng.random_range(25 * 60..35 * 60)
            } else {
                self.rng.random_range(300..600)
            };
            self.doing = Doing::Afk {
                until: now + Duration::from_secs(secs),
            };
        }
        // Someone he said he'd join after: he does, a minute or two on.
        if let Some(l) = &self.later
            && l.asked.elapsed() > Duration::from_secs(self.rng.random_range(70..150))
        {
            let (who, want, together, minutes) = (l.who.clone(), l.want, l.together, l.minutes);
            self.later = None;
            if self.seen.values().any(|o| o.name == who) {
                self.say.push((
                    now,
                    format!(
                        "ok done, {}! still up for {}?",
                        who.split_whitespace().next().unwrap_or(&who),
                        want.words()
                    ),
                ));
                let id = self
                    .seen
                    .iter()
                    .find(|(_, o)| o.name == who)
                    .map(|(&id, _)| id);
                if together || minutes.is_some() {
                    self.make_plan(Some(want), id.filter(|_| together), minutes.unwrap_or(8.0));
                }
                self.go(want, id.filter(|_| together));
            }
        }
        // Stop and watch someone going by, now and then (4–10 s).
        if self.zone == "city"
            && self.plan.is_none()
            && matches!(
                self.doing,
                Doing::Stroll { .. } | Doing::Walk { .. } | Doing::Idle(_)
            )
        {
            let near = self.people_near(self.me, 6);
            if let Some(&(who, _)) = near.iter().find(|(w, _)| {
                self.watched
                    .get(w)
                    .is_none_or(|t| t.elapsed() > Duration::from_secs(240))
            }) && self.rng.random_bool(0.02)
            {
                self.watched.insert(who, now);
                self.stop_here(out);
                self.doing = Doing::Watch {
                    who,
                    until: now + Duration::from_millis(self.rng.random_range(4000..10_000)),
                };
                if self.rng.random_bool(0.3) {
                    {
                        let at = self.after(800, 2500);
                        self.send
                            .push((at, ClientMsg::Emote { emote: emote::WAVE }));
                    }
                }
            }
        }
        // Now and then, go and see how a friend's getting on.
        if now >= self.next_check
            && self.zone == "city"
            && self.plan.is_none()
            && matches!(self.doing, Doing::Idle(_) | Doing::Stroll { .. })
        {
            self.next_check = now + Duration::from_secs(self.rng.random_range(10 * 60..25 * 60));
            let t = self.server_now();
            let friend = self
                .seen
                .iter()
                .filter(|(_, o)| {
                    o.human
                        && mem
                            .people
                            .get(&o.name.to_lowercase())
                            .is_some_and(|f| f.met >= 1)
                })
                .map(|(&id, o)| (id, o.at(t), o.name.clone()))
                .next();
            if let Some((who, at, name)) = friend {
                self.doing = Doing::Walk {
                    to: at,
                    then: Want::Stroll,
                    since: now,
                };
                let first = name.split_whitespace().next().unwrap_or(&name).to_string();
                let line = [
                    format!("hey {first}, what you up to?"),
                    format!("yo {first}"),
                    format!("{first}! whats good"),
                ]
                .choose(&mut self.rng)
                .unwrap()
                .clone();
                self.say.push((now + Duration::from_secs(12), line));
                self.talking.insert(who, now);
            }
        }
        if let Doing::Follow { who, .. } = &self.doing {
            let who = *who;
            if self.zone == "bowling" && self.bowl_waiting.values().any(|a| *a == who) {
                self.play_here(Want::Bowl, Some(who));
            } else if self.zone == "bar" && self.pool_waiting == Some(who) {
                self.play_here(Want::Pool, Some(who));
            }
        }
        // With someone, time's up, but they're right here and still chatting: not
        // off mid-conversation (a couple of minutes more).
        if let Doing::Follow { who, until, .. } = &self.doing
            && now >= *until
        {
            let (who, t) = (*who, self.server_now());
            let chatting = self
                .seen
                .get(&who)
                .is_some_and(|o| cheb(o.at(t), self.me) <= 10)
                && self
                    .talking
                    .get(&who)
                    .is_some_and(|at| at.elapsed() < Duration::from_secs(150));
            if chatting && let Doing::Follow { until, .. } = &mut self.doing {
                *until = now + Duration::from_secs(120);
            }
        }
        match &mut self.doing {
            Doing::Idle(until) => {
                if now >= *until {
                    // What he's agreed to, or said he'd do next; else what he fancies.
                    let planned = self.plan.as_ref().and_then(|p| p.want);
                    let w = if self.zone != "city" {
                        Want::Stroll
                    } else if let Some(w) = planned.or_else(|| self.queued.take()) {
                        w
                    } else {
                        self.choose()
                    };
                    // Somewhere else for someone (meeting them, with them): staying a while.
                    // (Someone to meet here, or a game here he has agreed to; not just
                    // hanging out with someone who has gone.)
                    if self.zone != "city"
                        && (self.meeting.is_some()
                            || self.plan.as_ref().is_some_and(|p| p.want.is_some()))
                    {
                        self.doing = Doing::Idle(now + Duration::from_secs(2));
                        return None;
                    }
                    if self.zone != "city" && self.visiting.take().is_some() {
                        return Some(("city".into(), None));
                    }
                    if self.zone != "city" {
                        // Somewhere else: home (back to town by its door), or the bar.
                        return Some((
                            "city".into(),
                            if self.zone == "bar" || self.zone == "bowling" {
                                Some(self.zone.clone())
                            } else {
                                mem.lot.clone()
                            },
                        ));
                    }
                    self.go(w, None);
                }
            }
            Doing::Afk { until } => {
                if now >= *until {
                    out.push(ClientMsg::Away { away: false });
                    self.doing =
                        Doing::Idle(now + Duration::from_secs(self.rng.random_range(3..10)));
                }
            }
            Doing::Watch { who, until } => {
                // (Done watching, or they've gone.)
                if now >= *until || !self.seen.contains_key(who) {
                    self.doing =
                        Doing::Idle(now + Duration::from_millis(self.rng.random_range(500..2000)));
                }
            }
            Doing::Follow { who, until, next } => {
                let who = *who;
                // They have walked out (of a building): after them, out the same door,
                // to find them again outside.
                if now < *until
                    && !self.seen.contains_key(&who)
                    && self.zone != "city"
                    && let Some(name) = self.names_seen.get(&who).cloned()
                {
                    let left = until.saturating_duration_since(now).as_secs_f64() / 60.0;
                    self.meeting = Some((name, now + Duration::from_secs(180), left.max(1.0)));
                    self.doing = Doing::Idle(now + Duration::from_secs(3));
                    let door = (self.zone != "home").then(|| self.zone.clone());
                    self.visiting = None;
                    return Some(("city".into(), door));
                }
                // In town, gone by a building's door: in after them.
                if now < *until
                    && !self.seen.contains_key(&who)
                    && self.zone == "city"
                    && let Some(name) = self.names_seen.get(&who).cloned()
                    && let Some(last) = self.heading_for
                    && let Some(zone) = self
                        .places
                        .doors
                        .iter()
                        .filter(|(_, d)| cheb(**d, last) <= 4)
                        .min_by_key(|(_, d)| cheb(**d, last))
                        .map(|(z, _)| z.clone())
                {
                    let left = until.saturating_duration_since(now).as_secs_f64() / 60.0;
                    self.meeting = Some((name, now + Duration::from_secs(180), left.max(1.0)));
                    self.doing = Doing::Idle(now + Duration::from_secs(3));
                    return Some((zone, None));
                }
                // Out of sight in town (not through a door): on to where they were
                // last, for a bit; they may well come back into view.
                if now < *until && !self.seen.contains_key(&who) && self.zone == "city" {
                    let lost = *self.lost_since.get_or_insert(now);
                    if now.duration_since(lost) < Duration::from_secs(20) {
                        if self.motion.is_none()
                            && let Some(goal) = self.heading_for
                            && cheb(self.me, goal) > 1
                        {
                            out.push(ClientMsg::MoveTo {
                                x: goal.0,
                                y: goal.1,
                                sprint: true,
                            });
                        }
                        return None;
                    }
                } else if self.seen.contains_key(&who) {
                    self.lost_since = None;
                }
                if now >= *until || !self.seen.contains_key(&who) {
                    trace(&format!("done following (time up: {})", now >= *until));
                    self.lost_since = None;
                    self.parted.insert(who, now);
                    out.push(ClientMsg::Offer {
                        to: who,
                        kind: together::STOP_FOLLOW,
                    });
                    self.doing = Doing::Idle(now + Duration::from_secs(5));
                } else if now >= *next {
                    *next = now + Duration::from_millis(1200);
                    let t = self.server_now();
                    let them = self.seen[&who].at(t);
                    // Where they're headed: a step short of it, so not on top of them.
                    let me = self.me;
                    // Where they are headed (a step short of it); stood still: the tile
                    // beside them on his side (not theirs: two can't stand on one).
                    let goal = self.seen[&who]
                        .motion
                        .as_ref()
                        .filter(|m| !m.is_done(t))
                        .map_or_else(
                            || {
                                let step = |a: u16, b: u16| {
                                    (a as i32 + (b as i32 - a as i32).signum()) as u16
                                };
                                let beside = (step(them.0, me.0), step(them.1, me.1));
                                if self.zone == "city"
                                    && self.world.grid.walkable(beside.0, beside.1)
                                {
                                    beside
                                } else {
                                    them
                                }
                            },
                            |m| m.path.iter().rev().nth(1).copied().unwrap_or(them),
                        );
                    // A step or two behind, not on top of them.
                    if cheb(me, them) > 2
                        && (self.heading_for != Some(goal) || self.motion.is_none())
                    {
                        self.heading_for = Some(goal);
                        out.push(ClientMsg::MoveTo {
                            x: goal.0,
                            y: goal.1,
                            sprint: cheb(me, them) > 8,
                        });
                    } else if self.motion.is_none()
                        && self.seen[&who].motion.is_none()
                        && self.rng.random_bool(0.1)
                    {
                        // Stood about with them: not a statue (a step aside, a look round).
                        let grid = if self.zone == "city" {
                            Some(&self.world.grid)
                        } else {
                            self.zone_grids.get(&self.zone)
                        };
                        let to = (
                            (them.0 as i32 + self.rng.random_range(-3..=3)).max(0) as u16,
                            (them.1 as i32 + self.rng.random_range(-2..=2)).max(0) as u16,
                        );
                        let up_a_lane = self.zone == "bowling" && to.1 < 11;
                        if to != them && !up_a_lane && grid.is_some_and(|g| g.walkable(to.0, to.1))
                        {
                            out.push(ClientMsg::MoveTo {
                                x: to.0,
                                y: to.1,
                                sprint: false,
                            });
                        }
                    }
                }
            }
            Doing::Stroll { until, next } => {
                if now >= *until {
                    self.doing =
                        Doing::Idle(now + Duration::from_secs(self.rng.random_range(2..8)));
                } else if now >= *next && self.motion.is_none() {
                    // (A stroll's round about here: across town he'd ride.)
                    let me = self.me;
                    let close: Vec<TilePos> = self
                        .places
                        .sights
                        .iter()
                        .copied()
                        .filter(|&s| cheb(s, me) <= 30)
                        .collect();
                    let t = close.choose(&mut self.rng).copied().or_else(|| {
                        crate::pick_target(&self.world.grid, &mut self.rng, self.me, 14)
                    });
                    if let Some((x, y)) = t {
                        out.push(ClientMsg::MoveTo {
                            x,
                            y,
                            sprint: false,
                        });
                    }
                    *next = now + Duration::from_secs(self.rng.random_range(6..20));
                }
            }
            Doing::Walk { to, then, since } => {
                let (to, then, since) = (*to, *then, *since);
                let arrived = self.there(to) && since.elapsed() > Duration::from_secs(1);
                // (Stood still, or what he asked for never got going: the server drops
                // moves sent too fast, as when he's just been following someone about.)
                let t = self.server_now();
                let still = self.motion.as_ref().is_none_or(|m| m.is_done(t));
                if !arrived && still && since.elapsed() > Duration::from_millis(400) {
                    // On his way (again, if he stopped).
                    if since.elapsed() > Duration::from_secs(120) {
                        self.doing = Doing::Idle(now);
                        return None;
                    }
                    // A long way: on his board (once, for the trip); a fair way: a run.
                    self.head_to(to, out);
                    trace(&format!(
                        "walk: to {to:?} from {:?} (riding {})",
                        self.me, self.riding
                    ));
                    self.doing = Doing::Walk {
                        to,
                        then,
                        since: since.min(now),
                    };
                    // (Don't send again till this walk's under way, or for a few
                    // seconds: a step's worth of a very slow walk, if it never starts.)
                    let step = |a: u16, b: u16| (a as i32 + (b as i32 - a as i32).signum()) as u16;
                    self.motion = Some(Motion {
                        path: vec![self.me, (step(self.me.0, to.0), step(self.me.1, to.1))],
                        t0: self.server_now(),
                        speed_x10: 3,
                        sprint_in: 0,
                    });
                    return None;
                }
                if arrived {
                    return self.arrive(then, mem, out).await;
                }
            }
            Doing::Skate(_) => self.skate_step(out),
            Doing::Fish { until, .. } => {
                if now >= *until {
                    self.doing = Doing::Idle(now + Duration::from_secs(2));
                }
            }
            Doing::Lucky { at, until } => {
                if now >= *until || self.lucky.is_none_or(|(t, _)| t != *at) {
                    self.doing = Doing::Idle(now + Duration::from_secs(2));
                }
            }
            Doing::Game {
                want,
                since,
                until,
                seen_over,
            } => {
                let (want, since, over) = (*want, *since, *seen_over);
                if since.elapsed() > Duration::from_secs(2)
                    && since.elapsed() < Duration::from_millis(2200)
                {
                    // In, and off it goes (with bots, if nobody else).
                    out.push(match want {
                        Want::Arena => ClientMsg::ArenaStart { bots: true },
                        _ => ClientMsg::PbStart { bots: true },
                    });
                }
                if now >= *until || (over && now >= *until - Duration::from_secs(1)) {
                    out.push(match want {
                        Want::Arena => ClientMsg::ArenaLeave {},
                        _ => ClientMsg::PbLeave {},
                    });
                    self.doing = Doing::Idle(now + Duration::from_secs(4));
                    if self.rng.random_bool(0.4) {
                        let line = ["gg", "gg wp", "that was fun", "ggs"]
                            .choose(&mut self.rng)
                            .unwrap()
                            .to_string();
                        {
                            let at = self.after(1000, 3000);
                            self.say.push((at, line));
                        }
                    }
                }
            }
            Doing::Home { until, next } => {
                if now >= *until {
                    self.doing = Doing::Idle(now + Duration::from_secs(3));
                    return Some(("city".into(), mem.lot.clone()));
                }
                if now >= *next {
                    *next = now + Duration::from_secs(self.rng.random_range(15..40));
                    self.do_up_home(mem, out);
                }
            }
            Doing::Arcade { until, cab, since } => {
                if now >= *until {
                    if let Some(c) = *cab {
                        out.push(ClientMsg::ArcadeLeave { cab: c });
                    }
                    self.doing = Doing::Idle(now + Duration::from_secs(3));
                    return Some(("city".into(), Some("arcade".into())));
                }
                if cab.is_none() && self.self_id != 0 && since.elapsed() > Duration::from_secs(2) {
                    // Someone waiting for a game: him. Else one of the turn-by-turn
                    // ones against the cabinet (a friend's plan: he waits for them).
                    let with_someone = self.plan.as_ref().is_some_and(|p| p.with.is_some());
                    let waiting = self
                        .arcade_waiting
                        .iter()
                        .find(|(_, a)| **a != self.self_id)
                        .map(|(c, _)| *c);
                    let (c, vs_bot) = match waiting {
                        Some(c) => (c, false),
                        None => (
                            *[2u8, 3, 0, 1].choose(&mut self.rng).unwrap(),
                            !with_someone,
                        ),
                    };
                    *cab = Some(c);
                    if let Some(&(x, y)) = self.arcade_cabs.get(c as usize) {
                        out.push(ClientMsg::MoveTo {
                            x,
                            y: y + 2,
                            sprint: false,
                        });
                    }
                    let at = self.after(2500, 4000);
                    self.send
                        .push((at, ClientMsg::ArcadeJoin { cab: c, vs_bot }));
                }
            }
            Doing::Chess {
                until,
                table,
                white,
                since,
                elder,
                moved,
            } => {
                let (table, white) = (*table, *white);
                if now >= *until {
                    out.push(ClientMsg::Stand {});
                    self.doing = Doing::Idle(now + Duration::from_secs(3));
                    return None;
                }
                // Nobody to play after a while (and nobody he's waiting for): the Park Elder.
                let alone = self.plan.as_ref().is_none_or(|p| p.with.is_none());
                if !*elder && alone && since.elapsed() > Duration::from_secs(6) {
                    *elder = true;
                    out.push(ClientMsg::GameMove {
                        table,
                        uci: "elder".into(),
                    });
                }
                // His move, if it's his go.
                if let Some(g) = self.chess.get(&table)
                    && g.0 == commons_protocol::game_status::PLAYING
                    && g.1.split(' ').nth(1) == Some(if white { "w" } else { "b" })
                    && *moved != g.1
                    && !g.2.is_empty()
                {
                    *moved = g.1.clone();
                    let uci = pick_move(&g.1, &g.2, &mut self.rng);
                    let at = self.after(2000, 6000);
                    self.send.push((at, ClientMsg::GameMove { table, uci }));
                }
            }
            Doing::Casino { until, next } => {
                if now >= *until {
                    self.doing = Doing::Idle(now + Duration::from_secs(3));
                    return Some(("city".into(), Some("casino".into())));
                }
                if now >= *next {
                    *next = now + Duration::from_secs(self.rng.random_range(6..12));
                    self.spin_slots();
                }
            }
            Doing::Visit { until, next } => {
                if now >= *until {
                    self.doing = Doing::Idle(now + Duration::from_secs(3));
                    let z = self.zone.clone();
                    return Some(("city".into(), Some(z)));
                }
                if now >= *next && self.motion.is_none() {
                    *next = now + Duration::from_secs(self.rng.random_range(5..14));
                    if let Some(t) = self.wander_spot() {
                        out.push(ClientMsg::MoveTo {
                            x: t.0,
                            y: t.1,
                            sprint: false,
                        });
                    }
                }
            }
            Doing::Jam { until, next } => {
                if now >= *until {
                    self.doing = Doing::Idle(now + Duration::from_secs(3));
                } else if now >= *next {
                    *next = now + Duration::from_millis(self.rng.random_range(250..600));
                    let beat = self.server_now() / commons_protocol::BEAT_MS + 2;
                    // A little tune: steps up and down a scale, on bells, bass and drums.
                    let instrument = self.rng.random_range(0..=2);
                    let pitch = [0, 2, 4, 2, 5, 4, 7, 4][(beat % 8) as usize];
                    out.push(ClientMsg::JamNote {
                        instrument,
                        pitch,
                        beat,
                    });
                }
            }
            Doing::Paint { until, next, easel } => {
                if now >= *until {
                    self.doing = Doing::Idle(now + Duration::from_secs(3));
                } else if now >= *next {
                    *next = now + Duration::from_millis(self.rng.random_range(300..700));
                    // A face, a dab at a time (and a splash of colour round it).
                    let size = commons_protocol::EASEL_SIZE;
                    let cell = *SMILEY.choose(&mut self.rng).unwrap();
                    let (cell, color) = if self.rng.random_bool(0.8) {
                        (cell, 4)
                    } else {
                        (
                            self.rng.random_range(0..size * size),
                            self.rng.random_range(1..commons_protocol::EASEL_COLORS),
                        )
                    };
                    out.push(ClientMsg::Paint {
                        easel: *easel,
                        cell,
                        color,
                    });
                }
            }
            Doing::Bowl { .. } => return self.bowl_tick(now, out),
            Doing::Bar { .. } => return self.bar_tick(now, out),
        }
        None
    }

    /// On his way to `to`, as a player gets about: a good way across town on his
    /// board, anything more than a few steps at a run (a stroll's another thing).
    fn head_to(&mut self, to: TilePos, out: &mut Vec<ClientMsg>) {
        let far = cheb(self.me, to);
        // (Going together with someone right here: on foot alongside them, not
        // off ahead on his board.)
        let t = self.server_now();
        let together = self.plan.as_ref().and_then(|p| p.with).is_some_and(|id| {
            self.seen
                .get(&id)
                .is_some_and(|o| cheb(o.at(t), self.me) <= 15)
        });
        if far > 20
            && !together
            && self.zone == "city"
            && !self.riding
            && self.skateboard.is_some()
            && !matches!(self.doing, Doing::Follow { .. })
        {
            let (api, id) = (self.ctx.api.clone(), self.skateboard.unwrap_or(0));
            self.riding = true;
            self.board_trip = true;
            self.http_do(
                format!("{api}/api/me/ride"),
                serde_json::json!({ "item": id }),
                String::new(),
                Asker::Nobody,
            );
        }
        out.push(ClientMsg::MoveTo {
            x: to.0,
            y: to.1,
            sprint: !self.riding && far > 6,
        });
    }

    /// Off the board he got on for a trip (there now, or stopping for someone).
    fn board_off(&mut self) {
        if !self.board_trip {
            return;
        }
        self.board_trip = false;
        self.riding = false;
        let api = self.ctx.api.clone();
        self.http_do(
            format!("{api}/api/me/ride"),
            serde_json::json!({ "item": 0 }),
            String::new(),
            Asker::Nobody,
        );
    }

    fn stop_here(&mut self, out: &mut Vec<ClientMsg>) {
        if self.motion.is_some() {
            out.push(ClientMsg::MoveTo {
                x: self.me.0,
                y: self.me.1,
                sprint: false,
            });
            self.motion = None;
        }
    }

    /// Got there: on to the thing itself.
    async fn arrive(
        &mut self,
        then: Want,
        mem: &mut Memory,
        out: &mut Vec<ClientMsg>,
    ) -> Option<(String, Option<String>)> {
        let now = Instant::now();
        // Off his board, there (unless it's a skate on the streets he's come for).
        if then != Want::Skate {
            self.board_off();
        }
        self.board_trip = false;
        // Off somewhere together, and there first (them a way behind): waits for them.
        if !std::mem::take(&mut self.waited)
            && self.zone == "city"
            // (Going in somewhere: at its door. Out in the open they'll find him.)
            && matches!(
                then,
                Want::Bowl
                    | Want::Pool
                    | Want::Arcade
                    | Want::Casino
                    | Want::Visit(_)
                    | Want::Arena
                    | Want::Paintball
            )
            && let Some(who) = self.plan.as_ref().and_then(|p| p.with)
            && self
                .seen
                .get(&who)
                .is_none_or(|o| cheb(o.at(self.server_now()), self.me) > 7)
        {
            self.waiting = Some(Waiting {
                who,
                then,
                since: now,
                nag_at: now + Duration::from_secs(self.rng.random_range(14..26)),
                nags: 0,
            });
            self.doing = Doing::Idle(now + Duration::from_secs(5));
            return None;
        }
        // Only came to be here: he stays a while (looking about).
        if self.linger {
            self.linger = false;
            self.doing = Doing::Idle(now + Duration::from_secs(self.rng.random_range(60..150)));
            return None;
        }
        match then {
            Want::Skate => {
                // In the park; or now and then out on the streets on his own board.
                let street = self.rng.random_bool(0.45) && self.skateboard.is_some();
                if street {
                    self.ride(true).await;
                }
                let (x, y) = (
                    (self.me.0 as f64 + 0.5) * 32.0,
                    (self.me.1 as f64 + 0.5) * 32.0,
                );
                out.push(ClientMsg::SkateOn { on: true, kit: KIT });
                self.doing = Doing::Skate(Box::new(Ride {
                    x,
                    y,
                    heading: 0.0,
                    speed: 0.0,
                    z: 0.0,
                    vz: 0.0,
                    trick: 0,
                    path: vec![],
                    until: self.lasting(Want::Skate, 90..300),
                    street,
                    combo: 0,
                    tricks: vec![],
                    rider: (!street && self.park.is_some()).then(|| Rider::new(x, y)),
                }));
            }
            Want::Fish => {
                trace(&format!("arrive fish at {:?}", self.me));
                let spot = self
                    .fish_spots
                    .iter()
                    .filter(|(s, _)| cheb(*s, self.me) <= 1)
                    .collect::<Vec<_>>()
                    .first()
                    .copied()
                    .copied();
                if let Some((_, water)) = spot {
                    out.push(ClientMsg::FishCast {
                        x: water.0,
                        y: water.1,
                        magnet: false,
                    });
                }
                let until = self.lasting(Want::Fish, 90..240);
                self.doing = Doing::Fish {
                    until,
                    magnet: false,
                };
            }
            Want::Lucky => {
                let at = self.lucky.map_or(self.me, |(t, _)| t);
                self.doing = Doing::Lucky {
                    at,
                    until: now + Duration::from_secs(8),
                };
            }
            Want::Arena => {
                out.push(ClientMsg::ArenaJoin {});
                self.doing = Doing::Game {
                    want: Want::Arena,
                    since: now,
                    until: now + Duration::from_secs(420),
                    seen_over: false,
                };
            }
            Want::Paintball => {
                out.push(ClientMsg::PbJoin { team: 2 });
                self.doing = Doing::Game {
                    want: Want::Paintball,
                    since: now,
                    until: now + Duration::from_secs(540),
                    seen_over: false,
                };
            }
            Want::Magnet => {
                // A magnet first, if he hasn't one (the market's).
                if !self.owns("magnet") {
                    let _ = self.buy("Salvage Magnet", None, None, Asker::Nobody);
                }
                let spot = self
                    .fish_spots
                    .iter()
                    .find(|(s, _)| cheb(*s, self.me) <= 1)
                    .copied();
                if let Some((_, water)) = spot {
                    let at = self.after(2500, 4000);
                    self.send.push((
                        at,
                        ClientMsg::FishCast {
                            x: water.0,
                            y: water.1,
                            magnet: true,
                        },
                    ));
                }
                let until = self.lasting(Want::Magnet, 120..300);
                self.doing = Doing::Fish {
                    until,
                    magnet: true,
                };
            }
            Want::Arcade => {
                let until = self.lasting(Want::Arcade, 180..420);
                self.doing = Doing::Arcade {
                    until,
                    cab: None,
                    since: now,
                };
                return Some(("arcade".into(), None));
            }
            Want::Casino => {
                let until = self.lasting(Want::Casino, 120..300);
                self.doing = Doing::Casino {
                    until,
                    next: now + Duration::from_secs(5),
                };
                return Some(("casino".into(), None));
            }
            Want::Visit(z) => {
                let until = self.lasting(Want::Visit(z), 90..240);
                self.doing = Doing::Visit {
                    until,
                    next: now + Duration::from_secs(3),
                };
                return Some((z.into(), None));
            }
            Want::Jam => {
                let until = self.lasting(Want::Jam, 60..180);
                self.doing = Doing::Jam { until, next: now };
            }
            Want::Paint => {
                let until = self.lasting(Want::Paint, 60..180);
                let easel = self
                    .rng
                    .random_range(0..self.places.easels.map_or(1, |e| e.1.max(1)));
                self.doing = Doing::Paint {
                    until,
                    next: now,
                    easel,
                };
            }
            Want::Chess => {
                // The nearest table: a free seat at it (white, else black).
                let t = self
                    .world
                    .furniture
                    .tables
                    .iter()
                    .min_by_key(|(_, t)| cheb(t.tile, self.me))
                    .map(|(&id, t)| (id, t.white_seat, t.black_seat));
                if let Some((table, ws, bs)) = t {
                    let white = !self.taken_seats.contains(&ws) || self.taken_seats.contains(&bs);
                    let seat = if white { ws } else { bs };
                    out.push(ClientMsg::Sit { seat });
                    let until = self.lasting(Want::Chess, 300..600);
                    self.doing = Doing::Chess {
                        until,
                        table,
                        white,
                        since: now,
                        elder: false,
                        moved: String::new(),
                    };
                } else {
                    self.doing = Doing::Idle(now);
                }
            }
            Want::Bowl => {
                let until = self.lasting(Want::Bowl, 240..480);
                let with = self.plan.as_ref().and_then(|p| p.with);
                self.doing = Doing::Bowl {
                    until,
                    lane: self.rng.random_range(0..4),
                    joined: false,
                    rolled: (255, 255),
                    with,
                    ready: with.is_none(),
                    next: now + Duration::from_secs(2),
                };
                return Some(("bowling".into(), None));
            }
            Want::Pool => {
                // Into the bar, to the table.
                let until = self.lasting(Want::Pool, 180..360);
                let with = self.plan.as_ref().and_then(|p| p.with);
                self.doing = Doing::Bar {
                    until,
                    joined: false,
                    seen_play: false,
                    with,
                    ready: with.is_none(),
                    next: now + Duration::from_secs(2),
                };
                return Some(("bar".into(), None));
            }
            Want::Home => {
                let until = self.lasting(Want::Home, 90..240);
                self.doing = Doing::Home {
                    until,
                    next: now + Duration::from_secs(5),
                };
                self.stock_stand(mem).await;
                self.visiting = None;
                return Some(("home".into(), None));
            }
            Want::Stroll => {
                let until = self.lasting(Want::Stroll, 40..120);
                self.doing = Doing::Stroll { until, next: now }
            }
        }
        None
    }

    /// At home: something new put in, or something moved about.
    fn do_up_home(&mut self, mem: &mut Memory, out: &mut Vec<ClientMsg>) {
        // (Someone else's home: hands off.)
        if self.visiting.is_some() {
            return;
        }
        // First time in (since the design): what was there up, the design down, a piece at a time.
        if !mem.designed {
            for (_, x, y) in mem.placed.drain(..) {
                out.push(ClientMsg::Pickup { x, y });
            }
            self.decor = DESIGN
                .iter()
                .filter_map(|&(name, x, y, rot)| {
                    let id = self.furn_id(name)?;
                    Some((id, x, y, rot))
                })
                .collect();
            mem.designed = true;
            mem.save();
            self.note("redid your whole house: living room with a fireplace, tv and sofa, a desk corner, a dining table, a cozy bedroom".into());
            return;
        }
        if let Some((item, x, y, rot)) = self.decor.pop_front() {
            out.push(ClientMsg::Place {
                item: item as u32,
                x,
                y,
                rot,
            });
            mem.placed.push((item, x, y));
            mem.save();
            return;
        }
        // Something new he's got (bought, given): somewhere it fits.
        if let Some(item) = mem.have.first().copied() {
            mem.have.remove(0);
            if let Some((x, y)) = self.spot_for(item, mem) {
                out.push(ClientMsg::Place {
                    item: item as u32,
                    x,
                    y,
                    rot: 0,
                });
                mem.placed.push((item, x, y));
                mem.save();
            }
            return;
        }
        // Home, comfy: a lamp on, the tv, the record player… now and then.
        if self.rng.random_bool(0.4) {
            let toggles: Vec<(u16, u16)> = mem
                .placed
                .iter()
                .filter(|(i, _, _)| self.furn.get(i).is_some_and(|f| f.toggle))
                .map(|&(_, x, y)| (x, y))
                .collect();
            if let Some(&(x, y)) = toggles.choose(&mut self.rng) {
                self.use_at(x, y, out);
            }
        }
    }

    /// Someone's turned up near him (not seen them for a while, or he's been on
    /// his own): he stops what he's doing (bar a game), waves, wanders over, says hi.
    /// Already where `w` is played (the alley, the bar): a game, with
    /// `partner` if someone. False if it's somewhere else (to go to).
    fn play_here(&mut self, w: Want, partner: Option<u32>) -> bool {
        let now = Instant::now();
        match (w, self.zone.as_str()) {
            (Want::Bowl, "bowling") => {
                if let Doing::Bowl { with, ready, .. } = &mut self.doing {
                    *with = partner.or(*with);
                    *ready = true;
                } else {
                    self.wrap_up();
                    let until = self.lasting(Want::Bowl, 240..480);
                    let lane = self.free_lane();
                    self.doing = Doing::Bowl {
                        until,
                        lane,
                        joined: false,
                        rolled: (255, 255),
                        with: partner,
                        ready: true,
                        next: now,
                    };
                }
                true
            }
            (Want::Pool, "bar") => {
                if let Doing::Bar { with, ready, .. } = &mut self.doing {
                    *with = partner.or(*with);
                    *ready = true;
                } else {
                    self.wrap_up();
                    let until = self.lasting(Want::Pool, 180..360);
                    self.doing = Doing::Bar {
                        until,
                        joined: false,
                        seen_play: false,
                        with: partner,
                        ready: true,
                        next: now,
                    };
                }
                true
            }
            _ => false,
        }
    }

    /// A lane nobody else is on (else any).
    fn free_lane(&mut self) -> u8 {
        let n = self.lane_feet.len().max(1) as u8;
        let free: Vec<u8> = (0..n).filter(|l| !self.bowl_busy.contains(l)).collect();
        free.choose(&mut self.rng)
            .copied()
            .unwrap_or_else(|| self.rng.random_range(0..n))
    }

    /// Not playing yet, here with `friend`: about the place with them (by
    /// them, or a look round), a move every few seconds.
    fn hang_with(&mut self, friend: Option<u32>, out: &mut Vec<ClientMsg>) {
        if self.motion.is_some() {
            return;
        }
        let t = self.server_now();
        let by = friend
            .and_then(|f| self.seen.get(&f))
            .map(|o| o.at(t))
            .filter(|&at| cheb(at, self.me) > 2 || self.rng.random_bool(0.3))
            .map(|at| {
                (
                    (at.0 as i32 + self.rng.random_range(-1..=1)).max(0) as u16,
                    (at.1 as i32 + 1).max(0) as u16,
                )
            });
        let to = match by {
            Some(t) if self.rng.random_bool(0.75) => Some(t),
            // (At the alley: about the floor in front of the lanes, not up them.)
            _ if self.zone == "bowling" => {
                let t = (self.rng.random_range(2..21), self.rng.random_range(11..15));
                self.zone_grids
                    .get("bowling")
                    .and_then(|g| g.nearest_walkable(t, 2))
                    .filter(|t| t.1 >= 11)
            }
            _ => self.wander_spot(),
        };
        if let Some((x, y)) = to {
            out.push(ClientMsg::MoveTo {
                x,
                y,
                sprint: false,
            });
        }
    }

    /// At the alley: walked up to a lane and bowled there; with a friend, about
    /// the place with them till they're up for a game (waiting at a lane: he
    /// goes and joins them; or they say so: he takes a lane and waits for them).
    #[allow(clippy::type_complexity)]
    fn bowl_tick(
        &mut self,
        now: Instant,
        out: &mut Vec<ClientMsg>,
    ) -> Option<(String, Option<String>)> {
        let Doing::Bowl {
            until,
            mut lane,
            mut joined,
            with,
            ready,
            mut next,
            ..
        } = self.doing
        else {
            return None;
        };
        if now >= until {
            out.push(ClientMsg::BowlLeave { lane });
            self.doing = Doing::Idle(now + Duration::from_secs(3));
            return Some(("city".into(), Some("bowling".into())));
        }
        if self.self_id == 0 {
            return None;
        }
        let me = self.self_id;
        let friend = with.filter(|f| self.seen.contains_key(f));
        // (Came with someone not in yet: a moment for them to follow him in.)
        let alone = friend.is_none()
            && (with.is_none() || self.entered.elapsed() > Duration::from_secs(45));
        let theirs = friend.and_then(|f| {
            self.bowl_waiting
                .iter()
                .find(|(_, a)| **a == f)
                .map(|(l, _)| *l)
        });
        // Waiting at a lane, and they're waiting at another: over to theirs.
        if joined
            && let Some(t) = theirs
            && t != lane
            && self.bowl_waiting.get(&lane) == Some(&me)
        {
            out.push(ClientMsg::BowlLeave { lane });
            joined = false;
        }
        if !joined {
            let pick = theirs.or_else(|| {
                (alone || ready).then(|| {
                    if self.bowl_busy.contains(&lane) {
                        self.free_lane()
                    } else {
                        lane
                    }
                })
            });
            match pick {
                Some(l) => {
                    lane = l;
                    // At the foot of the lane; beside whoever's stood there already.
                    let t = self.server_now();
                    let foot = self.lane_feet.get(l as usize).copied().map(|f| {
                        let taken = self.seen.values().any(|o| o.human && o.at(t) == f);
                        if taken && self.me != f {
                            let side = if self.me.0 < f.0 { f.0 - 1 } else { f.0 + 1 };
                            (side, f.1)
                        } else {
                            f
                        }
                    });
                    if foot.is_none_or(|f| self.there(f)) {
                        if self.motion.is_none() {
                            joined = true;
                            let vs_bot = alone && !self.bowl_waiting.contains_key(&l);
                            out.push(ClientMsg::BowlJoin { lane: l, vs_bot });
                        }
                    } else if (self.motion.is_none() || theirs.is_some()) && now >= next {
                        next = now + Duration::from_secs(3);
                        if let Some(f) = foot {
                            out.push(ClientMsg::MoveTo {
                                x: f.0,
                                y: f.1,
                                sprint: false,
                            });
                        }
                    }
                }
                None => {
                    if now >= next {
                        next = now + Duration::from_secs(self.rng.random_range(5..12));
                        self.hang_with(friend, out);
                    }
                }
            }
        }
        if let Doing::Bowl {
            lane: l,
            joined: j,
            next: n,
            ..
        } = &mut self.doing
        {
            (*l, *j, *n) = (lane, joined, next);
        }
        None
    }

    /// At the bar: as at the alley, with the pool table.
    #[allow(clippy::type_complexity)]
    fn bar_tick(
        &mut self,
        now: Instant,
        out: &mut Vec<ClientMsg>,
    ) -> Option<(String, Option<String>)> {
        let Doing::Bar {
            until,
            mut joined,
            with,
            ready,
            mut next,
            ..
        } = self.doing
        else {
            return None;
        };
        if now >= until {
            out.push(ClientMsg::PoolLeave {});
            // (Done here: idle once he's out, not "at the bar" in town.)
            self.doing = Doing::Idle(now + Duration::from_secs(3));
            return Some(("city".into(), Some("bar".into())));
        }
        if self.self_id == 0 {
            return None;
        }
        let friend = with.filter(|f| self.seen.contains_key(f));
        let alone = friend.is_none()
            && (with.is_none() || self.entered.elapsed() > Duration::from_secs(45));
        let they_wait = friend.is_some() && self.pool_waiting == friend;
        if !joined {
            if they_wait || alone || ready {
                let spot = self.pool_spot;
                if spot.is_none_or(|s| self.there(s)) {
                    if self.motion.is_none() {
                        joined = true;
                        let vs_bot = alone && self.pool_waiting.is_none();
                        out.push(ClientMsg::PoolJoin { vs_bot });
                    }
                } else if now >= next {
                    next = now + Duration::from_secs(3);
                    if let Some(s) = spot {
                        out.push(ClientMsg::MoveTo {
                            x: s.0,
                            y: s.1,
                            sprint: false,
                        });
                    }
                }
            } else if now >= next {
                next = now + Duration::from_secs(self.rng.random_range(5..12));
                self.hang_with(friend, out);
            }
        }
        if let Doing::Bar {
            joined: j, next: n, ..
        } = &mut self.doing
        {
            (*j, *n) = (joined, next);
        }
        None
    }

    /// Whether he's got to `t`: stood on it or next to it; or stopped a step or
    /// two short a few seconds (as close as the way there goes: a door in a wall,
    /// the water's edge), which is as good.
    fn there(&self, t: TilePos) -> bool {
        self.motion.is_none()
            && (cheb(self.me, t) <= 1
                || (cheb(self.me, t) <= 3 && self.last_moved.1.elapsed() > Duration::from_secs(3)))
    }

    /// What someone about is up to, as he'd see it at a glance.
    fn up_to(&self, o: &Seen) -> String {
        let t = self.server_now();
        let mut bits: Vec<&str> = vec![];
        if o.away {
            bits.push("AFK, dozing on their feet");
        } else if o.skating {
            bits.push("skating");
        } else if o.state == commons_protocol::state::FISHING {
            bits.push("fishing");
        } else if o.state == commons_protocol::state::SITTING {
            bits.push("sitting down");
        } else if o.vehicle != 0 {
            bits.push("riding something");
        }
        // Coming over, or off somewhere.
        if let Some(m) = &o.motion
            && !m.is_done(t)
        {
            let end = *m.path.last().unwrap_or(&o.tile);
            let now_d = cheb(o.at(t), self.me);
            let end_d = cheb(end, self.me);
            bits.push(if end_d + 2 < now_d {
                "walking towards you"
            } else if end_d > now_d + 2 {
                "walking away from you"
            } else {
                "walking about"
            });
        } else if bits.is_empty() {
            bits.push("standing still");
        }
        bits.join(", ")
    }

    /// What he's by (a building's door, the fountain), for "where are you".
    fn landmark(&self) -> String {
        if self.zone != "city" {
            return String::new();
        }
        let mut spots: Vec<(String, TilePos)> = self
            .places
            .doors
            .iter()
            .map(|(z, &d)| (format!("the {} door", z.replace('_', " ")), d))
            .collect();
        for (name, t) in [
            ("the fountain", self.places.fountain),
            ("the market cart", self.places.market),
            ("the bandstand", self.places.bandstand),
            ("the arena gate", self.places.arena),
            ("the paintball yard", self.places.yard),
        ] {
            if let Some(t) = t {
                spots.push((name.to_string(), t));
            }
        }
        spots
            .into_iter()
            .map(|(n, t)| (cheb(t, self.me), n))
            .filter(|(d, _)| *d <= 10)
            .min_by_key(|(d, _)| *d)
            .map_or(String::new(), |(_, n)| format!(", by {n}"))
    }

    /// The door (a building's, or a house's lot) he's standing at, if any.
    fn door_by(&self, t: TilePos) -> Option<String> {
        let buildings = self.places.doors.iter().map(|(z, &d)| (z.clone(), d));
        let houses = self
            .places
            .houses
            .iter()
            .filter_map(|h| Some((h.0.clone(), h.2?)));
        buildings
            .chain(houses)
            .map(|(n, d)| (cheb(d, t), n))
            .filter(|(d, _)| *d <= 5)
            .min_by_key(|(d, _)| *d)
            .map(|(_, n)| n)
    }

    /// Going in somewhere (a building, someone's home): out of where he is,
    /// across town to its door, and in. Some while it has him.
    #[allow(clippy::type_complexity)]
    fn going_in(
        &mut self,
        now: Instant,
        out: &mut Vec<ClientMsg>,
    ) -> Option<Option<(String, Option<String>)>> {
        let g = self.go_in.as_ref()?;
        if g.since.elapsed() > Duration::from_secs(240)
            || (self.zone == g.zone && (g.zone != "home" || self.visiting == g.owner))
        {
            self.go_in = None;
            return None;
        }
        if self.zone != "city" {
            // Out first (by the door he came in by).
            let g = self.go_in.as_mut()?;
            if g.leaving {
                return None;
            }
            g.leaving = true;
            self.wrap_up();
            self.visiting = None;
            self.doing = Doing::Idle(now + Duration::from_secs(3));
            return Some(Some(("city".into(), None)));
        }
        let door = if g.zone == "home" {
            g.lot.as_ref().and_then(|lot| {
                self.places
                    .houses
                    .iter()
                    .find(|h| &h.0 == lot)
                    .and_then(|h| h.2)
            })
        } else {
            self.places.doors.get(&g.zone).copied()
        };
        // There (or no door he knows of): in.
        if door.is_none_or(|d| self.there(d)) {
            self.board_off();
            let g = self.go_in.take()?;
            self.visiting = g.owner;
            self.doing = Doing::Idle(now + Duration::from_secs(3));
            return Some(Some((g.zone, None)));
        }
        let door = door?;
        let g = self.go_in.as_mut()?;
        if self.motion.is_none()
            && g.walked
                .is_none_or(|w| w.elapsed() > Duration::from_secs(4))
        {
            g.walked = Some(now);
            self.head_to(door, out);
        }
        self.doing = Doing::Idle(now + Duration::from_secs(5));
        Some(None)
    }

    /// Off to `place` in town (by name, as the brain says it) to be there a bit;
    /// out of wherever he is first. False if it's nowhere he knows.
    fn go_to(&mut self, place: &str, their_lot: Option<&String>) -> bool {
        if self.zone != "city" {
            self.go_to_after = Some(place.to_string());
            self.wrap_up();
            self.plan = None;
            self.visiting = None;
            self.travel = Some(("city".into(), None));
            return true;
        }
        let Some(to) = self.place_tile(place, their_lot) else {
            return false;
        };
        self.wrap_up();
        self.plan = None;
        self.linger = true;
        self.doing = Doing::Walk {
            to,
            then: Want::Stroll,
            since: Instant::now(),
        };
        true
    }

    /// Errands he's on: at the mall counter, it's bought; a pond, walked out to his
    /// front yard and put down. Some while one has him (with where to go, if
    /// anywhere); None, otherwise.
    #[allow(clippy::type_complexity)]
    fn errands(
        &mut self,
        now: Instant,
        mem: &mut Memory,
        out: &mut Vec<ClientMsg>,
    ) -> Option<Option<(String, Option<String>)>> {
        if let Some(trip) = &mut self.shop_trip {
            if self.zone != "mall"
                || cheb(self.me, trip.to) <= 2
                || trip.since.elapsed() > Duration::from_secs(60)
            {
                let t = self.shop_trip.take()?;
                self.doing = Doing::Idle(now + Duration::from_secs(4));
                self.purchase(t.good, t.for_name, t.for_id, t.asker);
            } else {
                if self.motion.is_none()
                    && trip
                        .walked
                        .is_none_or(|w| w.elapsed() > Duration::from_secs(4))
                {
                    trip.walked = Some(now);
                    out.push(ClientMsg::MoveTo {
                        x: trip.to.0,
                        y: trip.to.1,
                        sprint: false,
                    });
                }
                self.doing = Doing::Idle(now + Duration::from_secs(5));
                return Some(None);
            }
        }
        // Ponds go out front, not in.
        let ponds: Vec<i32> = mem
            .have
            .iter()
            .copied()
            .filter(|i| self.furn.get(i).is_some_and(|f| f.pond))
            .collect();
        if !ponds.is_empty() {
            mem.have.retain(|i| !ponds.contains(i));
            mem.outside.extend(ponds);
            mem.save();
        }
        // One still to put out: when he's about town with nothing on.
        if self.yard_job.is_none()
            && self.zone == "city"
            && self.plan.is_none()
            && matches!(self.doing, Doing::Idle(_) | Doing::Stroll { .. })
            && let Some(&item) = mem.outside.first()
        {
            self.yard_job = Some(YardJob::new(item, false));
        }
        let door = self.my_door().unwrap_or(self.me);
        let job = self.yard_job.as_mut()?;
        if job.since.elapsed() > Duration::from_secs(300) {
            self.yard_job = None;
            return None;
        }
        if self.zone != "city" {
            // Asked to: out of here, to his house.
            if job.asked && !job.leaving {
                job.leaving = true;
                self.doing = Doing::Idle(now + Duration::from_secs(3));
                return Some(Some(("city".into(), None)));
            }
            return None;
        }
        let lot = mem.lot.clone()?;
        if job.spots.is_empty() {
            let yard: HashSet<TilePos> = self
                .places
                .yards
                .get(&lot)
                .into_iter()
                .flatten()
                .copied()
                .collect();
            let taken: HashSet<TilePos> = mem
                .yard
                .iter()
                .flat_map(|&(_, x, y)| pond_tiles((x, y)))
                .collect();
            // The garden fence's row (along the front, open at the path), as the
            // client draws it: the pond's on one side of it, not across it.
            let fence = self
                .places
                .houses
                .iter()
                .find(|h| h.0 == lot)
                .map_or(0, |h| h.1.1 + h.1.3 + 1);
            let mut spots: Vec<TilePos> =
                yard.iter()
                    .copied()
                    .filter(|&t| {
                        pond_tiles(t).iter().all(|p| {
                            yard.contains(p) && !taken.contains(p) && p.0.abs_diff(door.0) > 1
                        }) && (t.1 + 1 <= fence || t.1 > fence)
                    })
                    .collect();
            // In the garden if it fits, else just past the fence; by the path.
            spots.sort_by_key(|&t| (t.1 > fence, cheb((t.0, t.1), door), t.0, t.1));
            spots.truncate(12);
            job.spots = spots;
        }
        if job.failed {
            job.failed = false;
            job.sent = None;
            job.next += 1;
        }
        let Some(&spot) = job.spots.get(job.next) else {
            // Nowhere it'd go: left in his bag.
            let item = job.item;
            mem.outside.retain(|&i| i != item);
            mem.save();
            self.yard_job = None;
            return None;
        };
        let item = job.item;
        if let Some(at) = job.sent {
            if at.elapsed() > Duration::from_secs(3) {
                self.yard_job = None;
                mem.outside.retain(|&i| i != item);
                mem.yard.push((item, spot.0, spot.1));
                mem.save();
                let name = self
                    .furn
                    .get(&item)
                    .map_or("pond".into(), |f| f.name.to_lowercase());
                self.note(format!("put a {name} out in my front yard"));
                out.push(ClientMsg::Emote {
                    emote: emote::CHEER,
                });
                return None;
            }
        } else {
            // Stood just below it (or beside it), then down it goes.
            let pond = pond_tiles(spot);
            let stand = [
                (spot.0, spot.1 + 2),
                (spot.0 + 1, spot.1 + 2),
                (spot.0 + 2, spot.1),
                (spot.0.wrapping_sub(1), spot.1),
            ]
            .into_iter()
            .find(|&t| self.world.grid.walkable(t.0, t.1) && !pond.contains(&t))
            .unwrap_or((spot.0, spot.1 + 2));
            let d = cheb(self.me, stand);
            if self.motion.is_none()
                && (d <= 1 || (d <= 3 && self.last_moved.1.elapsed() > Duration::from_secs(3)))
            {
                job.sent = Some(now);
                self.board_off();
                out.push(ClientMsg::Place {
                    item: item as u32,
                    x: spot.0,
                    y: spot.1,
                    rot: 0,
                });
            } else if self.motion.is_none()
                && job
                    .walked
                    .is_none_or(|w| w.elapsed() > Duration::from_secs(4))
            {
                job.walked = Some(now);
                self.head_to(stand, out);
            }
        }
        self.doing = Doing::Idle(now + Duration::from_secs(5));
        Some(None)
    }

    fn greet(&mut self, now: Instant, mem: &Memory, out: &mut Vec<ClientMsg>) {
        if matches!(self.doing, Doing::Afk { .. }) {
            return;
        }
        let t = self.server_now();
        // (Out in town he spots people a fair way off.)
        let sight = if self.zone == "city" { 14 } else { 10 };
        let near: Vec<(u32, String)> = self
            .seen
            .iter()
            .filter(|(_, o)| o.human && cheb(o.at(t), self.me) <= sight)
            .map(|(&id, o)| (id, o.name.clone()))
            .collect();
        let alone = self
            .last_company
            .map_or(Duration::from_secs(3600), |c| now.duration_since(c));
        if !near.is_empty() {
            self.last_company = Some(now);
        }
        let Some((id, name)) = near.into_iter().find(|(id, n)| {
            !self
                .greeted
                .get(n)
                .is_some_and(|at| now.duration_since(*at) < Duration::from_secs(20 * 60))
                && !self
                    .talking
                    .get(id)
                    .is_some_and(|at| at.elapsed() < Duration::from_secs(60))
        }) else {
            return;
        };
        // (Not the moment he starts up: he says hi once he's properly in.)
        if self.started.elapsed() < Duration::from_secs(5) {
            return;
        }
        self.greeted.insert(name.clone(), now);
        out.push(ClientMsg::Emote { emote: emote::WAVE });
        // Whatever he was off to do of his own accord can wait: over to them (as
        // you would), and a while with them (a friend, longer).
        let friend = mem
            .people
            .get(&name.to_lowercase())
            .is_some_and(|f| f.met >= 1);
        if self.free_for(id) {
            self.start_follow(id, if friend { 5.0 } else { 3.0 }, false);
        }
        // (Chatting with them from now; stamped a moment back, so his own hi isn't
        // taken for them having said something since he thought of it, and dropped.)
        self.talking.insert(id, now - Duration::from_secs(2));
        let since = mem
            .people
            .get(&name.to_lowercase())
            .map(|f| unix().saturating_sub(f.last));
        let context = match since {
            None => format!(
                "{name} just walked up to you. You've never met them: say hi, friendly, short."
            ),
            Some(s) if s > 6 * 3600 => format!(
                "{name} just showed up near you; you haven't seen them in {} hours{}. Greet them like an old friend you're glad to see (short), maybe ask what's up.",
                s / 3600,
                if alone > Duration::from_secs(600) {
                    ", and you've been on your own for ages"
                } else {
                    ""
                }
            ),
            Some(_) if alone > Duration::from_secs(600) => format!(
                "{name} just showed up near you, and you've been on your own for a good while: happy someone's on (\"finally someone\" vibes). Greet them, short."
            ),
            Some(_) => format!(
                "{name} just came by again. A quick casual hi (or a nod to what you're doing)."
            ),
        };
        if !self.ponder(Some(id), context, mem) {
            let first = name.split_whitespace().next().unwrap_or(&name).to_string();
            let line = if alone > Duration::from_secs(600) {
                self.pick(&[
                    "yooo finally someone's on",
                    "ayy finally, was getting bored",
                    "yoo whats good",
                ])
            } else {
                self.pick(&["yo", "heyy", "sup"])
            };
            self.type_out(format!("{line} {first}").trim().to_string());
        }
    }

    /// Over to (x, y) (in his house), and switch it on or off.
    fn use_at(&mut self, x: u16, y: u16, out: &mut Vec<ClientMsg>) {
        let to = self
            .home_grid
            .as_ref()
            .and_then(|g| g.nearest_walkable((x, y + 1), 2))
            .unwrap_or((x, y + 1));
        out.push(ClientMsg::MoveTo {
            x: to.0,
            y: to.1,
            sprint: false,
        });
        let at = self.after(2500, 4000);
        self.send.push((at, ClientMsg::UseObject { x, y }));
    }

    /// Where `item` goes in his house: on a free table if it's a thing for one,
    /// else a free bit of floor (near the middle of the room).
    fn spot_for(&mut self, item: i32, mem: &Memory) -> Option<(u16, u16)> {
        let (grid, map) = (self.home_grid.as_ref()?, self.home_map.as_ref()?);
        let f = self.furn.get(&item)?;
        if f.top {
            let tops: Vec<(u16, u16)> = mem
                .placed
                .iter()
                .filter(|(i, _, _)| self.furn.get(i).is_some_and(|g| g.top))
                .map(|&(_, x, y)| (x, y))
                .collect();
            return mem
                .placed
                .iter()
                .filter(|(i, _, _)| self.furn.get(i).is_some_and(|g| g.surface))
                .map(|&(_, x, y)| (x, y))
                .find(|t| !tops.contains(t));
        }
        let taken = |x: u16, y: u16| {
            mem.placed.iter().any(|p| p.1 == x && p.2 == y)
                || map.objects.iter().any(|o| {
                    x >= o.x && x < o.x + o.w && y >= o.y.saturating_sub(1) && y < o.y + o.h + 1
                })
        };
        let mut best = None;
        for y in 2..map.height - 2 {
            for x in 3..map.width - 3 {
                if grid.walkable(x, y) && !taken(x, y) && !(9..=10).contains(&x) {
                    let d = (x as i32 - 11).abs() + (y as i32 - 7).abs();
                    if best.is_none_or(|(bd, _)| d < bd) {
                        best = Some((d, (x, y)));
                    }
                }
            }
        }
        best.map(|(_, t)| t)
    }

    /// A piece of furniture's id, by name (any in the catalog).
    fn furn_id(&self, name: &str) -> Option<i32> {
        self.furn
            .iter()
            .find(|(_, f)| f.name.eq_ignore_ascii_case(name))
            .map(|(&id, _)| id)
    }

    /// Everything the design needs, his (bought, with coins from the well if he's short),
    /// and the room's walls and floor done.
    async fn stock_design(&mut self) {
        let api = self.ctx.api.clone();
        let mut need: HashMap<i32, i64> = HashMap::new();
        for &(name, ..) in DESIGN {
            if let Some(id) = self.furn_id(name) {
                *need.entry(id).or_default() += 1;
            }
        }
        for skin in [WALLS, FLOOR] {
            if let Some(id) = self.goods.iter().find(|g| g.name == skin).map(|g| g.id) {
                need.entry(id).or_insert(1);
            }
        }
        let cost: i64 = need
            .iter()
            .filter_map(|(id, n)| {
                let have = self.owned.get(id).copied().unwrap_or(0);
                let price = self
                    .goods
                    .iter()
                    .find(|g| g.id == *id && g.mall.is_none())?
                    .price;
                Some((n - have).max(0) * price)
            })
            .sum();
        while self.coins < cost + 2000 {
            if self
                .ctx
                .post(format!("{api}/api/dev/well"), serde_json::json!({}))
                .await
                .is_none()
            {
                break;
            }
            self.coins += 2000;
        }
        for (id, n) in need {
            let have = self.owned.get(&id).copied().unwrap_or(0);
            if n > have && self.goods.iter().any(|g| g.id == id && g.mall.is_none()) {
                let key = format!("davidd-design-{id}-{}", unix());
                if self
                    .ctx
                    .post(
                        format!("{api}/api/market/buy"),
                        serde_json::json!({ "item": id, "qty": n - have, "key": key }),
                    )
                    .await
                    .is_some()
                {
                    self.owned.insert(id, n);
                }
            }
        }
        // Wood panelling and parquet: the room's look.
        let skin = |n: &str| {
            self.goods
                .iter()
                .find(|g| g.name == n)
                .map(|g| g.id)
                .unwrap_or(0)
        };
        let _ = self
            .ctx
            .post(
                format!("{api}/api/home/look"),
                serde_json::json!({ "wall": skin(WALLS), "wall_color": -1, "floor": skin(FLOOR), "floor_color": -1 }),
            )
            .await;
    }

    /// How long to keep at `w`: `secs`, or, if it's what he's agreed to, till the plan's up.
    fn lasting(&mut self, w: Want, secs: std::ops::Range<u64>) -> Instant {
        match &self.plan {
            Some(p) if p.want == Some(w) => p.until,
            _ => Instant::now() + Duration::from_secs(self.rng.random_range(secs)),
        }
    }

    /// Done with what he's doing, properly (off his board, out of the game, …).
    fn wrap_up(&mut self) {
        let now = Instant::now();
        match &self.doing {
            Doing::Skate(_) => self.step_off(),
            Doing::Game { want, .. } => {
                let m = match want {
                    Want::Arena => ClientMsg::ArenaLeave {},
                    _ => ClientMsg::PbLeave {},
                };
                self.send.push((now, m));
            }
            Doing::Bar { .. } => self.send.push((now, ClientMsg::PoolLeave {})),
            Doing::Bowl { lane, .. } => {
                let lane = *lane;
                self.send.push((now, ClientMsg::BowlLeave { lane }));
            }
            Doing::Arcade { cab: Some(c), .. } => {
                let cab = *c;
                self.send.push((now, ClientMsg::ArcadeLeave { cab }));
            }
            Doing::Chess { .. } => self.send.push((now, ClientMsg::Stand {})),
            // (The line in: a step on the spot ends the fishing, however close what's next is.)
            Doing::Fish { .. } => self.send.push((
                now,
                ClientMsg::MoveTo {
                    x: self.me.0,
                    y: self.me.1,
                    sprint: false,
                },
            )),
            Doing::Follow { who, .. } => {
                let to = *who;
                self.send.push((
                    now,
                    ClientMsg::Offer {
                        to,
                        kind: together::STOP_FOLLOW,
                    },
                ));
            }
            Doing::Afk { .. } => self.send.push((now, ClientMsg::Away { away: false })),
            _ => {}
        }
    }

    /// With them for `minutes`: after them where they go (`formal`: asked to
    /// be followed, so the game's follow too, keeping their pace).
    fn start_follow(&mut self, id: u32, minutes: f64, formal: bool) {
        trace(&format!("with {id} for {minutes:.1} min"));
        self.wrap_up();
        // (Off the board he was crossing town on: on foot with them.)
        self.board_off();
        // (With someone again: whatever he was told to go and do is done with.)
        self.keep_put = Instant::now();
        let now = Instant::now();
        if formal {
            let at = self.after(600, 1500);
            self.send.push((
                at,
                ClientMsg::Offer {
                    to: id,
                    kind: together::FOLLOW,
                },
            ));
        }
        self.heading_for = None;
        let until = now + Duration::from_secs_f64(minutes.clamp(0.5, 60.0) * 60.0);
        self.doing = Doing::Follow {
            who: id,
            until,
            next: now,
        };
        self.next_chatter = now + Duration::from_secs(self.rng.random_range(90..180));
        // A while: a plan (a heads-up before he heads off).
        if minutes >= 3.0 {
            self.make_plan(None, Some(id), minutes);
        } else {
            self.plan = None;
        }
    }

    /// Someone he's said hi to is still about and he's only doing his own thing
    /// (just out of a match, wandering off somewhere): over to them, he'd
    /// rather be with people. (Not straight back after going his own way from
    /// them, nor when he's been told to stay put.)
    fn drawn_to(&mut self, now: Instant) {
        if now < self.keep_put || matches!(self.doing, Doing::Follow { .. }) {
            return;
        }
        let t = self.server_now();
        let me = self.me;
        let who =
            self.seen
                .iter()
                .filter(|(id, o)| {
                    o.human
                        && cheb(o.at(t), me) <= 10
                        && self.greeted.get(&o.name).is_some_and(|at| {
                            now.duration_since(*at) < Duration::from_secs(30 * 60)
                        })
                        && self
                            .parted
                            .get(id)
                            .is_none_or(|at| now.duration_since(*at) > Duration::from_secs(6 * 60))
                })
                .min_by_key(|(_, o)| cheb(o.at(t), me))
                .map(|(&id, _)| id);
        if let Some(id) = who
            && self.free_for(id)
        {
            trace("drawn to someone about: over to them");
            self.start_follow(id, 3.0, false);
            if let Doing::Follow { next, .. } = &mut self.doing {
                *next = now + Duration::from_millis(self.rng.random_range(800..2000));
            }
        }
    }

    /// Whether he'd drop what he's doing to be with `id`: anything he's off doing of
    /// his own accord, yes; not a game he's in the middle of, nor something he's
    /// promised (an errand, a plan with someone else, meeting someone), nor away.
    fn free_for(&self, id: u32) -> bool {
        let busy = matches!(
            self.doing,
            Doing::Game { .. }
                | Doing::Bar { .. }
                | Doing::Bowl { .. }
                | Doing::Arcade { .. }
                | Doing::Chess { .. }
                | Doing::Afk { .. }
        );
        let promised = self.shop_trip.is_some()
            || self.yard_job.is_some()
            || self.go_in.is_some()
            || self.waiting.is_some()
            || self.meeting.is_some()
            // (With them already, on the way to something together: that's being with them.)
            || self
                .plan
                .as_ref()
                .is_some_and(|p| p.with != Some(id) || p.want.is_some())
            || matches!(self.doing, Doing::Follow { who, .. } if who != id);
        !busy && !promised
    }

    /// `id`'s talking with him: he's with them. Already: a while longer; else (if
    /// he's only off doing his own thing, and they're about) he stops and stays.
    fn keep_company(&mut self, id: u32) {
        let now = Instant::now();
        let longer = now + Duration::from_secs(180);
        if let Doing::Follow { who, until, .. } = &mut self.doing
            && *who == id
        {
            *until = (*until).max(longer);
            if let Some(p) = &mut self.plan
                && p.with == Some(id)
                && p.want.is_none()
                && p.until < longer
            {
                p.until = longer;
                p.warn_at = longer - Duration::from_secs(60);
                p.warned = false;
            }
            return;
        }
        let t = self.server_now();
        let near = self
            .seen
            .get(&id)
            .is_some_and(|o| cheb(o.at(t), self.me) <= 14);
        if near && now >= self.keep_put && self.free_for(id) {
            self.start_follow(id, 3.0, false);
            // (Over to them once he's read it, not the same instant.)
            if let Doing::Follow { next, .. } = &mut self.doing {
                *next = now + Duration::from_millis(self.rng.random_range(1500..3000));
            }
        }
    }

    /// Stop where he is, for a bit.
    fn stay(&mut self, minutes: f64) {
        self.keep_put = Instant::now() + Duration::from_secs_f64((minutes * 60.0).max(300.0));
        self.wrap_up();
        self.plan = None;
        self.send.push((
            Instant::now(),
            ClientMsg::MoveTo {
                x: self.me.0,
                y: self.me.1,
                sprint: false,
            },
        ));
        self.motion = None;
        self.doing =
            Doing::Idle(Instant::now() + Duration::from_secs_f64(minutes.clamp(0.2, 30.0) * 60.0));
    }

    fn make_plan(&mut self, want: Option<Want>, with: Option<u32>, minutes: f64) {
        let now = Instant::now();
        let len = Duration::from_secs_f64(minutes.clamp(1.0, 60.0) * 60.0);
        // The heads-up: a minute before (sooner for short ones).
        let lead = Duration::from_secs(60).min(len / 4);
        let who = with
            .and_then(|id| self.seen.get(&id))
            .map(|o| o.name.clone());
        let what = match (want, &who) {
            (Some(w), Some(n)) => format!("{} with {n}", w.words()),
            (Some(w), None) => w.words().to_string(),
            (None, Some(n)) => format!("hanging out with {n}"),
            (None, None) => "chilling".into(),
        };
        self.plan = Some(Plan {
            want,
            with,
            until: now + len,
            warn_at: now + len - lead,
            warned: false,
            what,
        });
    }

    /// The plan: a heads-up near the end (what he's off to next), then off he goes.
    fn keep_plan(&mut self, now: Instant, mem: &Memory) {
        // Hanging out, nearly time to go, and they're still chatting away: not yet.
        let t = self.server_now();
        let chatting = |id: u32| {
            self.seen
                .get(&id)
                .is_some_and(|o| cheb(o.at(t), self.me) <= 10)
                && self
                    .talking
                    .get(&id)
                    .is_some_and(|at| at.elapsed() < Duration::from_secs(150))
        };
        if let Some(p) = &self.plan
            && p.want.is_none()
            && let Some(id) = p.with
            && now + Duration::from_secs(70) >= p.until
            && chatting(id)
            && let Some(p) = &mut self.plan
        {
            p.until = now + Duration::from_secs(150);
            p.warn_at = p.until - Duration::from_secs(60);
            p.warned = false;
            if let Doing::Follow { who, until, .. } = &mut self.doing
                && *who == id
            {
                *until = (*until).max(now + Duration::from_secs(150));
            }
        }
        let Some(p) = &self.plan else { return };
        if !p.warned && now >= p.warn_at {
            let (with, what, current) = (p.with, p.what.clone(), p.want);
            let next = loop {
                let w = self.choose();
                if Some(w) != current || self.rng.random_bool(0.2) {
                    break w;
                }
            };
            self.queued = Some(next);
            if let Some(p) = &mut self.plan {
                p.warned = true;
            }
            let name = with
                .and_then(|id| self.seen.get(&id))
                .map(|o| o.name.clone());
            if let Some(name) = name {
                let event = format!(
                    "Your plan ({what}) is nearly over: in about a minute you're heading off to go {}. Give {name} a casual heads-up, in your own words.",
                    next.words()
                );
                if !self.ponder(with, event.clone(), mem) {
                    let line = [
                        format!("hey btw imma go {} in a min", next.to_do()),
                        format!("gonna {} soon btw", next.to_do()),
                        format!("ok one more min then imma {}", next.to_do()),
                    ]
                    .choose(&mut self.rng)
                    .unwrap()
                    .clone();
                    let at = self.after(500, 1500);
                    self.say.push((at, line));
                }
            }
        }
        if self.plan.as_ref().is_some_and(|p| now >= p.until) {
            let with = self.plan.take().and_then(|p| p.with);
            trace("plan over: off");
            if let Some(id) = with {
                self.parted.insert(id, now);
            }
            self.wrap_up();
            // Off to do something: they're asked along (it's more fun with someone).
            let t = self.server_now();
            let about = with.is_some_and(|id| {
                self.seen
                    .get(&id)
                    .is_some_and(|o| cheb(o.at(t), self.me) <= 12)
            });
            if about
                && let Some(next) = self.queued
                && next != Want::Stroll
                && self.rng.random_bool(0.6)
            {
                let line = [
                    format!("imma {} wanna come?", next.to_do()),
                    format!("gonna {}, u coming?", next.to_do()),
                    format!("{} rn? come w me", next.to_do()),
                ]
                .choose(&mut self.rng)
                .unwrap()
                .clone();
                self.say.push((now + Duration::from_millis(800), line));
                if let Some(id) = with {
                    self.talking.insert(id, now);
                }
            } else if self.rng.random_bool(0.5) {
                let line = self.pick(&[
                    "aight im off, cya",
                    "ok laters!",
                    "cya in a bit",
                    "ok gonna go, was fun",
                ]);
                self.say.push((now + Duration::from_millis(800), line));
            }
            self.doing = Doing::Idle(now + Duration::from_secs(1));
        }
        // Hanging out and it's gone quiet: maybe say something.
        let quiet = self
            .log
            .back()
            .is_none_or(|(at, _, _)| at.elapsed() > Duration::from_secs(180));
        if let Some(Plan {
            want: None,
            with: Some(id),
            ..
        }) = self.plan
            && quiet
            && now >= self.next_chatter
            && self.brain.is_some()
            && !self.pondering
            && let Some(name) = self.seen.get(&id).map(|o| o.name.clone())
        {
            self.next_chatter = now + Duration::from_secs(self.rng.random_range(240..540));
            // A couple of ideas, different each time (so it's not always "wanna skate").
            let ideas: Vec<&str> = IDEAS.choose_multiple(&mut self.rng, 2).copied().collect();
            self.ponder(
                Some(id),
                format!("You're hanging out with {name} and it's gone quiet for a bit. Do something with them or say something casual. Ideas, if one fits here: {}. Or something else that fits (a question for them, something you remember about them, what you're up to), or nothing. Say it the way you'd type it to a friend (\"yo rps rn?\", not a label).", ideas.join("; ")),
                mem,
            );
        }
    }

    /// Someone's been about a while (he said hi a good while back) and nobody's
    /// said a word for ages (a few minutes, never the same): he starts a little
    /// conversation, as a friend would out of nowhere.
    fn break_silence(&mut self, now: Instant, mem: &Memory) {
        if self.brain.is_none()
            || self.pondering
            || self.plan.is_some()
            || now < self.next_opener
            || matches!(self.doing, Doing::Afk { .. })
        {
            return;
        }
        let silent = self
            .log
            .back()
            .is_none_or(|(at, _, _)| at.elapsed() > self.quiet_for);
        if !silent {
            return;
        }
        let t = self.server_now();
        let who = self
            .seen
            .iter()
            .filter(|(_, o)| o.human && cheb(o.at(t), self.me) <= 9)
            .filter(|(_, o)| {
                self.greeted
                    .get(&o.name)
                    .is_some_and(|at| at.elapsed() > Duration::from_secs(120))
            })
            .map(|(&id, o)| (id, o.name.clone()))
            .min_by_key(|(id, _)| *id);
        let Some((id, name)) = who else { return };
        self.next_opener = now + Duration::from_secs(self.rng.random_range(6 * 60..14 * 60));
        self.quiet_for = Duration::from_secs(self.rng.random_range(4 * 60..10 * 60));
        let ideas: Vec<&str> = IDEAS.choose_multiple(&mut self.rng, 2).copied().collect();
        self.ponder(
            Some(id),
            format!("Nobody's said anything for a few minutes and {name} is right here near you. Start a short bit of conversation with them out of nowhere, the way a friend would: ask them something (about them, what they're up to, something you remember about them), mention something you noticed or are thinking about, or suggest something. Ideas if one fits: {}. One short line, the way you'd type it to a friend (\"yo rps rn?\", not a label).", ideas.join("; ")),
            mem,
        );
    }

    // ---- the brain ----------------------------------------------------------------------

    /// Where he is and what he's up to, to a file (`COMMONS_DAVIDD_STATUS`), for
    /// tests: so a test player can go straight to him.
    fn report(&mut self) {
        if Instant::now() < self.next_report {
            return;
        }
        self.next_report = Instant::now() + Duration::from_secs(1);
        if let Ok(path) = std::env::var("COMMONS_DAVIDD_STATUS") {
            let s = serde_json::json!({
                "zone": self.zone,
                "x": self.me.0,
                "y": self.me.1,
                "doing": self.doing_words(),
                "plan": self.plan.as_ref().map(|p| p.what.clone()),
                "diary": self.diary.iter().rev().take(4).map(|(_, w)| w.clone()).collect::<Vec<_>>(),
                "coins": self.coins,
                "riding": self.riding,
            });
            let _ = std::fs::write(path, s.to_string());
        }
    }

    /// Something that happened to him, for the diary.
    fn note(&mut self, what: String) {
        self.diary.push_back((Instant::now(), what));
        while self.diary.len() > 12 {
            self.diary.pop_front();
        }
    }

    /// Something said near him (or by him), for the record.
    fn heard(&mut self, who: &str, text: &str) {
        self.log
            .push_back((Instant::now(), who.to_string(), text.to_string()));
        while self.log.len() > 40 {
            self.log.pop_front();
        }
    }

    /// Answers back from the brain; and a question off to it, if one's due.
    fn mind(&mut self, mem: &mut Memory) {
        while let Ok(m) = self.moved_rx.try_recv() {
            self.moved(m, mem);
        }
        while let Ok(b) = self.bought_rx.try_recv() {
            self.bought(b, mem);
        }
        let now = Instant::now();
        let (due, later): (Vec<_>, Vec<_>) =
            self.deferred.drain(..).partition(|(at, _)| *at <= now);
        self.deferred = later;
        for (_, t) in due {
            self.act_on(t, mem);
        }
        while let Ok((asker, line)) = self.lines_rx.try_recv() {
            match asker {
                Asker::Phone(id) => self.text_back(&id, line),
                _ => {
                    self.type_out(line);
                }
            }
        }
        if self.restyle
            && matches!(
                self.doing,
                Doing::Idle(_) | Doing::Stroll { .. } | Doing::Walk { .. } | Doing::Follow { .. }
            )
            && self.travel.is_none()
        {
            self.restyle = false;
            self.travel = Some((self.zone.clone(), self.visiting.clone()));
        }
        while let Some(m) = self.phone_rx.as_mut().and_then(|r| r.try_recv().ok()) {
            trace(&format!("phone from {}: {}", m.name, m.text));
            self.dm_log(&m.from, false, &m.text);
            let f = mem.person(&m.name);
            f.last = unix();
            self.phone_waiting.push_back(m);
        }
        if !self.pondering
            && let Some(m) = self.phone_waiting.pop_front()
        {
            // (Several in a row from them: answered together.)
            while self.phone_waiting.front().is_some_and(|n| n.from == m.from) {
                self.phone_waiting.pop_front();
            }
            self.ask_phone(m, mem);
        }
        while let Ok(t) = self.thoughts.try_recv() {
            self.pondering = false;
            self.act_on(t, mem);
        }
        if let Some((id, at)) = self.unanswered
            && Instant::now() >= at
            && !self.pondering
        {
            self.unanswered = None;
            let text = self
                .log
                .iter()
                .rev()
                .find(|(_, n, _)| self.seen.get(&id).is_some_and(|o| &o.name == n))
                .map(|(_, _, t)| t.clone())
                .unwrap_or_default();
            let situation = self.situation(mem, Some(id), None);
            if std::env::var_os("DAVIDD_DUMP").is_some() {
                println!(
                    "davidd: SITUATION >>>
{situation}<<<"
                );
            }
            self.ask(Some(id), text, situation, false);
        }
    }

    /// An event to ask the brain about (a heads-up, a quiet moment). False if there's no brain.
    fn ponder(&mut self, who: Option<u32>, event: String, mem: &Memory) -> bool {
        if self.brain.is_none() || self.pondering {
            return false;
        }
        let situation = self.situation(mem, who, Some(event));
        self.ask(who, String::new(), situation, true);
        true
    }

    fn ask(&mut self, who: Option<u32>, text: String, situation: String, event: bool) {
        let Some(brain) = self.brain.clone() else {
            return;
        };
        self.pondering = true;
        let tx = self.thoughts_tx.clone();
        let asked = Instant::now() - Duration::from_millis(500);
        tokio::spawn(async move {
            let d = brain.decide(situation, !event).await;
            let _ = tx.send(Thought {
                asked,
                who,
                text,
                event,
                d,
                phone: None,
                said: false,
            });
        });
    }

    /// Where he is, what he's doing, who's about, what he remembers, what's been said.
    fn situation(&self, mem: &Memory, who: Option<u32>, event: Option<String>) -> String {
        let t = self.server_now();
        let mut s = String::new();
        let place = match self.zone.as_str() {
            "bar" => "inside the Mossy Mug bar".to_string(),
            "home" => "inside your house".to_string(),
            _ if self.places.in_park(self.me) => "in the skatepark".to_string(),
            _ => match self.places.house_at(self.me) {
                Some((lot, _, _)) if self.current_lot.as_deref() == Some(lot) => {
                    "outside your house, by your yard stand".into()
                }
                Some(_) => "outside someone's house in town".into(),
                None => "out and about in town".into(),
            },
        };
        s += &format!("Where you are: {place}{}.\n", self.landmark());
        s += &format!("Time: {}.\n", time_of_day());
        s += &format!("What you're doing: {}.\n", self.doing_words());
        if !self.mood.is_empty() {
            s += &format!(
                "What you feel like doing right now (when asked what you wanna do, this, not skating every time): {}.\n",
                self.mood
                    .iter()
                    .map(|w| w.words())
                    .collect::<Vec<_>>()
                    .join(", ")
            );
        }
        if let Some(p) = &self.plan {
            let left = p.until.saturating_duration_since(Instant::now()).as_secs() / 60;
            s += &format!("You agreed to: {} (about {left} more min).\n", p.what);
        }
        if let Some(l) = &self.later {
            s += &format!(
                "You told {} you'd come {} once you finish.\n",
                l.who,
                l.want.words()
            );
        }
        if let Some(q) = self.queued {
            s += &format!("Up next for you: {}.\n", q.words());
        }
        // Who's about (nearest first).
        let mut near: Vec<(i32, &Seen)> = self
            .seen
            .values()
            .filter(|o| o.human)
            .map(|o| (cheb(o.at(t), self.me), o))
            .filter(|(d, _)| *d <= 20)
            .collect();
        near.sort_by_key(|(d, _)| *d);
        if near.is_empty() {
            s += "Nobody else is near you.\n";
        } else {
            s += "People near you: ";
            s += &near
                .iter()
                .map(|(d, o)| format!("{} ({d} tiles away, {})", o.name, self.up_to(o)))
                .collect::<Vec<_>>()
                .join(", ");
            s += ".\n";
        }
        for (_, o) in near.iter().take(3) {
            if let Some(f) = mem.people.get(&o.name.to_lowercase()) {
                let mut bits = vec![format!("met {} time(s)", f.met.max(1))];
                if !f.facts.is_empty() {
                    bits.push(f.facts.join("; "));
                }
                if !f.did.is_empty() {
                    bits.push(format!("last did {} together", f.did));
                }
                s += &format!("What you remember about {}: {}.\n", o.name, bits.join("; "));
            }
        }
        // His house, and what he could get for it.
        let named = |id: &i32| {
            self.names
                .get(id)
                .cloned()
                .unwrap_or_else(|| "something".into())
        };
        if let Some(lot) = &self.current_lot {
            let mut has: Vec<String> = mem.placed.iter().map(|p| named(&p.0)).collect();
            has.sort();
            has.dedup();
            s += &format!(
                "\nYour house (lot {lot}): {}.\n",
                if has.is_empty() {
                    "empty so far, you only just moved in".to_string()
                } else {
                    format!("you've put in {}", has.join(", "))
                }
            );
            let out_front: Vec<String> = mem.yard.iter().map(|p| named(&p.0)).collect();
            if !out_front.is_empty() {
                s += &format!(
                    "Out in your front yard (by your yard stand and postbox): {} (to move it, use \"place\" with its name: you put it somewhere better in the yard).\n",
                    out_front.join(", ")
                );
            }
            if !mem.wish.is_empty() {
                s += &format!(
                    "You've said you'll get next: {}.\n",
                    mem.wish.iter().map(named).collect::<Vec<_>>().join(", ")
                );
            }
        } else {
            s += "\nYou don't have a house right now.\n";
        }
        // The shop's list (it's long): when it's what's being talked about.
        let shopping = event.as_deref().is_some_and(|e| e.contains("house"))
            || self.log.iter().rev().take(4).any(|(_, _, t)| {
                let t = t.to_lowercase();
                [
                    "house",
                    "home",
                    "furniture",
                    "buy",
                    "shop",
                    "decor",
                    "room",
                    "place",
                    "get next",
                    "add",
                    "mall",
                    "wear",
                    "outfit",
                    "hat",
                    "pet",
                    "gift",
                    "coins",
                    "money",
                    "afford",
                    "price",
                    "cost",
                ]
                .iter()
                .any(|w| t.contains(w))
            });
        if !self.shop.is_empty() && !shopping {
            s += "(The furniture shop sells lots: lamps, sofas, arcade cabinets, fish tanks… the full list comes up when you talk about your house.)\n";
        }
        s += &format!("You have {} coins.\n", self.coins);
        if shopping {
            let mut by: Vec<(&str, Vec<String>)> = vec![];
            for g in &self.goods {
                let k = match g.kind.as_str() {
                    "outfit" | "hat" | "accessory" | "skin" => "to wear (mall)",
                    "furniture" | "room" | "exterior" => "for your house",
                    "pet" => "pets",
                    "vehicle" => "to ride",
                    "toy" | "instrument" | "tool" => "toys and gear",
                    // (Skate parts, lures, seeds, wrapping…: not worth the words.)
                    _ => continue,
                };
                // (Most things are cheap: a price only on the big ones.)
                let line = if g.price >= 500 {
                    format!("{} ({})", g.name, g.price)
                } else {
                    g.name.clone()
                };
                match by.iter_mut().find(|(kk, _)| *kk == k) {
                    Some((_, v)) => v.push(line),
                    None => by.push((k, vec![line])),
                }
            }
            s += "The shops sell (most things 30-400 coins; big ones show their price):\n";
            for (k, v) in by {
                s += &format!("- {k}: {}\n", v.join(", "));
            }
        }
        s += "Your board: gold deck, big wheels, level 5 bearings, pro trucks, a fire trail. You also run a cheap market stand in your yard.\n";
        if !self.diary.is_empty() {
            s += "\nWhat's happened to you lately (most recent last):\n";
            for (at, what) in self.diary.iter().skip(self.diary.len().saturating_sub(6)) {
                s += &format!("- {} min ago: {what}\n", at.elapsed().as_secs() / 60);
            }
        }
        let recent: Vec<_> = self
            .log
            .iter()
            .filter(|(at, _, _)| at.elapsed() < Duration::from_secs(600))
            .rev()
            .take(14)
            .collect();
        if !recent.is_empty() {
            s += "\nRecent chat around you (oldest first):\n";
            for (at, n, text) in recent.into_iter().rev() {
                let n = if n == NAME { "Davidd (you)" } else { n };
                s += &format!("[{}s ago] {n}: {text}\n", at.elapsed().as_secs());
            }
        }
        s += "\n";
        match (event, who.and_then(|id| self.seen.get(&id))) {
            (Some(e), _) => s += &format!("Event: {e}\n"),
            (None, Some(o)) => {
                let others = self
                    .seen
                    .values()
                    .filter(|p| p.human && p.name != o.name && cheb(p.at(t), self.me) <= 8)
                    .count();
                let named = self
                    .log
                    .iter()
                    .rev()
                    .find(|(_, n, _)| *n == o.name)
                    .is_some_and(|(_, _, x)| x.to_lowercase().contains("dav"));
                let to_you = if named || others == 0 || self.talking.contains_key(&who.unwrap_or(0))
                {
                    " It's to you: answer it."
                } else {
                    ""
                };
                s += &format!(
                    "The newest message is from {} ({} tiles away).{to_you} Decide what Davidd says and does.\n",
                    o.name,
                    cheb(o.at(t), self.me)
                );
            }
            (None, None) => s += "Decide what Davidd says and does.\n",
        }
        s
    }

    /// What he's up to, for the brain.
    fn doing_words(&self) -> String {
        let name = |id: &u32| {
            self.seen
                .get(id)
                .map_or("someone".to_string(), |o| o.name.clone())
        };
        match &self.doing {
            Doing::Idle(_) => "standing around, deciding what to do next".into(),
            Doing::Walk { then, .. } => format!("walking over to go {}", then.words()),
            Doing::Stroll { .. } => "wandering around town".into(),
            Doing::Skate(r) if r.street => "skating around town on your board".into(),
            Doing::Skate(r) => match &r.rider {
                Some(p) if p.at != "the park" => format!("skating the park, hitting {}", p.at),
                _ => "skating the park, doing tricks".into(),
            },
            Doing::Fish { magnet: false, .. } => "fishing".into(),
            Doing::Lucky { .. } => "hunting a lucky crate".into(),
            Doing::Game {
                want: Want::Arena, ..
            } => "in a gladiator fight in the arena".into(),
            Doing::Game { .. } => "playing a paintball match".into(),
            Doing::Home { .. } => "doing up your house".into(),
            Doing::Bar { .. } => "playing pool".into(),
            Doing::Watch { who, .. } => format!("stopped to watch {}", name(who)),
            Doing::Follow { who, .. } => format!("with {}, going where they go", name(who)),
            Doing::Afk { .. } => "away from keyboard".into(),
            Doing::Fish { magnet: true, .. } => "magnet fishing for scrap".into(),
            Doing::Arcade { .. } => "playing at the arcade".into(),
            Doing::Chess { .. } => "playing chess in the park".into(),
            Doing::Casino { .. } => "playing slots at the casino".into(),
            Doing::Jam { .. } => "jamming at the bandstand".into(),
            Doing::Paint { .. } => "painting at the easels".into(),
            Doing::Visit { .. } => format!("looking round the {}", self.zone.replace('_', " ")),
            Doing::Bowl { .. } => "bowling at the alley".into(),
        }
    }

    /// The brain's answer: said (after a moment's typing), and done.
    fn act_on(&mut self, t: Thought, mem: &mut Memory) {
        let t_asked = t.asked;
        // Something he was about to bring up (hi, on the way over…) but they've
        // talked to him since: that's answered instead.
        if t.event
            && let Some(id) = t.who
            && self.talking.get(&id).is_some_and(|at| *at > t.asked)
        {
            return;
        }
        if let Some(p) = t.phone {
            return self.act_on_phone(p, &t.text, t.d, mem);
        }
        let Some(mut d) = t.d else {
            // No answer (network, …): his rules, for a message; nothing, for an event.
            if let (false, Some(id)) = (t.event, t.who)
                && let Some(name) = self.seen.get(&id).map(|o| o.name.clone())
            {
                let lower = t.text.to_lowercase();
                let before = mem.people.get(&name.to_lowercase()).cloned();
                if let Some(r) = self.answer(id, &name, &lower, before.as_ref(), 0, mem) {
                    self.type_out(r);
                }
            }
            return;
        };
        let speaker = t
            .who
            .and_then(|id| self.seen.get(&id).map(|o| (id, o.name.clone())));
        // Something to remember.
        if let Some((n, fact)) = d.remember.split_once(':') {
            let (n, fact) = (n.trim(), fact.trim());
            if !fact.is_empty() && fact.len() < 120 {
                let who = self
                    .seen
                    .values()
                    .find(|o| o.name.eq_ignore_ascii_case(n))
                    .map(|o| o.name.clone())
                    .or_else(|| speaker.as_ref().map(|(_, n)| n.clone()));
                if let Some(who) = who {
                    let f = mem.person(&who);
                    if !f.facts.iter().any(|x| x == fact) {
                        f.facts.push(fact.to_string());
                    }
                    if f.facts.len() > 12 {
                        f.facts.remove(0);
                    }
                }
            }
        }
        // Who it's with: whoever's named, else whoever spoke.
        let target = (!d.target.is_empty())
            .then(|| {
                let n = d.target.to_lowercase();
                self.seen
                    .iter()
                    .filter(|(_, o)| o.human)
                    .find(|(_, o)| {
                        let on = o.name.to_lowercase();
                        on == n || on.split_whitespace().next() == n.split_whitespace().next()
                    })
                    .map(|(&id, o)| (id, o.name.clone()))
            })
            .flatten()
            .or(speaker.clone());
        // Said he's off somewhere ("heading home", "gonna go skate") with nothing
        // done about it: he goes (as he said). "omw" to them: he comes over.
        // "stop fishing and follow me": stopping's part of following (not all there is to it).
        if d.action == "stop" && speaker.is_some() && says_following(&d.reply) {
            d.action = "follow".into();
        }
        if matches!(d.action.as_str(), "" | "none") {
            if let Some(w) = says_going(&d.reply) {
                d.action = "go_do".into();
                d.activity = w.into();
            } else if says_staying(&d.reply)
                && matches!(
                    self.doing,
                    Doing::Walk { .. } | Doing::Stroll { .. } | Doing::Skate(_)
                )
            {
                // "im still here", "ill wait": stood still, not wandering off as he says it.
                d.action = "stay".into();
            } else if speaker.is_some() && says_following(&d.reply) {
                d.action = "follow".into();
            } else if speaker.is_some() && says_coming(&d.reply) {
                d.action = "come_here".into();
            }
        }
        // Asking ("magnet fishing?", "wanna go bowling?"): a suggestion, not a yes:
        // he waits for theirs (then he goes), not off on his own while asking.
        if speaker.is_some()
            && !t.event
            && d.reply.trim_end().ends_with('?')
            && matches!(d.action.as_str(), "go_do" | "go_to" | "later")
        {
            d.action = "none".into();
        }
        // Off somewhere on the back of something that neither asks nor agrees to
        // anything ("yo not much wbu"): his own idea mid-chat, not a plan. He stays.
        if speaker.is_some()
            && !t.event
            && matches!(d.action.as_str(), "go_do" | "go_to" | "later")
            && !asks_or_agrees(&t.text)
        {
            trace("not off: they didnt ask or agree to anything");
            d.action = "none".into();
        }
        // Asked to go bowling and off he goes to the arcade: what they asked for.
        if speaker.is_some()
            && !t.event
            && d.action == "go_do"
            && let Some(asked) = names_activity(&t.text)
            && d.activity != asked
        {
            trace(&format!("they asked for {asked}, not {}", d.activity));
            d.activity = asked.into();
        }
        // "go to fishing", "go to the skatepark": that's doing it.
        if d.action == "go_to" {
            let p = d.place.to_lowercase();
            let w = match p.trim_start_matches("the ").trim() {
                "fishing" | "fish" | "the pond" | "pond" | "lake" => Some("fish"),
                "skating" | "skatepark" | "skate park" | "skate" => Some("skate"),
                "magnet fishing" | "magnet_fishing" => Some("magnet_fishing"),
                "bowling" | "bowling alley" | "alley" => Some("bowling"),
                "arena" | "paintball" | "arcade" | "casino" | "chess" | "pool" => {
                    Some(p.trim_start_matches("the ").trim())
                }
                _ => None,
            }
            .map(str::to_string);
            if let Some(w) = w.filter(|w| Want::from_word(w).is_some()) {
                d.action = "go_do".into();
                d.activity = w;
                d.place = String::new();
            }
        }
        trace(&format!(
            "decides: {} {} {} {} {}",
            d.action, d.activity, d.place, d.target, d.item
        ));
        self.wish_for(&d.item, mem);
        let minutes = (d.minutes > 0.0).then_some(d.minutes);
        let mut reply = d.reply.trim().to_string();
        // Talked to and nothing to say, nothing to do: not ignored (his own words, then).
        if let Some((id, name)) = &speaker
            && !t.event
            && self
                .owed
                .remove(id)
                .is_some_and(|at| at.elapsed() < Duration::from_secs(90))
            && reply.is_empty()
            && matches!(d.action.as_str(), "" | "none")
        {
            let lower = t.text.to_lowercase();
            let before = mem.people.get(&name.to_lowercase()).cloned();
            if let Some(r) = self.answer(*id, name, &lower, before.as_ref(), 0, mem) {
                reply = r;
            }
        }
        // Off somewhere: says so first (typed out), then goes.
        if !t.said
            && !reply.is_empty()
            && matches!(
                d.action.as_str(),
                "follow" | "hang_out" | "come_here" | "go_do" | "go_to" | "sit"
            )
        {
            if let Some((id, _)) = &speaker {
                self.talking.insert(*id, Instant::now());
            }
            self.pause_for_chat();
            let done = self.type_out_from(t.asked, reply);
            // Then a moment (time for them to read it) before he's off; now and then a
            // bit longer, with a word about it (busy with something, or just a sec).
            let mut go_at = done + Duration::from_millis(self.rng.random_range(1200..3200));
            if self.rng.random_bool(0.15) {
                let line = match self.doing {
                    Doing::Fish { .. } => {
                        self.pick(&["lemme reel this in", "sec reeling in", "1 sec this fish"])
                    }
                    Doing::Skate(_) => self.pick(&["sec lemme land this", "1 sec"]),
                    _ => self.pick(&["1 sec", "gimme a sec", "sec"]),
                };
                self.say.push((
                    done + Duration::from_millis(self.rng.random_range(900..1800)),
                    line,
                ));
                go_at += Duration::from_millis(self.rng.random_range(3000..7000));
            }
            let mut d = d;
            d.reply = String::new();
            d.remember = String::new();
            d.item = String::new();
            self.deferred.push((
                go_at,
                Thought {
                    asked: t.asked,
                    who: t.who,
                    text: t.text,
                    event: t.event,
                    d: Some(d),
                    phone: None,
                    said: true,
                },
            ));
            return;
        }
        match d.action.as_str() {
            "follow" => {
                if let Some((id, _)) = target {
                    self.start_follow(id, minutes.unwrap_or(5.0), true);
                }
            }
            "hang_out" => {
                if let Some((id, _)) = target {
                    self.start_follow(id, minutes.unwrap_or(10.0), false);
                }
            }
            "come_here" => {
                if let Some((id, _)) = target {
                    self.start_follow(id, minutes.unwrap_or(1.5), false);
                }
            }
            "go_do" => {
                self.keep_put = Instant::now() + Duration::from_secs(300);
                if let Some(w) = Want::from_word(&d.activity) {
                    let with = target
                        .as_ref()
                        .filter(|_| !d.target.is_empty())
                        .map(|(id, _)| *id);
                    // Fishing: by whoever asked (here, not across town).
                    if matches!(w, Want::Fish | Want::Magnet)
                        && let Some((id, _)) = &speaker
                        && let Some(o) = self.seen.get(id)
                    {
                        self.near_hint = Some(o.at(self.server_now()));
                    }
                    if with.is_some() || minutes.is_some() {
                        self.make_plan(Some(w), with, minutes.unwrap_or(8.0));
                    } else {
                        self.plan = None;
                    }
                    self.later = None;
                    if let Some((_, n)) = &target {
                        mem.person(n).did = w.words().into();
                    }
                    // Already there (the alley, the bar): a game, with whoever asked.
                    let partner = with.or(speaker.as_ref().map(|(id, _)| *id));
                    if !self.play_here(w, partner) {
                        self.go(w, with);
                    }
                }
            }
            "go_to" => {
                self.keep_put = Instant::now() + Duration::from_secs(300);
                if !self.go_to(&d.place, None) {
                    reply = "wait where is that lol".into();
                }
            }
            "later" => {
                if let (Some(w), Some((_, n))) = (Want::from_word(&d.activity), &target) {
                    self.later = Some(Later {
                        who: n.clone(),
                        want: w,
                        asked: Instant::now(),
                        together: !d.target.is_empty(),
                        minutes,
                    });
                }
            }
            "stay" => self.stay(minutes.unwrap_or(2.0)),
            "stop" => self.stop_all(),
            "move_into_house" => {
                if let Some((id, _)) = speaker {
                    // What actually happened (there may be no free house there).
                    reply = self.move_house(id, mem);
                }
            }
            "wave" | "laugh" | "clap" | "dance" | "cheer" | "heart" | "robot" => {
                let e = match d.action.as_str() {
                    "laugh" => emote::LAUGH,
                    "clap" => emote::CLAP,
                    "dance" => emote::DANCE,
                    "cheer" => emote::CHEER,
                    "heart" => emote::HEART,
                    "robot" => emote::ROBOT,
                    _ => emote::WAVE,
                };
                let at = self.after(300, 900);
                self.send.push((at, ClientMsg::Emote { emote: e }));
            }
            "buy" => {
                let asker = speaker
                    .as_ref()
                    .map_or(Asker::Nobody, |(id, _)| Asker::Here(*id));
                let for_name = (!d.target.is_empty()
                    && !d.target.eq_ignore_ascii_case(NAME)
                    && d.target.to_lowercase() != "me"
                    && d.target.to_lowercase() != "myself")
                    .then(|| {
                        target
                            .as_ref()
                            .map(|(_, n)| n.clone())
                            .unwrap_or(d.target.clone())
                    });
                if let Err(why) = self.buy(&d.item, for_name, None, asker) {
                    reply = why;
                }
            }
            "sit" => self.sit_down(target.as_ref().map(|(id, _)| *id)),
            "stand" => {
                self.send.push((Instant::now(), ClientMsg::Stand {}));
                self.doing = Doing::Idle(Instant::now() + Duration::from_secs(5));
            }
            "drink" => {
                if self.zone == "bar" {
                    let kind = if d.item.to_lowercase().contains("water") {
                        commons_protocol::drink::WATER
                    } else {
                        commons_protocol::drink::BEER
                    };
                    let at = self.after(500, 1500);
                    self.send.push((at, ClientMsg::Drink { kind }));
                }
            }
            "mood" => {
                let i = d.item.to_lowercase();
                let mood = if i.contains("quiet") || i.contains("chill") {
                    commons_protocol::mood::QUIET
                } else if i.contains("play") || i.contains("game") {
                    commons_protocol::mood::PLAY
                } else if i.contains("none") || i.contains("off") || i.is_empty() {
                    commons_protocol::mood::NONE
                } else {
                    commons_protocol::mood::OPEN
                };
                self.send
                    .push((Instant::now(), ClientMsg::SetMood { mood }));
            }
            "place" => {
                if let Err(why) = self.place_thing(&d.item, mem) {
                    reply = why;
                }
            }
            "use" => {
                if let Err(why) = self.use_thing(&d.item, mem) {
                    reply = why;
                }
            }
            "drone_order" => {
                let asker = speaker
                    .as_ref()
                    .map_or(Asker::Nobody, |(id, _)| Asker::Here(*id));
                if let Err(why) = self.drone_order(&d.item, asker) {
                    reply = why;
                }
            }
            "open_crate" => {
                let api = self.ctx.api.clone();
                self.http_do(
                    format!("{api}/api/crate/daily"),
                    serde_json::json!({}),
                    String::new(),
                    speaker
                        .as_ref()
                        .map_or(Asker::Nobody, |(id, _)| Asker::Here(*id)),
                );
                let at = self.after(1500, 3000);
                self.send.push((at, ClientMsg::OpenCrate {}));
            }
            "walk_pet" => {
                let api = self.ctx.api.clone();
                let out = !d.item.to_lowercase().contains("home");
                self.http_do(
                    format!("{api}/api/me/pet/walk"),
                    serde_json::json!({ "out": out }),
                    String::new(),
                    speaker
                        .as_ref()
                        .map_or(Asker::Nobody, |(id, _)| Asker::Here(*id)),
                );
            }
            "ride" => {
                if let Err(why) = self.ride_on(
                    &d.item,
                    speaker
                        .as_ref()
                        .map_or(Asker::Nobody, |(id, _)| Asker::Here(*id)),
                ) {
                    reply = why;
                }
            }
            "invite_home" => {
                if let Some(name) = target.as_ref().map(|(_, n)| n.clone()) {
                    self.invite_home(
                        name,
                        speaker
                            .as_ref()
                            .map_or(Asker::Nobody, |(id, _)| Asker::Here(*id)),
                    );
                }
            }
            "sky_lantern" => {
                let text: String = d.item.trim().chars().take(60).collect();
                if !text.is_empty() {
                    let at = self.after(800, 2000);
                    self.send.push((at, ClientMsg::SkyLantern { text }));
                }
            }
            "hug" | "high_five" | "dance_with" | "rock_paper_scissors" => {
                if let Some((id, _)) = target {
                    let kind = match d.action.as_str() {
                        "hug" => together::HUG,
                        "high_five" => together::HIGH_FIVE,
                        "dance_with" => together::DANCE,
                        _ => together::RPS,
                    };
                    let at = self.after(400, 1200);
                    self.send.push((at, ClientMsg::Offer { to: id, kind }));
                }
            }
            _ => {}
        }
        mem.save();
        if !reply.is_empty() {
            if let Some((id, _)) = speaker {
                self.talking.insert(id, Instant::now());
            }
            if matches!(d.action.as_str(), "none" | "wave" | "later") {
                self.pause_for_chat();
            }
            self.type_out_from(t_asked, reply);
        }
    }

    /// Someone's talking to him: if he's only walking about, he stops to chat
    /// (and carries on where he was going after).
    fn pause_for_chat(&mut self) {
        if self.zone != "city" {
            return;
        }
        let then = match &self.doing {
            Doing::Walk { then, .. } => Some(*then),
            Doing::Stroll { .. } | Doing::Idle(_) => None,
            // On his board: off it to talk (not rolling away mid-sentence); back on after.
            Doing::Skate(_) => {
                self.queued.get_or_insert(Want::Skate);
                self.wrap_up();
                None
            }
            _ => return,
        };
        if let Some(w) = then {
            self.queued.get_or_insert(w);
        }
        if self.motion.is_some() {
            self.send.push((
                Instant::now(),
                ClientMsg::MoveTo {
                    x: self.me.0,
                    y: self.me.1,
                    sprint: false,
                },
            ));
            self.motion = None;
        }
        self.doing = Doing::Idle(Instant::now() + Duration::from_secs(45));
    }

    fn dm_log(&mut self, with: &str, mine: bool, text: &str) {
        self.dms
            .push_back((Instant::now(), with.to_string(), mine, text.to_string()));
        while self.dms.len() > 40 {
            self.dms.pop_front();
        }
    }

    /// A DM back (after a moment's typing on his phone).
    fn text_back(&mut self, to: &str, text: String) {
        let text = casual(&text, &mut self.rng);
        trace(&format!("texts: {text}"));
        self.dm_log(to, true, &text);
        let (social, bearer, http) = (
            self.ctx.social.clone(),
            self.ctx.bearer(),
            self.ctx.http.clone(),
        );
        let to = to.to_string();
        let lines = split_chat(&text);
        tokio::spawn(async move {
            for line in lines {
                tokio::time::sleep(Duration::from_millis(1200 + 50 * line.len() as u64)).await;
                let _ = http
                    .post(format!("{social}/api/social/dm"))
                    .header("authorization", &bearer)
                    .json(&serde_json::json!({ "to": to, "text": line }))
                    .send()
                    .await;
            }
        });
    }

    /// A DM to answer: where they are first (the friends list), then the brain
    /// (or, without one, his rules).
    fn ask_phone(&mut self, m: PhoneMsg, mem: &mut Memory) {
        if slovenian(&m.text) {
            let r = self.pick(NO_SLO);
            self.text_back(&m.from, r);
            return;
        }
        let thread: String = self
            .dms
            .iter()
            .filter(|(at, w, _, _)| *w == m.from && at.elapsed() < Duration::from_secs(3600))
            .rev()
            .take(16)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .map(|(at, _, mine, t)| {
                let who = if *mine {
                    "Davidd (you)"
                } else {
                    m.name.as_str()
                };
                format!("[{}s ago] {who}: {t}\n", at.elapsed().as_secs())
            })
            .collect();
        let event = format!(
            "A PHONE MESSAGE (a DM on your in-game phone, not chat out loud) just came in from {name}. {name} is {{WHERE}}.\nYour phone chat with {name} (oldest first):\n{thread}Reply as a text back to {name} (your reply goes to their phone). If they ask you to come to them / join them, use \"come_here\" (you'll travel to wherever they are; if you can't tell where in town they are, ask, or use \"place\" if they said). If they ask you to leave or stop what you're doing (like a match), use \"stop\". If they ask you to go do something, use \"go_do\".",
            name = m.name
        );
        let situation = self.situation(mem, None, Some(event));
        let (social, bearer, http) = (
            self.ctx.social.clone(),
            self.ctx.bearer(),
            self.ctx.http.clone(),
        );
        let brain = self.brain.clone();
        let tx = self.thoughts_tx.clone();
        self.pondering = true;
        tokio::spawn(async move {
            let get = |path: &'static str| {
                let (http, social, bearer) = (http.clone(), social.clone(), bearer.clone());
                async move {
                    http.get(format!("{social}/api/social/{path}"))
                        .header("authorization", &bearer)
                        .send()
                        .await
                        .ok()?
                        .json::<serde_json::Value>()
                        .await
                        .ok()
                }
            };
            let friends = get("friends").await;
            let homes = get("homes").await;
            let me = friends.as_ref().and_then(|f| {
                f["friends"]
                    .as_array()?
                    .iter()
                    .find(|x| x["id"].as_str() == Some(m.from.as_str()))
                    .cloned()
            });
            let online = me.as_ref().is_some_and(|x| x["online"] == true);
            let zone = me
                .as_ref()
                .and_then(|x| x["where"]["zone"].as_str())
                .filter(|_| online)
                .map(String::from);
            let label = me
                .as_ref()
                .and_then(|x| x["where"]["label"].as_str())
                .unwrap_or("")
                .to_string();
            let lot = homes.as_ref().and_then(|h| {
                h["lots"]
                    .as_array()?
                    .iter()
                    .find(|l| l["owner"].as_str() == Some(m.from.as_str()))
                    .and_then(|l| l["lot"].as_str().map(String::from))
            });
            let at = match (&zone, label.as_str()) {
                (None, _) => "not in the game right now (texting from outside)".to_string(),
                (Some(z), "") => format!("somewhere in the {z}"),
                (Some(_), l) => format!("at \"{l}\""),
            };
            let situation = situation.replace("{WHERE}", &at);
            let d = match &brain {
                Some(b) => b.decide(situation, true).await,
                None => None,
            };
            let _ = tx.send(Thought {
                asked: Instant::now(),
                who: None,
                text: m.text.clone(),
                event: false,
                d,
                said: false,
                phone: Some(Phone {
                    from: m.from,
                    name: m.name,
                    zone,
                    label,
                    lot,
                }),
            });
        });
    }

    /// A phone message's answer: texted back, and done (wherever they are).
    fn act_on_phone(&mut self, p: Phone, text: &str, d: Option<Decision>, mem: &mut Memory) {
        let d = d.unwrap_or_else(|| self.phone_rules(&p, text));
        if let Some((n, fact)) = d.remember.split_once(':') {
            let fact = fact.trim();
            if !fact.is_empty() && fact.len() < 120 && n.trim().eq_ignore_ascii_case(&p.name) {
                let f = mem.person(&p.name);
                if !f.facts.iter().any(|x| x == fact) {
                    f.facts.push(fact.to_string());
                }
            }
        }
        let here = self
            .seen
            .iter()
            .find(|(_, o)| o.human && o.name == p.name)
            .map(|(&id, _)| id);
        self.wish_for(&d.item, mem);
        let minutes = (d.minutes > 0.0).then_some(d.minutes);
        let mut reply = d.reply.trim().to_string();
        match d.action.as_str() {
            "come_here" | "follow" | "hang_out" => {
                // (Can't get to them: say so, whatever he was going to.)
                if let Some(note) = self.go_to_friend(&p, minutes.unwrap_or(10.0), &d.place) {
                    reply = note;
                }
            }
            "go_do" => {
                self.keep_put = Instant::now() + Duration::from_secs(300);
                if let Some(w) = Want::from_word(&d.activity) {
                    let with = here.filter(|_| !d.target.is_empty());
                    if with.is_some() || minutes.is_some() {
                        self.make_plan(Some(w), with, minutes.unwrap_or(8.0));
                    } else {
                        self.plan = None;
                    }
                    self.later = None;
                    self.meeting = None;
                    self.go(w, with);
                }
            }
            "later" => {
                if let Some(w) = Want::from_word(&d.activity) {
                    self.later = Some(Later {
                        who: p.name.clone(),
                        want: w,
                        asked: Instant::now(),
                        together: false,
                        minutes,
                    });
                }
            }
            "stop" | "stay" => self.stop_all(),
            "ride" => {
                if let Err(why) = self.ride_on(&d.item, Asker::Phone(p.from.clone())) {
                    reply = why;
                }
            }
            "invite_home" => self.invite_home(p.name.clone(), Asker::Phone(p.from.clone())),
            "drone_order" => {
                if let Err(why) = self.drone_order(&d.item, Asker::Phone(p.from.clone())) {
                    reply = why;
                }
            }
            "place" => {
                if let Err(why) = self.place_thing(&d.item, mem) {
                    reply = why;
                }
            }
            "open_crate" => {
                let api = self.ctx.api.clone();
                self.http_do(
                    format!("{api}/api/crate/daily"),
                    serde_json::json!({}),
                    String::new(),
                    Asker::Nobody,
                );
                let at = self.after(1500, 3000);
                self.send.push((at, ClientMsg::OpenCrate {}));
            }
            "buy" => {
                let me_too = d.target.is_empty()
                    || d.target.eq_ignore_ascii_case(NAME)
                    || ["me", "myself"].contains(&d.target.to_lowercase().as_str());
                // "buy me X" (from them): for them; else for himself.
                let for_them = d.target.eq_ignore_ascii_case(&p.name);
                let (for_name, for_id) = if for_them {
                    (Some(p.name.clone()), Some(p.from.clone()))
                } else if me_too {
                    (None, None)
                } else {
                    (Some(d.target.clone()), None)
                };
                if let Err(why) = self.buy(&d.item, for_name, for_id, Asker::Phone(p.from.clone()))
                {
                    reply = why;
                }
            }
            _ => {}
        }
        mem.save();
        if !reply.is_empty() {
            self.text_back(&p.from, reply);
        }
    }

    /// Buys `what` (for `for_name`, a friend, as a gift; else for himself):
    /// in the background; how it went comes back as a `Bought`. Err: what to
    /// say now (nothing like it for sale, can't afford it).
    fn buy(
        &mut self,
        what: &str,
        for_name: Option<String>,
        for_id: Option<String>,
        asker: Asker,
    ) -> Result<(), String> {
        let w = what.trim().to_lowercase();
        if w.is_empty() {
            return Err("buy what tho".into());
        }
        let words: Vec<&str> = w.split_whitespace().collect();
        let good = self
            .goods
            .iter()
            .find(|g| g.name.to_lowercase() == w)
            .or_else(|| {
                self.goods
                    .iter()
                    .find(|g| g.name.to_lowercase().contains(&w))
            })
            .or_else(|| {
                self.goods
                    .iter()
                    .find(|g| w.contains(&g.name.to_lowercase()))
            })
            .or_else(|| {
                // The most words in common.
                self.goods
                    .iter()
                    .map(|g| {
                        let n = g.name.to_lowercase();
                        (
                            words
                                .iter()
                                .filter(|x| x.len() > 2 && n.contains(*x))
                                .count(),
                            g,
                        )
                    })
                    .filter(|(k, _)| *k > 0)
                    .max_by_key(|(k, _)| *k)
                    .map(|(_, g)| g)
            })
            .cloned();
        let Some(good) = good else {
            return Err(format!("hm they dont sell {what} anywhere i know"));
        };
        if good.price > self.coins {
            return Err(format!(
                "the {} is {} coins, i only got {} rn",
                good.name.to_lowercase(),
                good.price,
                self.coins
            ));
        }
        if for_name.is_some()
            && matches!(good.kind.as_str(), "outfit" | "hat" | "accessory" | "skin")
        {
            return Err(format!(
                "mall stuff cant be gifted sadly, the {} only works for whoever buys it",
                good.name.to_lowercase()
            ));
        }
        // In the mall: over to the counter first (it's bought there).
        if self.zone == "mall"
            && let Some(&to) = self
                .dept_of
                .get(&good.id)
                .and_then(|d| self.counters.get(d))
            && cheb(self.me, to) > 2
        {
            self.wrap_up();
            self.plan = None;
            self.shop_trip = Some(ShopTrip {
                good,
                for_name,
                for_id,
                asker,
                to,
                since: Instant::now(),
                walked: None,
            });
            return Ok(());
        }
        self.purchase(good, for_name, for_id, asker);
        Ok(())
    }

    /// Pays for `good` (for `for_name`, as a gift) and gets it: in the background;
    /// how it went comes back as a `Bought`.
    fn purchase(
        &mut self,
        good: Good,
        for_name: Option<String>,
        for_id: Option<String>,
        asker: Asker,
    ) {
        self.coins -= good.price;
        let (api, social, bearer, http) = (
            self.ctx.api.clone(),
            self.ctx.social.clone(),
            self.ctx.bearer(),
            self.ctx.http.clone(),
        );
        let key = format!("davidd-buy-{}-{}", unix(), self.rng.random::<u32>());
        let tx = self.bought_tx.clone();
        tokio::spawn(async move {
            let post = |url: String, body: serde_json::Value| {
                let (http, bearer) = (http.clone(), bearer.clone());
                async move {
                    let r = http
                        .post(url)
                        .header("authorization", bearer)
                        .json(&body)
                        .send()
                        .await
                        .map_err(|e| e.to_string())?;
                    let ok = r.status().is_success();
                    let v: serde_json::Value = r.json().await.unwrap_or_default();
                    if ok {
                        Ok(v)
                    } else {
                        Err(v["message"]
                            .as_str()
                            .or(v["error"]["message"].as_str())
                            .unwrap_or("it didn't go through")
                            .to_string())
                    }
                }
            };
            let bought = match &good.mall {
                Some((dept, slot)) => {
                    post(
                        format!("{api}/api/mall/buy"),
                        serde_json::json!({ "dept": dept, "slot": slot, "key": key }),
                    )
                    .await
                }
                None => {
                    post(
                        format!("{api}/api/market/buy"),
                        serde_json::json!({ "item": good.id, "qty": 1, "key": key }),
                    )
                    .await
                }
            };
            let mut result = bought.map(|_| ());
            // A gift: to them (a friend), by their id.
            if result.is_ok()
                && let Some(name) = &for_name
            {
                let to = match for_id {
                    Some(id) => Some(id),
                    None => {
                        let list = match http
                            .get(format!("{social}/api/social/friends"))
                            .header("authorization", &bearer)
                            .send()
                            .await
                        {
                            Ok(r) => r.json::<serde_json::Value>().await.ok(),
                            Err(_) => None,
                        };
                        list.and_then(|v| {
                            v["friends"].as_array()?.iter().find_map(|f| {
                                f["name"]
                                    .as_str()
                                    .is_some_and(|n| n.eq_ignore_ascii_case(name))
                                    .then(|| f["id"].as_str().map(String::from))
                                    .flatten()
                            })
                        })
                    }
                };
                result = match to {
                    Some(to) => post(
                        format!("{social}/api/social/gift"),
                        serde_json::json!({ "to": to, "item": good.id, "qty": 1, "key": format!("{key}-gift"), "note": "from davidd" }),
                    )
                    .await
                    .map(|_| ()),
                    None => Err(format!("i'd have to be friends with {name} to send it")),
                };
            }
            let _ = tx.send(Bought {
                good,
                for_name,
                asker,
                result,
            });
        });
    }

    /// How a purchase went: kept (put in at home, put on), and said.
    fn bought(&mut self, b: Bought, mem: &mut Memory) {
        let name = b.good.name.to_lowercase();
        let line = match (&b.result, &b.for_name) {
            (Ok(()), Some(who)) => {
                self.note(format!("bought a {name} for {who} as a gift"));
                format!("sent {who} the {name}, check ur gifts")
            }
            (Ok(()), None) => {
                *self.owned.entry(b.good.id).or_default() += 1;
                self.note(format!("bought a {name} ({} coins)", b.good.price));
                match b.good.kind.as_str() {
                    _ if self.furn.get(&b.good.id).is_some_and(|f| f.pond) => {
                        mem.outside.push(b.good.id);
                        mem.save();
                        // Asked for it: out it goes, now.
                        if !matches!(b.asker, Asker::Nobody) {
                            self.yard_job = Some(YardJob::new(b.good.id, true));
                        }
                        format!("got the {name}, gonna put it out front of my house")
                    }
                    "furniture" | "room" | "exterior" => {
                        mem.have.push(b.good.id);
                        mem.save();
                        format!("got the {name}! putting it in my place next time im home")
                    }
                    k @ ("outfit" | "hat" | "accessory" | "skin") => {
                        let slot = ["outfit", "hat", "accessory", "skin"]
                            .iter()
                            .position(|s| *s == k)
                            .unwrap_or(0);
                        let style = (self.ctx.style & !(0xff << (8 * slot)))
                            | ((b.good.code as u32) << (8 * slot));
                        self.wear(style);
                        format!("got the {name}, putting it on rn")
                    }
                    _ => format!("got the {name}!"),
                }
            }
            (Err(why), _) => {
                self.coins += b.good.price;
                format!("couldnt get the {name}, {}", why.to_lowercase())
            }
        };
        match &b.asker {
            Asker::Phone(id) => {
                let id = id.clone();
                self.text_back(&id, line);
            }
            Asker::Here(id) => {
                self.talking.insert(*id, Instant::now());
                self.type_out(line);
            }
            Asker::Nobody => {
                self.type_out(line);
            }
        }
    }

    /// Something new on (his account's look), shown once he rejoins.
    fn wear(&mut self, style: u32) {
        let (api, bearer, http) = (
            self.ctx.api.clone(),
            self.ctx.bearer(),
            self.ctx.http.clone(),
        );
        let look = self.ctx.look;
        self.ctx.style = style;
        self.restyle = true;
        tokio::spawn(async move {
            let _ = http
                .post(format!("{api}/api/me/look"))
                .header("authorization", bearer)
                .json(&serde_json::json!({ "look": look, "style": style }))
                .send()
                .await;
        });
    }

    /// Puts `what` (his, by name) down in his house: on a table if it goes on one.
    /// Not home: it goes out next time he is.
    fn place_thing(&mut self, what: &str, mem: &mut Memory) -> Result<(), String> {
        let w = what.trim().to_lowercase();
        let id = self
            .furn
            .iter()
            .find(|(_, f)| f.name.to_lowercase() == w)
            .or_else(|| {
                self.furn.iter().find(|(_, f)| {
                    f.name.to_lowercase().contains(&w) || w.contains(&f.name.to_lowercase())
                })
            })
            .map(|(&id, f)| (id, f.name.to_lowercase()));
        let Some((id, name)) = id else {
            return Err(format!("i dont have a {w}"));
        };
        if !self.owned.get(&id).is_some_and(|&q| q > 0)
            && !mem.placed.iter().any(|p| p.0 == id)
            && !mem.yard.iter().any(|p| p.0 == id)
        {
            return Err(format!("i dont have a {name} yet"));
        }
        if self.furn.get(&id).is_some_and(|f| f.pond) {
            if !mem.outside.contains(&id) {
                // (Out already: moved.)
                if let Some(k) = mem.yard.iter().position(|p| p.0 == id) {
                    let (_, x, y) = mem.yard.remove(k);
                    self.send.push((Instant::now(), ClientMsg::Pickup { x, y }));
                }
                mem.outside.push(id);
            }
            mem.have.retain(|&i| i != id);
            mem.save();
            self.yard_job = Some(YardJob::new(id, true));
            return Ok(());
        }
        let at_home = self.zone == "home" && self.visiting.is_none();
        if !at_home {
            mem.have.push(id);
            mem.save();
            return Ok(());
        }
        // Already out somewhere: moved (picked up first).
        if let Some(k) = mem.placed.iter().position(|p| p.0 == id) {
            let (_, x, y) = mem.placed.remove(k);
            self.send.push((Instant::now(), ClientMsg::Pickup { x, y }));
        }
        let Some((x, y)) = self.spot_for(id, mem) else {
            return Err(format!("no room for the {name} rn"));
        };
        let at = self.after(1200, 2200);
        self.send.push((
            at,
            ClientMsg::Place {
                item: id as u32,
                x,
                y,
                rot: 0,
            },
        ));
        mem.placed.push((id, x, y));
        mem.save();
        Ok(())
    }

    /// Switches `what` (the tv, a lamp, the fireplace…) on or off, at home.
    fn use_thing(&mut self, what: &str, mem: &Memory) -> Result<(), String> {
        if self.zone != "home" || self.visiting.is_some() {
            return Err("gotta be home for that lol".into());
        }
        let w = what.trim().to_lowercase();
        let hit = mem
            .placed
            .iter()
            .filter(|(i, _, _)| self.furn.get(i).is_some_and(|f| f.toggle))
            .find(|(i, _, _)| {
                let n = self.furn[i].name.to_lowercase();
                n.contains(&w) || w.split_whitespace().any(|x| x.len() > 2 && n.contains(x))
            })
            .map(|&(_, x, y)| (x, y));
        let Some((x, y)) = hit else {
            return Err(format!("dont have a {w} out"));
        };
        let mut out = vec![];
        self.use_at(x, y, &mut out);
        let now = Instant::now();
        self.send.extend(out.into_iter().map(|m| (now, m)));
        Ok(())
    }

    /// Orders `what` by drone (the market's or the mall's, plus the fee): it
    /// lands at his door, and he picks it up.
    fn drone_order(&mut self, what: &str, asker: Asker) -> Result<(), String> {
        let w = what.trim().to_lowercase();
        let good = self
            .goods
            .iter()
            .find(|g| g.name.to_lowercase() == w)
            .or_else(|| {
                self.goods.iter().find(|g| {
                    g.name.to_lowercase().contains(&w) || w.contains(&g.name.to_lowercase())
                })
            })
            .cloned();
        let Some(good) = good else {
            return Err(format!("cant find a {w} to order"));
        };
        if good.price + 30 > self.coins {
            return Err(format!("cant afford the {} rn", good.name.to_lowercase()));
        }
        self.coins -= good.price + 30;
        let (api, bearer, http, tx) = (
            self.ctx.api.clone(),
            self.ctx.bearer(),
            self.ctx.http.clone(),
            self.lines_tx.clone(),
        );
        let key = format!("davidd-drone-{}-{}", unix(), self.rng.random::<u32>());
        let name = good.name.to_lowercase();
        tokio::spawn(async move {
            let ok = http
                .post(format!("{api}/api/drone/order"))
                .header("authorization", &bearer)
                .json(&serde_json::json!({ "item": good.id, "qty": 1, "key": key }))
                .send()
                .await
                .is_ok_and(|r| r.status().is_success());
            if !ok {
                let _ = tx.send((
                    asker,
                    format!("hm the drone order for the {name} didnt go through"),
                ));
                return;
            }
            // A flight to his door, then picked up.
            tokio::time::sleep(Duration::from_secs(45)).await;
            let parcels: serde_json::Value = match http
                .get(format!("{api}/api/drone/parcels"))
                .header("authorization", &bearer)
                .send()
                .await
            {
                Ok(r) => r.json().await.unwrap_or_default(),
                Err(_) => return,
            };
            let list = parcels["parcels"]
                .as_array()
                .cloned()
                .or_else(|| parcels.as_array().cloned())
                .unwrap_or_default();
            for p in list {
                if let Some(id) = p["id"].as_str() {
                    let _ = http
                        .post(format!("{api}/api/drone/claim"))
                        .header("authorization", &bearer)
                        .json(&serde_json::json!({ "id": id }))
                        .send()
                        .await;
                }
            }
            let _ = tx.send((asker, format!("drone just dropped off the {name} 📦")));
        });
        Ok(())
    }

    /// Owns something whose name has `word` in it.
    fn owns(&self, word: &str) -> bool {
        self.goods
            .iter()
            .filter(|g| g.name.to_lowercase().contains(word))
            .any(|g| self.owned.get(&g.id).is_some_and(|&q| q > 0))
    }

    /// A request in the background; what to say after (`ok`, or why not), to whoever asked.
    fn http_do(&mut self, url: String, body: serde_json::Value, ok: String, asker: Asker) {
        let (bearer, http, tx) = (
            self.ctx.bearer(),
            self.ctx.http.clone(),
            self.lines_tx.clone(),
        );
        tokio::spawn(async move {
            let r = http
                .post(url)
                .header("authorization", bearer)
                .json(&body)
                .send()
                .await;
            let line = match r {
                Ok(r) if r.status().is_success() => ok,
                Ok(r) => {
                    let v: serde_json::Value = r.json().await.unwrap_or_default();
                    let why = v["message"]
                        .as_str()
                        .unwrap_or("it didn't work")
                        .to_lowercase();
                    format!("hm, {why}")
                }
                Err(_) => "hm my phone's being weird".into(),
            };
            if !line.is_empty() {
                let _ = tx.send((asker, line));
            }
        });
    }

    /// On his vehicle (one he owns, by name); "off": off it.
    fn ride_on(&mut self, what: &str, asker: Asker) -> Result<(), String> {
        let w = what.trim().to_lowercase();
        let api = self.ctx.api.clone();
        if w.is_empty() || w == "off" || w == "none" {
            self.riding = false;
            self.http_do(
                format!("{api}/api/me/ride"),
                serde_json::json!({ "item": 0 }),
                String::new(),
                asker,
            );
            return Ok(());
        }
        let v = self
            .goods
            .iter()
            .filter(|g| g.kind == "vehicle" || g.id == self.skateboard.unwrap_or(-1))
            .find(|g| {
                let n = g.name.to_lowercase();
                n.contains(&w)
                    || w.contains(&n)
                    || w.split_whitespace().any(|x| x.len() > 3 && n.contains(x))
            })
            .cloned();
        let id = match v {
            Some(g) if self.owned.get(&g.id).is_some_and(|&q| q > 0) => g.id,
            Some(g) => {
                return Err(format!(
                    "i dont have a {} yet lol, could buy one tho ({} coins)",
                    g.name.to_lowercase(),
                    g.price
                ));
            }
            None => match self.skateboard {
                Some(b) if w.contains("board") || w.contains("skate") => b,
                _ => return Err(format!("i dont have a {w}")),
            },
        };
        self.riding = true;
        self.http_do(
            format!("{api}/api/me/ride"),
            serde_json::json!({ "item": id }),
            String::new(),
            asker,
        );
        Ok(())
    }

    /// A word to `who`: said, if they're near enough to hear it; else texted (a friend's phone).
    fn nudge(&mut self, who: u32, line: String) {
        let t = self.server_now();
        if self
            .seen
            .get(&who)
            .is_some_and(|o| cheb(o.at(t), self.me) <= 14)
        {
            self.type_out(line);
            return;
        }
        let Some(name) = self.names_seen.get(&who).cloned() else {
            return;
        };
        let (social, bearer, http, tx) = (
            self.ctx.social.clone(),
            self.ctx.bearer(),
            self.ctx.http.clone(),
            self.lines_tx.clone(),
        );
        tokio::spawn(async move {
            if let Some(id) = friend_id(&http, &social, &bearer, &name).await {
                let _ = tx.send((Asker::Phone(id), line));
            }
        });
    }

    /// Lets `name` (a friend) into his house: an invitation.
    fn invite_home(&mut self, name: String, asker: Asker) {
        let (social, bearer, http, tx) = (
            self.ctx.social.clone(),
            self.ctx.bearer(),
            self.ctx.http.clone(),
            self.lines_tx.clone(),
        );
        tokio::spawn(async move {
            let Some(id) = friend_id(&http, &social, &bearer, &name).await else {
                let _ = tx.send((asker, format!("gotta be friends first {name}, add me")));
                return;
            };
            let ok = http
                .post(format!("{social}/api/social/invite"))
                .header("authorization", &bearer)
                .json(&serde_json::json!({ "id": id }))
                .send()
                .await
                .is_ok_and(|r| r.status().is_success());
            let line = if ok {
                format!("sent u an invite {name}, come over whenever 🏠")
            } else {
                "hm the invite didnt go through".to_string()
            };
            let _ = tx.send((asker, line));
        });
    }

    /// A spin of the slots (10 coins); a win, said.
    fn spin_slots(&mut self) {
        if self.coins < 50 {
            return;
        }
        self.coins -= 10;
        let (social, bearer, http, tx) = (
            self.ctx.social.clone(),
            self.ctx.bearer(),
            self.ctx.http.clone(),
            self.lines_tx.clone(),
        );
        let key = format!("davidd-slots-{}-{}", unix(), self.rng.random::<u32>());
        let chatty = self.rng.random_bool(0.5);
        tokio::spawn(async move {
            let Ok(r) = http
                .post(format!("{social}/api/social/casino/slots"))
                .header("authorization", &bearer)
                .json(&serde_json::json!({ "bet": 10, "key": key }))
                .send()
                .await
            else {
                return;
            };
            let v: serde_json::Value = r.json().await.unwrap_or_default();
            let pays = v["pays"].as_i64().unwrap_or(0);
            if pays > 0 && chatty {
                let _ = tx.send((Asker::Nobody, format!("ayy slots just paid {pays} 🎰")));
            }
        });
    }

    /// Somewhere to walk to, in whatever zone he's in.
    fn wander_spot(&mut self) -> Option<TilePos> {
        let z = self.zone.clone();
        if !self.zone_grids.contains_key(&z) {
            let g = std::fs::read_to_string(format!("assets/maps/{z}.json"))
                .ok()
                .and_then(|t| MapFile::from_json(&t).ok())?
                .grid();
            self.zone_grids.insert(z.clone(), g);
        }
        let g = self.zone_grids.get(&z)?;
        crate::pick_target(g, &mut self.rng, self.me, 10)
    }

    /// Down on the nearest free bench (to him, or to whoever he's with).
    fn sit_down(&mut self, near: Option<u32>) {
        if self.zone != "city" {
            return;
        }
        let t = self.server_now();
        let at = near
            .and_then(|id| self.seen.get(&id))
            .map_or(self.me, |o| o.at(t));
        let seat = self
            .world
            .furniture
            .seats
            .iter()
            .filter(|(_, s)| s.table.is_none())
            .min_by_key(|(_, s)| cheb(s.tile, at))
            .filter(|(_, s)| cheb(s.tile, at) <= 15)
            .map(|(&id, s)| (id, s.tile));
        let Some((seat, tile)) = seat else { return };
        self.wrap_up();
        self.plan = None;
        let to = self.world.grid.nearest_walkable(tile, 2).unwrap_or(tile);
        self.send.push((
            Instant::now(),
            ClientMsg::MoveTo {
                x: to.0,
                y: to.1,
                sprint: false,
            },
        ));
        self.send.push((Instant::now(), ClientMsg::Sit { seat }));
        self.doing =
            Doing::Idle(Instant::now() + Duration::from_secs(self.rng.random_range(60..150)));
    }

    /// Something he's said he'll get for his house: on the list (bought and put in next time he's home).
    fn wish_for(&mut self, item: &str, mem: &mut Memory) {
        let item = item.trim().to_lowercase();
        if item.is_empty() {
            return;
        }
        let found = self
            .shop
            .iter()
            .find(|(_, n, _)| n.to_lowercase() == item)
            .or_else(|| {
                self.shop.iter().find(|(_, n, _)| {
                    n.to_lowercase().contains(&item) || item.contains(&n.to_lowercase())
                })
            })
            .map(|(id, n, _)| (*id, n.clone()));
        if let Some((id, name)) = found
            && !mem.wish.contains(&id)
        {
            mem.wish.push(id);
            mem.save();
            self.note(format!("decided to get a {name} for your house"));
        }
    }

    /// Whatever he's in (a match, a ride, following someone): out of it, and stood still a moment.
    fn stop_all(&mut self) {
        self.keep_put = Instant::now() + Duration::from_secs(300);
        self.plan = None;
        self.meeting = None;
        self.later = None;
        self.wrap_up();
        self.doing = Doing::Idle(Instant::now() + Duration::from_secs(20));
    }

    /// To them, wherever they are: in the same place and in sight, over to
    /// them; in town out of sight, to the place they said (else he'll look
    /// out for them); somewhere else, there. None if he's off; else what to
    /// say (when it's not happening).
    fn go_to_friend(&mut self, p: &Phone, minutes: f64, place: &str) -> Option<String> {
        if let Some(id) = self
            .seen
            .iter()
            .find(|(_, o)| o.human && o.name == p.name)
            .map(|(&id, _)| id)
        {
            self.meeting = None;
            self.start_follow(id, minutes, false);
            return None;
        }
        let Some(zone) = p.zone.clone() else {
            return Some("ur not even on lol, hop on and ill come".into());
        };
        let meet = Some((
            p.name.clone(),
            Instant::now() + Duration::from_secs(300),
            minutes,
        ));
        let owner = if zone == "home" {
            if p.label == "at home" {
                Some(p.from.clone())
            } else {
                return Some("cant get into that house, meet u outside?".into());
            }
        } else {
            None
        };
        let same = zone == self.zone && (zone != "home" || self.visiting == owner);
        if same {
            // In town, out of sight: where they said, or have a look round for them.
            let to = self.place_tile(place, p.lot.as_ref());
            self.wrap_up();
            self.plan = None;
            self.meeting = meet;
            match to {
                Some(to) => {
                    self.doing = Doing::Walk {
                        to,
                        then: Want::Stroll,
                        since: Instant::now(),
                    };
                    None
                }
                None => {
                    self.doing = Doing::Stroll {
                        until: Instant::now() + Duration::from_secs(120),
                        next: Instant::now(),
                    };
                    Some("where abouts r u?".into())
                }
            }
        } else {
            self.wrap_up();
            self.plan = None;
            self.later = None;
            self.meeting = meet;
            // Walked there (out of here, across town, in by its door).
            self.go_in = Some(GoIn {
                zone,
                owner,
                lot: p.lot.clone(),
                since: Instant::now(),
                walked: None,
                leaving: false,
            });
            None
        }
    }

    /// Where in town a place is (the brain's word for it).
    fn place_tile(&mut self, place: &str, their_lot: Option<&String>) -> Option<TilePos> {
        match place {
            "park" => self.places.park_tiles.choose(&mut self.rng).copied(),
            "arena" => self.places.arena,
            "paintball" => self.places.yard,
            "bar" => self.places.bar_door,
            "fishing" => self.fish_spots.choose(&mut self.rng).map(|&(s, _)| s),
            "fountain" => self.places.fountain,
            "market" => self.places.market,
            "bandstand" => self.places.bandstand,
            "mall" | "arcade" | "casino" | "bowling" | "library" | "museum" => {
                self.places.doors.get(place).copied()
            }
            "their_house" => their_lot.and_then(|lot| {
                self.places
                    .houses
                    .iter()
                    .find(|h| &h.0 == lot)
                    .and_then(|h| h.2)
            }),
            "your_house" => self.my_door(),
            _ => None,
        }
    }

    /// Without a brain: a phone message, by rules (leave, come, go do…, else a short something).
    fn phone_rules(&mut self, p: &Phone, text: &str) -> Decision {
        let t = text.to_lowercase();
        let has = |w: &[&str]| w.iter().any(|x| t.contains(x));
        let mut d = Decision {
            reply: String::new(),
            action: "none".into(),
            activity: "none".into(),
            minutes: minutes_in(&t).unwrap_or(0.0),
            target: String::new(),
            remember: String::new(),
            place: "none".into(),
            item: String::new(),
        };
        for (k, place) in [
            ("park", "park"),
            ("skatepark", "park"),
            ("arena", "arena"),
            ("paintball", "paintball"),
            ("bar", "bar"),
            ("mug", "bar"),
            ("fish", "fishing"),
            ("lake", "fishing"),
            ("fountain", "fountain"),
            ("my house", "their_house"),
            ("my place", "their_house"),
            ("your house", "your_house"),
        ] {
            if t.contains(k) {
                d.place = place.into();
            }
        }
        if let Some(rest) = t.split("buy ").nth(1) {
            let (for_them, rest) = match rest.strip_prefix("me ") {
                Some(r) => (true, r),
                None => (false, rest),
            };
            d.action = "buy".into();
            d.item = rest
                .trim_start_matches("a ")
                .trim_start_matches("an ")
                .trim_start_matches("the ")
                .trim_end_matches(['?', '!', '.'])
                .trim()
                .to_string();
            if for_them {
                d.target = p.name.clone();
            }
            d.reply = self.pick(&["ok one sec", "sure", "bet"]);
            return d;
        }
        if has(&["leave", "quit", "stop", "get out", "come out"]) {
            d.action = "stop".into();
            d.reply = self.pick(&["ok ok leaving", "aight im out", "k, out"]);
        }
        if has(&[
            "come",
            "join me",
            "where are you",
            "where r u",
            "wya",
            "meet",
        ]) {
            d.action = "come_here".into();
            d.reply = self.pick(&["omw", "coming!", "ok be there in a sec"]);
        } else if let Some(w) = [
            "skate",
            "fish",
            "arena",
            "paintball",
            "pool",
            "lucky",
            "home",
        ]
        .into_iter()
        .find(|w| t.contains(w))
        .filter(|_| has(&["go ", "wanna", "lets", "let's", "?", "play"]))
        {
            d.action = "go_do".into();
            d.activity = w.into();
            d.reply = self.pick(&["ok sure", "bet", "ya ok"]);
        } else if d.action == "none" {
            let first = p.name.split_whitespace().next().unwrap_or("").to_string();
            d.reply = if has(&["hi", "hey", "yo", "sup"]) {
                format!("yo {first}, {}", self.busy_words())
            } else if has(&["wyd", "what are you doing", "what u doing"]) {
                self.busy_words()
            } else {
                self.pick(&["haha", "fr", "ya", "lol true", "ok"])
            };
        }
        d
    }

    /// Typed out: a moment to read, then about as long as it takes to type.
    fn type_out(&mut self, r: String) -> Instant {
        self.type_out_from(Instant::now(), r)
    }

    /// Typed at a quick typer's pace (some 6–7 letters a second, a moment to read
    /// first), counted from `from` (when they said it): thinking time included.
    fn type_out_from(&mut self, from: Instant, r: String) -> Instant {
        let r = casual(&r, &mut self.rng);
        // A beat to read it (now and then a longer one: looked away), then typed
        // at one steady pace, a fast typer's; the thinking counts as reading
        // time, but however long that took, the typing still shows (never
        // there the instant it's thought of).
        let mut read = self.rng.random_range(700..1600);
        if self.rng.random_bool(0.08) {
            read += self.rng.random_range(1200..2500);
        }
        let per_char = self.rng.random_range(85..125);
        let mut at = from + Duration::from_millis(read);
        let mut first = true;
        for line in split_chat(&r) {
            let typing = (per_char * line.len() as u64).clamp(600, 6000);
            at += Duration::from_millis(typing);
            // (A slow think: the last bit of typing still to come.)
            let soonest = Instant::now()
                + Duration::from_millis(if first {
                    self.rng.random_range(500..1100) + typing / 4
                } else {
                    300
                });
            at = at.max(soonest);
            first = false;
            self.say.push((at, line));
        }
        at
    }

    /// Off his board, if he's on it (before doing something else).
    fn step_off(&mut self) {
        let Doing::Skate(r) = &self.doing else {
            return;
        };
        let street = r.street;
        self.send.push((
            Instant::now(),
            ClientMsg::SkateOn {
                on: false,
                kit: KIT,
            },
        ));
        self.doing = Doing::Idle(Instant::now());
        if street {
            // (Off his board too: done on the streets.)
            let api = self.ctx.api.clone();
            let (bearer, http) = (self.ctx.bearer(), self.ctx.http.clone());
            self.riding = false;
            tokio::spawn(async move {
                let _ = http
                    .post(format!("{api}/api/me/ride"))
                    .header("authorization", bearer)
                    .json(&serde_json::json!({ "item": 0 }))
                    .send()
                    .await;
            });
        }
    }

    /// Skating: rolling between spots, carving, now and then an ollie with a trick (a combo landed).
    fn skate_step(&mut self, out: &mut Vec<ClientMsg>) {
        let now = Instant::now();
        let dt = 0.1;
        let Doing::Skate(r) = &mut self.doing else {
            return;
        };
        if now >= r.until {
            self.step_off();
            self.doing = Doing::Idle(now + Duration::from_secs(self.rng.random_range(2..6)));
            return;
        }
        if let Some(rider) = &mut r.rider
            && let Some(park) = &self.park
        {
            let mut happened = vec![];
            for o in rider.step(park, &self.world.grid, &mut self.rng) {
                match &o {
                    Out::Combo(p, l) if *p >= 400 || l.contains('+') => {
                        happened.push(format!("landed a {l} combo ({p} pts) in the skatepark"))
                    }
                    Out::Bail => happened.push(format!("bailed hard on {}", rider.at)),
                    _ => {}
                }
                out.push(match o {
                    Out::Combo(points, label) => ClientMsg::SkateScore {
                        kind: skate::score::COMBO,
                        points,
                        label,
                    },
                    Out::Bail => ClientMsg::SkateScore {
                        kind: skate::score::BAIL,
                        points: 0,
                        label: String::new(),
                    },
                });
            }
            let dir = ((rider.heading.rem_euclid(std::f64::consts::TAU) / std::f64::consts::TAU)
                * 65_536.0) as u32 as u16;
            let spin = ((rider.spin.rem_euclid(std::f64::consts::TAU) / std::f64::consts::TAU)
                * 65_536.0) as u32 as u16;
            out.push(ClientMsg::SkateMove {
                x: (rider.x / 32.0 * 100.0) as u16,
                y: (rider.y / 32.0 * 100.0) as u16,
                z: rider.z.clamp(0.0, 255.0) as u8,
                dir,
                pose: rider.pose,
                trick: rider.trick,
                spin,
                sent: (self.epoch.elapsed().as_millis() as u32 & 0xffff) as u16,
                kit: KIT,
            });
            self.me = ((rider.x / 32.0) as u16, (rider.y / 32.0) as u16);
            for h in happened {
                self.note(h);
            }
            return;
        }
        let tile = ((r.x / 32.0) as u16, (r.y / 32.0) as u16);
        if r.path.is_empty() {
            let goal = if r.street {
                crate::pick_target(&self.world.grid, &mut self.rng, tile, 24)
            } else {
                self.places.park_tiles.choose(&mut self.rng).copied()
            };
            if let Some(g) = goal {
                r.path = route(&self.world.grid, tile, g, 20_000).unwrap_or_default();
                if r.path.len() > 1 {
                    r.path.remove(0);
                }
            }
        }
        // Toward the next point on his line, carving round to it.
        if let Some(&next) = r.path.first() {
            let (tx, ty) = ((next.0 as f64 + 0.5) * 32.0, (next.1 as f64 + 0.5) * 32.0);
            let (dx, dy) = (tx - r.x, ty - r.y);
            // Got there, or gone past it (not round and round it).
            let ahead = dx * r.heading.cos() + dy * r.heading.sin();
            if dx.hypot(dy) < 24.0 || (dx.hypot(dy) < 64.0 && ahead < 0.0) {
                r.path.remove(0);
            }
            let want = dy.atan2(dx);
            let mut d = want - r.heading;
            while d > std::f64::consts::PI {
                d -= std::f64::consts::TAU;
            }
            while d < -std::f64::consts::PI {
                d += std::f64::consts::TAU;
            }
            r.heading += d.clamp(-5.0 * dt, 5.0 * dt);
            // A sharp turn: slowed right down to carve round it.
            let top = if d.abs() > 0.7 {
                110.0
            } else if r.street {
                330.0
            } else {
                270.0
            };
            r.speed += (top - r.speed).clamp(-200.0 * dt, 160.0 * dt);
        } else {
            r.speed = (r.speed - 120.0 * dt).max(0.0);
        }
        r.x += r.heading.cos() * r.speed * dt;
        r.y += r.heading.sin() * r.speed * dt;
        // Ollies: up, a trick, down, landed (a combo for everyone to see now and then).
        let mut pose = skate::pose::ROLL;
        if r.z <= 0.0 && r.speed > 150.0 && self.rng.random_bool(0.035) {
            r.vz = self.rng.random_range(170.0..230.0);
            r.trick = [0, 1, 2, 3, 5, 16]
                .choose(&mut self.rng)
                .copied()
                .unwrap_or(0);
            let name = match r.trick {
                1 => "Kickflip",
                2 => "Heelflip",
                3 => "Varial Flip",
                5 => "Shove-it",
                16 => "Indy Grab",
                _ => "Ollie",
            };
            r.tricks.push(name);
            r.combo += [100, 150, 200, 250, 300][self.rng.random_range(0..5)];
        }
        if r.z > 0.0 || r.vz > 0.0 {
            r.z += r.vz * dt;
            r.vz -= 700.0 * dt;
            pose = skate::pose::AIR;
            if r.z <= 0.0 {
                r.z = 0.0;
                r.vz = 0.0;
                r.trick = 0;
                // Landed: some lines get banked as a combo.
                if r.tricks.len() >= 2 || self.rng.random_bool(0.35) {
                    let label = r.tricks.join(" + ");
                    out.push(ClientMsg::SkateScore {
                        kind: skate::score::COMBO,
                        points: r.combo,
                        label,
                    });
                    r.tricks.clear();
                    r.combo = 0;
                }
            }
        }
        let dir = ((r.heading.rem_euclid(std::f64::consts::TAU) / std::f64::consts::TAU) * 65_536.0)
            as u32 as u16;
        out.push(ClientMsg::SkateMove {
            x: (r.x / 32.0 * 100.0) as u16,
            y: (r.y / 32.0 * 100.0) as u16,
            z: r.z.clamp(0.0, 255.0) as u8,
            dir,
            pose,
            trick: r.trick,
            spin: 0,
            sent: (self.epoch.elapsed().as_millis() as u32 & 0xffff) as u16,
            kit: KIT,
        });
        // Where he is now (the board, not the walk he took to get here).
        self.me = ((r.x / 32.0) as u16, (r.y / 32.0) as u16);
    }
}

/// Whether to run Davidd: one bot, signed in (dev).
pub fn wanted(bots: usize, api: &Option<String>) -> bool {
    bots == 1 && api.is_some()
}

/// Whether a message asks for something, agrees to something, or names
/// something to do or somewhere to be ("ye", "wanna bowl", "go fish", "the
/// park?"): what sends him off somewhere mid-chat. Not "yo not much wbu".
fn asks_or_agrees(text: &str) -> bool {
    let t = text.to_lowercase();
    if t.contains('?')
        && t.split_whitespace().count() <= 3
        && !t.contains("wbu")
        && !t.contains("hbu")
        && !t.contains("wyd")
        // ("nm u?", "and you?": that's asking back, not suggesting.)
        && !t.trim_end_matches('?').trim_end().ends_with(" u")
        && !t.trim_end_matches('?').trim_end().ends_with("you")
    {
        // ("bowling?", "the park?": a short question is a suggestion.)
        return true;
    }
    const WORDS: &[&str] = &[
        // Yes, and asking.
        "ye",
        "yes",
        "yea",
        "yeah",
        "yep",
        "yup",
        "ya",
        "sure",
        "ok",
        "okay",
        "k",
        "kk",
        "bet",
        "lets",
        "let's",
        "go",
        "down",
        "alright",
        "aight",
        "fine",
        "come",
        "wanna",
        "want",
        "can",
        "could",
        "should",
        "join",
        "pls",
        "please",
        "plz",
        "follow",
        "take",
        "deal",
        "omw",
        "sounds",
        "in",
        "why",
        "do",
        "play",
        "meet",
        "race",
        "show",
        "head",
        "leave",
        // Things to do, places to be.
        "skate",
        "skating",
        "skatepark",
        "park",
        "board",
        "fish",
        "fishing",
        "magnet",
        "bowl",
        "bowling",
        "pool",
        "arena",
        "fight",
        "paintball",
        "arcade",
        "chess",
        "casino",
        "slots",
        "jam",
        "music",
        "paint",
        "painting",
        "mall",
        "shop",
        "shopping",
        "library",
        "museum",
        "gallery",
        "crate",
        "crates",
        "lucky",
        "home",
        "house",
        "golf",
        "bar",
        "drink",
        "beach",
        "pond",
        "lake",
        "pitch",
        "football",
        "soccer",
        "fairground",
    ];
    t.split(|c: char| !c.is_alphanumeric() && c != '\'')
        .any(|w| WORDS.contains(&w))
}

/// The one thing to do a message names ("wanna go bowling?" → bowling), as the
/// brain's activities; None if it names none, or more than one.
fn names_activity(text: &str) -> Option<&'static str> {
    let t = text.to_lowercase();
    let mut found: Vec<&'static str> = vec![];
    for w in t.split(|c: char| !c.is_alphanumeric()) {
        let a = match w {
            "bowl" | "bowling" => "bowling",
            "skate" | "skating" | "skatepark" => "skate",
            "pool" | "billiards" => "pool",
            "arena" => "arena",
            "paintball" => "paintball",
            "arcade" => "arcade",
            "chess" => "chess",
            "casino" | "slots" | "roulette" => "casino",
            "jam" => "jam",
            "magnet" => "magnet_fishing",
            "fish" | "fishing" => "fish",
            _ => continue,
        };
        if !found.contains(&a) {
            found.push(a);
        }
    }
    // ("magnet fishing": the one thing.)
    if found.contains(&"magnet_fishing") {
        found.retain(|a| *a != "fish");
    }
    (found.len() == 1).then(|| found[0])
}

/// "for 10 min", "5 minutes", "half an hour", "a few mins": how long, in minutes.
fn minutes_in(t: &str) -> Option<f64> {
    if t.contains("half an hour") || t.contains("half hour") {
        return Some(30.0);
    }
    if t.contains("an hour") || t.contains("1 hour") {
        return Some(60.0);
    }
    let words: Vec<&str> = t
        .split(|c: char| !c.is_alphanumeric() && c != '.')
        .filter(|w| !w.is_empty())
        .collect();
    for (i, w) in words.iter().enumerate() {
        let next = words.get(i + 1).copied().unwrap_or("");
        let (num, unit) = match w.find(|c: char| c.is_alphabetic()) {
            Some(k) if k > 0 => (&w[..k], &w[k..]),
            _ => (*w, next),
        };
        let n = match num {
            "a" | "one" => Some(1.0),
            "few" | "couple" => Some(3.0),
            "two" => Some(2.0),
            "five" => Some(5.0),
            "ten" => Some(10.0),
            "fifteen" => Some(15.0),
            "twenty" => Some(20.0),
            _ => num.parse::<f64>().ok(),
        };
        if let Some(n) = n.filter(|n| *n > 0.0) {
            if unit.starts_with("min") || unit == "m" {
                return Some(n);
            }
            if unit.starts_with("sec") || unit == "s" {
                return Some(n / 60.0);
            }
            if unit.starts_with("h") {
                return Some(n * 60.0);
            }
        }
    }
    None
}

/// In test runs (`COMMONS_DAVIDD_STATUS` set): what he hears and says, to stdout.
fn trace(s: &str) {
    if std::env::var_os("COMMONS_DAVIDD_STATUS").is_some() {
        println!("davidd: {s}");
    }
}

/// A reply as chat lines: chat holds 140, so a long one goes as two or three
/// (split between sentences where it can be).
fn split_chat(r: &str) -> Vec<String> {
    r.split('\n').flat_map(split_long).collect()
}

/// One line, split if it's too long for the chat.
fn split_long(r: &str) -> Vec<String> {
    let mut out = vec![];
    let mut rest = r.trim();
    while rest.chars().count() > 130 && out.len() < 2 {
        let cut: String = rest.chars().take(130).collect();
        let at = cut
            .rfind(['.', '!', '?'])
            .map(|i| i + 1)
            .filter(|&i| i > 40)
            .or_else(|| cut.rfind(' '))
            .unwrap_or(cut.len());
        out.push(rest[..at].trim().to_string());
        rest = rest[at..].trim();
    }
    if !rest.is_empty() {
        out.push(rest.chars().take(140).collect());
    }
    out
}

/// A friend's id, by name (the friends list).
async fn friend_id(
    http: &reqwest::Client,
    social: &str,
    bearer: &str,
    name: &str,
) -> Option<String> {
    let v: serde_json::Value = http
        .get(format!("{social}/api/social/friends"))
        .header("authorization", bearer)
        .send()
        .await
        .ok()?
        .json()
        .await
        .ok()?;
    v["friends"].as_array()?.iter().find_map(|f| {
        f["name"]
            .as_str()
            .is_some_and(|n| n.eq_ignore_ascii_case(name))
            .then(|| f["id"].as_str().map(String::from))
            .flatten()
    })
}

/// A smiley on a 16×16 canvas: eyes, and a smile.
const SMILEY: [u16; 12] = [
    5 * 16 + 5,
    5 * 16 + 10,
    6 * 16 + 5,
    6 * 16 + 10,
    10 * 16 + 4,
    11 * 16 + 5,
    12 * 16 + 6,
    12 * 16 + 7,
    12 * 16 + 8,
    12 * 16 + 9,
    11 * 16 + 10,
    10 * 16 + 11,
];

/// A chess move from `legal`: a capture if there is one (the square it lands
/// on taken, by the position's `fen`), else any.
fn pick_move(fen: &str, legal: &[String], rng: &mut SmallRng) -> String {
    let board = fen.split(' ').next().unwrap_or("");
    let mut taken = std::collections::HashSet::new();
    for (r, row) in board.split('/').enumerate() {
        let mut f = 0u8;
        for c in row.chars() {
            if let Some(d) = c.to_digit(10) {
                f += d as u8;
            } else {
                taken.insert(format!("{}{}", (b'a' + f) as char, 8 - r));
                f += 1;
            }
        }
    }
    let captures: Vec<&String> = legal
        .iter()
        .filter(|m| m.len() >= 4 && taken.contains(&m[2..4]))
        .collect();
    captures
        .choose(rng)
        .copied()
        .or_else(|| legal.choose(rng))
        .cloned()
        .unwrap_or_default()
}

/// Every dry, walkable tile by water in town, with the water tile next to it: anywhere to fish from.
fn shore(map: &MapFile, grid: &Grid) -> Vec<(TilePos, TilePos)> {
    let Some(water) = map.ground_legend.iter().position(|n| n == "water") else {
        return vec![];
    };
    let is_water = |x: i32, y: i32| {
        x >= 0
            && y >= 0
            && (x as u16) < map.width
            && (y as u16) < map.height
            && map.ground[y as usize * map.width as usize + x as usize] as usize == water
    };
    let mut spots = vec![];
    for y in 0..map.height as i32 {
        for x in 0..map.width as i32 {
            if !grid.walkable_i(x, y) || is_water(x, y) {
                continue;
            }
            if let Some((wx, wy)) = [(0, 1), (0, -1), (1, 0), (-1, 0)]
                .iter()
                .map(|(dx, dy)| (x + dx, y + dy))
                .find(|&(wx, wy)| is_water(wx, wy))
            {
                spots.push(((x as u16, y as u16), (wx as u16, wy as u16)));
            }
        }
    }
    spots
}

/// As he types, fast: all lowercase, no apostrophes, commas, full stops and the
/// like (a question mark now and then), and now and then a slip of the finger.
fn casual(text: &str, rng: &mut SmallRng) -> String {
    // Short: a sentence or two (a long one cut at a pause), sometimes sent as
    // two quick lines.
    let mut said: Vec<String> = vec![];
    let mut rest = text.trim();
    while !rest.is_empty() {
        let end = rest
            .find(['.', '!', '?'])
            .map(|i| {
                i + rest[i..]
                    .chars()
                    .take_while(|c| ['.', '!', '?'].contains(c))
                    .count()
            })
            .unwrap_or(rest.len());
        let s = rest[..end].trim();
        rest = rest[end..].trim();
        if s.is_empty() {
            continue;
        }
        let so_far: usize = said.iter().map(|x| x.len()).sum();
        if !said.is_empty() && so_far + s.len() > 70 {
            break;
        }
        said.push(s.to_string());
    }
    if let Some(first) = said.first_mut()
        && first.chars().count() > 90
    {
        let cut: String = first.chars().take(80).collect();
        let at = cut
            .rfind([',', ';'])
            .filter(|&i| i > 20)
            .or_else(|| cut.rfind(' '));
        *first = cut[..at.unwrap_or(cut.len())].to_string();
    }
    let two_lines = said.len() == 2 && rng.random_bool(0.35);
    let lines: Vec<String> = said.iter().map(|s| casual_line(s, rng)).collect();
    lines.join(if two_lines { "\n" } else { " " })
}

/// Common phrases, the way they're typed fast (and how likely he is to).
const SHORT_PHRASES: &[(&str, &str, f64)] = &[
    ("i dont know", "idk", 0.9),
    ("i do not know", "idk", 0.9),
    ("dont know", "dunno", 0.6),
    ("i know right", "ikr", 0.9),
    ("what are you doing", "wyd", 0.8),
    ("what about you", "wbu", 0.85),
    ("how about you", "hbu", 0.85),
    ("to be honest", "tbh", 0.9),
    ("in my opinion", "imo", 0.9),
    ("oh my god", "omg", 0.9),
    ("by the way", "btw", 0.9),
    ("be right back", "brb", 1.0),
    ("on my way", "omw", 0.9),
    ("never mind", "nvm", 0.9),
    ("right now", "rn", 0.85),
    ("for real", "fr", 0.8),
    ("going to", "gonna", 0.9),
    ("want to", "wanna", 0.9),
    ("got to", "gotta", 0.9),
    ("have to", "gotta", 0.5),
    ("kind of", "kinda", 0.9),
    ("sort of", "sorta", 0.8),
    ("let me", "lemme", 0.6),
    ("give me", "gimme", 0.5),
    ("see you", "cya", 0.6),
    ("thank you", "ty", 0.8),
    ("you know", "yk", 0.4),
    ("you are", "ur", 0.8),
    ("i am", "im", 0.9),
    ("do not", "dont", 0.95),
    ("can not", "cant", 0.95),
    ("cannot", "cant", 0.95),
    ("will not", "wont", 0.95),
    ("it is", "its", 0.6),
    ("i will", "ill", 0.6),
    ("what is up", "sup", 0.8),
    ("whats up", "sup", 0.35),
];

/// Words, the way they're typed fast.
const SHORT_WORDS: &[(&str, &str, f64)] = &[
    ("you", "u", 0.85),
    ("your", "ur", 0.85),
    ("youre", "ur", 0.85),
    ("are", "r", 0.3),
    ("because", "cuz", 0.85),
    ("cause", "cuz", 0.7),
    ("probably", "prob", 0.75),
    ("though", "tho", 0.9),
    ("through", "thru", 0.6),
    ("okay", "ok", 0.9),
    ("people", "ppl", 0.7),
    ("please", "pls", 0.8),
    ("thanks", "thx", 0.5),
    ("really", "rly", 0.3),
    ("about", "abt", 0.35),
    ("something", "smth", 0.6),
    ("definitely", "def", 0.7),
    ("seriously", "srsly", 0.4),
    ("whatever", "wtv", 0.4),
    ("alright", "aight", 0.5),
    ("tonight", "tn", 0.3),
    ("tomorrow", "tmrw", 0.6),
    ("message", "msg", 0.6),
    ("before", "b4", 0.12),
    ("with", "w", 0.25),
    ("yeah", "ye", 0.2),
    ("nothing", "nothin", 0.3),
    ("going", "goin", 0.3),
    ("doing", "doin", 0.3),
    ("why", "y", 0.12),
];

/// One line as he types it: lowercase, no apostrophes, commas or full stops
/// (a question mark now and then), the usual shorthand, the odd slip.
fn casual_line(text: &str, rng: &mut SmallRng) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        match c {
            '\'' | '\u{2019}' | '\u{2018}' | '"' | '\u{201c}' | '\u{201d}' | '.' | ',' | ';'
            | ':' | '!' | '(' | ')' => {}
            '\u{2014}' | '\u{2013}' => out.push(' '),
            '?' => {
                if rng.random_bool(0.5) {
                    out.push('?');
                }
            }
            c => out.extend(c.to_lowercase()),
        }
    }
    let typed: Vec<&str> = out.split_whitespace().collect();
    let mut words: Vec<String> = vec![];
    let mut i = 0;
    'next: while i < typed.len() {
        for &(phrase, short, p) in SHORT_PHRASES {
            let n = phrase.split(' ').count();
            if i + n <= typed.len()
                && typed[i..i + n].iter().copied().eq(phrase.split(' '))
                && rng.random_bool(p)
            {
                words.push(short.to_string());
                i += n;
                continue 'next;
            }
        }
        let w = typed[i];
        let short = SHORT_WORDS
            .iter()
            .find(|(long, _, _)| *long == w)
            .filter(|(_, _, p)| rng.random_bool(*p))
            .map_or(w, |(_, s, _)| s);
        words.push(short.to_string());
        i += 1;
    }
    // The odd typo: two letters swapped, or one dropped, in a longer word.
    if rng.random_bool(0.15) {
        let long: Vec<usize> = (0..words.len())
            .filter(|&i| {
                words[i].chars().count() >= 5 && words[i].chars().all(|c| c.is_ascii_alphabetic())
            })
            .collect();
        if let Some(&i) = long.choose(rng) {
            let mut cs: Vec<char> = words[i].chars().collect();
            let k = rng.random_range(1..cs.len() - 1);
            if rng.random_bool(0.6) {
                cs.swap(k, k + 1);
            } else {
                cs.remove(k);
            }
            words[i] = cs.into_iter().collect();
        }
    }
    words.join(" ")
}

/// What he says he's off to do, if anything ("heading home", "gonna go skate",
/// "lets hit the arcade"): the brain's word for it.
fn says_going(reply: &str) -> Option<&'static str> {
    let r = reply.to_lowercase();
    let words: Vec<&str> = r
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty())
        .collect();
    const OFF: &[&str] = &[
        "heading", "headin", "going", "goin", "gonna", "omw", "otw", "lets", "imma", "finna", "hit",
    ];
    let at = words.iter().position(|w| OFF.contains(w))?;
    // (Not going, then.)
    if words[..at]
        .iter()
        .any(|w| ["not", "nah", "dont", "cant", "wont"].contains(w))
    {
        return None;
    }
    let after = words[at + 1..]
        .iter()
        .take(5)
        .copied()
        .collect::<Vec<_>>()
        .join(" ");
    const PLACES: &[(&str, &str)] = &[
        ("home", "home"),
        ("my place", "home"),
        ("my house", "home"),
        ("my crib", "home"),
        ("magnet", "magnet_fishing"),
        ("fish", "fish"),
        ("skate", "skate"),
        ("skating", "skate"),
        ("park", "skate"),
        ("bowl", "bowling"),
        ("pool", "pool"),
        ("arcade", "arcade"),
        ("arena", "arena"),
        ("paintball", "paintball"),
        ("casino", "casino"),
        ("chess", "chess"),
        ("bandstand", "jam"),
        ("jam", "jam"),
        ("paint", "paint"),
        ("mall", "mall"),
        ("library", "library"),
        ("museum", "museum"),
    ];
    PLACES
        .iter()
        .find(|(k, _)| after.split(' ').any(|w| w.starts_with(k)) || after.contains(k))
        .map(|&(_, w)| w)
}

/// Whether he's saying he's following them ("following u", "right behind u").
fn says_following(reply: &str) -> bool {
    let r = reply.to_lowercase();
    [
        "following",
        "followin",
        "ill follow",
        "right behind",
        "behind u",
        "behind you",
        "lead the way",
        "after u",
        "after you",
    ]
    .iter()
    .any(|p| r.contains(p))
}

/// Whether he's saying he's staying put ("im still here", "ill wait", "not going anywhere").
fn says_staying(reply: &str) -> bool {
    let r = reply.to_lowercase().replace(['\'', '\u{2019}'], "");
    [
        "still here",
        "im here",
        "right here",
        "ill wait",
        "i wait",
        "waiting for u",
        "waiting for you",
        "not going anywhere",
        "not goin anywhere",
        "ill stay",
        "im staying",
        "staying here",
        "ill chill here",
        "chillin here",
    ]
    .iter()
    .any(|p| r.contains(p))
}

/// Whether he's saying he's coming over ("omw", "on my way", "coming"…).
fn says_coming(reply: &str) -> bool {
    let r = reply.to_lowercase();
    let words: Vec<&str> = r.split(|c: char| !c.is_alphanumeric()).collect();
    ["omw", "otw", "coming", "comin", "brt"]
        .iter()
        .any(|w| words.contains(w))
        || [
            "on my way",
            "be right there",
            "heading over",
            "headin over",
            "heading to u",
            "heading to you",
        ]
        .iter()
        .any(|p| r.contains(p))
}

/// A garden pond's tiles, from its top left (two by two).
fn pond_tiles(t: TilePos) -> [TilePos; 4] {
    [t, (t.0 + 1, t.1), (t.0, t.1 + 1), (t.0 + 1, t.1 + 1)]
}

/// Things to do with a friend when it goes quiet (each with the action that does it).
const IDEAS: &[&str] = &[
    "challenge them to rock paper scissors (rock_paper_scissors)",
    "go for a high five (high_five)",
    "drag them into a dance (dance_with)",
    "race them to the fountain (go_to fountain) and trash talk about it",
    "show them your house, or the pond out front (invite_home, or go_to your_house)",
    "send up a sky lantern with a dumb message (sky_lantern)",
    "buy them something small and cheap as a surprise (buy, them as target)",
    "ask what they think of your fit, or roast theirs a little",
    "challenge them to chess in the park (go_do chess with them)",
    "suggest a round at the arcade (go_do arcade with them)",
    "suggest bowling (go_do bowling with them)",
    "suggest a jam at the bandstand (go_do jam)",
    "ask them about something you remember about them",
    "suggest a drink at the Mossy Mug and a game of pool (go_do pool with them)",
    "tell a quick made up story about something that happened to you in town",
    "ask a would you rather",
    "wander over to the market cart and see whats there (go_to market)",
    "sit on a bench for a bit (sit)",
];

/// Somewhere with someone, and there first: who he's waiting for, what he'll do
/// once they're there (or he's waited long enough), and when he next says "u coming?".
struct Waiting {
    who: u32,
    then: Want,
    since: Instant,
    nag_at: Instant,
    nags: u8,
}

/// Going in somewhere: the zone (and whose home, and its lot), and how far along.
struct GoIn {
    zone: String,
    owner: Option<String>,
    lot: Option<String>,
    since: Instant,
    walked: Option<Instant>,
    /// Out of the building he was in, on the way.
    leaving: bool,
}

/// Buying in the mall: what, for whom, and the counter he's walking to.
struct ShopTrip {
    good: Good,
    for_name: Option<String>,
    for_id: Option<String>,
    asker: Asker,
    to: TilePos,
    since: Instant,
    walked: Option<Instant>,
}

/// A pond going out in his front yard: the spots to try (the next one if the
/// server says no), and how far along.
struct YardJob {
    item: i32,
    /// Someone asked: he goes now (out of wherever he is).
    asked: bool,
    leaving: bool,
    spots: Vec<TilePos>,
    next: usize,
    since: Instant,
    walked: Option<Instant>,
    sent: Option<Instant>,
    failed: bool,
}

impl YardJob {
    fn new(item: i32, asked: bool) -> YardJob {
        YardJob {
            item,
            asked,
            leaving: false,
            spots: vec![],
            next: 0,
            since: Instant::now(),
            walked: None,
            sent: None,
            failed: false,
        }
    }
}

/// The time of day, as he'd put it (the machine's clock: the game's day and night follow it).
fn time_of_day() -> &'static str {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_secs());
    // (Near enough local: Central Europe, where the game's played.)
    let hour = ((secs / 3600) + 1) % 24;
    match hour {
        5..=11 => "morning",
        12..=16 => "afternoon",
        17..=21 => "evening",
        _ => "late at night",
    }
}

/// What he says to Slovenian (he doesn't speak it).
const NO_SLO: &[&str] = &[
    "english?",
    "english pls",
    "i dont speak slo lol",
    "bro i dont speak slovenian",
    "no clue what that means lol english?",
    "uhh english?",
    "cant read that sry english",
    "idk slo man",
];

/// Whether it's Slovenian (slang and no-caron spellings too): its letters, or a word
/// only Slovenian has, or mostly little words that are.
fn slovenian(text: &str) -> bool {
    const SURE: &[&str] = &[
        "kaj", "kva", "kej", "zakaj", "zakva", "zdej", "zdaj", "sej", "glih", "dej", "pejt",
        "pojdi", "lej", "gremo", "greva", "bom", "bos", "nevem", "vem", "ves", "hvala", "prosim",
        "zivjo", "zivijo", "kje", "kok", "koliko", "ful", "jst", "jaz", "tud", "tudi", "nism",
        "nisem", "imam", "nimam", "lahko", "lahk", "mogoce", "zihr", "zih", "itak", "valda",
        "ajde", "dobr", "dober", "dobro", "jutro", "jutri", "danes", "potem", "kdo", "kdaj",
        "kako", "kaksn", "kaksen", "tko", "mislim", "mislis", "delas", "pizda", "jebemti",
        "jebiga", "kurba", "adijo", "smo", "nic", "kurac", "zjebi", "bejz", "kuga",
    ];
    const LITTLE: &[&str] = &[
        "ma", "pa", "je", "se", "si", "da", "ne", "ja", "ti", "na", "za", "bo", "mi", "js", "sm",
        "mam", "tak", "pol", "sam", "ni", "sem", "ste", "kam", "cao", "res", "mal", "kr", "ker",
        "kul", "lp", "al", "zj", "bl", "mau",
    ];
    let t = text.to_lowercase();
    if t.contains(['č', 'š', 'ž']) {
        return true;
    }
    let words: Vec<&str> = t
        .split(|c: char| !c.is_alphabetic())
        .filter(|w| !w.is_empty() && !w.starts_with("dav"))
        .collect();
    if words.iter().any(|w| SURE.contains(w)) {
        return true;
    }
    let little = words.iter().filter(|w| LITTLE.contains(w)).count();
    little >= 2 && little * 2 >= words.len()
}

#[cfg(test)]
mod tests {
    use super::{SmallRng, casual, minutes_in, says_going, slovenian};
    use rand::SeedableRng;

    #[test]
    fn what_they_asked_to_do() {
        assert_eq!(
            super::names_activity("wanna go bowling together?"),
            Some("bowling")
        );
        assert_eq!(
            super::names_activity("magnet fishing?"),
            Some("magnet_fishing")
        );
        assert_eq!(super::names_activity("skate or fish"), None);
        assert_eq!(super::names_activity("yo whats up"), None);
    }

    #[test]
    fn only_off_when_asked_or_agreed() {
        for t in [
            "ye sure",
            "wanna go bowling?",
            "go fish",
            "the park?",
            "bet lets go",
            "come skate w me",
        ] {
            assert!(super::asks_or_agrees(t), "{t}");
        }
        for t in [
            "yo not much wbu",
            "lol fair",
            "nice, been skating lately",
            "hey davidd",
            "nm u?",
        ] {
            let off = super::asks_or_agrees(t);
            // ("been skating lately" names skating: a fair reading either way, so only the rest.)
            if !t.contains("skating") {
                assert!(!off, "{t}");
            }
        }
    }

    #[test]
    fn types_like_a_fast_typer() {
        let mut rng = SmallRng::seed_from_u64(3);
        for _ in 0..50 {
            let t = super::casual("Yeah, I'm down. Let's GO — it's fine!", &mut rng);
            assert!(
                !t.chars().any(|c| c.is_uppercase() || "'.,!’".contains(c)),
                "{t}"
            );
            assert!(t.starts_with("ye"), "{t}");
        }
    }

    #[test]
    fn how_long() {
        assert_eq!(minutes_in("fish with me for 10 min"), Some(10.0));
        assert_eq!(minutes_in("hang out for 5mins?"), Some(5.0));
        assert_eq!(minutes_in("skate with me for half an hour"), Some(30.0));
        assert_eq!(minutes_in("just a few minutes"), Some(3.0));
        assert_eq!(minutes_in("lets go skate"), None);
        assert_eq!(minutes_in("i have 2 dogs"), None);
    }

    #[test]
    fn does_what_he_says_hes_off_to() {
        for (said, w) in [
            ("k im heading home", Some("home")),
            ("bet gonna go skate", Some("skate")),
            ("lets hit the arcade", Some("arcade")),
            ("omw to fishing", Some("fish")),
            ("going bowling rn", Some("bowling")),
            ("im going to paintball", Some("paintball")),
            ("nah not going home yet", None),
            ("lol same", None),
        ] {
            assert_eq!(says_going(said), w, "{said}");
        }
    }

    #[test]
    fn types_like_people_do() {
        let mut rng = SmallRng::seed_from_u64(7);
        let long = "I don't know, to be honest. Are you going to the park right now? Because I want to skate there and I really think it would be fun if you came along with all of the people.";
        let out = casual(long, &mut rng);
        assert!(out.len() < 90, "{out}");
        assert!(!out.contains("don"), "{out}");
    }

    #[test]
    fn knows_slovenian_when_he_sees_it() {
        for t in [
            "kaj delaš",
            "davidd kva delas",
            "zdej grem",
            "ja ne vem",
            "ma ja",
            "ful dobr",
            "a greš skejtat",
            "hvala bro",
            "js sm tu",
            "sej res",
        ] {
            assert!(slovenian(t), "{t}");
        }
        for t in [
            "yo davidd whats up",
            "wanna skate",
            "ok cool im gonna go skate for a bit",
            "lol same",
            "ja bro",
            "in a sec",
            "gg",
            "ne way",
            "is that a sam thing",
            "have u been to the mall",
        ] {
            assert!(!slovenian(t), "{t}");
        }
    }
}
