//! Pets (ADR 0011, M5). Adopted at the mall's Pets shop, or made to order at
//! the Breeder, by someone with a house, one each. A pet lives inside its
//! owner's house; taking it out for a walk, it walks with you everywhere
//! (the zone draws it at your heels, for everyone); bringing it home after
//! at least `COMMONS_PET_WALK_SECS` counts as the day's walk. Moving house
//! takes the pet along (where it lives is wherever its owner's house is).
//!
//! A pet has needs: `food` and `joy` (0–100) run down by the hour, and a pet
//! low on either is sad. Meals (a few coins) fill it up; its minigames, a
//! walk and a cuddle cheer it up (the day's first few games pay a few coins).
//!
//! The Breeder makes a pet to your design: species, breed, coat, pattern,
//! eyes and something to wear (`design_ok`), and restyles one you have.
//!
//! `GET /api/pets` (every pet in the city), `POST /api/me/pet/walk`,
//! `/me/pet/feed`, `/me/pet/play`, `/me/pet/breed`, `/me/pet/restyle`,
//! `/me/pet/rehome` (up for adoption at the Pets shop: room for another).

use crate::AppState;
use crate::economy::{Applied, COIN, EconError, Op, apply, bearer_player};
use crate::error::{ApiError, ApiResult};
use crate::store::db_err;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::routing::{get, post};
use axum::{Json, Router};
use commons_common::config;
use commons_common::filter::clean_chat;
use serde::{Deserialize, Serialize};
use sqlx::PgConnection;
use std::sync::Arc;
use uuid::Uuid;

type S = State<Arc<AppState>>;

/// A walk this long or longer counts as the day's walk.
const DEFAULT_WALK_SECS: i64 = 180;
/// A pet left out longer than this (its walker went away) is home again.
pub const OUT_HOURS: i32 = 3;
/// How fast a pet gets hungry, and bored (points an hour, of 100): a full
/// pet is peckish in half a day and starving by the next.
const FOOD_PER_HOUR: f32 = 4.0;
const JOY_PER_HOUR: f32 = 3.0;
/// Below this in either, a pet is sad.
pub const SAD_BELOW: f32 = 30.0;
/// The Breeder's prices: a pet to order, and a new look for yours.
pub const BREED_PRICE: i32 = 350;
pub const RESTYLE_PRICE: i32 = 120;
/// The item a Breeder pet is (its look is its `design`).
const BRED_ITEM: i32 = 608;
/// Minigames a day that pay out coins, and the most one pays.
const PAID_PLAYS: i32 = 5;
const MAX_PLAY_COINS: i32 = 12;
/// A cuddle cheers a pet up, but only so far, and not every second.
/// Care (a cuddle, a brush, a bath) counts again only after this long.
const CUDDLE_SECS: f64 = 60.0;

/// Levels: 1 to 100, from experience (`xp`) for everything done together.
pub const MAX_LEVEL: i32 = 100;

/// The experience a pet needs to reach `level` (the client's `pets.ts`
/// has the same curve): a few days to the teens, months to 100.
pub fn xp_for(level: i32) -> i32 {
    let l = level.clamp(1, MAX_LEVEL) - 1;
    (8.0 * (l as f64).powf(1.7)).round() as i32
}

/// A pet's level from its experience.
pub fn level_of(xp: i32) -> i32 {
    let mut l = 1;
    while l < MAX_LEVEL && xp >= xp_for(l + 1) {
        l += 1;
    }
    l
}

/// Tricks a pet learns as it grows (the level each comes at): its walker
/// asks and everyone nearby sees (`emote::PET_TRICKS`, in this order).
pub const TRICKS: [(&str, i32); 10] = [
    ("sit", 1),
    ("spin", 3),
    ("beg", 6),
    ("roll", 10),
    ("highfive", 15),
    ("playdead", 22),
    ("dance", 30),
    ("backflip", 45),
    ("zoomies", 60),
    ("bow", 80),
];
/// A trick counts again (joy, experience) only after this long.
const TRICK_SECS: f64 = 8.0;

/// The skills' bits (as `commons_protocol::pet_skill`, which the zone goes by).
pub mod pet_skill {
    pub const FISH: u32 = 1 << 0;
    pub const MAGNET: u32 = 1 << 1;
    pub const TREASURE: u32 = 1 << 2;
    pub const DIG: u32 = 1 << 3;
    pub const FRIEND: u32 = 1 << 4;
    pub const HOME: u32 = 1 << 5;
    pub const FISH2: u32 = 1 << 6;
    pub const FISH3: u32 = 1 << 7;
}

/// The skill tree (`pet_skill`): each skill's name, its
/// bit, and the one it grows from (learnt first), if any. The client's
/// `pets.ts` has the same.
pub const SKILLS: [(&str, u32, u32); 8] = [
    ("fish", pet_skill::FISH, 0),
    // (The fishing buddy's tiers: what it can bring up, rare, then epic, then legendary.)
    ("fish2", pet_skill::FISH2, pet_skill::FISH),
    ("fish3", pet_skill::FISH3, pet_skill::FISH2),
    ("magnet", pet_skill::MAGNET, pet_skill::FISH),
    ("treasure", pet_skill::TREASURE, 0),
    ("dig", pet_skill::DIG, pet_skill::TREASURE),
    ("friend", pet_skill::FRIEND, 0),
    ("home", pet_skill::HOME, pet_skill::FRIEND),
];
/// A skill point at each of these levels (the first straight away).
pub const SKILL_LEVELS: [i32; 8] = [1, 8, 18, 30, 40, 50, 75, 90];

/// Skill points a pet at `level` has had in all.
pub fn skill_points(level: i32) -> i32 {
    SKILL_LEVELS.iter().filter(|&&l| level >= l).count() as i32
}
/// Things to do for a pet (no coins): how much happier it gets, up to how
/// happy, and the experience. They share a cooldown (`cuddled_at`).
const CARE: [(&str, f32, f32, i32); 3] = [
    ("cuddle", 6.0, 75.0, 3),
    ("brush", 8.0, 85.0, 4),
    ("bath", 10.0, 90.0, 5),
];
/// A playdate with another walker's pet counts once in a while.
const PLAYDATE_SECS: f64 = 300.0;

fn walk_secs() -> i64 {
    config::env_or("COMMONS_PET_WALK_SECS", DEFAULT_WALK_SECS).max(0)
}

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/pets", get(list))
        .route("/me/pet/walk", post(walk))
        .route("/me/pet/feed", post(feed))
        .route("/me/pet/play", post(play))
        .route("/me/pet/breed", post(breed))
        .route("/me/pet/restyle", post(restyle))
        .route("/me/pet/rehome", post(rehome))
        .route("/me/pet/trick", post(trick))
        .route("/me/pet/skill", post(learn))
        .route("/me/pet/friends", get(friends))
}

/// Is this item a pet to adopt?
pub fn is_pet(kind: &str) -> bool {
    kind == "pet"
}

fn conflict(code: &'static str, msg: &str) -> ApiError {
    ApiError::new(StatusCode::CONFLICT, code, msg)
}

/// A pet's name: 2 to 16 letters, spaces, - or '.
pub fn clean_name(raw: &str) -> ApiResult<String> {
    let name = raw.trim().to_string();
    let bad = |m: &str| Err(ApiError::bad_request("invalid_name", m));
    if !(2..=16).contains(&name.chars().count()) {
        return bad("A pet's name is 2 to 16 letters.");
    }
    if !name
        .chars()
        .all(|c| c.is_alphabetic() || c == ' ' || c == '-' || c == '\'')
        || name.contains("  ")
    {
        return bad("Use letters, spaces, - and '.");
    }
    if clean_chat(&name).as_deref() != Some(name.as_str()) {
        return bad("Please pick a different name.");
    }
    Ok(name)
}

/// A Breeder design (the client's `world/petlook.ts` has the same layout):
/// bits 0–3 species (1 dog, 2 cat, 3 bunny, 4 duck, 5 hedgehog), 4–6 breed,
/// 7–10 coat colour, 11–13 pattern, 14–17 pattern colour, 18–20 eyes, 21–24
/// accessory, 25–27 its colour, and bit 30 set (a design, not an old coat
/// code). Bits 28–29 are the pet's mood, set only on the wire.
pub const DESIGN_FLAG: u32 = 1 << 30;
/// Breeds by species (index = species).
const BREEDS: [u32; 6] = [0, 6, 4, 4, 3, 2];
/// Accessories (0 none).
const ACCESSORIES: u32 = 13;
/// The mood bits on the wire: sad.
pub const MOOD_SAD: u32 = 1 << 28;
/// On the wire too: level 50 and up (a sparkle), and level 100 (a golden glow).
pub const LEVEL_STAR: u32 = 1 << 29;
pub const LEVEL_GOLD: u32 = 1 << 31;

/// Whether `d` is a design the Breeder can make.
pub fn design_ok(d: i64) -> bool {
    let Ok(d) = u32::try_from(d) else {
        return false;
    };
    let species = d & 0xf;
    d & DESIGN_FLAG != 0
        && d & !(DESIGN_FLAG | 0x0fff_ffff) == 0
        && (1..=5).contains(&species)
        && (d >> 4) & 7 < BREEDS[species as usize]
        && (d >> 21) & 0xf < ACCESSORIES
}

/// A pet's species from its code (a design or an old coat code).
pub fn species_of(code: u32) -> u32 {
    if code & DESIGN_FLAG != 0 {
        code & 0xf
    } else {
        code & 0xff
    }
}

/// Adopts the pet `item` (bought at the Pets shop, in the purchase's
/// transaction): you need a house, and no pet yet. `design`: a Breeder's.
pub async fn adopt(conn: &mut PgConnection, player: Uuid, item: i32, name: &str) -> ApiResult<()> {
    adopt_as(conn, player, item, name, None).await
}

async fn adopt_as(
    conn: &mut PgConnection,
    player: Uuid,
    item: i32,
    name: &str,
    design: Option<i32>,
) -> ApiResult<()> {
    if !has_house(conn, player).await? {
        return Err(conflict(
            "no_house",
            "A pet needs a home: rent a house first (ask at the Post Office).",
        ));
    }
    let added = sqlx::query(
        "INSERT INTO pets (owner, item_id, name, design) VALUES ($1, $2, $3, $4) ON CONFLICT (owner) DO NOTHING",
    )
    .bind(player)
    .bind(item)
    .bind(name)
    .bind(design)
    .execute(&mut *conn)
    .await
    .map_err(db_err)?
    .rows_affected();
    if added == 0 {
        return Err(conflict(
            "have_pet",
            "You have a pet already: one is plenty of love.",
        ));
    }
    Ok(())
}

async fn has_house(conn: &mut PgConnection, player: Uuid) -> ApiResult<bool> {
    sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM leases WHERE player_id = $1 AND kind = 'home' AND state <> 'ended')",
    )
    .bind(player)
    .fetch_one(&mut *conn)
    .await
    .map_err(db_err)
}

#[derive(Serialize, sqlx::FromRow)]
struct PetRow {
    owner: Uuid,
    owner_name: String,
    name: String,
    item: i32,
    /// How it looks: its Breeder design, or its item's code.
    code: i32,
    /// The house it lives at (none: its owner has no house just now).
    plot: Option<String>,
    /// Out on a walk.
    out: bool,
    walked_today: bool,
    walks: i32,
    /// Now (0–100): fed, and happy.
    food: f32,
    joy: f32,
    plays: i32,
    /// Experience (its level: `level_of`).
    xp: i32,
    /// The skills it's learnt (`SKILLS`' bits).
    skills: i32,
}

/// `food` and `joy` now: as they were, less the hours since.
fn needs_now(alias: &str) -> String {
    format!(
        "GREATEST(0, {a}.food - {FOOD_PER_HOUR} * EXTRACT(EPOCH FROM now() - {a}.needs_at)::real / 3600)::real AS food,
         GREATEST(0, {a}.joy - {JOY_PER_HOUR} * EXTRACT(EPOCH FROM now() - {a}.needs_at)::real / 3600)::real AS joy",
        a = alias
    )
}

fn pet_rows() -> String {
    format!(
        "SELECT p.owner, pl.display_name AS owner_name, p.name, p.item_id AS item,
                COALESCE(p.design, (i.meta->>'code')::int, 0) AS code,
                l.plot,
                (p.out_since IS NOT NULL AND p.out_since > now() - make_interval(hours => $1)) AS out,
                (p.last_walk IS NOT NULL AND p.last_walk >= (now() AT TIME ZONE 'utc')::date) AS walked_today,
                p.walks, {}, p.plays, p.xp, p.skills
         FROM pets p
         JOIN players pl ON pl.id = p.owner
         JOIN items i ON i.id = p.item_id
         LEFT JOIN leases l ON l.player_id = p.owner AND l.kind = 'home' AND l.state <> 'ended'",
        needs_now("p")
    )
}

async fn one(conn: &mut PgConnection, player: Uuid) -> ApiResult<Option<PetRow>> {
    sqlx::query_as(&format!("{} WHERE p.owner = $2", pet_rows()))
        .bind(OUT_HOURS)
        .bind(player)
        .fetch_optional(&mut *conn)
        .await
        .map_err(db_err)
}

/// Every pet: where it lives, whether it's out, whether it's had its walk.
async fn list(State(state): S) -> ApiResult<Json<serde_json::Value>> {
    let rows: Vec<PetRow> = sqlx::query_as(&format!("{} ORDER BY p.adopted_at", pet_rows()))
        .bind(OUT_HOURS)
        .fetch_all(&state.db)
        .await
        .map_err(db_err)?;
    Ok(Json(serde_json::json!({
        "pets": rows,
        "walk_secs": walk_secs(),
        "sad_below": SAD_BELOW,
        "breed_price": BREED_PRICE,
        "restyle_price": RESTYLE_PRICE,
    })))
}

/// Your pet's needs as they stand (locking it for the update): food, joy.
async fn settle(conn: &mut PgConnection, player: Uuid) -> ApiResult<(f32, f32)> {
    let now: Option<(f32, f32)> = sqlx::query_as(&format!(
        "SELECT {} FROM pets p WHERE p.owner = $1 FOR UPDATE",
        needs_now("p")
    ))
    .bind(player)
    .fetch_optional(&mut *conn)
    .await
    .map_err(db_err)?;
    now.ok_or_else(|| conflict("no_pet", "You don't have a pet yet."))
}

/// Writes your pet's needs as they are now.
async fn store_needs(conn: &mut PgConnection, player: Uuid, food: f32, joy: f32) -> ApiResult<()> {
    sqlx::query("UPDATE pets SET food = $2, joy = $3, needs_at = now() WHERE owner = $1")
        .bind(player)
        .bind(food.clamp(0.0, 100.0))
        .bind(joy.clamp(0.0, 100.0))
        .execute(&mut *conn)
        .await
        .map_err(db_err)?;
    Ok(())
}

/// Adds experience: the new level, if it went up.
async fn gain(conn: &mut PgConnection, player: Uuid, xp: i32) -> ApiResult<Option<i32>> {
    if xp <= 0 {
        return Ok(None);
    }
    let now: Option<i32> =
        sqlx::query_scalar("UPDATE pets SET xp = LEAST(xp + $2, $3) WHERE owner = $1 RETURNING xp")
            .bind(player)
            .bind(xp)
            .bind(xp_for(MAX_LEVEL))
            .fetch_optional(&mut *conn)
            .await
            .map_err(db_err)?;
    Ok(now.and_then(|n| {
        let (before, after) = (level_of(n - xp), level_of(n));
        (after > before).then_some(after)
    }))
}

#[derive(Deserialize)]
struct WalkReq {
    out: bool,
}

/// Takes your pet out, or brings it home. Home after a long enough walk:
/// that's today's walk (once a day), and a happy pet (if a hungry one).
async fn walk(
    State(state): S,
    headers: HeaderMap,
    Json(req): Json<WalkReq>,
) -> ApiResult<Json<serde_json::Value>> {
    let player = bearer_player(&state, &headers)?;
    let mut tx = state.db.begin().await.map_err(db_err)?;
    // Out now (and since when), and whether today's walk is still to come.
    let now: Option<(bool, bool, bool)> = sqlx::query_as(
        "SELECT out_since IS NOT NULL AND out_since > now() - make_interval(hours => $2)
                AND out_since <= now() - make_interval(secs => $3),
                last_walk IS NULL OR last_walk < (now() AT TIME ZONE 'utc')::date,
                out_since IS NOT NULL AND out_since > now() - make_interval(hours => $2)
         FROM pets WHERE owner = $1 FOR UPDATE",
    )
    .bind(player)
    .bind(OUT_HOURS)
    .bind(walk_secs() as f64)
    .fetch_optional(&mut *tx)
    .await
    .map_err(db_err)?;
    let Some((long_enough, due, was_out)) = now else {
        return Err(conflict("no_pet", "You don't have a pet yet."));
    };
    let walked = !req.out && long_enough && due;
    let mut level_up = None;
    if req.out {
        // Already out (and not forgotten): the walk keeps going.
        sqlx::query(
            "UPDATE pets SET out_since = now() WHERE owner = $1
             AND (out_since IS NULL OR out_since <= now() - make_interval(hours => $2))",
        )
        .bind(player)
        .bind(OUT_HOURS)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    } else {
        // A walk is the best thing: a proper one cheers it right up (and
        // works up an appetite); a short one, a little.
        if was_out {
            let (food, joy) = settle(&mut tx, player).await?;
            let (dfood, djoy) = if long_enough {
                (-8.0, 30.0)
            } else {
                (0.0, 6.0)
            };
            store_needs(&mut tx, player, food + dfood, joy + djoy).await?;
            level_up = gain(&mut tx, player, if long_enough { 40 } else { 6 }).await?;
        }
        sqlx::query(
            "UPDATE pets SET out_since = NULL,
                 walks = walks + $2::int,
                 last_walk = CASE WHEN $3 THEN (now() AT TIME ZONE 'utc')::date ELSE last_walk END
             WHERE owner = $1",
        )
        .bind(player)
        .bind(walked as i32)
        .bind(walked)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    }
    let pet = one(&mut tx, player).await?;
    tx.commit().await.map_err(db_err)?;
    Ok(Json(
        serde_json::json!({ "pet": pet, "walked": walked, "level_up": level_up }),
    ))
}

/// What a pet can be fed: (key, coins, food, joy).
const MEALS: [(&str, i32, f32, f32); 3] = [
    // A handful of kibble (seed, greens: whatever it eats).
    ("snack", 3, 25.0, 0.0),
    // A proper bowlful.
    ("meal", 8, 60.0, 5.0),
    // Its very favourite thing.
    ("treat", 15, 20.0, 25.0),
];

#[derive(Deserialize)]
struct FeedReq {
    meal: String,
    /// Client-generated idempotency key (one per press).
    key: String,
}

/// Feeds your pet (for a few coins): fuller, and a treat makes it happy.
async fn feed(
    State(state): S,
    headers: HeaderMap,
    Json(req): Json<FeedReq>,
) -> ApiResult<Json<serde_json::Value>> {
    let player = bearer_player(&state, &headers)?;
    let &(_, price, dfood, djoy) = MEALS
        .iter()
        .find(|m| m.0 == req.meal)
        .ok_or_else(|| ApiError::bad_request("bad_meal", "That's not on the menu."))?;
    if req.key.is_empty() || req.key.len() > 80 {
        return Err(ApiError::bad_request("bad_request", "Invalid request."));
    }
    let mut tx = state.db.begin().await.map_err(db_err)?;
    let (food, joy) = settle(&mut tx, player).await?;
    if food >= 97.0 && djoy == 0.0 {
        return Err(conflict("full", "They're full! Maybe a game instead?"));
    }
    if food >= 97.0 && joy >= 97.0 {
        return Err(conflict("full", "They couldn't eat another bite."));
    }
    let ops = [Op {
        item: COIN,
        delta: -price,
    }];
    let applied = pay(
        &mut tx,
        &state,
        player,
        &ops,
        "pet_food",
        &format!("petfeed:{player}:{}", req.key),
    )
    .await?;
    let mut level_up = None;
    if !applied.duplicate {
        store_needs(&mut tx, player, food + dfood, joy + djoy).await?;
        level_up = gain(&mut tx, player, (price / 2).max(3)).await?;
    }
    let pet = one(&mut tx, player).await?;
    tx.commit().await.map_err(db_err)?;
    Ok(Json(
        serde_json::json!({ "pet": pet, "applied": applied, "level_up": level_up }),
    ))
}

/// The pet minigames (`ui/petgames.ts`) and what a point is worth in coins
/// (score ÷ this), and a cuddle.
const GAMES: [(&str, u32); 9] = [
    ("fetch", 40),
    ("laser", 25),
    ("hop", 30),
    ("splash", 20),
    ("roll", 25),
    // Care (`CARE`) and a playdate: no score.
    ("cuddle", 0),
    ("brush", 0),
    ("bath", 0),
    ("playdate", 0),
];

#[derive(Deserialize)]
struct PlayReq {
    game: String,
    #[serde(default)]
    score: u32,
    key: String,
}

/// A game with your pet (or a cuddle): it cheers up (more for a better
/// game), gets a little peckish, and the day's first few games pay coins.
async fn play(
    State(state): S,
    headers: HeaderMap,
    Json(req): Json<PlayReq>,
) -> ApiResult<Json<serde_json::Value>> {
    let player = bearer_player(&state, &headers)?;
    let &(game, per_coin) = GAMES
        .iter()
        .find(|g| g.0 == req.game)
        .ok_or_else(|| ApiError::bad_request("bad_game", "No such game."))?;
    if req.key.is_empty() || req.key.len() > 80 {
        return Err(ApiError::bad_request("bad_request", "Invalid request."));
    }
    let mut tx = state.db.begin().await.map_err(db_err)?;
    let (food, joy) = settle(&mut tx, player).await?;
    let mut coins = 0;
    let mut applied = Applied::default();
    let mut level_up = None;
    let mut resting = false;
    if game == "playdate" {
        // Two pets out together: a romp (counts once in a while).
        let recent: bool = sqlx::query_scalar(
            "SELECT playdate_at IS NOT NULL AND playdate_at > now() - make_interval(secs => $2) FROM pets WHERE owner = $1",
        )
        .bind(player)
        .bind(PLAYDATE_SECS)
        .fetch_one(&mut *tx)
        .await
        .map_err(db_err)?;
        resting = recent;
        if !recent {
            store_needs(&mut tx, player, food - 3.0, joy + 12.0).await?;
            sqlx::query("UPDATE pets SET playdate_at = now() WHERE owner = $1")
                .bind(player)
                .execute(&mut *tx)
                .await
                .map_err(db_err)?;
            level_up = gain(&mut tx, player, 12).await?;
        }
    } else if let Some(&(_, djoy, upto, xp)) = CARE.iter().find(|c| c.0 == game) {
        let recent: bool = sqlx::query_scalar(
            "SELECT cuddled_at IS NOT NULL AND cuddled_at > now() - make_interval(secs => $2) FROM pets WHERE owner = $1",
        )
        .bind(player)
        .bind(CUDDLE_SECS)
        .fetch_one(&mut *tx)
        .await
        .map_err(db_err)?;
        resting = recent;
        if !recent {
            if joy < upto {
                store_needs(&mut tx, player, food, (joy + djoy).min(upto)).await?;
            }
            sqlx::query("UPDATE pets SET cuddled_at = now() WHERE owner = $1")
                .bind(player)
                .execute(&mut *tx)
                .await
                .map_err(db_err)?;
            level_up = gain(&mut tx, player, xp).await?;
        }
    } else {
        let score = req.score.min(5000);
        // A good game cheers it right up: 12 to 40.
        let djoy = (12.0 + score as f32 / per_coin as f32 * 3.0).min(40.0);
        let paid: i32 = sqlx::query_scalar(
            "UPDATE pets SET plays = plays + 1,
                 plays_paid = CASE WHEN plays_day = (now() AT TIME ZONE 'utc')::date THEN plays_paid ELSE 0 END,
                 plays_day = (now() AT TIME ZONE 'utc')::date
             WHERE owner = $1 RETURNING plays_paid",
        )
        .bind(player)
        .fetch_one(&mut *tx)
        .await
        .map_err(db_err)?;
        let xp_now: i32 = sqlx::query_scalar("SELECT xp FROM pets WHERE owner = $1")
            .bind(player)
            .fetch_one(&mut *tx)
            .await
            .map_err(db_err)?;
        if paid < PAID_PLAYS {
            // A grown-up pet earns a little more: a coin more every 25 levels.
            coins = ((score / per_coin) as i32).clamp(1, MAX_PLAY_COINS) + level_of(xp_now) / 25;
            let ops = [Op {
                item: COIN,
                delta: coins,
            }];
            applied = pay(
                &mut tx,
                &state,
                player,
                &ops,
                "pet_play",
                &format!("petplay:{player}:{}", req.key),
            )
            .await?;
            if applied.duplicate {
                coins = 0;
            } else {
                sqlx::query("UPDATE pets SET plays_paid = plays_paid + 1 WHERE owner = $1")
                    .bind(player)
                    .execute(&mut *tx)
                    .await
                    .map_err(db_err)?;
            }
        }
        if !applied.duplicate {
            store_needs(&mut tx, player, food - 5.0, joy + djoy).await?;
            level_up = gain(
                &mut tx,
                player,
                10 + ((score / per_coin) as i32 * 2).min(30),
            )
            .await?;
        }
    }
    let pet = one(&mut tx, player).await?;
    tx.commit().await.map_err(db_err)?;
    Ok(Json(serde_json::json!({
        "pet": pet, "coins": coins, "applied": applied, "level_up": level_up, "resting": resting,
    })))
}

/// Pays (or charges) through the ledger, a repeat of the same press answered
/// as a duplicate.
async fn pay(
    conn: &mut PgConnection,
    state: &AppState,
    player: Uuid,
    ops: &[Op],
    reason: &str,
    key: &str,
) -> ApiResult<Applied> {
    match apply(conn, &state.catalog, player, ops, reason, key).await {
        Ok(a) => Ok(a),
        Err(EconError::Race) => Ok(Applied {
            duplicate: true,
            ..Default::default()
        }),
        Err(e) => Err(e.into()),
    }
}

#[derive(Deserialize)]
struct BreedReq {
    design: i64,
    name: String,
    key: String,
}

/// A pet made to your design at the Breeder: a house and no pet yet.
async fn breed(
    State(state): S,
    headers: HeaderMap,
    Json(req): Json<BreedReq>,
) -> ApiResult<Json<serde_json::Value>> {
    let player = bearer_player(&state, &headers)?;
    if !design_ok(req.design) {
        return Err(ApiError::bad_request(
            "bad_design",
            "The Breeder can't make that one.",
        ));
    }
    if req.key.is_empty() || req.key.len() > 80 {
        return Err(ApiError::bad_request("bad_request", "Invalid request."));
    }
    let name = clean_name(&req.name)?;
    let mut tx = state.db.begin().await.map_err(db_err)?;
    let ops = [Op {
        item: COIN,
        delta: -BREED_PRICE,
    }];
    let applied = pay(
        &mut tx,
        &state,
        player,
        &ops,
        "pet_breed",
        &format!("breed:{player}:{}", req.key),
    )
    .await?;
    if !applied.duplicate {
        adopt_as(&mut tx, player, BRED_ITEM, &name, Some(req.design as i32)).await?;
    }
    let pet = one(&mut tx, player).await?;
    tx.commit().await.map_err(db_err)?;
    Ok(Json(serde_json::json!({ "pet": pet, "applied": applied })))
}

#[derive(Deserialize)]
struct RestyleReq {
    design: i64,
    key: String,
}

/// A new look for your pet at the Breeder (the same animal: its species stays).
async fn restyle(
    State(state): S,
    headers: HeaderMap,
    Json(req): Json<RestyleReq>,
) -> ApiResult<Json<serde_json::Value>> {
    let player = bearer_player(&state, &headers)?;
    if !design_ok(req.design) {
        return Err(ApiError::bad_request(
            "bad_design",
            "The Breeder can't do that look.",
        ));
    }
    if req.key.is_empty() || req.key.len() > 80 {
        return Err(ApiError::bad_request("bad_request", "Invalid request."));
    }
    let mut tx = state.db.begin().await.map_err(db_err)?;
    let Some(now) = one(&mut tx, player).await? else {
        return Err(conflict("no_pet", "You don't have a pet yet."));
    };
    if species_of(now.code as u32) != species_of(req.design as u32) {
        return Err(conflict(
            "other_species",
            "A new look, yes; a new animal, no!",
        ));
    }
    let ops = [Op {
        item: COIN,
        delta: -RESTYLE_PRICE,
    }];
    let applied = pay(
        &mut tx,
        &state,
        player,
        &ops,
        "pet_restyle",
        &format!("restyle:{player}:{}", req.key),
    )
    .await?;
    if !applied.duplicate {
        sqlx::query("UPDATE pets SET design = $2 WHERE owner = $1")
            .bind(player)
            .bind(req.design as i32)
            .execute(&mut *tx)
            .await
            .map_err(db_err)?;
    }
    let pet = one(&mut tx, player).await?;
    tx.commit().await.map_err(db_err)?;
    Ok(Json(serde_json::json!({ "pet": pet, "applied": applied })))
}

#[derive(Deserialize)]
struct TrickReq {
    trick: String,
}

/// Your pet does a trick it's learnt (a little happier, a little wiser).
async fn trick(
    State(state): S,
    headers: HeaderMap,
    Json(req): Json<TrickReq>,
) -> ApiResult<Json<serde_json::Value>> {
    let player = bearer_player(&state, &headers)?;
    let &(_, needs) = TRICKS
        .iter()
        .find(|t| t.0 == req.trick)
        .ok_or_else(|| ApiError::bad_request("bad_trick", "No such trick."))?;
    let mut tx = state.db.begin().await.map_err(db_err)?;
    let (food, joy) = settle(&mut tx, player).await?;
    let (xp, recent): (i32, bool) = sqlx::query_as(
        "SELECT xp, trick_at IS NOT NULL AND trick_at > now() - make_interval(secs => $2) FROM pets WHERE owner = $1",
    )
    .bind(player)
    .bind(TRICK_SECS)
    .fetch_one(&mut *tx)
    .await
    .map_err(db_err)?;
    if level_of(xp) < needs {
        return Err(conflict("not_learnt", "They haven't learnt that one yet."));
    }
    let mut level_up = None;
    if !recent {
        if joy < 90.0 {
            store_needs(&mut tx, player, food, (joy + 2.0).min(90.0)).await?;
        }
        sqlx::query("UPDATE pets SET trick_at = now() WHERE owner = $1")
            .bind(player)
            .execute(&mut *tx)
            .await
            .map_err(db_err)?;
        level_up = gain(&mut tx, player, 4).await?;
    }
    let pet = one(&mut tx, player).await?;
    tx.commit().await.map_err(db_err)?;
    Ok(Json(
        serde_json::json!({ "pet": pet, "level_up": level_up, "resting": recent }),
    ))
}

/// The zone's: a game of Treat Catch played (`duo`).
pub fn internal_routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/pets/duo", post(duo))
        .route("/pets/bounce", post(bounce))
        .route("/pets/bounce/best", post(bounce_best))
}

/// Treat Catch: the first so many games a day between two pets grow their
/// friendship and give each some experience and joy (more for a better game).
pub const DUO_COUNTED: i32 = 5;
/// Friendship points a level (levels from 1, up to `DUO_TOP`).
pub const DUO_PER_LEVEL: i32 = 10;
pub const DUO_TOP: i32 = 10;

#[derive(Deserialize)]
struct DuoReq {
    a: String,
    b: String,
    score: i32,
}

/// A game of Treat Catch between `a`'s pet and `b`'s (`score` caught
/// together): each a little happier and wiser, and fonder of each other.
async fn duo(
    State(state): S,
    headers: HeaderMap,
    Json(req): Json<DuoReq>,
) -> ApiResult<Json<serde_json::Value>> {
    crate::internal::service(&state, &headers)?;
    let pair = pair(&req)?;
    let score = req.score.clamp(0, 500);
    let r = played(&state, pair, 1 + score / 8, (6 + score / 2).min(40), 0).await?;
    Ok(Json(r))
}

/// A game of Bounce Buddies between `a`'s pet and `b`'s: as Treat Catch, and their best together kept.
async fn bounce(
    State(state): S,
    headers: HeaderMap,
    Json(req): Json<DuoReq>,
) -> ApiResult<Json<serde_json::Value>> {
    crate::internal::service(&state, &headers)?;
    let pair = pair(&req)?;
    let score = req.score.clamp(0, 1_000_000);
    // (Shut as it began: that's no game.)
    let (points, xp) = if score == 0 {
        (0, 0)
    } else {
        (1 + (score / 100).min(12), (6 + score / 40).min(40))
    };
    Ok(Json(played(&state, pair, points, xp, score).await?))
}

/// The best those two have done together at Bounce Buddies.
async fn bounce_best(
    State(state): S,
    headers: HeaderMap,
    Json(req): Json<DuoReq>,
) -> ApiResult<Json<serde_json::Value>> {
    crate::internal::service(&state, &headers)?;
    let (a, b) = pair(&req)?;
    let best: Option<i32> =
        sqlx::query_scalar("SELECT best_bounce FROM pet_friends WHERE a = $1 AND b = $2")
            .bind(a)
            .bind(b)
            .fetch_optional(&state.db)
            .await
            .map_err(db_err)?;
    Ok(Json(serde_json::json!({ "best": best.unwrap_or(0) })))
}

/// Whose two pets, the lesser id first.
fn pair(req: &DuoReq) -> ApiResult<(Uuid, Uuid)> {
    let (a, b) = (
        crate::internal::uuid(&req.a)?,
        crate::internal::uuid(&req.b)?,
    );
    if a == b {
        return Err(ApiError::bad_request(
            "bad_pair",
            "a pet can't play with itself",
        ));
    }
    Ok((a.min(b), a.max(b)))
}

/// Two pets have played together: `fonder` points' more friendship and `xp`
/// each (the day's first few games), and `best` if it beats their best at Bounce Buddies.
async fn played(
    state: &AppState,
    (lo, hi): (Uuid, Uuid),
    fonder: i32,
    earned: i32,
    best: i32,
) -> ApiResult<serde_json::Value> {
    let mut tx = state.db.begin().await.map_err(db_err)?;
    // Today's games between them (a new day starts the count again).
    let (points, games): (i32, i32) = sqlx::query_as(
        "INSERT INTO pet_friends (a, b) VALUES ($1, $2)
         ON CONFLICT (a, b) DO UPDATE SET
           games = CASE WHEN pet_friends.day = (now() AT TIME ZONE 'utc')::date THEN pet_friends.games ELSE 0 END,
           day = (now() AT TIME ZONE 'utc')::date
         RETURNING points, games",
    )
    .bind(lo)
    .bind(hi)
    .fetch_one(&mut *tx)
    .await
    .map_err(db_err)?;
    let counted = games < DUO_COUNTED && earned > 0;
    let (mut points, mut xp) = (points, 0);
    if counted {
        points += fonder;
        xp = earned;
        for who in [lo, hi] {
            if let Ok((food, joy)) = settle(&mut tx, who).await {
                store_needs(&mut tx, who, food, joy + 12.0).await?;
                gain(&mut tx, who, xp).await?;
            }
        }
    }
    let best: i32 = sqlx::query_scalar(
        "UPDATE pet_friends SET points = $3, games = games + $4,
           best_bounce = GREATEST(best_bounce, $5)
         WHERE a = $1 AND b = $2 RETURNING best_bounce",
    )
    .bind(lo)
    .bind(hi)
    .bind(points)
    .bind(i32::from(earned > 0))
    .bind(best)
    .fetch_one(&mut *tx)
    .await
    .map_err(db_err)?;
    tx.commit().await.map_err(db_err)?;
    Ok(serde_json::json!({
        "friendship": points,
        "level": friend_level(points),
        "counted": counted,
        "xp": xp,
        "best": best,
    }))
}

/// The friendship level two pets have reached (1 to `DUO_TOP`).
pub fn friend_level(points: i32) -> i32 {
    (1 + points / DUO_PER_LEVEL).min(DUO_TOP)
}

/// Your pet's friends (the pets it's played with): whose, how fond, the most first.
async fn friends(State(state): S, headers: HeaderMap) -> ApiResult<Json<serde_json::Value>> {
    let player = bearer_player(&state, &headers)?;
    let rows: Vec<(String, Option<String>, i32)> = sqlx::query_as(
        "SELECT pl.display_name, p.name, f.points FROM pet_friends f
         JOIN players pl ON pl.id = CASE WHEN f.a = $1 THEN f.b ELSE f.a END
         LEFT JOIN pets p ON p.owner = pl.id
         WHERE f.a = $1 OR f.b = $1
         ORDER BY f.points DESC LIMIT 8",
    )
    .bind(player)
    .fetch_all(&state.db)
    .await
    .map_err(db_err)?;
    Ok(Json(serde_json::json!({
        "friends": rows.into_iter().map(|(owner, pet, points)| serde_json::json!({
            "owner": owner, "pet": pet, "points": points, "level": friend_level(points),
        })).collect::<Vec<_>>(),
    })))
}

#[derive(Deserialize)]
struct SkillReq {
    skill: String,
}

/// Your pet learns a skill: a skill point to spend (`skill_points`), and the
/// skill it grows from learnt already.
async fn learn(
    State(state): S,
    headers: HeaderMap,
    Json(req): Json<SkillReq>,
) -> ApiResult<Json<serde_json::Value>> {
    let player = bearer_player(&state, &headers)?;
    let &(_, bit, after) = SKILLS
        .iter()
        .find(|k| k.0 == req.skill)
        .ok_or_else(|| ApiError::bad_request("bad_skill", "No such skill."))?;
    let mut tx = state.db.begin().await.map_err(db_err)?;
    let row: Option<(i32, i32)> =
        sqlx::query_as("SELECT xp, skills FROM pets WHERE owner = $1 FOR UPDATE")
            .bind(player)
            .fetch_optional(&mut *tx)
            .await
            .map_err(db_err)?;
    let (xp, skills) = row.ok_or_else(|| conflict("no_pet", "You don't have a pet."))?;
    let skills = skills as u32;
    if skills & bit != 0 {
        return Err(conflict("learnt", "They know that one already."));
    }
    if after != 0 && skills & after == 0 {
        return Err(conflict("not_yet", "Learn the skill before it first."));
    }
    if skills.count_ones() as i32 >= skill_points(level_of(xp)) {
        return Err(conflict(
            "no_points",
            "No skill points left: they get more as they level up.",
        ));
    }
    sqlx::query("UPDATE pets SET skills = $2 WHERE owner = $1")
        .bind(player)
        .bind((skills | bit) as i32)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    let pet = one(&mut tx, player).await?;
    tx.commit().await.map_err(db_err)?;
    Ok(Json(serde_json::json!({ "pet": pet })))
}

/// Puts your pet up for adoption: it goes to a new family through the Pets
/// shop, and you have room for another (from the shop or the Breeder).
async fn rehome(State(state): S, headers: HeaderMap) -> ApiResult<Json<serde_json::Value>> {
    let player = bearer_player(&state, &headers)?;
    let name: Option<String> =
        sqlx::query_scalar("DELETE FROM pets WHERE owner = $1 RETURNING name")
            .bind(player)
            .fetch_optional(&state.db)
            .await
            .map_err(db_err)?;
    let name = name.ok_or_else(|| conflict("no_pet", "You don't have a pet."))?;
    Ok(Json(serde_json::json!({ "rehomed": name })))
}

/// The code (its look) of the pet out with `player`, 0 if none: the zone
/// draws it at their heels. A sad pet carries `MOOD_SAD`, so it droops.
/// And its skills (`SKILLS`' bits), for the zone (its catches, its digging).
pub async fn out_with(state: &AppState, player: Uuid) -> ApiResult<(u32, u32)> {
    let row: Option<(i32, Option<i32>, i32, f32, f32, i32)> = sqlx::query_as(&format!(
        "SELECT p.item_id, p.design, p.xp, {}, p.skills FROM pets p WHERE p.owner = $1
         AND p.out_since IS NOT NULL AND p.out_since > now() - make_interval(hours => $2)",
        needs_now("p")
    ))
    .bind(player)
    .bind(OUT_HOURS)
    .fetch_optional(&state.db)
    .await
    .map_err(db_err)?;
    let Some((item, design, xp, food, joy, skills)) = row else {
        return Ok((0, 0));
    };
    let code = match design {
        Some(d) => d as u32,
        None => state
            .catalog
            .get(item)
            .and_then(|it| it.meta["code"].as_u64())
            .map_or(0, |c| c as u32),
    };
    let sad = food < SAD_BELOW || joy < SAD_BELOW;
    if code == 0 {
        return Ok((0, 0));
    }
    // How grown-up it is shows too: a sparkle from 50, a golden glow at 100.
    let level = level_of(xp);
    let mut code = if sad { code | MOOD_SAD } else { code };
    if level >= 50 {
        code |= LEVEL_STAR;
    }
    if level >= MAX_LEVEL {
        code |= LEVEL_GOLD;
    }
    Ok((code, skills as u32))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_skill_point_at_level_one_and_more_as_it_grows() {
        assert_eq!(skill_points(1), 1);
        assert_eq!(skill_points(7), 1);
        assert_eq!(skill_points(8), 2);
        assert_eq!(skill_points(74), 6);
        assert_eq!(skill_points(MAX_LEVEL), SKILLS.len() as i32);
        // Every skill grows from another in the tree (learnt first), or from nothing.
        for (_, bit, after) in SKILLS {
            assert!(after == 0 || SKILLS.iter().any(|k| k.1 == after), "{bit}");
        }
    }

    #[test]
    fn pet_names() {
        assert_eq!(clean_name("  Biscuit ").unwrap(), "Biscuit");
        assert_eq!(clean_name("Mr O'Toole").unwrap(), "Mr O'Toole");
        assert!(clean_name("B").is_err());
        assert!(clean_name("Rex123").is_err());
        assert!(clean_name("a very long name for a pet").is_err());
    }

    #[test]
    fn levels() {
        assert_eq!(level_of(0), 1);
        assert_eq!(level_of(xp_for(2)), 2);
        assert_eq!(level_of(xp_for(2) - 1), 1);
        assert_eq!(level_of(xp_for(100)), 100);
        assert_eq!(level_of(i32::MAX), 100);
        for l in 1..MAX_LEVEL {
            assert!(xp_for(l + 1) > xp_for(l));
        }
    }

    #[test]
    fn designs() {
        let dog = DESIGN_FLAG as i64 | 1 | (2 << 4) | (5 << 7) | (3 << 21);
        assert!(design_ok(dog));
        // Not a design (an old coat code), no such species or breed, mood bits, too big.
        assert!(!design_ok(257));
        assert!(!design_ok(DESIGN_FLAG as i64 | 6));
        assert!(!design_ok(DESIGN_FLAG as i64 | 5 | (2 << 4)));
        assert!(!design_ok(dog | MOOD_SAD as i64));
        assert!(!design_ok(dog | (13 << 21)));
        assert!(!design_ok(-1));
        assert!(!design_ok(1 << 33));
        assert_eq!(species_of(dog as u32), 1);
        assert_eq!(species_of(258), 2);
    }
}
