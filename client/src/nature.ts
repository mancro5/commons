// Bugs and mushrooms (ADR 0019; server: crates/social/src/nature.rs). What's
// out where is the same for everyone, worked out from the clock, the weather,
// the season and the moon; each can be taken once by each of us.

import type { Applied, Economy } from "./economy";
import type { Auth } from "./net/api";

/** The bug net (server `nature::NET_ITEM`). */
export const NET_ITEM = 960;

export interface Out {
  spot: number;
  x: number;
  y: number;
  slot: number;
  /** When it goes (unix ms). */
  ends: number;
  shroom: boolean;
  item: number;
  key: string;
  rarity: number;
  woozy: boolean;
}

export interface OutNow {
  now: number;
  out: Out[];
  weather: string;
  season: string;
  moon: string;
}

export interface Caught {
  item: number;
  key: string;
  name: string;
  rarity: number;
  /** New in your journal. */
  first: boolean;
  woozy: boolean;
  applied: Applied;
}

export class Nature {
  now: OutNow | null = null;
  private hintsP: Promise<Record<string, string>> | null = null;
  private listeners = new Set<() => void>();
  /** Spots you've just caught at or scared off (by spot and slot), till the next load forgets them. */
  private gone = new Set<string>();

  constructor(
    private auth: Auth,
    private eco: Economy,
  ) {}

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private changed() {
    this.listeners.forEach((f) => f());
  }

  async load(): Promise<OutNow> {
    this.now = await this.auth.get<OutNow>("/api/social/nature/out");
    const live = new Set(this.now.out.map((o) => `${o.spot}:${o.slot}`));
    for (const g of this.gone) if (!live.has(g)) this.gone.delete(g);
    this.changed();
    return this.now;
  }

  /** What's out and still there for you. */
  get out(): Out[] {
    return (this.now?.out ?? []).filter((o) => !this.gone.has(`${o.spot}:${o.slot}`) && o.ends > Date.now() - 30_000);
  }

  /** It flew off (a miss, or it heard you coming): gone for you this time. */
  scare(o: Out) {
    this.gone.add(`${o.spot}:${o.slot}`);
    this.changed();
  }

  async catch(o: Out): Promise<Caught> {
    const r = await this.auth.send<Caught>("/api/social/nature/catch", { spot: o.spot, slot: o.slot });
    this.gone.add(`${o.spot}:${o.slot}`);
    this.eco.applyResult(r.applied);
    if (r.first) this.eco.setTotal(r.item, this.eco.qty(r.item), true);
    this.changed();
    return r;
  }

  /** Where and when to look for each bug and mushroom (by key). */
  hints(): Promise<Record<string, string>> {
    this.hintsP ??= this.auth.get<Record<string, string>>("/api/social/nature/hints").catch((e) => {
      this.hintsP = null;
      throw e;
    });
    return this.hintsP;
  }
}
