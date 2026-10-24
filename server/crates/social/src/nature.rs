//! Bug catching and mushroom foraging (ADR 0019). What's out where is
//! worked out from the clock (commons_sim::nature), the same for everyone;
//! this says what's out now for you (minus what you've already taken) and
//! hands over what you catch or pick. Each bug or mushroom can be taken once
//! by each of us: nobody takes one away from anyone else.

use crate::State as SocialState;
use crate::routes::{db_err, me};
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::{Datelike, TimeZone, Timelike};
use commons_api::economy::{Op, apply};
use commons_api::error::{ApiError, ApiResult};
use commons_sim::nature::{self, Moment, Spot, WOOZY};
use serde::Deserialize;
use serde_json::{Value, json};
use std::sync::{Arc, OnceLock};

type S = State<Arc<SocialState>>;

/// The bug net (an item): bugs can't be caught without one.
pub const NET_ITEM: i32 = 960;
/// A catch reported this long after its slot ended still counts (the walk, the swing).
const GRACE_MS: i64 = 45_000;

/// The city's forage spots, read once from its map.
fn spots() -> &'static [Spot] {
    static SPOTS: OnceLock<Vec<Spot>> = OnceLock::new();
    SPOTS.get_or_init(|| {
        #[derive(Deserialize)]
        struct Objects {
            objects: Vec<commons_sim::map::MapObject>,
        }
        let map: Objects = serde_json::from_str(include_str!("../../../../assets/maps/city.json"))
            .expect("the city map is invalid");
        map.objects
            .iter()
            .filter_map(|o| Spot::from_object(&o.kind, o.label.as_deref(), o.x, o.y))
            .collect()
    })
}

/// The moment at the start of a slot, in the town's own time.
fn moment(start_ms: i64) -> Moment {
    let t = chrono::Local
        .timestamp_millis_opt(start_ms)
        .single()
        .unwrap_or_else(chrono::Local::now);
    Moment::at(
        start_ms,
        t.hour() as f64 + t.minute() as f64 / 60.0,
        t.month(),
    )
}

fn conflict(code: &'static str, msg: impl Into<String>) -> ApiError {
    ApiError::new(StatusCode::CONFLICT, code, msg)
}

pub fn routes() -> Router<Arc<SocialState>> {
    Router::new()
        .route("/nature/out", get(out))
        .route("/nature/catch", post(catch))
        .route("/nature/hints", get(|| async { Json(hints()) }))
}

/// What's out in the city now, for you: each bug and mushroom with its spot,
/// what it is, and until when; and the weather, the season and the moon.
async fn out(State(state): S, headers: HeaderMap) -> ApiResult<Json<Value>> {
    let (me, _) = me(&state, &headers)?;
    let now = chrono::Utc::now().timestamp_millis();
    let taken: Vec<(i32, i64)> = sqlx::query_as(
        "SELECT spot, slot FROM forage_claims WHERE player_id = $1 AND at > now() - interval '3 hours'",
    )
    .bind(me)
    .fetch_all(&state.db)
    .await
    .map_err(db_err)?;
    let mut list = vec![];
    for s in spots() {
        let slot = s.slot(now);
        if taken.contains(&(s.id(), slot)) {
            continue;
        }
        let m = moment(s.slot_start(slot));
        let Some(k) = s.out(slot, &m) else { continue };
        let Some(item) = state.catalog.by_key(k.key) else {
            continue;
        };
        list.push(json!({
            "spot": s.id(), "x": s.x, "y": s.y, "slot": slot,
            "ends": s.slot_start(slot + 1),
            "shroom": s.shroom, "item": item.id, "key": k.key, "rarity": k.rarity,
            "woozy": WOOZY.contains(&k.key),
        }));
    }
    let m = moment(now);
    Ok(Json(json!({
        "now": now,
        "out": list,
        "weather": m.weather.key(),
        "season": m.season.name(),
        "moon": nature::moon_name(now),
    })))
}

#[derive(Deserialize)]
struct CatchReq {
    spot: i32,
    slot: i64,
}

/// Catches the bug, or picks the mushroom, at a spot: once each, for each of us.
async fn catch(
    State(state): S,
    headers: HeaderMap,
    Json(req): Json<CatchReq>,
) -> ApiResult<Json<Value>> {
    let (me, _) = me(&state, &headers)?;
    let spot = spots()
        .iter()
        .find(|s| s.id() == req.spot)
        .ok_or_else(|| ApiError::bad_request("no_spot", "There's nothing there."))?;
    let now = chrono::Utc::now().timestamp_millis();
    // This slot, or the one just gone (you were already reaching for it).
    let current = spot.slot(now);
    if !(req.slot == current
        || (req.slot == current - 1 && now - spot.slot_start(current) < GRACE_MS))
    {
        return Err(conflict("gone", "It's gone."));
    }
    if state.hub.location(me).is_none_or(|l| l.zone != "city") {
        return Err(conflict("away", "You need to be there."));
    }
    let kind = spot
        .out(req.slot, &moment(spot.slot_start(req.slot)))
        .ok_or_else(|| conflict("gone", "It's gone."))?;
    let item = state
        .catalog
        .by_key(kind.key)
        .ok_or_else(|| conflict("gone", "It's gone."))?;
    let mut tx = state.db.begin().await.map_err(db_err)?;
    if !spot.shroom {
        let nets: Option<i32> =
            sqlx::query_scalar("SELECT qty FROM inventory WHERE player_id = $1 AND item_id = $2")
                .bind(me)
                .bind(NET_ITEM)
                .fetch_optional(&mut *tx)
                .await
                .map_err(db_err)?;
        if nets.unwrap_or(0) < 1 {
            return Err(conflict(
                "no_net",
                "You'll need a bug net: the museum's curator sells them.",
            ));
        }
    }
    let fresh = sqlx::query(
        "INSERT INTO forage_claims (player_id, spot, slot, item_id) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING",
    )
    .bind(me)
    .bind(spot.id())
    .bind(req.slot)
    .bind(item.id)
    .execute(&mut *tx)
    .await
    .map_err(db_err)?
    .rows_affected()
        == 1;
    if !fresh {
        return Err(conflict("taken", "You've had that one."));
    }
    let applied = apply(
        &mut tx,
        &state.catalog,
        me,
        &[Op {
            item: item.id,
            delta: 1,
        }],
        if spot.shroom { "forage" } else { "bug_catch" },
        &format!("forage:{me}:{}:{}", spot.id(), req.slot),
    )
    .await?;
    tx.commit().await.map_err(db_err)?;
    // Now and then, forget claims nobody can use any more.
    if rand::random::<u8>() < 4 {
        let _ = sqlx::query("DELETE FROM forage_claims WHERE at < now() - interval '1 day'")
            .execute(&state.db)
            .await;
    }
    Ok(Json(json!({
        "item": item.id, "key": item.key, "name": item.name, "rarity": item.rarity,
        "first": applied.firsts.contains(&item.id),
        "woozy": WOOZY.contains(&kind.key),
        "applied": applied,
    })))
}

/// The naturalist's hints for the journal: where and when to look for each.
pub fn hints() -> Value {
    Value::Object(
        nature::BUGS
            .iter()
            .chain(nature::SHROOMS)
            .map(|k| (k.key.to_string(), Value::String(k.hint())))
            .collect(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_city_has_spots_of_every_habitat() {
        let s = spots();
        assert!(s.len() > 100, "{} spots", s.len());
        assert!(s.iter().any(|s| s.shroom) && s.iter().any(|s| !s.shroom));
    }
}
