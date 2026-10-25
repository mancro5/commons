//! The Museum & Gallery (ADR 0018).
//!
//! **The Gallery.** Paint your own canvas in the Studio, in one of three
//! sizes (small 16×16, medium 32×32, large 64×64), and enter it in the
//! Salon: one entry per size at a time. The Salon's walls hold a few frames
//! for each size and turn through every entry, a new set each hour, the same
//! for everyone (so "mine's on at three" is something to say). Anyone can
//! give a painting a heart; each week has a theme, and when the week's done
//! the three paintings with the most hearts in each size go up in the Hall
//! of Fame, for good. A reported painting comes down at once, until checked.
//!
//! **Natural history.** Give the museum one of each fish you've caught; the
//! first to give a kind is named on its tank.

use crate::State as SocialState;
use crate::routes::{db_err, me};
use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::routing::{get, post};
use axum::{Json, Router};
use base64::Engine;
use base64::engine::general_purpose::STANDARD as B64;
use chrono::{Datelike, Duration, NaiveDate, Utc};
use commons_api::economy::{COIN, EconError, Op, apply};
use commons_api::error::{ApiError, ApiResult};
use commons_common::filter::clean_chat;
use serde::Deserialize;
use serde_json::{Value, json};
use std::sync::Arc;
use uuid::Uuid;

type S = State<Arc<SocialState>>;

/// The canvas sizes, small to large.
pub const SIZES: [i16; 3] = [16, 32, 64];
/// Frames on the Salon's walls for each size.
pub const FRAMES: [usize; 3] = [12, 6, 3];
/// How long a painting stays in the Salon (then it retires on its own).
pub const SALON_DAYS: i64 = 28;
/// The least of a canvas that must be painted to enter it.
pub const MIN_PAINTED: f64 = 0.08;
/// The palette's size (index 0 is the bare canvas).
pub const COLORS: u8 = 32;
/// What the Hall of Fame pays, first to third.
pub const PRIZES: [i32; 3] = [100, 60, 30];

/// A theme a week, in turn.
pub const THEMES: [&str; 16] = [
    "The Lake at night",
    "My pet",
    "Autumn",
    "A self-portrait",
    "The city from above",
    "Something delicious",
    "Under the sea",
    "A friend",
    "Rainy day",
    "The best day ever",
    "A dream I had",
    "Tiny creatures",
    "Music",
    "Home",
    "Far away",
    "Anything goes",
];

fn conflict(code: &'static str, msg: impl Into<String>) -> ApiError {
    ApiError::new(StatusCode::CONFLICT, code, msg)
}

fn size_index(size: i16) -> ApiResult<usize> {
    SIZES
        .iter()
        .position(|&s| s == size)
        .ok_or_else(|| ApiError::bad_request("bad_size", "Canvases are 16, 32 or 64 across."))
}

/// The ISO week a day is in, as `2026-W43`.
pub fn week_of(day: NaiveDate) -> String {
    let w = day.iso_week();
    format!("{}-W{:02}", w.year(), w.week())
}

/// A week's theme.
pub fn theme_of(week: &str) -> &'static str {
    let n = week
        .bytes()
        .fold(0u32, |h, b| h.wrapping_mul(31).wrapping_add(b as u32));
    THEMES[n as usize % THEMES.len()]
}

/// When the current week ends (Monday 00:00 UTC), unix seconds.
fn week_ends(day: NaiveDate) -> i64 {
    let left = 7 - day.weekday().num_days_from_monday() as i64;
    (day + Duration::days(left))
        .and_hms_opt(0, 0, 0)
        .unwrap()
        .and_utc()
        .timestamp()
}

/// The hour of the Salon's turning (all instances agree): hours since the epoch.
pub fn salon_hour(unix: i64) -> i64 {
    unix.div_euclid(3600)
}

/// Which entries (positions in a list of `n`) are on the wall in hour `h`, `frames` at a time.
pub fn on_wall(n: usize, frames: usize, h: i64) -> Vec<usize> {
    if n <= frames {
        return (0..n).collect();
    }
    let start = (h.rem_euclid(n as i64) as usize * frames) % n;
    (0..frames).map(|i| (start + i) % n).collect()
}

/// The next hours (from `h`, within two days) entry `i` of `n` is on the wall.
pub fn showings(n: usize, frames: usize, i: usize, h: i64) -> Vec<i64> {
    (h..h + 48)
        .filter(|&k| on_wall(n, frames, k).contains(&i))
        .take(4)
        .collect()
}

pub fn routes() -> Router<Arc<SocialState>> {
    Router::new()
        .route("/museum", get(status))
        .route("/museum/salon", get(salon))
        .route("/museum/catalogue", get(catalogue))
        .route("/museum/fame", get(fame))
        .route("/museum/drafts/{size}", get(draft).post(save_draft))
        .route("/museum/submit", post(submit))
        .route("/museum/art/{id}", get(artwork))
        .route("/museum/art/{id}/heart", post(heart))
        .route("/museum/art/{id}/report", post(report))
        .route("/museum/nature", get(nature))
        .route("/museum/donate", post(donate))
}

// ---- the Hall of Fame: last week's best, chosen once ------------------------------------

/// Chooses last week's Hall of Fame, if nobody has yet: the three paintings
/// with the most hearts in each size (at least one heart), and their prizes.
pub async fn settle(state: &SocialState, today: NaiveDate) -> ApiResult<()> {
    let last = week_of(today - Duration::days(7));
    let mut tx = state.db.begin().await.map_err(db_err)?;
    let fresh = sqlx::query("INSERT INTO museum_weeks (week) VALUES ($1) ON CONFLICT DO NOTHING")
        .bind(&last)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?
        .rows_affected()
        == 1;
    if !fresh {
        return Ok(());
    }
    for size in SIZES {
        let best: Vec<(i64, Uuid)> = sqlx::query_as(
            "SELECT id, player_id FROM artworks
             WHERE week = $1 AND size = $2 AND NOT hidden AND hearts > 0
             ORDER BY hearts DESC, submitted_at ASC LIMIT 3",
        )
        .bind(&last)
        .bind(size)
        .fetch_all(&mut *tx)
        .await
        .map_err(db_err)?;
        for (rank, (id, player)) in best.into_iter().enumerate() {
            sqlx::query("UPDATE artworks SET fame_rank = $2 WHERE id = $1")
                .bind(id)
                .bind(rank as i16 + 1)
                .execute(&mut *tx)
                .await
                .map_err(db_err)?;
            apply(
                &mut tx,
                &state.catalog,
                player,
                &[Op {
                    item: COIN,
                    delta: PRIZES[rank],
                }],
                "museum_fame",
                &format!("museum:fame:{id}"),
            )
            .await
            .map_err(ApiError::from)?;
        }
    }
    tx.commit().await.map_err(db_err)?;
    Ok(())
}

// ---- what we send ---------------------------------------------------------------------

fn art_json(r: &ArtRow, mine_hearted: bool) -> Value {
    json!({
        "id": r.id, "artist": r.artist, "size": r.size, "title": r.title,
        "cells": B64.encode(&r.cells), "week": r.week, "theme": r.theme,
        "hearts": r.hearts, "hearted": mine_hearted, "fame": r.fame_rank,
        "at": r.submitted_at.timestamp(), "mine": false,
    })
}

#[derive(sqlx::FromRow)]
struct ArtRow {
    id: i64,
    player_id: Uuid,
    artist: String,
    size: i16,
    title: String,
    cells: Vec<u8>,
    week: String,
    theme: String,
    hearts: i32,
    fame_rank: Option<i16>,
    submitted_at: chrono::DateTime<Utc>,
}

const ART_COLS: &str =
    "id, player_id, artist, size, title, cells, week, theme, hearts, fame_rank, submitted_at";

/// The Salon's current entries for a size, in hanging order.
async fn entries(state: &SocialState, size: i16) -> ApiResult<Vec<ArtRow>> {
    sqlx::query_as(&format!(
        "SELECT {ART_COLS} FROM artworks
         WHERE size = $1 AND retired_at IS NULL AND NOT hidden
           AND submitted_at > now() - make_interval(days => $2)
         ORDER BY id"
    ))
    .bind(size)
    .bind(SALON_DAYS as i32)
    .fetch_all(&state.db)
    .await
    .map_err(db_err)
}

/// Which of `ids` `me` has given a heart.
async fn hearted(state: &SocialState, me: Uuid, ids: &[i64]) -> ApiResult<Vec<i64>> {
    sqlx::query_scalar(
        "SELECT artwork_id FROM artwork_hearts WHERE player_id = $1 AND artwork_id = ANY($2)",
    )
    .bind(me)
    .bind(ids)
    .fetch_all(&state.db)
    .await
    .map_err(db_err)
}

fn with_mine(mut v: Value, me: Uuid, r: &ArtRow) -> Value {
    v["mine"] = json!(r.player_id == me);
    v
}

// ---- the routes -----------------------------------------------------------------------

/// The week's theme, your entries (and when they're next on the wall), your drafts.
async fn status(State(state): S, headers: HeaderMap) -> ApiResult<Json<Value>> {
    let (me, _) = me(&state, &headers)?;
    let today = Utc::now().date_naive();
    settle(&state, today).await?;
    let week = week_of(today);
    let h = salon_hour(Utc::now().timestamp());
    let mut mine = vec![];
    let mut counts = vec![];
    for (si, size) in SIZES.into_iter().enumerate() {
        let list = entries(&state, size).await?;
        counts.push(list.len());
        if let Some(i) = list.iter().position(|r| r.player_id == me) {
            let r = &list[i];
            let mut v = art_json(r, false);
            v["mine"] = json!(true);
            v["showings"] = json!(
                showings(list.len(), FRAMES[si], i, h)
                    .iter()
                    .map(|k| k * 3600)
                    .collect::<Vec<_>>()
            );
            mine.push(v);
        }
    }
    let drafts: Vec<i16> =
        sqlx::query_scalar("SELECT size FROM art_drafts WHERE player_id = $1 ORDER BY size")
            .bind(me)
            .fetch_all(&state.db)
            .await
            .map_err(db_err)?;
    Ok(Json(json!({
        "week": week, "theme": theme_of(&week), "week_ends": week_ends(today),
        "sizes": SIZES, "frames": FRAMES, "colors": COLORS, "min_painted": MIN_PAINTED,
        "salon_days": SALON_DAYS, "prizes": PRIZES,
        "mine": mine, "counts": counts, "drafts": drafts,
    })))
}

/// What's on the Salon's walls this hour: for each size, its frames in order.
async fn salon(State(state): S, headers: HeaderMap) -> ApiResult<Json<Value>> {
    let (me, _) = me(&state, &headers)?;
    let now = Utc::now().timestamp();
    let h = salon_hour(now);
    let mut walls = vec![];
    for (si, size) in SIZES.into_iter().enumerate() {
        let list = entries(&state, size).await?;
        let shown: Vec<&ArtRow> = on_wall(list.len(), FRAMES[si], h)
            .into_iter()
            .map(|i| &list[i])
            .collect();
        let ids: Vec<i64> = shown.iter().map(|r| r.id).collect();
        let liked = hearted(&state, me, &ids).await?;
        walls.push(json!({
            "size": size, "frames": FRAMES[si], "total": list.len(),
            "art": shown.iter().map(|r| with_mine(art_json(r, liked.contains(&r.id)), me, r)).collect::<Vec<_>>(),
        }));
    }
    Ok(Json(
        json!({ "hour": h, "next": (h + 1) * 3600, "walls": walls }),
    ))
}

#[derive(Deserialize)]
struct CatalogueQ {
    size: i16,
    #[serde(default)]
    sort: Option<String>,
    #[serde(default)]
    page: Option<i64>,
}

/// Every painting in the Salon now, for a size: newest or most loved first.
async fn catalogue(
    State(state): S,
    headers: HeaderMap,
    Query(q): Query<CatalogueQ>,
) -> ApiResult<Json<Value>> {
    let (me, _) = me(&state, &headers)?;
    size_index(q.size)?;
    let order = if q.sort.as_deref() == Some("hearts") {
        "hearts DESC, id DESC"
    } else {
        "id DESC"
    };
    let page = q.page.unwrap_or(0).clamp(0, 1000);
    let per = if q.size == 64 { 6 } else { 12 };
    let rows: Vec<ArtRow> = sqlx::query_as(&format!(
        "SELECT {ART_COLS} FROM artworks
         WHERE size = $1 AND retired_at IS NULL AND NOT hidden
           AND submitted_at > now() - make_interval(days => $2)
         ORDER BY {order} LIMIT $3 OFFSET $4"
    ))
    .bind(q.size)
    .bind(SALON_DAYS as i32)
    .bind(per + 1)
    .bind(page * per)
    .fetch_all(&state.db)
    .await
    .map_err(db_err)?;
    let more = rows.len() as i64 > per;
    let rows = &rows[..rows.len().min(per as usize)];
    let ids: Vec<i64> = rows.iter().map(|r| r.id).collect();
    let liked = hearted(&state, me, &ids).await?;
    Ok(Json(json!({
        "art": rows.iter().map(|r| with_mine(art_json(r, liked.contains(&r.id)), me, r)).collect::<Vec<_>>(),
        "more": more, "page": page,
    })))
}

/// The Hall of Fame, newest weeks first.
async fn fame(State(state): S, headers: HeaderMap) -> ApiResult<Json<Value>> {
    let (me, _) = me(&state, &headers)?;
    settle(&state, Utc::now().date_naive()).await?;
    let rows: Vec<ArtRow> = sqlx::query_as(&format!(
        "SELECT {ART_COLS} FROM artworks WHERE fame_rank IS NOT NULL AND NOT hidden
         ORDER BY week DESC, size, fame_rank LIMIT 90"
    ))
    .fetch_all(&state.db)
    .await
    .map_err(db_err)?;
    let ids: Vec<i64> = rows.iter().map(|r| r.id).collect();
    let liked = hearted(&state, me, &ids).await?;
    Ok(Json(json!({
        "art": rows.iter().map(|r| with_mine(art_json(r, liked.contains(&r.id)), me, r)).collect::<Vec<_>>(),
    })))
}

/// One painting, wherever it hangs.
async fn artwork(
    State(state): S,
    headers: HeaderMap,
    Path(id): Path<i64>,
) -> ApiResult<Json<Value>> {
    let (me, _) = me(&state, &headers)?;
    let r: ArtRow = sqlx::query_as(&format!(
        "SELECT {ART_COLS} FROM artworks WHERE id = $1 AND NOT hidden"
    ))
    .bind(id)
    .fetch_optional(&state.db)
    .await
    .map_err(db_err)?
    .ok_or_else(|| {
        ApiError::new(
            StatusCode::NOT_FOUND,
            "not_found",
            "That painting isn't on show.",
        )
    })?;
    let liked = hearted(&state, me, &[id]).await?;
    Ok(Json(with_mine(art_json(&r, !liked.is_empty()), me, &r)))
}

/// Your canvas in progress at a size (blank if you haven't started one).
async fn draft(
    State(state): S,
    headers: HeaderMap,
    Path(size): Path<i16>,
) -> ApiResult<Json<Value>> {
    let (me, _) = me(&state, &headers)?;
    size_index(size)?;
    let cells: Option<Vec<u8>> =
        sqlx::query_scalar("SELECT cells FROM art_drafts WHERE player_id = $1 AND size = $2")
            .bind(me)
            .bind(size)
            .fetch_optional(&state.db)
            .await
            .map_err(db_err)?;
    let cells = cells.unwrap_or_else(|| vec![0; size as usize * size as usize]);
    Ok(Json(json!({ "size": size, "cells": B64.encode(cells) })))
}

#[derive(Deserialize)]
struct DraftReq {
    cells: String,
}

/// The cells, checked: the right size, the palette's colours.
fn decode_cells(size: i16, cells: &str) -> ApiResult<Vec<u8>> {
    let cells = B64
        .decode(cells)
        .map_err(|_| ApiError::bad_request("bad_cells", "That canvas didn't come through."))?;
    if cells.len() != size as usize * size as usize || cells.iter().any(|&c| c >= COLORS) {
        return Err(ApiError::bad_request(
            "bad_cells",
            "That canvas didn't come through.",
        ));
    }
    Ok(cells)
}

async fn save_draft(
    State(state): S,
    headers: HeaderMap,
    Path(size): Path<i16>,
    Json(req): Json<DraftReq>,
) -> ApiResult<Json<Value>> {
    let (me, _) = me(&state, &headers)?;
    size_index(size)?;
    let cells = decode_cells(size, &req.cells)?;
    sqlx::query(
        "INSERT INTO art_drafts (player_id, size, cells) VALUES ($1, $2, $3)
         ON CONFLICT (player_id, size) DO UPDATE SET cells = EXCLUDED.cells, updated_at = now()",
    )
    .bind(me)
    .bind(size)
    .bind(&cells)
    .execute(&state.db)
    .await
    .map_err(db_err)?;
    Ok(Json(json!({ "saved": true })))
}

#[derive(Deserialize)]
struct SubmitReq {
    size: i16,
    title: String,
    /// The canvas as it is now (saved as the draft too).
    cells: String,
}

/// Enters a canvas in the Salon (it replaces your last entry of that size).
async fn submit(
    State(state): S,
    headers: HeaderMap,
    Json(req): Json<SubmitReq>,
) -> ApiResult<Json<Value>> {
    let (me, claims) = me(&state, &headers)?;
    size_index(req.size)?;
    let cells = decode_cells(req.size, &req.cells)?;
    let painted = cells.iter().filter(|&&c| c != 0).count() as f64 / cells.len() as f64;
    if painted < MIN_PAINTED {
        return Err(conflict(
            "too_bare",
            "Paint a little more of the canvas before you hang it.",
        ));
    }
    let title = req.title.trim();
    if title.is_empty() || title.chars().count() > 40 {
        return Err(ApiError::bad_request(
            "bad_title",
            "Give it a title (up to 40 letters).",
        ));
    }
    let Some(title) = clean_chat(title) else {
        return Err(ApiError::bad_request(
            "bad_title",
            "Try a friendlier title.",
        ));
    };
    let week = week_of(Utc::now().date_naive());
    let mut tx = state.db.begin().await.map_err(db_err)?;
    sqlx::query("UPDATE artworks SET retired_at = now() WHERE player_id = $1 AND size = $2 AND retired_at IS NULL")
        .bind(me)
        .bind(req.size)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    let id: i64 = sqlx::query_scalar(
        "INSERT INTO artworks (player_id, artist, size, title, cells, week, theme)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id",
    )
    .bind(me)
    .bind(&claims.name)
    .bind(req.size)
    .bind(&title)
    .bind(&cells)
    .bind(&week)
    .bind(theme_of(&week))
    .fetch_one(&mut *tx)
    .await
    .map_err(db_err)?;
    sqlx::query(
        "INSERT INTO art_drafts (player_id, size, cells) VALUES ($1, $2, $3)
         ON CONFLICT (player_id, size) DO UPDATE SET cells = EXCLUDED.cells, updated_at = now()",
    )
    .bind(me)
    .bind(req.size)
    .bind(&cells)
    .execute(&mut *tx)
    .await
    .map_err(db_err)?;
    tx.commit().await.map_err(db_err)?;
    Ok(Json(
        json!({ "id": id, "week": week, "theme": theme_of(&week) }),
    ))
}

#[derive(Deserialize)]
struct HeartReq {
    on: bool,
}

/// A heart for a painting (or taken back). Not your own.
async fn heart(
    State(state): S,
    headers: HeaderMap,
    Path(id): Path<i64>,
    Json(req): Json<HeartReq>,
) -> ApiResult<Json<Value>> {
    let (me, _) = me(&state, &headers)?;
    let owner: Option<Uuid> =
        sqlx::query_scalar("SELECT player_id FROM artworks WHERE id = $1 AND NOT hidden")
            .bind(id)
            .fetch_optional(&state.db)
            .await
            .map_err(db_err)?;
    let owner = owner.ok_or_else(|| {
        ApiError::new(
            StatusCode::NOT_FOUND,
            "not_found",
            "That painting isn't on show.",
        )
    })?;
    if owner == me {
        return Err(conflict(
            "own",
            "That one's yours! Hearts are for others' work.",
        ));
    }
    let mut tx = state.db.begin().await.map_err(db_err)?;
    let changed = if req.on {
        sqlx::query("INSERT INTO artwork_hearts (artwork_id, player_id) VALUES ($1, $2) ON CONFLICT DO NOTHING")
    } else {
        sqlx::query("DELETE FROM artwork_hearts WHERE artwork_id = $1 AND player_id = $2")
    }
    .bind(id)
    .bind(me)
    .execute(&mut *tx)
    .await
    .map_err(db_err)?
    .rows_affected();
    let hearts: i32 = sqlx::query_scalar(
        "UPDATE artworks SET hearts = hearts + $2 WHERE id = $1 RETURNING hearts",
    )
    .bind(id)
    .bind(if changed == 0 {
        0
    } else if req.on {
        1
    } else {
        -1
    })
    .fetch_one(&mut *tx)
    .await
    .map_err(db_err)?;
    tx.commit().await.map_err(db_err)?;
    Ok(Json(json!({ "hearts": hearts, "hearted": req.on })))
}

/// Reports a painting: it comes down at once, until someone checks it.
async fn report(
    State(state): S,
    headers: HeaderMap,
    Path(id): Path<i64>,
) -> ApiResult<Json<Value>> {
    let (me, _) = me(&state, &headers)?;
    let owner: Option<Uuid> = sqlx::query_scalar("SELECT player_id FROM artworks WHERE id = $1")
        .bind(id)
        .fetch_optional(&state.db)
        .await
        .map_err(db_err)?;
    let owner = owner
        .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "not_found", "No such painting."))?;
    if owner == me {
        return Err(conflict(
            "own",
            "You can take your own down by hanging another.",
        ));
    }
    let mut tx = state.db.begin().await.map_err(db_err)?;
    sqlx::query("INSERT INTO artwork_reports (artwork_id, player_id) VALUES ($1, $2) ON CONFLICT DO NOTHING")
        .bind(id)
        .bind(me)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    sqlx::query("UPDATE artworks SET hidden = true WHERE id = $1")
        .bind(id)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    tx.commit().await.map_err(db_err)?;
    Ok(Json(json!({ "hidden": true })))
}

// ---- natural history ----------------------------------------------------------------

/// Every kind of fish: whether you've given one, and who gave the first.
async fn nature(State(state): S, headers: HeaderMap) -> ApiResult<Json<Value>> {
    let (me, _) = me(&state, &headers)?;
    let firsts: Vec<(i32, String, chrono::DateTime<Utc>)> = sqlx::query_as(
        "SELECT DISTINCT ON (item_id) item_id, name, at FROM museum_donations ORDER BY item_id, at",
    )
    .fetch_all(&state.db)
    .await
    .map_err(db_err)?;
    let given: Vec<i32> =
        sqlx::query_scalar("SELECT item_id FROM museum_donations WHERE player_id = $1")
            .bind(me)
            .fetch_all(&state.db)
            .await
            .map_err(db_err)?;
    let counts: Vec<(i32, i64)> =
        sqlx::query_as("SELECT item_id, count(*) FROM museum_donations GROUP BY item_id")
            .fetch_all(&state.db)
            .await
            .map_err(db_err)?;
    // Fish by rarity; bugs and mushrooms in the naturalist's order.
    let section = |kind: &str| -> Vec<Value> {
        let mut items: Vec<_> = state.catalog.of_kind(kind).collect();
        if kind == "fish" {
            items.sort_by_key(|f| (f.rarity, f.id));
        } else {
            items.sort_by_key(|f| f.id);
        }
        items
            .iter()
            .map(|f| {
                let first = firsts.iter().find(|x| x.0 == f.id);
                json!({
                    "item": f.id, "key": f.key, "name": f.name, "rarity": f.rarity,
                    "given": given.contains(&f.id),
                    "first": first.map(|x| json!({ "name": x.1, "at": x.2.timestamp() })),
                    "givers": counts.iter().find(|c| c.0 == f.id).map(|c| c.1).unwrap_or(0),
                })
            })
            .collect()
    };
    Ok(Json(json!({
        "fish": section("fish"),
        "bugs": section("bug"),
        "shrooms": section("shroom"),
    })))
}

#[derive(Deserialize)]
struct DonateReq {
    item: i32,
}

/// Gives the museum one fish, bug or mushroom of a kind (one of each kind per player).
async fn donate(
    State(state): S,
    headers: HeaderMap,
    Json(req): Json<DonateReq>,
) -> ApiResult<Json<Value>> {
    let (me, claims) = me(&state, &headers)?;
    let item = state
        .catalog
        .get(req.item)
        .filter(|i| ["fish", "bug", "shroom"].contains(&i.kind.as_str()))
        .ok_or_else(|| {
            ApiError::bad_request("not_fish", "The museum collects fish, bugs and mushrooms.")
        })?;
    let mut tx = state.db.begin().await.map_err(db_err)?;
    let fresh = sqlx::query(
        "INSERT INTO museum_donations (item_id, player_id, name) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
    )
    .bind(item.id)
    .bind(me)
    .bind(&claims.name)
    .execute(&mut *tx)
    .await
    .map_err(db_err)?
    .rows_affected()
        == 1;
    if !fresh {
        return Err(conflict(
            "given",
            format!("You've given the museum a {} already.", item.name),
        ));
    }
    apply(
        &mut tx,
        &state.catalog,
        me,
        &[Op {
            item: item.id,
            delta: -1,
        }],
        "museum_donation",
        &format!("museum:give:{me}:{}", item.id),
    )
    .await
    .map_err(|e| match e {
        EconError::Insufficient(_) => {
            conflict("none", format!("You haven't got a {} to give.", item.name))
        }
        e => e.into(),
    })?;
    let first: bool =
        sqlx::query_scalar("SELECT count(*) = 1 FROM museum_donations WHERE item_id = $1")
            .bind(item.id)
            .fetch_one(&mut *tx)
            .await
            .map_err(db_err)?;
    tx.commit().await.map_err(db_err)?;
    Ok(Json(
        json!({ "item": item.id, "name": item.name, "first": first }),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_salon_turns_through_everyone_a_few_at_a_time() {
        // Fewer than the frames: everyone's up.
        assert_eq!(on_wall(3, 6, 99), vec![0, 1, 2]);
        // More: a window of `frames` that moves on each hour, and over the
        // hours every entry gets its turn.
        let n = 29;
        let mut seen = std::collections::HashSet::new();
        for h in 0..n as i64 {
            let w = on_wall(n, 6, h);
            assert_eq!(w.len(), 6);
            seen.extend(w);
        }
        assert_eq!(seen.len(), n, "everyone's on the wall within a day or so");
        // And you can tell someone when theirs is up next.
        let s = showings(n, 6, 17, 1000);
        assert!(!s.is_empty() && s.iter().all(|&k| on_wall(n, 6, k).contains(&17)));
    }

    #[test]
    fn weeks_and_their_themes() {
        let d = NaiveDate::from_ymd_opt(2026, 10, 24).unwrap();
        assert_eq!(week_of(d), "2026-W43");
        assert_eq!(theme_of("2026-W43"), theme_of(&week_of(d)));
        assert!(THEMES.contains(&theme_of("2026-W44")));
        // The week ends at the start of the next Monday.
        assert_eq!(
            week_ends(d),
            NaiveDate::from_ymd_opt(2026, 10, 26)
                .unwrap()
                .and_hms_opt(0, 0, 0)
                .unwrap()
                .and_utc()
                .timestamp()
        );
    }
}
