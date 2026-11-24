//! The day's missions, all in one place: the skate mission (any one of the
//! day's three skate quests, claimed at Dusty's van), the fisherman's order
//! and his magnet order, and a gladiator match won as the day's class (paid
//! by the class: `ARENA_PAY`). Done them all today, a bonus: `DAILY_BONUS`
//! coins, once a day.
//!
//! `GET /api/daily` (what's done, by the server's own records), `POST
//! /api/daily/bonus` (the bonus, if it's all done); `POST
//! /internal/daily/arena` (the zone: a match won, and as which class).

use crate::AppState;
use crate::economy::{COIN, Op, apply, bearer_player, key_used};
use crate::error::{ApiError, ApiResult};
use crate::fishquest::{Board, period_at, state_of};
use crate::internal::conflict;
use crate::internal::{service, uuid};
use crate::store::db_err;
use axum::extract::State;
use axum::http::HeaderMap;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::{Value, json};
use std::sync::Arc;
use uuid::Uuid;

/// The bonus for every mission done in a day.
pub const DAILY_BONUS: i32 = 100;

/// The gladiator mission: a match won as the day's class (`commons_sim::arena::kit`,
/// in its order): its name and what it pays, the harder the class to win
/// with, the more (the tank, twice the health, least; the bomber most).
pub const ARENA_PAY: [(&str, i32); 5] = [
    ("Knight", 35),
    ("Archer", 45),
    ("Bomber", 50),
    ("Spearman", 40),
    ("Tank", 30),
];

/// The class to win as on `day`: a different one each day, round them all.
pub fn arena_class(day: i64) -> u8 {
    ((day * 3 + 1).rem_euclid(ARENA_PAY.len() as i64)) as u8
}

type S = State<Arc<AppState>>;

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/daily", get(today))
        .route("/daily/bonus", post(bonus))
}

pub fn internal_routes() -> Router<Arc<AppState>> {
    Router::new().route("/daily/arena", post(arena_won))
}

/// The day (UTC), as the skate quests count them (days since 1970).
fn day_now() -> i64 {
    chrono::Utc::now().timestamp().div_euclid(86_400)
}

/// What's done today: the skate quests paid, the two orders filled, the bonus had.
async fn status(state: &AppState, player: Uuid) -> ApiResult<Value> {
    let day = day_now();
    let mut conn = state.db.acquire().await.map_err(db_err)?;
    let mut skate = Vec::new();
    for slot in 0..3 {
        skate.push(
            key_used(&mut conn, &format!("skate_quest:{player}:{day}:{slot}"))
                .await
                .map_err(db_err)?,
        );
    }
    let period = period_at(chrono::Utc::now().timestamp());
    let order = |rows: Vec<(i32, i32, i32)>| {
        let need: i32 = rows.iter().map(|r| r.1).sum();
        let given: i32 = rows.iter().map(|r| r.2.min(r.1)).sum();
        json!({ "need": need, "given": given, "done": need > 0 && given >= need })
    };
    let fish = order(state_of(state, Board::Fish, player, period).await?);
    let magnet = order(state_of(state, Board::Magnet, player, period).await?);
    let claimed = key_used(&mut conn, &format!("daily_bonus:{player}:{day}"))
        .await
        .map_err(db_err)?;
    let class = arena_class(day);
    let (name, reward) = ARENA_PAY[class as usize];
    let won = key_used(&mut conn, &format!("daily_arena:{player}:{day}"))
        .await
        .map_err(db_err)?;
    let arena = json!({ "class": class, "name": name, "reward": reward, "done": won });
    // The skate mission is any one of the three: whichever suits you today.
    let all = skate.iter().any(|&s| s) && fish["done"] == true && magnet["done"] == true && won;
    Ok(json!({
        "day": day,
        "skate": skate,
        "fish": fish,
        "magnet": magnet,
        "arena": arena,
        "all_done": all,
        "bonus": DAILY_BONUS,
        "claimed": claimed,
    }))
}

async fn today(State(state): S, headers: HeaderMap) -> ApiResult<Json<Value>> {
    let player = bearer_player(&state, &headers)?;
    Ok(Json(status(&state, player).await?))
}

/// Everything done today: the bonus (once).
async fn bonus(State(state): S, headers: HeaderMap) -> ApiResult<Json<Value>> {
    let player = bearer_player(&state, &headers)?;
    let s = status(&state, player).await?;
    if s["all_done"] != true {
        return Err(conflict(
            "not_done",
            "Finish all of today's missions first.",
        ));
    }
    let mut tx = state.db.begin().await.map_err(db_err)?;
    let applied = apply(
        &mut tx,
        &state.catalog,
        player,
        &[Op {
            item: COIN,
            delta: DAILY_BONUS,
        }],
        "daily_bonus",
        &format!("daily_bonus:{player}:{}", s["day"]),
    )
    .await?;
    tx.commit().await.map_err(db_err)?;
    Ok(Json(
        json!({ "applied": applied, "duplicate": applied.duplicate }),
    ))
}

#[derive(Deserialize)]
struct ArenaWon {
    player: String,
    /// The class they won as (`commons_sim::arena::kit`).
    kit: u8,
}

/// A gladiator match won (the zone says, and as which class): won as the
/// day's class, the mission's paid (once a day).
async fn arena_won(
    State(state): S,
    headers: HeaderMap,
    Json(req): Json<ArenaWon>,
) -> ApiResult<Json<Value>> {
    service(&state, &headers)?;
    let player = uuid(&req.player)?;
    let day = day_now();
    let class = arena_class(day);
    if req.kit as usize >= ARENA_PAY.len() {
        return Err(ApiError::bad_request("bad_kit", "no such class"));
    }
    if req.kit != class {
        return Ok(Json(json!({ "paid": false })));
    }
    let (name, reward) = ARENA_PAY[class as usize];
    let mut tx = state.db.begin().await.map_err(db_err)?;
    let applied = apply(
        &mut tx,
        &state.catalog,
        player,
        &[Op {
            item: COIN,
            delta: reward,
        }],
        "daily_arena",
        &format!("daily_arena:{player}:{day}"),
    )
    .await?;
    tx.commit().await.map_err(db_err)?;
    Ok(Json(json!({
        "paid": !applied.duplicate,
        "class": name,
        "reward": reward,
        "applied": applied,
    })))
}
