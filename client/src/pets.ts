// Pets (server: crates/api/src/pets.rs): every pet in the city, where it
// lives and whether it's had its walk today, how fed and happy it is, and
// looking after yours: walks, meals, games, care and tricks, its level
// (1 to 100, from everything you do together), and the Breeder.

import type { Applied, Economy } from "./economy";
import type { Auth } from "./net/api";

export interface Pet {
  owner: string;
  owner_name: string;
  name: string;
  /** Its catalogue item. */
  item: number;
  /** How it looks: a Breeder design, or its item's code (world/petlook.ts). */
  code: number;
  /** The house it lives at (null: its owner has no house just now). */
  plot: string | null;
  /** Out on a walk. */
  out: boolean;
  walked_today: boolean;
  walks: number;
  /** 0–100 when loaded: fed, and happy. */
  food: number;
  joy: number;
  plays: number;
  /** Experience: its level (`levelOf`). */
  xp: number;
  /** The skills it's learnt (`SKILLS`' bits). */
  skills?: number;
}

/** The top level. */
export const MAX_LEVEL = 100;

/** Experience to reach `level` (as the server's `pets::xp_for`). */
export function xpFor(level: number): number {
  const l = Math.max(1, Math.min(MAX_LEVEL, level)) - 1;
  return Math.round(8 * Math.pow(l, 1.7));
}

export function levelOf(xp: number): number {
  let l = 1;
  while (l < MAX_LEVEL && xp >= xpFor(l + 1)) l++;
  return l;
}

/** How far into its level (0–1). */
export function levelProgress(xp: number): number {
  const l = levelOf(xp);
  if (l >= MAX_LEVEL) return 1;
  return (xp - xpFor(l)) / (xpFor(l + 1) - xpFor(l));
}

/** What a pet's called at its level. */
export function levelTitle(level: number): string {
  if (level >= 100) return "Legendary";
  if (level >= 75) return "Superstar";
  if (level >= 50) return "Champion";
  if (level >= 35) return "Clever clogs";
  if (level >= 20) return "Trusty pal";
  if (level >= 10) return "Best friend";
  if (level >= 5) return "Buddy";
  return "New friend";
}

/** Tricks, learnt as a pet grows (server `pets::TRICKS`; emote 40 + index). */
export const TRICKS: { key: string; name: string; emoji: string; level: number }[] = [
  { key: "sit", name: "Sit", emoji: "🪑", level: 1 },
  { key: "spin", name: "Spin", emoji: "🌀", level: 3 },
  { key: "beg", name: "Beg", emoji: "🥺", level: 6 },
  { key: "roll", name: "Roll over", emoji: "🔄", level: 10 },
  { key: "highfive", name: "High five", emoji: "✋", level: 15 },
  { key: "playdead", name: "Play dead", emoji: "💫", level: 22 },
  { key: "dance", name: "Dance", emoji: "💃", level: 30 },
  { key: "backflip", name: "Backflip", emoji: "🤸", level: 45 },
  { key: "zoomies", name: "Zoomies", emoji: "💨", level: 60 },
  { key: "bow", name: "Take a bow", emoji: "🎩", level: 80 },
];
export const TRICK_EMOTE = 40;

/** A skill in the pet's skill tree (server `pets::SKILLS`, protocol `pet_skill`). */
export interface Skill {
  key: SkillKey;
  bit: number;
  /** The skill it grows from (learnt first), if any. */
  after: SkillKey | null;
  name: string;
  emoji: string;
  /** What it does. */
  does: string;
  /** Used on demand (from the pet panel), not always at it. */
  lead?: boolean;
  /** A higher tier of another skill (shown in its box, not a box of its own), and which. */
  upgradeOf?: SkillKey;
  tier?: number;
}
export type SkillKey = "fish" | "fish2" | "fish3" | "magnet" | "treasure" | "dig" | "friend" | "home";

/** The tree: three branches, each a skill and the one that grows from it. */
export const SKILLS: Skill[] = [
  { key: "fish", bit: 1 << 0, after: null, name: "Fishing Buddy", emoji: "🎣", does: "While you fish, it waits by the water and now and then pulls a fish out too. Rare ones flop on the bank: tap them to land them!", tier: 1 },
  { key: "fish2", bit: 1 << 6, after: "fish", name: "Fishing Buddy II", emoji: "🎣", does: "It can bring up epic fish too.", upgradeOf: "fish", tier: 2 },
  { key: "fish3", bit: 1 << 7, after: "fish2", name: "Fishing Buddy III", emoji: "🎣", does: "It can bring up legendary fish too.", upgradeOf: "fish", tier: 3 },
  { key: "magnet", bit: 1 << 1, after: "fish", name: "Scrap Hound", emoji: "🧲", does: "While you're magnet fishing, it dives in and now and then drags something up for you." },
  { key: "treasure", bit: 1 << 2, after: null, name: "Treasure Nose", emoji: "📦", does: "Sniffs out today's lucky crate and leads you right to it.", lead: true },
  { key: "dig", bit: 1 << 3, after: "treasure", name: "Coin Digger", emoji: "⛏️", does: "Out on walks around town, it digs up a few coins every couple of minutes." },
  { key: "friend", bit: 1 << 4, after: null, name: "Friend Finder", emoji: "👥", does: "Picks up the scent of the nearest player and leads you to them.", lead: true },
  { key: "home", bit: 1 << 5, after: "friend", name: "Homeward", emoji: "🏠", does: "Knows the way home from anywhere in town, and takes you there.", lead: true },
];
/** A skill point at each of these levels (the first straight away). */
export const SKILL_LEVELS = [1, 8, 18, 30, 40, 50, 75, 90];

/** The fishing buddy's tiers: the rarest it can bring up at each (tier I rare, II epic, III legendary). */
export const FISH_TIER_MOST = ["", "rare", "epic", "legendary"];

/** How far up its tiers pet `p` has `key` (0: not learnt). */
export function tierOf(p: Pet | null | undefined, key: SkillKey): number {
  if (!knows(p, key)) return 0;
  let t = 1;
  for (const u of SKILLS.filter((k) => k.upgradeOf === key)) if (knows(p, u.key)) t = Math.max(t, u.tier ?? 1);
  return t;
}

/** Skill points a pet at `level` has had in all. */
export function skillPoints(level: number): number {
  return SKILL_LEVELS.filter((l) => level >= l).length;
}

/** Whether pet `p` has learnt `key`. */
export function knows(p: Pet | null | undefined, key: SkillKey): boolean {
  const k = SKILLS.find((s) => s.key === key);
  return !!p && !!k && ((p.skills ?? 0) & k.bit) !== 0;
}

/** Skill points it has to spend. */
export function pointsLeft(p: Pet): number {
  let n = 0;
  for (let b = p.skills ?? 0; b; b &= b - 1) n++;
  return skillPoints(levelOf(p.xp ?? 0)) - n;
}

/** Looking after it: no coins, a little happier, a little experience. */
export type Care = "cuddle" | "brush" | "bath";

/** How fast needs run down (points an hour), as on the server. */
const FOOD_PER_HOUR = 4;
const JOY_PER_HOUR = 3;

export type Meal = "snack" | "meal" | "treat";
export const MEAL_PRICES: Record<Meal, number> = { snack: 3, meal: 8, treat: 15 };

export type PetGame = "fetch" | "laser" | "hop" | "splash" | "roll";

const key = () => crypto.randomUUID();

export class Pets {
  all: Pet[] = [];
  /** How long a walk has to be to count. */
  walkSecs = 180;
  /** Below this in food or joy, a pet is sad. */
  sadBelow = 30;
  breedPrice = 350;
  restylePrice = 120;
  /** When the list was loaded (ms): needs run down from then. */
  private loadedAt = Date.now();
  /** When the current walk started (ms, this browser), if yours is out.
   * A walk found already out (after a reload) is taken as starting then. */
  outSince = 0;
  private listeners = new Set<() => void>();
  /** Your pet went up a level (its name, the new level). */
  onLevelUp: (name: string, level: number) => void = () => {};
  /** What something just did for your pet: food, joy, experience gained (whole points; any may be 0). */
  onGain: (gain: { food: number; joy: number; xp: number }) => void = () => {};

  constructor(
    private auth: Auth,
    private eco?: Economy,
  ) {}

  onChange(f: () => void): () => void {
    this.listeners.add(f);
    return () => this.listeners.delete(f);
  }

  private changed() {
    for (const f of this.listeners) f();
  }

  get mine(): Pet | null {
    const me = this.auth.player?.id;
    return this.all.find((p) => p.owner === me) ?? null;
  }

  /** A walker's pet, by their name. */
  ofName(name: string): Pet | null {
    return this.all.find((p) => p.owner_name === name) ?? null;
  }

  ofOwner(owner: string): Pet | null {
    return this.all.find((p) => p.owner === owner) ?? null;
  }

  /** A pet's needs now (they run down between loads). */
  needs(p: Pet): { food: number; joy: number } {
    const h = (Date.now() - this.loadedAt) / 3_600_000;
    return { food: Math.max(0, p.food - FOOD_PER_HOUR * h), joy: Math.max(0, p.joy - JOY_PER_HOUR * h) };
  }

  sad(p: Pet): boolean {
    const n = this.needs(p);
    return n.food < this.sadBelow || n.joy < this.sadBelow;
  }

  /** What it most wants, if anything: food, a game, a walk. */
  wish(p: Pet): "food" | "play" | "walk" | null {
    const n = this.needs(p);
    if (n.food < 40) return "food";
    if (n.joy < 40) return "play";
    if (!p.walked_today && !p.out) return "walk";
    return null;
  }

  async load() {
    const r = await this.auth.get<{ pets: Pet[]; walk_secs: number; sad_below?: number; breed_price?: number; restyle_price?: number }>("/api/pets");
    this.all = r.pets;
    this.loadedAt = Date.now();
    this.walkSecs = r.walk_secs;
    if (r.sad_below) this.sadBelow = r.sad_below;
    if (r.breed_price) this.breedPrice = r.breed_price;
    if (r.restyle_price) this.restylePrice = r.restyle_price;
    const mine = this.mine;
    if (mine?.out && !this.outSince) this.outSince = Date.now();
    if (!mine?.out) this.outSince = 0;
    this.changed();
  }

  /** Puts a fresh copy of your pet in the list (its needs as of now). */
  private put(p: Pet | null, levelUp?: number | null) {
    if (!p) return;
    if (levelUp) window.setTimeout(() => this.onLevelUp(p.name, levelUp), 400);
    // Yours: what that did for it (its needs as they'd run down to now, against now).
    const was = this.all.find((x) => x.owner === p.owner);
    if (was && p.owner === this.auth.player?.id) {
      const n = this.needs(was);
      const gain = { food: Math.round(p.food - n.food), joy: Math.round(p.joy - n.joy), xp: Math.round(p.xp - was.xp) };
      if (gain.food >= 1 || gain.joy >= 1 || gain.xp >= 1) this.onGain(gain);
    }
    // Others' needs keep running from the last load; yours restart now.
    const h = (Date.now() - this.loadedAt) / 3_600_000;
    const fresh = { ...p, food: p.food + FOOD_PER_HOUR * h, joy: p.joy + JOY_PER_HOUR * h };
    this.all = [...this.all.filter((x) => x.owner !== p.owner), fresh];
    this.changed();
  }

  /** Takes your pet out (or home). Home: whether that counted as today's walk. */
  async walk(out: boolean): Promise<boolean> {
    const r = await this.auth.send<{ pet: Pet; walked: boolean; level_up?: number | null }>("/api/me/pet/walk", { out });
    this.outSince = out ? this.outSince || Date.now() : 0;
    this.put(r.pet, r.level_up);
    return r.walked;
  }

  /** Feeds your pet (for a few coins). */
  async feed(meal: Meal) {
    const r = await this.auth.send<{ pet: Pet; applied: Applied; level_up?: number | null }>("/api/me/pet/feed", { meal, key: key() });
    this.eco?.applyResult(r.applied);
    this.put(r.pet, r.level_up);
  }

  /** After a game (or care, or a playdate): coins earned (the day's first few games). */
  async play(game: PetGame | Care | "playdate", score = 0): Promise<number> {
    return (await this.act(game, score)).coins;
  }

  /** Care or a playdate: whether it counted (not too soon after the last). */
  async care(what: Care | "playdate"): Promise<boolean> {
    return !(await this.act(what, 0)).resting;
  }

  private async act(game: string, score: number): Promise<{ coins: number; resting: boolean }> {
    const r = await this.auth.send<{ pet: Pet; coins: number; applied: Applied; level_up?: number | null; resting?: boolean }>("/api/me/pet/play", { game, score: Math.max(0, Math.round(score)), key: key() });
    if (r.applied?.totals?.length) this.eco?.applyResult(r.applied);
    this.put(r.pet, r.level_up);
    return { coins: r.coins, resting: !!r.resting };
  }

  /** Your pet does a trick it's learnt. */
  async trick(trick: string) {
    const r = await this.auth.send<{ pet: Pet; level_up?: number | null }>("/api/me/pet/trick", { trick });
    this.put(r.pet, r.level_up);
  }

  /** Your pet learns a skill (a skill point spent). */
  async learn(skill: SkillKey) {
    const r = await this.auth.send<{ pet: Pet }>("/api/me/pet/skill", { skill });
    this.put(r.pet);
  }

  /** The pets yours has played Treat Catch with: whose, and how fond they are of each other. */
  async friends(): Promise<{ owner: string; pet: string | null; points: number; level: number }[]> {
    const r = await this.auth.get<{ friends: { owner: string; pet: string | null; points: number; level: number }[] }>("/api/me/pet/friends");
    return r.friends;
  }

  /** A pet made to order at the Breeder. */
  async breed(design: number, name: string) {
    const r = await this.auth.send<{ pet: Pet; applied: Applied }>("/api/me/pet/breed", { design, name, key: key() });
    this.eco?.applyResult(r.applied);
    await this.load();
  }

  /** Puts your pet up for adoption at the Pets shop (room for another). */
  async rehome() {
    await this.auth.send<{ rehomed: string }>("/api/me/pet/rehome", {});
    this.outSince = 0;
    await this.load();
  }

  /** A new look for your pet. */
  async restyle(design: number) {
    const r = await this.auth.send<{ pet: Pet; applied: Applied }>("/api/me/pet/restyle", { design, key: key() });
    this.eco?.applyResult(r.applied);
    this.put(r.pet);
  }
}
