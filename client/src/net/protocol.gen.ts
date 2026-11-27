// AUTO-GENERATED from server/crates/protocol by `cargo run -p commons-protocol --bin gen-ts`.
// Do not edit by hand.
/* eslint-disable */

export const PROTOCOL_VERSION = 67;
export const CELL_TILES = 16;

export class Writer {
  private buf = new Uint8Array(64);
  private view = new DataView(this.buf.buffer);
  private len = 0;
  private reserve(n: number) {
    if (this.len + n <= this.buf.length) return;
    const next = new Uint8Array(Math.max(this.buf.length * 2, this.len + n));
    next.set(this.buf);
    this.buf = next;
    this.view = new DataView(next.buffer);
  }
  u8(v: number) { this.reserve(1); this.view.setUint8(this.len, v); this.len += 1; }
  u16(v: number) { this.reserve(2); this.view.setUint16(this.len, v, true); this.len += 2; }
  u32(v: number) { this.reserve(4); this.view.setUint32(this.len, v >>> 0, true); this.len += 4; }
  bool(v: boolean) { this.u8(v ? 1 : 0); }
  bytes(b: Uint8Array) { this.reserve(b.length); this.buf.set(b, this.len); this.len += b.length; }
  str(v: string) { const b = textEncoder.encode(v); this.u16(b.length); this.bytes(b); }
  vec<T>(v: T[], f: (x: T) => void) { this.u16(v.length); for (const x of v) f(x); }
  finish(): Uint8Array { return this.buf.slice(0, this.len); }
}

export class Reader {
  private view: DataView;
  private pos = 0;
  constructor(private buf: Uint8Array) {
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  private need(n: number) { if (this.pos + n > this.buf.length) throw new Error("protocol: unexpected end of message"); }
  u8() { this.need(1); return this.view.getUint8(this.pos++); }
  u16() { this.need(2); const v = this.view.getUint16(this.pos, true); this.pos += 2; return v; }
  u32() { this.need(4); const v = this.view.getUint32(this.pos, true); this.pos += 4; return v; }
  bool() { return this.u8() !== 0; }
  str() { const n = this.u16(); this.need(n); const s = textDecoder.decode(this.buf.subarray(this.pos, this.pos + n)); this.pos += n; return s; }
  vec<T>(f: () => T): T[] { const n = this.u16(); const out: T[] = []; for (let i = 0; i < n; i++) out.push(f()); return out; }
  done() { if (this.pos !== this.buf.length) throw new Error(`protocol: ${this.buf.length - this.pos} trailing bytes`); }
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8", { fatal: true });

/** Packs encoded messages into one frame of `[u16 length][message]` entries. */
export function encodeFrame(msgs: Uint8Array[]): Uint8Array {
  const w = new Writer();
  for (const m of msgs) { w.u16(m.length); w.bytes(m); }
  return w.finish();
}

/** Splits a frame into its encoded messages. */
export function splitFrame(frame: Uint8Array): Uint8Array[] {
  const out: Uint8Array[] = [];
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
  let pos = 0;
  while (pos < frame.length) {
    if (pos + 2 > frame.length) throw new Error("protocol: truncated frame");
    const n = view.getUint16(pos, true);
    pos += 2;
    if (pos + n > frame.length) throw new Error("protocol: truncated frame");
    out.push(frame.subarray(pos, pos + n));
    pos += n;
  }
  return out;
}

export interface Tile {
  x: number;
  y: number;
}

export function encTile(w: Writer, v: Tile) {
  w.u16(v.x);
  w.u16(v.y);
}

export function decTile(r: Reader): Tile {
  return {
    x: r.u16(),
    y: r.u16(),
  };
}

export interface PoolBall {
  n: number;
  x: number;
  y: number;
}

export function encPoolBall(w: Writer, v: PoolBall) {
  w.u8(v.n);
  w.u16(v.x);
  w.u16(v.y);
}

export function decPoolBall(r: Reader): PoolBall {
  return {
    n: r.u8(),
    x: r.u16(),
    y: r.u16(),
  };
}

export interface ArenaFighter {
  id: number;
  x: number;
  y: number;
  aim: number;
  hp: number;
  stamina: number;
  rage: number;
  act: number;
  actMs: number;
  charge: number;
  flags: number;
  holding: number;
  fix: number;
  kit: number;
  buffs: number;
}

export function encArenaFighter(w: Writer, v: ArenaFighter) {
  w.u32(v.id);
  w.u16(v.x);
  w.u16(v.y);
  w.u16(v.aim);
  w.u16(v.hp);
  w.u8(v.stamina);
  w.u8(v.rage);
  w.u8(v.act);
  w.u16(v.actMs);
  w.u8(v.charge);
  w.u8(v.flags);
  w.u8(v.holding);
  w.u8(v.fix);
  w.u8(v.kit);
  w.u8(v.buffs);
}

export function decArenaFighter(r: Reader): ArenaFighter {
  return {
    id: r.u32(),
    x: r.u16(),
    y: r.u16(),
    aim: r.u16(),
    hp: r.u16(),
    stamina: r.u8(),
    rage: r.u8(),
    act: r.u8(),
    actMs: r.u16(),
    charge: r.u8(),
    flags: r.u8(),
    holding: r.u8(),
    fix: r.u8(),
    kit: r.u8(),
    buffs: r.u8(),
  };
}

export interface ArenaLion {
  id: number;
  kind: number;
  x: number;
  y: number;
  aim: number;
  hp: number;
  act: number;
  actMs: number;
  toX: number;
  toY: number;
  item: number;
}

export function encArenaLion(w: Writer, v: ArenaLion) {
  w.u8(v.id);
  w.u8(v.kind);
  w.u16(v.x);
  w.u16(v.y);
  w.u16(v.aim);
  w.u8(v.hp);
  w.u8(v.act);
  w.u16(v.actMs);
  w.u16(v.toX);
  w.u16(v.toY);
  w.u8(v.item);
}

export function decArenaLion(r: Reader): ArenaLion {
  return {
    id: r.u8(),
    kind: r.u8(),
    x: r.u16(),
    y: r.u16(),
    aim: r.u16(),
    hp: r.u8(),
    act: r.u8(),
    actMs: r.u16(),
    toX: r.u16(),
    toY: r.u16(),
    item: r.u8(),
  };
}

export interface ArenaCloud {
  id: number;
  x: number;
  y: number;
}

export function encArenaCloud(w: Writer, v: ArenaCloud) {
  w.u8(v.id);
  w.u16(v.x);
  w.u16(v.y);
}

export function decArenaCloud(r: Reader): ArenaCloud {
  return {
    id: r.u8(),
    x: r.u16(),
    y: r.u16(),
  };
}

export interface ArenaGift {
  kind: number;
  x: number;
  y: number;
  landsMs: number;
}

export function encArenaGift(w: Writer, v: ArenaGift) {
  w.u8(v.kind);
  w.u16(v.x);
  w.u16(v.y);
  w.u16(v.landsMs);
}

export function decArenaGift(r: Reader): ArenaGift {
  return {
    kind: r.u8(),
    x: r.u16(),
    y: r.u16(),
    landsMs: r.u16(),
  };
}

export interface ArenaStat {
  id: number;
  kills: number;
  damage: number;
  hits: number;
  taken: number;
  downs: number;
  matchKills: number;
  matchDamage: number;
}

export function encArenaStat(w: Writer, v: ArenaStat) {
  w.u32(v.id);
  w.u8(v.kills);
  w.u16(v.damage);
  w.u16(v.hits);
  w.u16(v.taken);
  w.u8(v.downs);
  w.u16(v.matchKills);
  w.u32(v.matchDamage);
}

export function decArenaStat(r: Reader): ArenaStat {
  return {
    id: r.u32(),
    kills: r.u8(),
    damage: r.u16(),
    hits: r.u16(),
    taken: r.u16(),
    downs: r.u8(),
    matchKills: r.u16(),
    matchDamage: r.u32(),
  };
}

export interface PbPlayer {
  id: number;
  team: number;
  x: number;
  y: number;
  aim: number;
  hp: number;
  ammo: number;
  flags: number;
  power: number;
  powerMs: number;
  respawnMs: number;
  dashMs: number;
  reloadMs: number;
  kills: number;
  deaths: number;
  streak: number;
  fix: number;
  class: number;
}

export function encPbPlayer(w: Writer, v: PbPlayer) {
  w.u32(v.id);
  w.u8(v.team);
  w.u16(v.x);
  w.u16(v.y);
  w.u16(v.aim);
  w.u8(v.hp);
  w.u8(v.ammo);
  w.u8(v.flags);
  w.u8(v.power);
  w.u16(v.powerMs);
  w.u16(v.respawnMs);
  w.u16(v.dashMs);
  w.u16(v.reloadMs);
  w.u8(v.kills);
  w.u8(v.deaths);
  w.u8(v.streak);
  w.u8(v.fix);
  w.u8(v.class);
}

export function decPbPlayer(r: Reader): PbPlayer {
  return {
    id: r.u32(),
    team: r.u8(),
    x: r.u16(),
    y: r.u16(),
    aim: r.u16(),
    hp: r.u8(),
    ammo: r.u8(),
    flags: r.u8(),
    power: r.u8(),
    powerMs: r.u16(),
    respawnMs: r.u16(),
    dashMs: r.u16(),
    reloadMs: r.u16(),
    kills: r.u8(),
    deaths: r.u8(),
    streak: r.u8(),
    fix: r.u8(),
    class: r.u8(),
  };
}

export interface PbFlag {
  x: number;
  y: number;
  carrier: number;
  home: boolean;
}

export function encPbFlag(w: Writer, v: PbFlag) {
  w.u16(v.x);
  w.u16(v.y);
  w.u32(v.carrier);
  w.bool(v.home);
}

export function decPbFlag(r: Reader): PbFlag {
  return {
    x: r.u16(),
    y: r.u16(),
    carrier: r.u32(),
    home: r.bool(),
  };
}

export interface PbPoint {
  x: number;
  y: number;
  r: number;
  value: number;
  owner: number;
  progress: number;
}

export function encPbPoint(w: Writer, v: PbPoint) {
  w.u16(v.x);
  w.u16(v.y);
  w.u8(v.r);
  w.u8(v.value);
  w.u8(v.owner);
  w.u8(v.progress);
}

export function decPbPoint(r: Reader): PbPoint {
  return {
    x: r.u16(),
    y: r.u16(),
    r: r.u8(),
    value: r.u8(),
    owner: r.u8(),
    progress: r.u8(),
  };
}

export interface PbPickup {
  kind: number;
  x: number;
  y: number;
}

export function encPbPickup(w: Writer, v: PbPickup) {
  w.u8(v.kind);
  w.u16(v.x);
  w.u16(v.y);
}

export function decPbPickup(r: Reader): PbPickup {
  return {
    kind: r.u8(),
    x: r.u16(),
    y: r.u16(),
  };
}

export interface SkateEntry {
  name: string;
  points: number;
}

export function encSkateEntry(w: Writer, v: SkateEntry) {
  w.str(v.name);
  w.u32(v.points);
}

export function decSkateEntry(r: Reader): SkateEntry {
  return {
    name: r.str(),
    points: r.u32(),
  };
}

export interface GolfDuelBall {
  x: number;
  y: number;
  state: number;
}

export function encGolfDuelBall(w: Writer, v: GolfDuelBall) {
  w.u16(v.x);
  w.u16(v.y);
  w.u8(v.state);
}

export function decGolfDuelBall(r: Reader): GolfDuelBall {
  return {
    x: r.u16(),
    y: r.u16(),
    state: r.u8(),
  };
}

export interface MapDot {
  id: number;
  x: number;
  y: number;
  name: string;
  bot: boolean;
}

export function encMapDot(w: Writer, v: MapDot) {
  w.u32(v.id);
  w.u16(v.x);
  w.u16(v.y);
  w.str(v.name);
  w.bool(v.bot);
}

export function decMapDot(r: Reader): MapDot {
  return {
    id: r.u32(),
    x: r.u16(),
    y: r.u16(),
    name: r.str(),
    bot: r.bool(),
  };
}

export interface EntityInfo {
  id: number;
  name: string;
  look: number;
  style: number;
  pet: number;
  vehicle: number;
  tool: number;
  x: number;
  y: number;
  state: number;
  speedX10: number;
  t0: number;
  sprintIn: number;
  path: Tile[];
  mood: number;
  away: boolean;
  reading: number;
  calling: boolean;
  bot: boolean;
}

export function encEntityInfo(w: Writer, v: EntityInfo) {
  w.u32(v.id);
  w.str(v.name);
  w.u32(v.look);
  w.u32(v.style);
  w.u32(v.pet);
  w.u8(v.vehicle);
  w.u8(v.tool);
  w.u16(v.x);
  w.u16(v.y);
  w.u8(v.state);
  w.u8(v.speedX10);
  w.u32(v.t0);
  w.u16(v.sprintIn);
  w.vec(v.path, (x) => encTile(w, x));
  w.u8(v.mood);
  w.bool(v.away);
  w.u32(v.reading);
  w.bool(v.calling);
  w.bool(v.bot);
}

export function decEntityInfo(r: Reader): EntityInfo {
  return {
    id: r.u32(),
    name: r.str(),
    look: r.u32(),
    style: r.u32(),
    pet: r.u32(),
    vehicle: r.u8(),
    tool: r.u8(),
    x: r.u16(),
    y: r.u16(),
    state: r.u8(),
    speedX10: r.u8(),
    t0: r.u32(),
    sprintIn: r.u16(),
    path: r.vec(() => decTile(r)),
    mood: r.u8(),
    away: r.bool(),
    reading: r.u32(),
    calling: r.bool(),
    bot: r.bool(),
  };
}

export type ClientMsg =
  | { t: "Hello"; joinToken: string; version: number; viewW: number; viewH: number; device: number }
  | { t: "MoveTo"; x: number; y: number; sprint: boolean }
  | { t: "Emote"; emote: number }
  | { t: "ChatSay"; text: string }
  | { t: "Ping"; clientT: number }
  | { t: "Sit"; seat: number }
  | { t: "Stand" }
  | { t: "GameMove"; table: number; uci: string }
  | { t: "FishCast"; x: number; y: number; magnet: boolean }
  | { t: "FishReel"; quality: number }
  | { t: "PlotAction"; x: number; y: number; action: number; item: number }
  | { t: "Place"; item: number; x: number; y: number; rot: number }
  | { t: "Pickup"; x: number; y: number }
  | { t: "JamNote"; instrument: number; pitch: number; beat: number }
  | { t: "Paint"; easel: number; cell: number; color: number }
  | { t: "SetMood"; mood: number }
  | { t: "Offer"; to: number; kind: number }
  | { t: "Accept"; from: number; kind: number }
  | { t: "SkyLantern"; text: string }
  | { t: "SetLook"; look: number }
  | { t: "RpsPick"; pick: number }
  | { t: "Drink"; kind: number }
  | { t: "PoolJoin"; vsBot: boolean }
  | { t: "PoolLeave" }
  | { t: "PoolShoot"; angle: number; power: number }
  | { t: "ArcadeJoin"; cab: number; vsBot: boolean }
  | { t: "ArcadeLeave"; cab: number }
  | { t: "ArcadeInput"; cab: number; value: number }
  | { t: "PoolAim"; angle: number; pull: number }
  | { t: "Away"; away: boolean }
  | { t: "FishHit" }
  | { t: "Reading"; book: number }
  | { t: "Calling"; on: boolean }
  | { t: "Going"; zone: string; arrive: string }
  | { t: "ThrowLure"; x: number; y: number; kind: number }
  | { t: "BowlJoin"; lane: number; vsBot: boolean }
  | { t: "BowlLeave"; lane: number }
  | { t: "BowlRoll"; lane: number; aim: number; power: number }
  | { t: "ArenaJoin" }
  | { t: "ArenaLeave" }
  | { t: "ArenaMove"; x: number; y: number; aim: number; reach: number }
  | { t: "ArenaAct"; act: number; aim: number; reach: number }
  | { t: "OpenCrate" }
  | { t: "Boat"; op: number }
  | { t: "PbJoin"; team: number }
  | { t: "PbLeave" }
  | { t: "PbStart"; bots: boolean }
  | { t: "PbMove"; x: number; y: number; aim: number }
  | { t: "PbFire"; shot: number; x: number; y: number; aim: number }
  | { t: "PbDash" }
  | { t: "PbReload" }
  | { t: "ArenaStart"; bots: boolean }
  | { t: "ArenaBot"; slot: number; on: boolean }
  | { t: "ArenaLevel"; level: number }
  | { t: "PbBot"; slot: number; on: boolean }
  | { t: "PbLevel"; level: number }
  | { t: "ArenaMode"; mode: number; goliath: number }
  | { t: "ArenaKits"; on: boolean }
  | { t: "ArenaKit"; kit: number }
  | { t: "ArenaLobby" }
  | { t: "ArenaWheel"; on: boolean }
  | { t: "ArenaVote"; kind: number }
  | { t: "ArenaDisasters"; on: boolean }
  | { t: "ArenaBet"; pick: number }
  | { t: "ArenaSwitch"; slot: number }
  | { t: "SalvageReel"; target: boolean; extras: number }
  | { t: "UseObject"; x: number; y: number }
  | { t: "TankPut"; x: number; y: number; fish: number }
  | { t: "TankTake"; x: number; y: number; index: number }
  | { t: "TankFeed"; x: number; y: number }
  | { t: "SkateOn"; on: boolean; kit: number }
  | { t: "SkateMove"; x: number; y: number; z: number; dir: number; pose: number; trick: number; spin: number; sent: number; kit: number }
  | { t: "SkateScore"; kind: number; points: number; label: string }
  | { t: "SkateQuest"; day: number; slot: number }
  | { t: "SkateDuel"; join: boolean; bot: boolean; grinds: boolean }
  | { t: "SkateDuelScore"; points: number; done: boolean }
  | { t: "PbBet"; pick: number }
  | { t: "PbClass"; class: number }
  | { t: "PbMode"; mode: number }
  | { t: "GolfBall"; hole: number; x: number; y: number; strokes: number; state: number }
  | { t: "GolfCard"; strokes: number[] }
  | { t: "GolfBoardAsk" }
  | { t: "GolfDuelShot"; balls: GolfDuelBall[]; done: boolean; penalty: number }
  | { t: "GolfDuelLeave" }
  | { t: "GolfDuelBot" }
  | { t: "GolfDuelSeek"; on: boolean }
  | { t: "PetFishHit" }
  | { t: "PetGoal"; x: number; y: number; kind: number }
  | { t: "PetDuoMove"; x: number }
  | { t: "PetDuoCatch"; treat: number }
  | { t: "PetBounceTap"; n: number; q: number }
  | { t: "PetBounceAt"; x: number }
  | { t: "PetBounceStar"; n: number; k: number }
  | { t: "PetBounceAgain"; on: boolean }
  ;

export function encodeClientMsg(m: ClientMsg): Uint8Array {
  const w = new Writer();
  switch (m.t) {
    case "Hello":
      w.u8(1);
      w.str(m.joinToken);
      w.u16(m.version);
      w.u8(m.viewW);
      w.u8(m.viewH);
      w.u32(m.device);
      break;
    case "MoveTo":
      w.u8(2);
      w.u16(m.x);
      w.u16(m.y);
      w.bool(m.sprint);
      break;
    case "Emote":
      w.u8(3);
      w.u8(m.emote);
      break;
    case "ChatSay":
      w.u8(4);
      w.str(m.text);
      break;
    case "Ping":
      w.u8(5);
      w.u32(m.clientT);
      break;
    case "Sit":
      w.u8(6);
      w.u32(m.seat);
      break;
    case "Stand":
      w.u8(7);
      break;
    case "GameMove":
      w.u8(8);
      w.u32(m.table);
      w.str(m.uci);
      break;
    case "FishCast":
      w.u8(9);
      w.u16(m.x);
      w.u16(m.y);
      w.bool(m.magnet);
      break;
    case "FishReel":
      w.u8(10);
      w.u16(m.quality);
      break;
    case "PlotAction":
      w.u8(11);
      w.u16(m.x);
      w.u16(m.y);
      w.u8(m.action);
      w.u32(m.item);
      break;
    case "Place":
      w.u8(12);
      w.u32(m.item);
      w.u16(m.x);
      w.u16(m.y);
      w.u8(m.rot);
      break;
    case "Pickup":
      w.u8(13);
      w.u16(m.x);
      w.u16(m.y);
      break;
    case "JamNote":
      w.u8(14);
      w.u8(m.instrument);
      w.u8(m.pitch);
      w.u32(m.beat);
      break;
    case "Paint":
      w.u8(15);
      w.u8(m.easel);
      w.u16(m.cell);
      w.u8(m.color);
      break;
    case "SetMood":
      w.u8(16);
      w.u8(m.mood);
      break;
    case "Offer":
      w.u8(17);
      w.u32(m.to);
      w.u8(m.kind);
      break;
    case "Accept":
      w.u8(18);
      w.u32(m.from);
      w.u8(m.kind);
      break;
    case "SkyLantern":
      w.u8(19);
      w.str(m.text);
      break;
    case "SetLook":
      w.u8(20);
      w.u32(m.look);
      break;
    case "RpsPick":
      w.u8(22);
      w.u8(m.pick);
      break;
    case "Drink":
      w.u8(23);
      w.u8(m.kind);
      break;
    case "PoolJoin":
      w.u8(24);
      w.bool(m.vsBot);
      break;
    case "PoolLeave":
      w.u8(25);
      break;
    case "PoolShoot":
      w.u8(26);
      w.u16(m.angle);
      w.u16(m.power);
      break;
    case "ArcadeJoin":
      w.u8(27);
      w.u8(m.cab);
      w.bool(m.vsBot);
      break;
    case "ArcadeLeave":
      w.u8(28);
      w.u8(m.cab);
      break;
    case "ArcadeInput":
      w.u8(29);
      w.u8(m.cab);
      w.u16(m.value);
      break;
    case "PoolAim":
      w.u8(30);
      w.u16(m.angle);
      w.u16(m.pull);
      break;
    case "Away":
      w.u8(31);
      w.bool(m.away);
      break;
    case "FishHit":
      w.u8(32);
      break;
    case "Reading":
      w.u8(33);
      w.u32(m.book);
      break;
    case "Calling":
      w.u8(34);
      w.bool(m.on);
      break;
    case "Going":
      w.u8(35);
      w.str(m.zone);
      w.str(m.arrive);
      break;
    case "ThrowLure":
      w.u8(36);
      w.u16(m.x);
      w.u16(m.y);
      w.u8(m.kind);
      break;
    case "BowlJoin":
      w.u8(37);
      w.u8(m.lane);
      w.bool(m.vsBot);
      break;
    case "BowlLeave":
      w.u8(38);
      w.u8(m.lane);
      break;
    case "BowlRoll":
      w.u8(39);
      w.u8(m.lane);
      w.u16(m.aim);
      w.u16(m.power);
      break;
    case "ArenaJoin":
      w.u8(40);
      break;
    case "ArenaLeave":
      w.u8(41);
      break;
    case "ArenaMove":
      w.u8(42);
      w.u16(m.x);
      w.u16(m.y);
      w.u16(m.aim);
      w.u16(m.reach);
      break;
    case "ArenaAct":
      w.u8(43);
      w.u8(m.act);
      w.u16(m.aim);
      w.u16(m.reach);
      break;
    case "OpenCrate":
      w.u8(44);
      break;
    case "Boat":
      w.u8(45);
      w.u8(m.op);
      break;
    case "PbJoin":
      w.u8(46);
      w.u8(m.team);
      break;
    case "PbLeave":
      w.u8(47);
      break;
    case "PbStart":
      w.u8(48);
      w.bool(m.bots);
      break;
    case "PbMove":
      w.u8(49);
      w.u16(m.x);
      w.u16(m.y);
      w.u16(m.aim);
      break;
    case "PbFire":
      w.u8(50);
      w.u16(m.shot);
      w.u16(m.x);
      w.u16(m.y);
      w.u16(m.aim);
      break;
    case "PbDash":
      w.u8(51);
      break;
    case "PbReload":
      w.u8(52);
      break;
    case "ArenaStart":
      w.u8(53);
      w.bool(m.bots);
      break;
    case "ArenaBot":
      w.u8(54);
      w.u8(m.slot);
      w.bool(m.on);
      break;
    case "ArenaLevel":
      w.u8(55);
      w.u8(m.level);
      break;
    case "PbBot":
      w.u8(56);
      w.u8(m.slot);
      w.bool(m.on);
      break;
    case "PbLevel":
      w.u8(57);
      w.u8(m.level);
      break;
    case "ArenaMode":
      w.u8(58);
      w.u8(m.mode);
      w.u8(m.goliath);
      break;
    case "ArenaKits":
      w.u8(59);
      w.bool(m.on);
      break;
    case "ArenaKit":
      w.u8(60);
      w.u8(m.kit);
      break;
    case "ArenaLobby":
      w.u8(61);
      break;
    case "ArenaWheel":
      w.u8(62);
      w.bool(m.on);
      break;
    case "ArenaVote":
      w.u8(67);
      w.u8(m.kind);
      break;
    case "ArenaDisasters":
      w.u8(68);
      w.bool(m.on);
      break;
    case "ArenaBet":
      w.u8(69);
      w.u8(m.pick);
      break;
    case "ArenaSwitch":
      w.u8(70);
      w.u8(m.slot);
      break;
    case "SalvageReel":
      w.u8(63);
      w.bool(m.target);
      w.u8(m.extras);
      break;
    case "UseObject":
      w.u8(64);
      w.u16(m.x);
      w.u16(m.y);
      break;
    case "TankPut":
      w.u8(65);
      w.u16(m.x);
      w.u16(m.y);
      w.u32(m.fish);
      break;
    case "TankTake":
      w.u8(66);
      w.u16(m.x);
      w.u16(m.y);
      w.u8(m.index);
      break;
    case "TankFeed":
      w.u8(71);
      w.u16(m.x);
      w.u16(m.y);
      break;
    case "SkateOn":
      w.u8(72);
      w.bool(m.on);
      w.u32(m.kit);
      break;
    case "SkateMove":
      w.u8(73);
      w.u16(m.x);
      w.u16(m.y);
      w.u8(m.z);
      w.u16(m.dir);
      w.u8(m.pose);
      w.u8(m.trick);
      w.u16(m.spin);
      w.u16(m.sent);
      w.u32(m.kit);
      break;
    case "SkateScore":
      w.u8(74);
      w.u8(m.kind);
      w.u32(m.points);
      w.str(m.label);
      break;
    case "SkateQuest":
      w.u8(75);
      w.u32(m.day);
      w.u8(m.slot);
      break;
    case "SkateDuel":
      w.u8(76);
      w.bool(m.join);
      w.bool(m.bot);
      w.bool(m.grinds);
      break;
    case "SkateDuelScore":
      w.u8(77);
      w.u32(m.points);
      w.bool(m.done);
      break;
    case "PbBet":
      w.u8(78);
      w.u8(m.pick);
      break;
    case "PbClass":
      w.u8(79);
      w.u8(m.class);
      break;
    case "PbMode":
      w.u8(80);
      w.u8(m.mode);
      break;
    case "GolfBall":
      w.u8(81);
      w.u8(m.hole);
      w.u16(m.x);
      w.u16(m.y);
      w.u8(m.strokes);
      w.u8(m.state);
      break;
    case "GolfCard":
      w.u8(82);
      w.vec(m.strokes, (x) => w.u8(x));
      break;
    case "GolfBoardAsk":
      w.u8(83);
      break;
    case "GolfDuelShot":
      w.u8(84);
      w.vec(m.balls, (x) => encGolfDuelBall(w, x));
      w.bool(m.done);
      w.u8(m.penalty);
      break;
    case "GolfDuelLeave":
      w.u8(85);
      break;
    case "GolfDuelBot":
      w.u8(86);
      break;
    case "GolfDuelSeek":
      w.u8(87);
      w.bool(m.on);
      break;
    case "PetFishHit":
      w.u8(88);
      break;
    case "PetGoal":
      w.u8(89);
      w.u16(m.x);
      w.u16(m.y);
      w.u8(m.kind);
      break;
    case "PetDuoMove":
      w.u8(90);
      w.u16(m.x);
      break;
    case "PetDuoCatch":
      w.u8(91);
      w.u16(m.treat);
      break;
    case "PetBounceTap":
      w.u8(92);
      w.u16(m.n);
      w.u8(m.q);
      break;
    case "PetBounceAt":
      w.u8(93);
      w.u16(m.x);
      break;
    case "PetBounceStar":
      w.u8(94);
      w.u16(m.n);
      w.u8(m.k);
      break;
    case "PetBounceAgain":
      w.u8(95);
      w.bool(m.on);
      break;
  }
  return w.finish();
}

export function decodeClientMsg(b: Uint8Array): ClientMsg {
  const r = new Reader(b);
  let m: ClientMsg;
  const tag = r.u8();
  switch (tag) {
    case 1:
      m = { t: "Hello", joinToken: r.str(), version: r.u16(), viewW: r.u8(), viewH: r.u8(), device: r.u32() };
      break;
    case 2:
      m = { t: "MoveTo", x: r.u16(), y: r.u16(), sprint: r.bool() };
      break;
    case 3:
      m = { t: "Emote", emote: r.u8() };
      break;
    case 4:
      m = { t: "ChatSay", text: r.str() };
      break;
    case 5:
      m = { t: "Ping", clientT: r.u32() };
      break;
    case 6:
      m = { t: "Sit", seat: r.u32() };
      break;
    case 7:
      m = { t: "Stand" };
      break;
    case 8:
      m = { t: "GameMove", table: r.u32(), uci: r.str() };
      break;
    case 9:
      m = { t: "FishCast", x: r.u16(), y: r.u16(), magnet: r.bool() };
      break;
    case 10:
      m = { t: "FishReel", quality: r.u16() };
      break;
    case 11:
      m = { t: "PlotAction", x: r.u16(), y: r.u16(), action: r.u8(), item: r.u32() };
      break;
    case 12:
      m = { t: "Place", item: r.u32(), x: r.u16(), y: r.u16(), rot: r.u8() };
      break;
    case 13:
      m = { t: "Pickup", x: r.u16(), y: r.u16() };
      break;
    case 14:
      m = { t: "JamNote", instrument: r.u8(), pitch: r.u8(), beat: r.u32() };
      break;
    case 15:
      m = { t: "Paint", easel: r.u8(), cell: r.u16(), color: r.u8() };
      break;
    case 16:
      m = { t: "SetMood", mood: r.u8() };
      break;
    case 17:
      m = { t: "Offer", to: r.u32(), kind: r.u8() };
      break;
    case 18:
      m = { t: "Accept", from: r.u32(), kind: r.u8() };
      break;
    case 19:
      m = { t: "SkyLantern", text: r.str() };
      break;
    case 20:
      m = { t: "SetLook", look: r.u32() };
      break;
    case 22:
      m = { t: "RpsPick", pick: r.u8() };
      break;
    case 23:
      m = { t: "Drink", kind: r.u8() };
      break;
    case 24:
      m = { t: "PoolJoin", vsBot: r.bool() };
      break;
    case 25:
      m = { t: "PoolLeave" };
      break;
    case 26:
      m = { t: "PoolShoot", angle: r.u16(), power: r.u16() };
      break;
    case 27:
      m = { t: "ArcadeJoin", cab: r.u8(), vsBot: r.bool() };
      break;
    case 28:
      m = { t: "ArcadeLeave", cab: r.u8() };
      break;
    case 29:
      m = { t: "ArcadeInput", cab: r.u8(), value: r.u16() };
      break;
    case 30:
      m = { t: "PoolAim", angle: r.u16(), pull: r.u16() };
      break;
    case 31:
      m = { t: "Away", away: r.bool() };
      break;
    case 32:
      m = { t: "FishHit" };
      break;
    case 33:
      m = { t: "Reading", book: r.u32() };
      break;
    case 34:
      m = { t: "Calling", on: r.bool() };
      break;
    case 35:
      m = { t: "Going", zone: r.str(), arrive: r.str() };
      break;
    case 36:
      m = { t: "ThrowLure", x: r.u16(), y: r.u16(), kind: r.u8() };
      break;
    case 37:
      m = { t: "BowlJoin", lane: r.u8(), vsBot: r.bool() };
      break;
    case 38:
      m = { t: "BowlLeave", lane: r.u8() };
      break;
    case 39:
      m = { t: "BowlRoll", lane: r.u8(), aim: r.u16(), power: r.u16() };
      break;
    case 40:
      m = { t: "ArenaJoin" };
      break;
    case 41:
      m = { t: "ArenaLeave" };
      break;
    case 42:
      m = { t: "ArenaMove", x: r.u16(), y: r.u16(), aim: r.u16(), reach: r.u16() };
      break;
    case 43:
      m = { t: "ArenaAct", act: r.u8(), aim: r.u16(), reach: r.u16() };
      break;
    case 44:
      m = { t: "OpenCrate" };
      break;
    case 45:
      m = { t: "Boat", op: r.u8() };
      break;
    case 46:
      m = { t: "PbJoin", team: r.u8() };
      break;
    case 47:
      m = { t: "PbLeave" };
      break;
    case 48:
      m = { t: "PbStart", bots: r.bool() };
      break;
    case 49:
      m = { t: "PbMove", x: r.u16(), y: r.u16(), aim: r.u16() };
      break;
    case 50:
      m = { t: "PbFire", shot: r.u16(), x: r.u16(), y: r.u16(), aim: r.u16() };
      break;
    case 51:
      m = { t: "PbDash" };
      break;
    case 52:
      m = { t: "PbReload" };
      break;
    case 53:
      m = { t: "ArenaStart", bots: r.bool() };
      break;
    case 54:
      m = { t: "ArenaBot", slot: r.u8(), on: r.bool() };
      break;
    case 55:
      m = { t: "ArenaLevel", level: r.u8() };
      break;
    case 56:
      m = { t: "PbBot", slot: r.u8(), on: r.bool() };
      break;
    case 57:
      m = { t: "PbLevel", level: r.u8() };
      break;
    case 58:
      m = { t: "ArenaMode", mode: r.u8(), goliath: r.u8() };
      break;
    case 59:
      m = { t: "ArenaKits", on: r.bool() };
      break;
    case 60:
      m = { t: "ArenaKit", kit: r.u8() };
      break;
    case 61:
      m = { t: "ArenaLobby" };
      break;
    case 62:
      m = { t: "ArenaWheel", on: r.bool() };
      break;
    case 67:
      m = { t: "ArenaVote", kind: r.u8() };
      break;
    case 68:
      m = { t: "ArenaDisasters", on: r.bool() };
      break;
    case 69:
      m = { t: "ArenaBet", pick: r.u8() };
      break;
    case 70:
      m = { t: "ArenaSwitch", slot: r.u8() };
      break;
    case 63:
      m = { t: "SalvageReel", target: r.bool(), extras: r.u8() };
      break;
    case 64:
      m = { t: "UseObject", x: r.u16(), y: r.u16() };
      break;
    case 65:
      m = { t: "TankPut", x: r.u16(), y: r.u16(), fish: r.u32() };
      break;
    case 66:
      m = { t: "TankTake", x: r.u16(), y: r.u16(), index: r.u8() };
      break;
    case 71:
      m = { t: "TankFeed", x: r.u16(), y: r.u16() };
      break;
    case 72:
      m = { t: "SkateOn", on: r.bool(), kit: r.u32() };
      break;
    case 73:
      m = { t: "SkateMove", x: r.u16(), y: r.u16(), z: r.u8(), dir: r.u16(), pose: r.u8(), trick: r.u8(), spin: r.u16(), sent: r.u16(), kit: r.u32() };
      break;
    case 74:
      m = { t: "SkateScore", kind: r.u8(), points: r.u32(), label: r.str() };
      break;
    case 75:
      m = { t: "SkateQuest", day: r.u32(), slot: r.u8() };
      break;
    case 76:
      m = { t: "SkateDuel", join: r.bool(), bot: r.bool(), grinds: r.bool() };
      break;
    case 77:
      m = { t: "SkateDuelScore", points: r.u32(), done: r.bool() };
      break;
    case 78:
      m = { t: "PbBet", pick: r.u8() };
      break;
    case 79:
      m = { t: "PbClass", class: r.u8() };
      break;
    case 80:
      m = { t: "PbMode", mode: r.u8() };
      break;
    case 81:
      m = { t: "GolfBall", hole: r.u8(), x: r.u16(), y: r.u16(), strokes: r.u8(), state: r.u8() };
      break;
    case 82:
      m = { t: "GolfCard", strokes: r.vec(() => r.u8()) };
      break;
    case 83:
      m = { t: "GolfBoardAsk" };
      break;
    case 84:
      m = { t: "GolfDuelShot", balls: r.vec(() => decGolfDuelBall(r)), done: r.bool(), penalty: r.u8() };
      break;
    case 85:
      m = { t: "GolfDuelLeave" };
      break;
    case 86:
      m = { t: "GolfDuelBot" };
      break;
    case 87:
      m = { t: "GolfDuelSeek", on: r.bool() };
      break;
    case 88:
      m = { t: "PetFishHit" };
      break;
    case 89:
      m = { t: "PetGoal", x: r.u16(), y: r.u16(), kind: r.u8() };
      break;
    case 90:
      m = { t: "PetDuoMove", x: r.u16() };
      break;
    case 91:
      m = { t: "PetDuoCatch", treat: r.u16() };
      break;
    case 92:
      m = { t: "PetBounceTap", n: r.u16(), q: r.u8() };
      break;
    case 93:
      m = { t: "PetBounceAt", x: r.u16() };
      break;
    case 94:
      m = { t: "PetBounceStar", n: r.u16(), k: r.u8() };
      break;
    case 95:
      m = { t: "PetBounceAgain", on: r.bool() };
      break;
    default:
      throw new Error(`protocol: unknown ClientMsg tag ${tag}`);
  }
  r.done();
  return m;
}

export type ServerMsg =
  | { t: "Welcome"; zone: string; instance: number; selfId: number; serverT: number }
  | { t: "CellEnter"; cell: number; entities: EntityInfo[] }
  | { t: "CellLeave"; cell: number; ids: number[] }
  | { t: "Spawn"; entity: EntityInfo }
  | { t: "Despawn"; id: number }
  | { t: "MoveStart"; id: number; speedX10: number; t0: number; sprintIn: number; path: Tile[] }
  | { t: "Snap"; id: number; x: number; y: number }
  | { t: "EmoteShown"; id: number; emote: number }
  | { t: "ChatBubble"; id: number; text: string }
  | { t: "Pong"; clientT: number; serverT: number }
  | { t: "Error"; code: number; message: string }
  | { t: "StateChange"; id: number; state: number; x: number; y: number }
  | { t: "GameState"; table: number; status: number; white: number; black: number; fen: string; last: string; legal: string[] }
  | { t: "ScreenState"; screen: number; title: string; source: string; startedT: number; durationMs: number }
  | { t: "FishEvent"; id: number; kind: number; x: number; y: number; item: number }
  | { t: "PlotState"; x: number; y: number; plant: number; stage: number; watered: boolean; owner: string; stageLeftMs: number }
  | { t: "ObjectUpdate"; x: number; y: number; item: number; rot: number }
  | { t: "Granted"; item: number; added: number; total: number; first: boolean }
  | { t: "JamNote"; id: number; instrument: number; pitch: number; beat: number }
  | { t: "Painted"; id: number; easel: number; cell: number; color: number }
  | { t: "Ball"; x: number; y: number; vx: number; vy: number; t0: number; left: number; right: number }
  | { t: "MoodShown"; id: number; mood: number }
  | { t: "Offered"; from: number; kind: number }
  | { t: "Together"; a: number; b: number; kind: number }
  | { t: "LanternRise"; id: number; x: number; y: number; text: string }
  | { t: "LookChanged"; id: number; look: number; style: number; pet: number; vehicle: number; tool: number }
  | { t: "Rps"; a: number; b: number; phase: number; aPick: number; bPick: number; endsT: number }
  | { t: "Woozy"; id: number; ms: number }
  | { t: "PoolState"; a: number; b: number; turn: number; groups: number; status: number; shot: number; hole: number; balls: PoolBall[] }
  | { t: "PoolShot"; by: number; vx: number; vy: number; shot: number }
  | { t: "ArcadeState"; cab: number; kind: number; a: number; b: number; status: number; turn: number; t0: number; data: number[] }
  | { t: "PoolAim"; by: number; angle: number; pull: number }
  | { t: "AwayChanged"; id: number; away: boolean }
  | { t: "ReadingShown"; id: number; book: number }
  | { t: "CallingShown"; id: number; on: boolean }
  | { t: "Went"; id: number; zone: string; arrive: string }
  | { t: "LureShown"; x: number; y: number; ends: number; kind: number }
  | { t: "BowlState"; lane: number; a: number; b: number; status: number; turn: number; frame: number; ball: number; standing: number; shot: number; rollsA: number[]; rollsB: number[] }
  | { t: "BowlRolled"; lane: number; by: number; aim: number; power: number; knocked: number; shot: number }
  | { t: "ArenaState"; status: number; now: number; phaseMs: number; round: number; fire: number; spikes: number[]; slots: number[]; crowns: number[]; fighters: ArenaFighter[]; gifts: ArenaGift[]; winner: number; level: number; mode: number; goliath: number; kits: boolean; chooseMs: number; exhibition: boolean; wheel: boolean; disaster: number; disasterStage: number; disasterMs: number; disasterVotes: number[]; disasterPool: number; lava: number; lions: ArenaLion[]; disasters: boolean; clouds: ArenaCloud[]; betMs: number; bets: number[]; betPay: number }
  | { t: "ArenaEvent"; kind: number; a: number; b: number; x: number; y: number; n: number; m: number; vx: number; vy: number }
  | { t: "LuckyShown"; x: number; y: number; moves: number }
  | { t: "LuckyFound"; id: number; x: number; y: number }
  | { t: "LuckyOpened"; coins: number }
  | { t: "BoatState"; captain: number; until: number; seats: number[] }
  | { t: "PbState"; status: number; now: number; phaseMs: number; blue: number; red: number; winner: number; slots: number[]; players: PbPlayer[]; pickups: PbPickup[]; level: number; round: number; exhibit: boolean; betMs: number; bets: number[]; betPay: number; classes: number[]; mode: number; toWin: number; flags: PbFlag[]; points: PbPoint[]; winnerId: number; giant: number }
  | { t: "PbShot"; by: number; shot: number; x: number; y: number; aim: number; kind: number }
  | { t: "PbEvent"; kind: number; a: number; b: number; x: number; y: number; n: number }
  | { t: "SalvageJunk"; items: number[] }
  | { t: "ObjectOn"; x: number; y: number; on: boolean }
  | { t: "TankFish"; x: number; y: number; fish: number[] }
  | { t: "TankFed"; x: number; y: number; fed: number }
  | { t: "ObjectTop"; x: number; y: number; item: number; rot: number }
  | { t: "LabState"; lit: number[]; gates: number[]; found: number; attuned: number; finishers: number; out: boolean }
  | { t: "LabEvent"; kind: number; id: number; n: number }
  | { t: "ArenaBetPlaced"; pick: number; pays: number }
  | { t: "ArenaBetSettled"; coins: number; refund: boolean }
  | { t: "ArenaStoodDown" }
  | { t: "Skating"; id: number; on: boolean }
  | { t: "Skater"; id: number; x: number; y: number; z: number; dir: number; pose: number; trick: number; spin: number; sent: number; kit: number }
  | { t: "SkateEvent"; id: number; kind: number; points: number; label: string }
  | { t: "SkateBoard"; runs: SkateEntry[]; combos: SkateEntry[] }
  | { t: "SkateQuestPaid"; day: number; slot: number; coins: number; already: boolean }
  | { t: "SkateDuelState"; phase: number; opp: number; name: string; startIn: number; grinds: boolean }
  | { t: "SkateDuelScore"; points: number }
  | { t: "SkateDuelEnd"; mine: number; theirs: number; result: number }
  | { t: "PbBetPlaced"; pick: number; pays: number }
  | { t: "PbBetSettled"; coins: number; refund: boolean }
  | { t: "MapDots"; dots: MapDot[] }
  | { t: "GolfBall"; id: number; hole: number; x: number; y: number; strokes: number; state: number }
  | { t: "GolfBoard"; rounds: SkateEntry[] }
  | { t: "GolfDuel"; a: number; b: number; hole: number; turn: number; balls: GolfDuelBall[]; strokes: number[]; over: boolean; winner: number }
  | { t: "GolfDuelRoll"; balls: GolfDuelBall[] }
  | { t: "GolfSeeking"; id: number }
  | { t: "PetDug"; id: number; x: number; y: number; coins: number }
  | { t: "ArenaStats"; round: number; winner: number; over: boolean; rows: ArenaStat[] }
  | { t: "PetGoal"; id: number; x: number; y: number; kind: number }
  | { t: "PetDuo"; a: number; b: number; seed: number; start: number; ms: number }
  | { t: "PetDuoMove"; id: number; x: number }
  | { t: "PetDuoCatch"; id: number; treat: number }
  | { t: "PetDuoOver"; score: number; friendship: number; level: number; counted: boolean; xp: number }
  | { t: "PetBounce"; a: number; b: number; seed: number; start: number; best: number }
  | { t: "PetBounceTap"; id: number; n: number; q: number }
  | { t: "PetBounceAt"; id: number; x: number }
  | { t: "PetBounceStar"; id: number; n: number; k: number; hearts: number }
  | { t: "PetBounceBeat"; n: number; height: number; hearts: number; combo: number; score: number }
  | { t: "PetBounceOver"; score: number; bounces: number; height: number; best: number; record: boolean; friendship: number; level: number; counted: boolean; xp: number }
  | { t: "PetBounceAgain"; id: number; on: boolean }
  ;

export function encodeServerMsg(m: ServerMsg): Uint8Array {
  const w = new Writer();
  switch (m.t) {
    case "Welcome":
      w.u8(1);
      w.str(m.zone);
      w.u16(m.instance);
      w.u32(m.selfId);
      w.u32(m.serverT);
      break;
    case "CellEnter":
      w.u8(2);
      w.u16(m.cell);
      w.vec(m.entities, (x) => encEntityInfo(w, x));
      break;
    case "CellLeave":
      w.u8(3);
      w.u16(m.cell);
      w.vec(m.ids, (x) => w.u32(x));
      break;
    case "Spawn":
      w.u8(4);
      encEntityInfo(w, m.entity);
      break;
    case "Despawn":
      w.u8(5);
      w.u32(m.id);
      break;
    case "MoveStart":
      w.u8(6);
      w.u32(m.id);
      w.u8(m.speedX10);
      w.u32(m.t0);
      w.u16(m.sprintIn);
      w.vec(m.path, (x) => encTile(w, x));
      break;
    case "Snap":
      w.u8(7);
      w.u32(m.id);
      w.u16(m.x);
      w.u16(m.y);
      break;
    case "EmoteShown":
      w.u8(8);
      w.u32(m.id);
      w.u8(m.emote);
      break;
    case "ChatBubble":
      w.u8(9);
      w.u32(m.id);
      w.str(m.text);
      break;
    case "Pong":
      w.u8(10);
      w.u32(m.clientT);
      w.u32(m.serverT);
      break;
    case "Error":
      w.u8(11);
      w.u16(m.code);
      w.str(m.message);
      break;
    case "StateChange":
      w.u8(12);
      w.u32(m.id);
      w.u8(m.state);
      w.u16(m.x);
      w.u16(m.y);
      break;
    case "GameState":
      w.u8(13);
      w.u32(m.table);
      w.u8(m.status);
      w.u32(m.white);
      w.u32(m.black);
      w.str(m.fen);
      w.str(m.last);
      w.vec(m.legal, (x) => w.str(x));
      break;
    case "ScreenState":
      w.u8(14);
      w.u32(m.screen);
      w.str(m.title);
      w.str(m.source);
      w.u32(m.startedT);
      w.u32(m.durationMs);
      break;
    case "FishEvent":
      w.u8(15);
      w.u32(m.id);
      w.u8(m.kind);
      w.u16(m.x);
      w.u16(m.y);
      w.u32(m.item);
      break;
    case "PlotState":
      w.u8(16);
      w.u16(m.x);
      w.u16(m.y);
      w.u32(m.plant);
      w.u8(m.stage);
      w.bool(m.watered);
      w.str(m.owner);
      w.u32(m.stageLeftMs);
      break;
    case "ObjectUpdate":
      w.u8(17);
      w.u16(m.x);
      w.u16(m.y);
      w.u32(m.item);
      w.u8(m.rot);
      break;
    case "Granted":
      w.u8(18);
      w.u32(m.item);
      w.u16(m.added);
      w.u32(m.total);
      w.bool(m.first);
      break;
    case "JamNote":
      w.u8(19);
      w.u32(m.id);
      w.u8(m.instrument);
      w.u8(m.pitch);
      w.u32(m.beat);
      break;
    case "Painted":
      w.u8(20);
      w.u32(m.id);
      w.u8(m.easel);
      w.u16(m.cell);
      w.u8(m.color);
      break;
    case "Ball":
      w.u8(21);
      w.u16(m.x);
      w.u16(m.y);
      w.u16(m.vx);
      w.u16(m.vy);
      w.u32(m.t0);
      w.u8(m.left);
      w.u8(m.right);
      break;
    case "MoodShown":
      w.u8(22);
      w.u32(m.id);
      w.u8(m.mood);
      break;
    case "Offered":
      w.u8(23);
      w.u32(m.from);
      w.u8(m.kind);
      break;
    case "Together":
      w.u8(24);
      w.u32(m.a);
      w.u32(m.b);
      w.u8(m.kind);
      break;
    case "LanternRise":
      w.u8(25);
      w.u32(m.id);
      w.u16(m.x);
      w.u16(m.y);
      w.str(m.text);
      break;
    case "LookChanged":
      w.u8(26);
      w.u32(m.id);
      w.u32(m.look);
      w.u32(m.style);
      w.u32(m.pet);
      w.u8(m.vehicle);
      w.u8(m.tool);
      break;
    case "Rps":
      w.u8(27);
      w.u32(m.a);
      w.u32(m.b);
      w.u8(m.phase);
      w.u8(m.aPick);
      w.u8(m.bPick);
      w.u32(m.endsT);
      break;
    case "Woozy":
      w.u8(28);
      w.u32(m.id);
      w.u32(m.ms);
      break;
    case "PoolState":
      w.u8(29);
      w.u32(m.a);
      w.u32(m.b);
      w.u8(m.turn);
      w.u8(m.groups);
      w.u8(m.status);
      w.u32(m.shot);
      w.u8(m.hole);
      w.vec(m.balls, (x) => encPoolBall(w, x));
      break;
    case "PoolShot":
      w.u8(30);
      w.u32(m.by);
      w.u16(m.vx);
      w.u16(m.vy);
      w.u32(m.shot);
      break;
    case "ArcadeState":
      w.u8(31);
      w.u8(m.cab);
      w.u8(m.kind);
      w.u32(m.a);
      w.u32(m.b);
      w.u8(m.status);
      w.u8(m.turn);
      w.u32(m.t0);
      w.vec(m.data, (x) => w.u16(x));
      break;
    case "PoolAim":
      w.u8(32);
      w.u32(m.by);
      w.u16(m.angle);
      w.u16(m.pull);
      break;
    case "AwayChanged":
      w.u8(33);
      w.u32(m.id);
      w.bool(m.away);
      break;
    case "ReadingShown":
      w.u8(34);
      w.u32(m.id);
      w.u32(m.book);
      break;
    case "CallingShown":
      w.u8(35);
      w.u32(m.id);
      w.bool(m.on);
      break;
    case "Went":
      w.u8(36);
      w.u32(m.id);
      w.str(m.zone);
      w.str(m.arrive);
      break;
    case "LureShown":
      w.u8(37);
      w.u16(m.x);
      w.u16(m.y);
      w.u32(m.ends);
      w.u8(m.kind);
      break;
    case "BowlState":
      w.u8(38);
      w.u8(m.lane);
      w.u32(m.a);
      w.u32(m.b);
      w.u8(m.status);
      w.u8(m.turn);
      w.u8(m.frame);
      w.u8(m.ball);
      w.u16(m.standing);
      w.u32(m.shot);
      w.vec(m.rollsA, (x) => w.u8(x));
      w.vec(m.rollsB, (x) => w.u8(x));
      break;
    case "BowlRolled":
      w.u8(39);
      w.u8(m.lane);
      w.u32(m.by);
      w.u16(m.aim);
      w.u16(m.power);
      w.u16(m.knocked);
      w.u32(m.shot);
      break;
    case "ArenaState":
      w.u8(40);
      w.u8(m.status);
      w.u32(m.now);
      w.u32(m.phaseMs);
      w.u8(m.round);
      w.u16(m.fire);
      w.vec(m.spikes, (x) => w.u8(x));
      w.vec(m.slots, (x) => w.u32(x));
      w.vec(m.crowns, (x) => w.u8(x));
      w.vec(m.fighters, (x) => encArenaFighter(w, x));
      w.vec(m.gifts, (x) => encArenaGift(w, x));
      w.u32(m.winner);
      w.u8(m.level);
      w.u8(m.mode);
      w.u8(m.goliath);
      w.bool(m.kits);
      w.u16(m.chooseMs);
      w.bool(m.exhibition);
      w.bool(m.wheel);
      w.u8(m.disaster);
      w.u8(m.disasterStage);
      w.u16(m.disasterMs);
      w.vec(m.disasterVotes, (x) => w.u8(x));
      w.u8(m.disasterPool);
      w.u16(m.lava);
      w.vec(m.lions, (x) => encArenaLion(w, x));
      w.bool(m.disasters);
      w.vec(m.clouds, (x) => encArenaCloud(w, x));
      w.u16(m.betMs);
      w.vec(m.bets, (x) => w.u8(x));
      w.u16(m.betPay);
      break;
    case "ArenaEvent":
      w.u8(41);
      w.u8(m.kind);
      w.u32(m.a);
      w.u32(m.b);
      w.u16(m.x);
      w.u16(m.y);
      w.u16(m.n);
      w.u16(m.m);
      w.u16(m.vx);
      w.u16(m.vy);
      break;
    case "LuckyShown":
      w.u8(42);
      w.u16(m.x);
      w.u16(m.y);
      w.u32(m.moves);
      break;
    case "LuckyFound":
      w.u8(43);
      w.u32(m.id);
      w.u16(m.x);
      w.u16(m.y);
      break;
    case "LuckyOpened":
      w.u8(44);
      w.u16(m.coins);
      break;
    case "BoatState":
      w.u8(45);
      w.u32(m.captain);
      w.u32(m.until);
      w.vec(m.seats, (x) => w.u32(x));
      break;
    case "PbState":
      w.u8(46);
      w.u8(m.status);
      w.u32(m.now);
      w.u32(m.phaseMs);
      w.u8(m.blue);
      w.u8(m.red);
      w.u8(m.winner);
      w.vec(m.slots, (x) => w.u32(x));
      w.vec(m.players, (x) => encPbPlayer(w, x));
      w.vec(m.pickups, (x) => encPbPickup(w, x));
      w.u8(m.level);
      w.u32(m.round);
      w.bool(m.exhibit);
      w.u16(m.betMs);
      w.vec(m.bets, (x) => w.u16(x));
      w.u16(m.betPay);
      w.vec(m.classes, (x) => w.u8(x));
      w.u8(m.mode);
      w.u8(m.toWin);
      w.vec(m.flags, (x) => encPbFlag(w, x));
      w.vec(m.points, (x) => encPbPoint(w, x));
      w.u32(m.winnerId);
      w.u32(m.giant);
      break;
    case "PbShot":
      w.u8(47);
      w.u32(m.by);
      w.u16(m.shot);
      w.u16(m.x);
      w.u16(m.y);
      w.u16(m.aim);
      w.u8(m.kind);
      break;
    case "PbEvent":
      w.u8(48);
      w.u8(m.kind);
      w.u32(m.a);
      w.u32(m.b);
      w.u16(m.x);
      w.u16(m.y);
      w.u16(m.n);
      break;
    case "SalvageJunk":
      w.u8(49);
      w.vec(m.items, (x) => w.u32(x));
      break;
    case "ObjectOn":
      w.u8(50);
      w.u16(m.x);
      w.u16(m.y);
      w.bool(m.on);
      break;
    case "TankFish":
      w.u8(51);
      w.u16(m.x);
      w.u16(m.y);
      w.vec(m.fish, (x) => w.u32(x));
      break;
    case "TankFed":
      w.u8(59);
      w.u16(m.x);
      w.u16(m.y);
      w.u32(m.fed);
      break;
    case "ObjectTop":
      w.u8(52);
      w.u16(m.x);
      w.u16(m.y);
      w.u32(m.item);
      w.u8(m.rot);
      break;
    case "LabState":
      w.u8(53);
      w.vec(m.lit, (x) => w.u8(x));
      w.vec(m.gates, (x) => w.u8(x));
      w.u8(m.found);
      w.u8(m.attuned);
      w.u16(m.finishers);
      w.bool(m.out);
      break;
    case "LabEvent":
      w.u8(54);
      w.u8(m.kind);
      w.u32(m.id);
      w.u16(m.n);
      break;
    case "ArenaBetPlaced":
      w.u8(55);
      w.u8(m.pick);
      w.u16(m.pays);
      break;
    case "ArenaBetSettled":
      w.u8(56);
      w.u16(m.coins);
      w.bool(m.refund);
      break;
    case "ArenaStoodDown":
      w.u8(57);
      break;
    case "Skating":
      w.u8(60);
      w.u32(m.id);
      w.bool(m.on);
      break;
    case "Skater":
      w.u8(61);
      w.u32(m.id);
      w.u16(m.x);
      w.u16(m.y);
      w.u8(m.z);
      w.u16(m.dir);
      w.u8(m.pose);
      w.u8(m.trick);
      w.u16(m.spin);
      w.u16(m.sent);
      w.u32(m.kit);
      break;
    case "SkateEvent":
      w.u8(62);
      w.u32(m.id);
      w.u8(m.kind);
      w.u32(m.points);
      w.str(m.label);
      break;
    case "SkateBoard":
      w.u8(63);
      w.vec(m.runs, (x) => encSkateEntry(w, x));
      w.vec(m.combos, (x) => encSkateEntry(w, x));
      break;
    case "SkateQuestPaid":
      w.u8(64);
      w.u32(m.day);
      w.u8(m.slot);
      w.u16(m.coins);
      w.bool(m.already);
      break;
    case "SkateDuelState":
      w.u8(65);
      w.u8(m.phase);
      w.u32(m.opp);
      w.str(m.name);
      w.u16(m.startIn);
      w.bool(m.grinds);
      break;
    case "SkateDuelScore":
      w.u8(66);
      w.u32(m.points);
      break;
    case "SkateDuelEnd":
      w.u8(67);
      w.u32(m.mine);
      w.u32(m.theirs);
      w.u8(m.result);
      break;
    case "PbBetPlaced":
      w.u8(68);
      w.u8(m.pick);
      w.u16(m.pays);
      break;
    case "PbBetSettled":
      w.u8(69);
      w.u16(m.coins);
      w.bool(m.refund);
      break;
    case "MapDots":
      w.u8(70);
      w.vec(m.dots, (x) => encMapDot(w, x));
      break;
    case "GolfBall":
      w.u8(71);
      w.u32(m.id);
      w.u8(m.hole);
      w.u16(m.x);
      w.u16(m.y);
      w.u8(m.strokes);
      w.u8(m.state);
      break;
    case "GolfBoard":
      w.u8(72);
      w.vec(m.rounds, (x) => encSkateEntry(w, x));
      break;
    case "GolfDuel":
      w.u8(73);
      w.u32(m.a);
      w.u32(m.b);
      w.u8(m.hole);
      w.u32(m.turn);
      w.vec(m.balls, (x) => encGolfDuelBall(w, x));
      w.vec(m.strokes, (x) => w.u8(x));
      w.bool(m.over);
      w.u32(m.winner);
      break;
    case "GolfDuelRoll":
      w.u8(74);
      w.vec(m.balls, (x) => encGolfDuelBall(w, x));
      break;
    case "GolfSeeking":
      w.u8(75);
      w.u32(m.id);
      break;
    case "PetDug":
      w.u8(76);
      w.u32(m.id);
      w.u16(m.x);
      w.u16(m.y);
      w.u16(m.coins);
      break;
    case "ArenaStats":
      w.u8(77);
      w.u8(m.round);
      w.u32(m.winner);
      w.bool(m.over);
      w.vec(m.rows, (x) => encArenaStat(w, x));
      break;
    case "PetGoal":
      w.u8(78);
      w.u32(m.id);
      w.u16(m.x);
      w.u16(m.y);
      w.u8(m.kind);
      break;
    case "PetDuo":
      w.u8(79);
      w.u32(m.a);
      w.u32(m.b);
      w.u32(m.seed);
      w.u32(m.start);
      w.u32(m.ms);
      break;
    case "PetDuoMove":
      w.u8(80);
      w.u32(m.id);
      w.u16(m.x);
      break;
    case "PetDuoCatch":
      w.u8(81);
      w.u32(m.id);
      w.u16(m.treat);
      break;
    case "PetDuoOver":
      w.u8(82);
      w.u16(m.score);
      w.u16(m.friendship);
      w.u8(m.level);
      w.bool(m.counted);
      w.u16(m.xp);
      break;
    case "PetBounce":
      w.u8(83);
      w.u32(m.a);
      w.u32(m.b);
      w.u32(m.seed);
      w.u32(m.start);
      w.u32(m.best);
      break;
    case "PetBounceTap":
      w.u8(84);
      w.u32(m.id);
      w.u16(m.n);
      w.u8(m.q);
      break;
    case "PetBounceAt":
      w.u8(85);
      w.u32(m.id);
      w.u16(m.x);
      break;
    case "PetBounceStar":
      w.u8(86);
      w.u32(m.id);
      w.u16(m.n);
      w.u8(m.k);
      w.u8(m.hearts);
      break;
    case "PetBounceBeat":
      w.u8(87);
      w.u16(m.n);
      w.u16(m.height);
      w.u8(m.hearts);
      w.u16(m.combo);
      w.u32(m.score);
      break;
    case "PetBounceOver":
      w.u8(88);
      w.u32(m.score);
      w.u16(m.bounces);
      w.u16(m.height);
      w.u32(m.best);
      w.bool(m.record);
      w.u16(m.friendship);
      w.u8(m.level);
      w.bool(m.counted);
      w.u16(m.xp);
      break;
    case "PetBounceAgain":
      w.u8(89);
      w.u32(m.id);
      w.bool(m.on);
      break;
  }
  return w.finish();
}

export function decodeServerMsg(b: Uint8Array): ServerMsg {
  const r = new Reader(b);
  let m: ServerMsg;
  const tag = r.u8();
  switch (tag) {
    case 1:
      m = { t: "Welcome", zone: r.str(), instance: r.u16(), selfId: r.u32(), serverT: r.u32() };
      break;
    case 2:
      m = { t: "CellEnter", cell: r.u16(), entities: r.vec(() => decEntityInfo(r)) };
      break;
    case 3:
      m = { t: "CellLeave", cell: r.u16(), ids: r.vec(() => r.u32()) };
      break;
    case 4:
      m = { t: "Spawn", entity: decEntityInfo(r) };
      break;
    case 5:
      m = { t: "Despawn", id: r.u32() };
      break;
    case 6:
      m = { t: "MoveStart", id: r.u32(), speedX10: r.u8(), t0: r.u32(), sprintIn: r.u16(), path: r.vec(() => decTile(r)) };
      break;
    case 7:
      m = { t: "Snap", id: r.u32(), x: r.u16(), y: r.u16() };
      break;
    case 8:
      m = { t: "EmoteShown", id: r.u32(), emote: r.u8() };
      break;
    case 9:
      m = { t: "ChatBubble", id: r.u32(), text: r.str() };
      break;
    case 10:
      m = { t: "Pong", clientT: r.u32(), serverT: r.u32() };
      break;
    case 11:
      m = { t: "Error", code: r.u16(), message: r.str() };
      break;
    case 12:
      m = { t: "StateChange", id: r.u32(), state: r.u8(), x: r.u16(), y: r.u16() };
      break;
    case 13:
      m = { t: "GameState", table: r.u32(), status: r.u8(), white: r.u32(), black: r.u32(), fen: r.str(), last: r.str(), legal: r.vec(() => r.str()) };
      break;
    case 14:
      m = { t: "ScreenState", screen: r.u32(), title: r.str(), source: r.str(), startedT: r.u32(), durationMs: r.u32() };
      break;
    case 15:
      m = { t: "FishEvent", id: r.u32(), kind: r.u8(), x: r.u16(), y: r.u16(), item: r.u32() };
      break;
    case 16:
      m = { t: "PlotState", x: r.u16(), y: r.u16(), plant: r.u32(), stage: r.u8(), watered: r.bool(), owner: r.str(), stageLeftMs: r.u32() };
      break;
    case 17:
      m = { t: "ObjectUpdate", x: r.u16(), y: r.u16(), item: r.u32(), rot: r.u8() };
      break;
    case 18:
      m = { t: "Granted", item: r.u32(), added: r.u16(), total: r.u32(), first: r.bool() };
      break;
    case 19:
      m = { t: "JamNote", id: r.u32(), instrument: r.u8(), pitch: r.u8(), beat: r.u32() };
      break;
    case 20:
      m = { t: "Painted", id: r.u32(), easel: r.u8(), cell: r.u16(), color: r.u8() };
      break;
    case 21:
      m = { t: "Ball", x: r.u16(), y: r.u16(), vx: r.u16(), vy: r.u16(), t0: r.u32(), left: r.u8(), right: r.u8() };
      break;
    case 22:
      m = { t: "MoodShown", id: r.u32(), mood: r.u8() };
      break;
    case 23:
      m = { t: "Offered", from: r.u32(), kind: r.u8() };
      break;
    case 24:
      m = { t: "Together", a: r.u32(), b: r.u32(), kind: r.u8() };
      break;
    case 25:
      m = { t: "LanternRise", id: r.u32(), x: r.u16(), y: r.u16(), text: r.str() };
      break;
    case 26:
      m = { t: "LookChanged", id: r.u32(), look: r.u32(), style: r.u32(), pet: r.u32(), vehicle: r.u8(), tool: r.u8() };
      break;
    case 27:
      m = { t: "Rps", a: r.u32(), b: r.u32(), phase: r.u8(), aPick: r.u8(), bPick: r.u8(), endsT: r.u32() };
      break;
    case 28:
      m = { t: "Woozy", id: r.u32(), ms: r.u32() };
      break;
    case 29:
      m = { t: "PoolState", a: r.u32(), b: r.u32(), turn: r.u8(), groups: r.u8(), status: r.u8(), shot: r.u32(), hole: r.u8(), balls: r.vec(() => decPoolBall(r)) };
      break;
    case 30:
      m = { t: "PoolShot", by: r.u32(), vx: r.u16(), vy: r.u16(), shot: r.u32() };
      break;
    case 31:
      m = { t: "ArcadeState", cab: r.u8(), kind: r.u8(), a: r.u32(), b: r.u32(), status: r.u8(), turn: r.u8(), t0: r.u32(), data: r.vec(() => r.u16()) };
      break;
    case 32:
      m = { t: "PoolAim", by: r.u32(), angle: r.u16(), pull: r.u16() };
      break;
    case 33:
      m = { t: "AwayChanged", id: r.u32(), away: r.bool() };
      break;
    case 34:
      m = { t: "ReadingShown", id: r.u32(), book: r.u32() };
      break;
    case 35:
      m = { t: "CallingShown", id: r.u32(), on: r.bool() };
      break;
    case 36:
      m = { t: "Went", id: r.u32(), zone: r.str(), arrive: r.str() };
      break;
    case 37:
      m = { t: "LureShown", x: r.u16(), y: r.u16(), ends: r.u32(), kind: r.u8() };
      break;
    case 38:
      m = { t: "BowlState", lane: r.u8(), a: r.u32(), b: r.u32(), status: r.u8(), turn: r.u8(), frame: r.u8(), ball: r.u8(), standing: r.u16(), shot: r.u32(), rollsA: r.vec(() => r.u8()), rollsB: r.vec(() => r.u8()) };
      break;
    case 39:
      m = { t: "BowlRolled", lane: r.u8(), by: r.u32(), aim: r.u16(), power: r.u16(), knocked: r.u16(), shot: r.u32() };
      break;
    case 40:
      m = { t: "ArenaState", status: r.u8(), now: r.u32(), phaseMs: r.u32(), round: r.u8(), fire: r.u16(), spikes: r.vec(() => r.u8()), slots: r.vec(() => r.u32()), crowns: r.vec(() => r.u8()), fighters: r.vec(() => decArenaFighter(r)), gifts: r.vec(() => decArenaGift(r)), winner: r.u32(), level: r.u8(), mode: r.u8(), goliath: r.u8(), kits: r.bool(), chooseMs: r.u16(), exhibition: r.bool(), wheel: r.bool(), disaster: r.u8(), disasterStage: r.u8(), disasterMs: r.u16(), disasterVotes: r.vec(() => r.u8()), disasterPool: r.u8(), lava: r.u16(), lions: r.vec(() => decArenaLion(r)), disasters: r.bool(), clouds: r.vec(() => decArenaCloud(r)), betMs: r.u16(), bets: r.vec(() => r.u8()), betPay: r.u16() };
      break;
    case 41:
      m = { t: "ArenaEvent", kind: r.u8(), a: r.u32(), b: r.u32(), x: r.u16(), y: r.u16(), n: r.u16(), m: r.u16(), vx: r.u16(), vy: r.u16() };
      break;
    case 42:
      m = { t: "LuckyShown", x: r.u16(), y: r.u16(), moves: r.u32() };
      break;
    case 43:
      m = { t: "LuckyFound", id: r.u32(), x: r.u16(), y: r.u16() };
      break;
    case 44:
      m = { t: "LuckyOpened", coins: r.u16() };
      break;
    case 45:
      m = { t: "BoatState", captain: r.u32(), until: r.u32(), seats: r.vec(() => r.u32()) };
      break;
    case 46:
      m = { t: "PbState", status: r.u8(), now: r.u32(), phaseMs: r.u32(), blue: r.u8(), red: r.u8(), winner: r.u8(), slots: r.vec(() => r.u32()), players: r.vec(() => decPbPlayer(r)), pickups: r.vec(() => decPbPickup(r)), level: r.u8(), round: r.u32(), exhibit: r.bool(), betMs: r.u16(), bets: r.vec(() => r.u16()), betPay: r.u16(), classes: r.vec(() => r.u8()), mode: r.u8(), toWin: r.u8(), flags: r.vec(() => decPbFlag(r)), points: r.vec(() => decPbPoint(r)), winnerId: r.u32(), giant: r.u32() };
      break;
    case 47:
      m = { t: "PbShot", by: r.u32(), shot: r.u16(), x: r.u16(), y: r.u16(), aim: r.u16(), kind: r.u8() };
      break;
    case 48:
      m = { t: "PbEvent", kind: r.u8(), a: r.u32(), b: r.u32(), x: r.u16(), y: r.u16(), n: r.u16() };
      break;
    case 49:
      m = { t: "SalvageJunk", items: r.vec(() => r.u32()) };
      break;
    case 50:
      m = { t: "ObjectOn", x: r.u16(), y: r.u16(), on: r.bool() };
      break;
    case 51:
      m = { t: "TankFish", x: r.u16(), y: r.u16(), fish: r.vec(() => r.u32()) };
      break;
    case 59:
      m = { t: "TankFed", x: r.u16(), y: r.u16(), fed: r.u32() };
      break;
    case 52:
      m = { t: "ObjectTop", x: r.u16(), y: r.u16(), item: r.u32(), rot: r.u8() };
      break;
    case 53:
      m = { t: "LabState", lit: r.vec(() => r.u8()), gates: r.vec(() => r.u8()), found: r.u8(), attuned: r.u8(), finishers: r.u16(), out: r.bool() };
      break;
    case 54:
      m = { t: "LabEvent", kind: r.u8(), id: r.u32(), n: r.u16() };
      break;
    case 55:
      m = { t: "ArenaBetPlaced", pick: r.u8(), pays: r.u16() };
      break;
    case 56:
      m = { t: "ArenaBetSettled", coins: r.u16(), refund: r.bool() };
      break;
    case 57:
      m = { t: "ArenaStoodDown" };
      break;
    case 60:
      m = { t: "Skating", id: r.u32(), on: r.bool() };
      break;
    case 61:
      m = { t: "Skater", id: r.u32(), x: r.u16(), y: r.u16(), z: r.u8(), dir: r.u16(), pose: r.u8(), trick: r.u8(), spin: r.u16(), sent: r.u16(), kit: r.u32() };
      break;
    case 62:
      m = { t: "SkateEvent", id: r.u32(), kind: r.u8(), points: r.u32(), label: r.str() };
      break;
    case 63:
      m = { t: "SkateBoard", runs: r.vec(() => decSkateEntry(r)), combos: r.vec(() => decSkateEntry(r)) };
      break;
    case 64:
      m = { t: "SkateQuestPaid", day: r.u32(), slot: r.u8(), coins: r.u16(), already: r.bool() };
      break;
    case 65:
      m = { t: "SkateDuelState", phase: r.u8(), opp: r.u32(), name: r.str(), startIn: r.u16(), grinds: r.bool() };
      break;
    case 66:
      m = { t: "SkateDuelScore", points: r.u32() };
      break;
    case 67:
      m = { t: "SkateDuelEnd", mine: r.u32(), theirs: r.u32(), result: r.u8() };
      break;
    case 68:
      m = { t: "PbBetPlaced", pick: r.u8(), pays: r.u16() };
      break;
    case 69:
      m = { t: "PbBetSettled", coins: r.u16(), refund: r.bool() };
      break;
    case 70:
      m = { t: "MapDots", dots: r.vec(() => decMapDot(r)) };
      break;
    case 71:
      m = { t: "GolfBall", id: r.u32(), hole: r.u8(), x: r.u16(), y: r.u16(), strokes: r.u8(), state: r.u8() };
      break;
    case 72:
      m = { t: "GolfBoard", rounds: r.vec(() => decSkateEntry(r)) };
      break;
    case 73:
      m = { t: "GolfDuel", a: r.u32(), b: r.u32(), hole: r.u8(), turn: r.u32(), balls: r.vec(() => decGolfDuelBall(r)), strokes: r.vec(() => r.u8()), over: r.bool(), winner: r.u32() };
      break;
    case 74:
      m = { t: "GolfDuelRoll", balls: r.vec(() => decGolfDuelBall(r)) };
      break;
    case 75:
      m = { t: "GolfSeeking", id: r.u32() };
      break;
    case 76:
      m = { t: "PetDug", id: r.u32(), x: r.u16(), y: r.u16(), coins: r.u16() };
      break;
    case 77:
      m = { t: "ArenaStats", round: r.u8(), winner: r.u32(), over: r.bool(), rows: r.vec(() => decArenaStat(r)) };
      break;
    case 78:
      m = { t: "PetGoal", id: r.u32(), x: r.u16(), y: r.u16(), kind: r.u8() };
      break;
    case 79:
      m = { t: "PetDuo", a: r.u32(), b: r.u32(), seed: r.u32(), start: r.u32(), ms: r.u32() };
      break;
    case 80:
      m = { t: "PetDuoMove", id: r.u32(), x: r.u16() };
      break;
    case 81:
      m = { t: "PetDuoCatch", id: r.u32(), treat: r.u16() };
      break;
    case 82:
      m = { t: "PetDuoOver", score: r.u16(), friendship: r.u16(), level: r.u8(), counted: r.bool(), xp: r.u16() };
      break;
    case 83:
      m = { t: "PetBounce", a: r.u32(), b: r.u32(), seed: r.u32(), start: r.u32(), best: r.u32() };
      break;
    case 84:
      m = { t: "PetBounceTap", id: r.u32(), n: r.u16(), q: r.u8() };
      break;
    case 85:
      m = { t: "PetBounceAt", id: r.u32(), x: r.u16() };
      break;
    case 86:
      m = { t: "PetBounceStar", id: r.u32(), n: r.u16(), k: r.u8(), hearts: r.u8() };
      break;
    case 87:
      m = { t: "PetBounceBeat", n: r.u16(), height: r.u16(), hearts: r.u8(), combo: r.u16(), score: r.u32() };
      break;
    case 88:
      m = { t: "PetBounceOver", score: r.u32(), bounces: r.u16(), height: r.u16(), best: r.u32(), record: r.bool(), friendship: r.u16(), level: r.u8(), counted: r.bool(), xp: r.u16() };
      break;
    case 89:
      m = { t: "PetBounceAgain", id: r.u32(), on: r.bool() };
      break;
    default:
      throw new Error(`protocol: unknown ServerMsg tag ${tag}`);
  }
  r.done();
  return m;
}
