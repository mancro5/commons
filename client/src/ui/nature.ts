// Bug catching and the Naturalist's Journal (ADR 0019). The net game: a
// ring closes in and opens out round the bug; swing when it's on the line
// (rarer bugs: a thinner line, a quicker ring). The journal: everything
// you've found, fish, bugs, mushrooms and flowers, where and when to look
// for what you haven't, what you've given the museum, and a title for each
// section as it fills.

import type { Economy, Item } from "../economy";
import type { Museum } from "../museum";
import type { Nature } from "../nature";
import { drawBug } from "../world/critterart";
import { Panel, button, el, icon, isTyping } from "./panels";
import { tier } from "./rarity";

// ---- the net game ---------------------------------------------------------------------------

/** How hard each rarity is: how near the line counts (fraction of the target) and the ring's pace. */
const NET_TIERS = [
  { slack: 0.2, pace: 2.4 },
  { slack: 0.16, pace: 2.9 },
  { slack: 0.13, pace: 3.4 },
  { slack: 0.1, pace: 3.9 },
  { slack: 0.08, pace: 4.3 },
  { slack: 0.065, pace: 4.6 },
];
/** It flies off if you haven't swung by then. */
const NET_MS = 6000;

export class NetGame {
  private el = el("div", "netgame");
  private title = el("div", "title");
  private ring = el("div", "net-ring");
  private target = el("div", "net-target");
  private pic = el("canvas", "net-bug");
  private start = 0;
  private pace = 2.4;
  private slack = 0.2;
  private raf = 0;
  private done: ((ok: boolean) => void) | null = null;
  /** When it was last swung (the click's release comes after the panel hides). */
  hitAt = -Infinity;
  private key = (e: KeyboardEvent) => {
    if (isTyping(e)) return;
    if (e.code === "Space" || e.code === "Enter") {
      e.preventDefault();
      if (!e.repeat) this.swing();
    }
  };

  constructor() {
    const field = el("div", "net-field");
    this.pic.width = this.pic.height = 32;
    field.append(this.target, this.ring, this.pic);
    const btn = button("Swing!", () => {}, "primary");
    btn.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      this.swing();
    });
    this.el.append(this.title, field, btn);
    this.el.hidden = true;
    document.body.appendChild(this.el);
  }

  get active(): boolean {
    return !this.el.hidden || performance.now() - this.hitAt < 700;
  }

  /** The ring's size now, as a fraction of the target's. */
  private size(t: number): number {
    const s = (t - this.start) / 1000;
    return 1 + 0.65 * Math.cos(s * this.pace);
  }

  play(key: string, name: string, rarity: number, done: (ok: boolean) => void) {
    this.done = done;
    const t = NET_TIERS[Math.max(0, Math.min(5, rarity))];
    this.pace = t.pace;
    this.slack = t.slack;
    const tr = tier(rarity);
    this.title.replaceChildren();
    const b = el("b", "", tr.name.toUpperCase());
    // (Common's pale grey is hard to read on paper: plain ink for it.)
    b.style.color = rarity > 0 ? tr.color : "";
    this.title.append(b, ` ${name}! Swing when the ring is on the line`);
    this.target.style.borderColor = rarity > 0 ? tr.color : "";
    this.target.style.borderWidth = `${Math.max(2, Math.round(this.slack * 40))}px`;
    const ctx = this.pic.getContext("2d")!;
    ctx.clearRect(0, 0, 32, 32);
    drawBug(ctx, key);
    this.start = performance.now();
    this.el.hidden = false;
    window.addEventListener("keydown", this.key, true);
    const frame = (now: number) => {
      this.ring.style.transform = `translate(-50%, -50%) scale(${this.size(now)})`;
      if (now - this.start > NET_MS) return this.finish(false);
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }

  private swing() {
    if (!this.done) return;
    this.hitAt = performance.now();
    this.finish(Math.abs(this.size(performance.now()) - 1) <= this.slack);
  }

  private finish(ok: boolean) {
    cancelAnimationFrame(this.raf);
    window.removeEventListener("keydown", this.key, true);
    this.el.hidden = true;
    const d = this.done;
    this.done = null;
    d?.(ok);
  }

  cancel() {
    if (this.done) this.finish(false);
  }
}

// ---- the journal ----------------------------------------------------------------------------

type Section = { key: string; title: string; kinds: string[]; ranks: [string, string, string]; empty: string };

const SECTIONS: Section[] = [
  { key: "fish", title: "🐟 Fish", kinds: ["fish"], ranks: ["Angler's Apprentice", "Keen Angler", "Master Angler"], empty: "Cast a line at the Pond or the Lake." },
  { key: "bugs", title: "🦋 Bugs", kinds: ["bug"], ranks: ["Bug Spotter", "Bug Hunter", "Entomologist"], empty: "Get a net from the Museum's curator, then look in the Park, the Woods, the Meadow, the Orchard and by the water." },
  { key: "shrooms", title: "🍄 Mushrooms", kinds: ["shroom"], ranks: ["Mushroom Picker", "Forager", "Mycologist"], empty: "Mushrooms come up in the Woods, the Meadow, the Orchard and the Park, best after rain." },
  { key: "plants", title: "🌷 Garden", kinds: ["plant"], ranks: ["Seedling", "Green Thumb", "Master Gardener"], empty: "Plant seeds in the Community Garden in the Orchard." },
];

const WEATHER_ICON: Record<string, string> = { clear: "☀️", cloudy: "⛅", rain: "🌧", mist: "🌫" };

/** A section's title for how much of it you've found: a quarter, two thirds, all. */
export function rankFor(found: number, total: number, ranks: [string, string, string]): string | null {
  if (!total || !found) return null;
  if (found >= total) return ranks[2];
  if (found >= Math.ceil((total * 2) / 3)) return ranks[1];
  if (found >= Math.ceil(total / 4)) return ranks[0];
  return null;
}

export class JournalPanel extends Panel {
  private section = "bugs";
  private hints: Record<string, string> = {};
  private given = new Set<number>();

  constructor(
    private eco: Economy,
    private nature: Nature,
    private museum: Museum,
  ) {
    super("📔 Naturalist's Journal", "journal");
    eco.onChange(() => this.open && this.render());
  }

  show() {
    super.show();
    this.eco.loadAlbum().catch(() => {});
    void this.nature
      .hints()
      .then((h) => {
        this.hints = h;
        if (this.open) this.render();
      })
      .catch(() => {});
    void this.museum
      .nature()
      .then((n) => {
        this.given = new Set([...n.fish, ...n.bugs, ...n.shrooms].filter((s) => s.given).map((s) => s.item));
        if (this.open) this.render();
      })
      .catch(() => {});
    if (!this.nature.now) void this.nature.load().then(() => this.open && this.render()).catch(() => {});
  }

  private items(s: Section): Item[] {
    return this.eco.ofKind(...s.kinds).sort((a, b) => (s.key === "fish" ? a.rarity - b.rarity || a.id - b.id : a.id - b.id));
  }

  private hint(it: Item): string {
    if (it.kind === "fish") return it.meta.night ? "the Pond and the Lake · at night" : "the Pond and the Lake";
    if (it.kind === "plant") return "grown from seed";
    return this.hints[it.key] ?? "";
  }

  render() {
    this.body.replaceChildren();
    const n = this.nature.now;
    if (n) this.body.append(el("p", "hint journal-today", `${WEATHER_ICON[n.weather] ?? ""} ${n.weather[0].toUpperCase()}${n.weather.slice(1)} · ${n.season} · ${n.moon} tonight`));

    // Titles earned so far, and the tabs with how far along each is.
    const earned: string[] = [];
    const tabs = el("div", "tabs");
    let all = true;
    for (const s of SECTIONS) {
      const items = this.items(s);
      const found = items.filter((i) => this.eco.album.has(i.id)).length;
      const rank = rankFor(found, items.length, s.ranks);
      if (rank) earned.push(rank);
      if (s.key !== "plants" && found < items.length) all = false;
      tabs.append(button(`${s.title} ${found}/${items.length}`, () => ((this.section = s.key), this.render()), this.section === s.key ? "on" : ""));
    }
    if (all) earned.unshift("Naturalist of the Commons");
    if (earned.length) {
      const t = el("p", "journal-titles");
      for (const e of earned) t.append(el("span", "stamp", e));
      this.body.append(t);
    }
    this.body.append(tabs);

    const s = SECTIONS.find((x) => x.key === this.section)!;
    const items = this.items(s);
    const found = items.filter((i) => this.eco.album.has(i.id)).length;
    const bar = el("div", "journal-bar");
    const fill = el("div", "journal-fill");
    fill.style.width = `${items.length ? (found / items.length) * 100 : 0}%`;
    bar.append(fill);
    const now = rankFor(found, items.length, s.ranks);
    const next = s.ranks[(now ? s.ranks.indexOf(now) : -1) + 1];
    this.body.append(bar, el("p", "hint", found ? `${found} of ${items.length} found${next && found < items.length ? ` · next title: ${next}` : ""}.` : s.empty));

    const grid = el("div", "item-grid journal-grid");
    for (const it of items) {
      const entry = this.eco.album.get(it.id);
      const cell = el("div", entry ? "item" : "item unknown");
      const name = el("span", "name", entry ? it.name : "???");
      if (entry) name.style.color = tier(it.rarity).color === "#c8c4b8" ? "" : tier(it.rarity).color;
      cell.append(icon(it), name);
      if (entry) cell.append(el("span", "qty", `×${entry.total}`));
      if (this.given.has(it.id)) cell.append(el("span", "journal-given", "🏛"));
      const h = this.hint(it);
      if (h) cell.append(el("span", "hint", h));
      if (entry) cell.title = `First found ${new Date(entry.first_at * 1000).toLocaleDateString()}`;
      grid.append(cell);
    }
    this.body.append(grid);
  }
}
