//! Trading face to face: tap someone, ask to trade, and once they say yes
//! you each put things from your bag (and coins) on the table. Changing
//! anything takes both locks off. When both sides are locked in, each says
//! "trade"; when both have, everything changes hands in one go (or nothing
//! does). One side may put up nothing at all: that's a present.
//!
//! Trades live here, in memory; nothing moves until the end, in one
//! transaction on both bags.
//!
//! Players: `GET /api/social/trade` (yours, if any), `POST /api/social/trade/
//! {ask,answer,offer,lock,confirm,cancel}`. Pushed on the social socket to both
//! sides: `{ "t": "trade", "trade": … }` (see `view`), and when it's over,
//! `{ "t": "trade", "trade": { "id", "state": "done" | "cancelled", … } }`.

use crate::State as SocialState;
use crate::db;
use crate::routes::{db_err, me};
use axum::Json;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use commons_api::economy::{COIN, EconError, Op, apply};
use commons_api::error::{ApiError, ApiResult};
use serde::Deserialize;
use serde_json::json;
use std::collections::{BTreeMap, HashMap};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use uuid::Uuid;

type S = State<Arc<SocialState>>;

/// How long an ask waits for an answer.
pub const ASK_TTL: Duration = Duration::from_secs(60);
/// The most different things one side can put up.
pub const MAX_LINES: usize = 12;
/// The most of one thing, and the most coins, one side can put up.
pub const MAX_QTY: i32 = 999;
pub const MAX_COINS: i32 = 1_000_000;

#[derive(Debug, Clone, Default)]
struct Side {
    who: Uuid,
    name: String,
    /// What they put up: item → how many.
    items: BTreeMap<i32, i32>,
    coins: i32,
    locked: bool,
    confirmed: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Stage {
    /// Waiting for the other side (`side[1]`) to say yes.
    Asked,
    Open,
    /// Changing hands right now: hands off.
    Swapping,
}

#[derive(Debug, Clone)]
struct Trade {
    id: Uuid,
    side: [Side; 2],
    stage: Stage,
    asked_at: Instant,
}

impl Trade {
    fn of(&self, who: Uuid) -> Option<usize> {
        self.side.iter().position(|s| s.who == who)
    }

    /// Something changed on the table: both look again.
    fn unlock(&mut self) {
        for s in &mut self.side {
            s.locked = false;
            s.confirmed = false;
        }
    }
}

#[derive(Default)]
struct Inner {
    trades: HashMap<Uuid, Trade>,
    /// Who's in which trade (asking, asked, or trading).
    of: HashMap<Uuid, Uuid>,
}

impl Inner {
    /// `who`'s trade, dropping an ask that's gone unanswered too long.
    fn trade_of(&mut self, who: Uuid) -> Option<&mut Trade> {
        let id = *self.of.get(&who)?;
        let stale = self
            .trades
            .get(&id)
            .is_none_or(|t| t.stage == Stage::Asked && t.asked_at.elapsed() > ASK_TTL);
        if stale {
            self.end(id);
            return None;
        }
        self.trades.get_mut(&id)
    }

    fn end(&mut self, id: Uuid) -> Option<Trade> {
        let t = self.trades.remove(&id)?;
        for s in &t.side {
            if self.of.get(&s.who) == Some(&id) {
                self.of.remove(&s.who);
            }
        }
        Some(t)
    }
}

/// Every trade going on (the gateway's own; see `hub` for why that's enough for now).
#[derive(Default)]
pub struct Trades(Mutex<Inner>);

impl Trades {
    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        self.0.lock().unwrap()
    }
}

fn conflict(code: &'static str, msg: &str) -> ApiError {
    ApiError::new(StatusCode::CONFLICT, code, msg)
}

fn none() -> ApiError {
    conflict("no_trade", "That trade's over.")
}

fn side_json(s: &Side) -> serde_json::Value {
    let items: Vec<_> = s.items.iter().map(|(i, q)| json!([i, q])).collect();
    json!({ "items": items, "coins": s.coins, "locked": s.locked, "confirmed": s.confirmed })
}

/// The trade as `who` sees it: their side, the other's, and whose ask it was.
fn view(t: &Trade, who: usize) -> serde_json::Value {
    let them = &t.side[1 - who];
    let mut theirs = side_json(them);
    theirs["id"] = json!(them.who.to_string());
    theirs["name"] = json!(them.name);
    json!({
        "id": t.id.to_string(),
        "state": match t.stage { Stage::Asked => "asked", Stage::Open => "open", Stage::Swapping => "swapping" },
        "asker": who == 0,
        "me": side_json(&t.side[who]),
        "them": theirs,
    })
}

/// Tells both sides how the trade stands.
fn push(state: &SocialState, t: &Trade) {
    for (i, s) in t.side.iter().enumerate() {
        state
            .hub
            .send(s.who, &json!({ "t": "trade", "trade": view(t, i) }));
    }
}

/// Tells both sides it's off (`why`, as each should read it).
fn push_end(state: &SocialState, t: &Trade, why: &str, by: Option<Uuid>) {
    for s in &t.side {
        let you = by == Some(s.who);
        state.hub.send(
            s.who,
            &json!({ "t": "trade", "trade": { "id": t.id.to_string(), "state": "cancelled", "reason": why, "by_you": you } }),
        );
    }
}

/// Asked or open, and `me` in it: run `f` on it, then show both sides.
fn change(
    state: &SocialState,
    me: Uuid,
    id: &str,
    f: impl FnOnce(&mut Trade, usize) -> ApiResult<()>,
) -> ApiResult<()> {
    let mut g = state.trades.lock();
    let t = g.trade_of(me).ok_or_else(none)?;
    if t.id.to_string() != id {
        return Err(none());
    }
    if t.stage == Stage::Swapping {
        return Err(conflict("swapping", "It's changing hands right now."));
    }
    let i = t.of(me).ok_or_else(none)?;
    f(t, i)?;
    let t = t.clone();
    drop(g);
    push(state, &t);
    Ok(())
}

// ---- asking ----------------------------------------------------------------------

#[derive(Deserialize)]
pub struct AskReq {
    name: String,
}

pub async fn ask(
    State(state): S,
    headers: HeaderMap,
    Json(req): Json<AskReq>,
) -> ApiResult<Json<serde_json::Value>> {
    let (me, claims) = me(&state, &headers)?;
    let (other, other_name) = db::player_by_name(&state.db, &req.name)
        .await
        .map_err(db_err)?
        .ok_or_else(|| {
            ApiError::new(
                StatusCode::NOT_FOUND,
                "no_such_player",
                "Nobody here goes by that name.",
            )
        })?;
    if other == me {
        return Err(ApiError::bad_request("self", "That's you!"));
    }
    if db::blocked(&state.db, me, other).await.map_err(db_err)? {
        return Err(ApiError::new(
            StatusCode::FORBIDDEN,
            "blocked",
            "you can't reach this person",
        ));
    }
    // Face to face: both here, in the same place.
    let here = state.hub.location(me);
    if !state.hub.online(other) || here.is_none() || here != state.hub.location(other) {
        return Err(conflict(
            "not_here",
            "You need to be in the same place to trade.",
        ));
    }
    let mut g = state.trades.lock();
    if g.trade_of(me).is_some() {
        return Err(conflict("busy_you", "You're already in a trade."));
    }
    if g.trade_of(other).is_some() {
        return Err(conflict("busy", "They're busy with another trade."));
    }
    let t = Trade {
        id: Uuid::new_v4(),
        side: [
            Side {
                who: me,
                name: claims.name.clone(),
                ..Default::default()
            },
            Side {
                who: other,
                name: other_name,
                ..Default::default()
            },
        ],
        stage: Stage::Asked,
        asked_at: Instant::now(),
    };
    g.of.insert(me, t.id);
    g.of.insert(other, t.id);
    g.trades.insert(t.id, t.clone());
    drop(g);
    push(&state, &t);
    Ok(Json(view(&t, 0)))
}

#[derive(Deserialize)]
pub struct AnswerReq {
    id: String,
    yes: bool,
}

pub async fn answer(
    State(state): S,
    headers: HeaderMap,
    Json(req): Json<AnswerReq>,
) -> ApiResult<Json<serde_json::Value>> {
    let (me, _) = me(&state, &headers)?;
    let mut g = state.trades.lock();
    let t = g.trade_of(me).ok_or_else(none)?;
    if t.id.to_string() != req.id || t.stage != Stage::Asked || t.side[1].who != me {
        return Err(none());
    }
    if req.yes {
        t.stage = Stage::Open;
        let t = t.clone();
        drop(g);
        push(&state, &t);
    } else {
        let id = t.id;
        let t = g.end(id).ok_or_else(none)?;
        drop(g);
        push_end(&state, &t, "declined", Some(me));
    }
    Ok(Json(json!({ "ok": true })))
}

// ---- the table ---------------------------------------------------------------------

#[derive(Deserialize)]
pub struct OfferReq {
    id: String,
    /// `[item, qty]` pairs.
    items: Vec<(i32, i32)>,
    #[serde(default)]
    coins: i32,
}

/// What you may put up: not coins (they go by `coins`), nothing that's yours to keep.
fn tradeable(state: &SocialState, item: i32) -> bool {
    item != COIN
        && state
            .catalog
            .get(item)
            .is_some_and(|i| i.kind != "currency" && !i.account_bound())
}

/// How many of each of `items` `who` has.
async fn have(db: &sqlx::PgPool, who: Uuid, items: &[i32]) -> sqlx::Result<HashMap<i32, i32>> {
    let rows: Vec<(i32, i32)> = sqlx::query_as(
        "SELECT item_id, qty FROM inventory WHERE player_id = $1 AND item_id = ANY($2)",
    )
    .bind(who)
    .bind(items)
    .fetch_all(db)
    .await?;
    Ok(rows.into_iter().collect())
}

pub async fn offer(
    State(state): S,
    headers: HeaderMap,
    Json(req): Json<OfferReq>,
) -> ApiResult<Json<serde_json::Value>> {
    let (me, _) = me(&state, &headers)?;
    let mut items: BTreeMap<i32, i32> = BTreeMap::new();
    for (item, qty) in req.items {
        if qty <= 0 {
            continue;
        }
        if !tradeable(&state, item) {
            return Err(ApiError::bad_request(
                "not_tradeable",
                "That's yours to keep: it can't be traded.",
            ));
        }
        *items.entry(item).or_default() += qty;
    }
    if items.len() > MAX_LINES
        || items.values().any(|q| *q > MAX_QTY)
        || !(0..=MAX_COINS).contains(&req.coins)
    {
        return Err(ApiError::bad_request(
            "too_much",
            "That's more than fits on the table.",
        ));
    }
    // Only what's in your bag (checked again when it changes hands).
    let mut wanted: Vec<i32> = items.keys().copied().collect();
    wanted.push(COIN);
    let have = have(&state.db, me, &wanted).await.map_err(db_err)?;
    if req.coins > have.get(&COIN).copied().unwrap_or(0) {
        return Err(conflict(
            "not_enough_coins",
            "You don't have that many coins.",
        ));
    }
    if items
        .iter()
        .any(|(i, q)| *q > have.get(i).copied().unwrap_or(0))
    {
        return Err(conflict("not_enough", "You don't have that many."));
    }
    change(&state, me, &req.id, |t, i| {
        if t.stage != Stage::Open {
            return Err(conflict("not_open", "They haven't said yes yet."));
        }
        t.side[i].items = items;
        t.side[i].coins = req.coins;
        t.unlock();
        Ok(())
    })?;
    Ok(Json(json!({ "ok": true })))
}

#[derive(Deserialize)]
pub struct LockReq {
    id: String,
    on: bool,
}

/// Locks your side in (happy with what's on the table), or takes it off again.
pub async fn lock(
    State(state): S,
    headers: HeaderMap,
    Json(req): Json<LockReq>,
) -> ApiResult<Json<serde_json::Value>> {
    let (me, _) = me(&state, &headers)?;
    change(&state, me, &req.id, |t, i| {
        if t.stage != Stage::Open {
            return Err(conflict("not_open", "They haven't said yes yet."));
        }
        if t.side.iter().all(|s| s.items.is_empty() && s.coins == 0) && req.on {
            return Err(ApiError::bad_request(
                "empty",
                "Put something on the table first.",
            ));
        }
        t.side[i].locked = req.on;
        // (Unlocking takes back both "trade"s: there's something to look at again.)
        if !req.on {
            for s in &mut t.side {
                s.confirmed = false;
            }
        }
        Ok(())
    })?;
    Ok(Json(json!({ "ok": true })))
}

#[derive(Deserialize)]
pub struct IdReq {
    id: String,
}

pub async fn cancel(
    State(state): S,
    headers: HeaderMap,
    Json(req): Json<IdReq>,
) -> ApiResult<Json<serde_json::Value>> {
    let (me, _) = me(&state, &headers)?;
    let mut g = state.trades.lock();
    let t = g.trade_of(me).ok_or_else(none)?;
    if t.id.to_string() != req.id || t.stage == Stage::Swapping {
        return Err(none());
    }
    let id = t.id;
    let t = g.end(id).ok_or_else(none)?;
    drop(g);
    push_end(&state, &t, "cancelled", Some(me));
    Ok(Json(json!({ "ok": true })))
}

/// `who`'s gone (offline): any trade they're in is off.
pub fn gone(state: &SocialState, who: Uuid) {
    let mut g = state.trades.lock();
    let Some(id) = g.of.get(&who).copied() else {
        return;
    };
    if g.trades
        .get(&id)
        .is_some_and(|t| t.stage == Stage::Swapping)
    {
        return;
    }
    let t = g.end(id);
    drop(g);
    if let Some(t) = t {
        push_end(state, &t, "left", Some(who));
    }
}

pub async fn mine(State(state): S, headers: HeaderMap) -> ApiResult<Json<serde_json::Value>> {
    let (me, _) = me(&state, &headers)?;
    let mut g = state.trades.lock();
    let Some(t) = g.trade_of(me) else {
        return Ok(Json(json!({ "trade": null })));
    };
    let i = t.of(me).unwrap_or(0);
    Ok(Json(json!({ "trade": view(t, i) })))
}

// ---- changing hands ------------------------------------------------------------------

/// What `who` (side `i`) gives and gets, as one bag change.
fn ops_for(t: &Trade, i: usize) -> Vec<Op> {
    let mut d: BTreeMap<i32, i32> = BTreeMap::new();
    let (mine, theirs) = (&t.side[i], &t.side[1 - i]);
    for (item, q) in &mine.items {
        *d.entry(*item).or_default() -= q;
    }
    for (item, q) in &theirs.items {
        *d.entry(*item).or_default() += q;
    }
    *d.entry(COIN).or_default() += theirs.coins - mine.coins;
    // (Spending first, so a short bag fails before anything's added.)
    let mut ops: Vec<Op> = d
        .into_iter()
        .filter(|(_, delta)| *delta != 0)
        .map(|(item, delta)| Op { item, delta })
        .collect();
    ops.sort_by_key(|o| o.delta > 0);
    ops
}

/// Says "trade" (both locked in); when both have, it changes hands.
pub async fn confirm(
    State(state): S,
    headers: HeaderMap,
    Json(req): Json<IdReq>,
) -> ApiResult<Json<serde_json::Value>> {
    let (me, _) = me(&state, &headers)?;
    let mut ready = None;
    change(&state, me, &req.id, |t, i| {
        if t.stage != Stage::Open || !t.side.iter().all(|s| s.locked) {
            return Err(conflict("not_locked", "Both of you lock in first."));
        }
        t.side[i].confirmed = true;
        if t.side.iter().all(|s| s.confirmed) {
            t.stage = Stage::Swapping;
            ready = Some(t.clone());
        }
        Ok(())
    })?;
    let Some(t) = ready else {
        return Ok(Json(json!({ "ok": true, "done": false })));
    };
    match swap(&state, &t).await {
        Ok(()) => {
            state.trades.lock().end(t.id);
            for (i, s) in t.side.iter().enumerate() {
                let other = &t.side[1 - i];
                state.hub.send(
                    s.who,
                    &json!({ "t": "trade", "trade": { "id": t.id.to_string(), "state": "done",
                        "with": other.name, "gave": side_json(s), "got": side_json(other) } }),
                );
            }
            Ok(Json(json!({ "ok": true, "done": true })))
        }
        Err(e) => {
            // Nothing moved: back on the table, unlocked, and why.
            let mut g = state.trades.lock();
            let t = g.trades.get_mut(&t.id).map(|t| {
                t.stage = Stage::Open;
                t.unlock();
                t.clone()
            });
            drop(g);
            if let Some(t) = t {
                push(&state, &t);
            }
            Err(e)
        }
    }
}

/// Both bags, in one transaction: all of it changes hands, or none.
async fn swap(state: &SocialState, t: &Trade) -> ApiResult<()> {
    let mut tx = state.db.begin().await.map_err(db_err)?;
    for (i, s) in t.side.iter().enumerate() {
        let ops = ops_for(t, i);
        if ops.is_empty() {
            continue;
        }
        let key = format!("trade:{}:{}", t.id, s.who);
        apply(&mut tx, &state.catalog, s.who, &ops, "trade", &key)
            .await
            .map_err(|e| match e {
                EconError::Insufficient(COIN) => conflict(
                    "short",
                    &format!("{} doesn't have those coins any more.", s.name),
                ),
                EconError::Insufficient(item) => conflict(
                    "short",
                    &format!(
                        "{} doesn't have the {} any more.",
                        s.name,
                        state
                            .catalog
                            .get(item)
                            .map(|i| i.name.as_str())
                            .unwrap_or("things")
                    ),
                ),
                e => e.into(),
            })?;
    }
    tx.commit().await.map_err(db_err)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn side(who: u128, items: &[(i32, i32)], coins: i32) -> Side {
        Side {
            who: Uuid::from_u128(who),
            items: items.iter().copied().collect(),
            coins,
            ..Default::default()
        }
    }

    fn trade(a: Side, b: Side) -> Trade {
        Trade {
            id: Uuid::nil(),
            side: [a, b],
            stage: Stage::Open,
            asked_at: Instant::now(),
        }
    }

    #[test]
    fn each_side_gives_theirs_and_gets_the_others() {
        let t = trade(side(1, &[(500, 2)], 10), side(2, &[(600, 1)], 0));
        let a: Vec<_> = ops_for(&t, 0).iter().map(|o| (o.item, o.delta)).collect();
        let b: Vec<_> = ops_for(&t, 1).iter().map(|o| (o.item, o.delta)).collect();
        // Spending first.
        assert_eq!(a, vec![(COIN, -10), (500, -2), (600, 1)]);
        assert_eq!(b, vec![(600, -1), (COIN, 10), (500, 2)]);
    }

    #[test]
    fn a_present_is_a_trade_with_one_side_empty() {
        let t = trade(side(1, &[(500, 1)], 0), side(2, &[], 0));
        assert_eq!(ops_for(&t, 0).len(), 1);
        let b: Vec<_> = ops_for(&t, 1).iter().map(|o| (o.item, o.delta)).collect();
        assert_eq!(b, vec![(500, 1)]);
    }

    #[test]
    fn the_same_thing_both_ways_cancels_out() {
        let t = trade(side(1, &[(500, 3)], 5), side(2, &[(500, 3)], 5));
        assert!(ops_for(&t, 0).is_empty());
        assert!(ops_for(&t, 1).is_empty());
    }

    #[test]
    fn an_unanswered_ask_goes_stale() {
        let mut g = Inner::default();
        let mut t = trade(side(1, &[], 0), side(2, &[], 0));
        t.stage = Stage::Asked;
        t.asked_at = Instant::now() - ASK_TTL - Duration::from_secs(1);
        g.of.insert(t.side[0].who, t.id);
        g.of.insert(t.side[1].who, t.id);
        g.trades.insert(t.id, t);
        assert!(g.trade_of(Uuid::from_u128(2)).is_none());
        assert!(g.of.is_empty() && g.trades.is_empty());
    }
}
