// Trading face to face (social trade.rs): tap someone, ask to trade, and
// once they say yes you each put things from your bag (and coins) on the
// table. Changing anything takes both locks off; when you're both locked in,
// you each press Trade, and it all changes hands at once. Leave your side
// empty and it's a present.

import type { Economy } from "../economy";
import type { Social } from "../social";
import { COIN } from "../economy";
import { ChoiceModal, Panel, button, el, icon } from "./panels";

interface Side {
  items: [number, number][];
  coins: number;
  locked: boolean;
  confirmed: boolean;
}

/** A trade as the server shows it to you. */
interface TradeView {
  id: string;
  state: "asked" | "open" | "swapping";
  /** Whether you asked (else they asked you). */
  asker: boolean;
  me: Side;
  them: Side & { id: string; name: string };
}

/** A trade ending: done (what went each way), or called off and why. */
interface TradeEnd {
  id: string;
  state: "done" | "cancelled";
  reason?: "declined" | "cancelled" | "left";
  by_you?: boolean;
  with?: string;
  gave?: Side;
  got?: Side;
}

export class TradePanel extends Panel {
  private trade: TradeView | null = null;
  /** Your bag, open to pick from. */
  private picking = false;
  private err = el("p", "error");
  private ask = new ChoiceModal();
  /** A request is on its way (no double taps). */
  private busy = false;

  constructor(
    private eco: Economy,
    private social: Social,
    private toast: (text: string, ms?: number) => void,
  ) {
    super("🤝 Trade", "trade");
    this.sticky = true;
    social.onPush((m) => {
      if (m.t === "trade") this.onTrade(m.trade as TradeView | TradeEnd);
    });
    eco.onChange(() => this.open && this.picking && this.render());
  }

  /** Asks `name` (here with you) to trade. */
  async start(name: string) {
    try {
      await this.social.tradeAsk(name);
    } catch (e) {
      this.toast((e as Error).message || "That didn't work.");
    }
  }

  private onTrade(m: TradeView | TradeEnd) {
    if (m.state === "done" || m.state === "cancelled") return this.ended(m as TradeEnd);
    const t = m as TradeView;
    const was = this.trade;
    this.trade = t;
    if (t.state === "asked" && !t.asker) {
      // Asked: say yes or no, over the world.
      this.ask.show(
        `${t.them.name} wants to trade`,
        "You each put things on the table; nothing changes hands till you both lock in and press Trade.",
        [{ icon: "🤝", label: "Trade", sub: "Open the table", primary: true, pick: () => void this.call(() => this.social.tradeAnswer(t.id, true)) }],
        () => void this.call(() => this.social.tradeAnswer(t.id, false)),
        "🤝 Trade",
      );
      return;
    }
    if (!was || was.id !== t.id) this.picking = false;
    if (!this.open) this.show();
    else this.render();
  }

  private ended(t: TradeEnd) {
    if (this.trade && this.trade.id !== t.id) return;
    const name = this.trade?.them.name ?? t.with ?? "They";
    this.trade = null;
    this.ask.hide();
    if (this.open) super.hide();
    if (t.state === "done") {
      void this.eco.load();
      const got = this.describe(t.got);
      const gave = this.describe(t.gave);
      this.toast(got ? `🤝 Traded with ${t.with}: you got ${got}.` : `🎁 You gave ${t.with} ${gave}.`, 5000);
      return;
    }
    if (t.by_you) return;
    if (t.reason === "declined") this.toast(`${name} doesn't want to trade right now.`);
    else if (t.reason === "left") this.toast(`${name} left: the trade's off.`);
    else this.toast(`${name} called the trade off.`);
  }

  /** "2 Tulips, 30 coins" (empty if nothing). */
  private describe(s: Side | undefined): string {
    if (!s) return "";
    const parts = s.items.map(([i, q]) => `${q > 1 ? `${q} ` : ""}${this.eco.name(i)}`);
    if (s.coins) parts.push(`${s.coins} coins`);
    return parts.join(", ");
  }

  /** Runs a request, showing what went wrong (if anything). */
  private async call(f: () => Promise<unknown>) {
    if (this.busy) return;
    this.busy = true;
    this.err.textContent = "";
    try {
      await f();
    } catch (e) {
      this.err.textContent = (e as Error).message || "That didn't work.";
      if (!this.open) this.toast(this.err.textContent);
    } finally {
      this.busy = false;
    }
  }

  /** Your side as it'll be with `item` changed by `by` (and coins set to `coins`). */
  private put(item: number | null, by: number, coins?: number) {
    const t = this.trade;
    if (!t) return;
    const items = new Map(t.me.items);
    if (item !== null) {
      const n = Math.max(0, Math.min(this.eco.qty(item), (items.get(item) ?? 0) + by));
      if (n) items.set(item, n);
      else items.delete(item);
    }
    void this.call(() => this.social.tradeOffer(t.id, [...items], coins ?? t.me.coins));
  }

  hide() {
    // Closing the table calls it off.
    const t = this.trade;
    if (t) void this.social.tradeCancel(t.id).catch(() => {});
    this.trade = null;
    super.hide();
  }

  render() {
    const t = this.trade;
    this.body.replaceChildren();
    if (!t) return;
    this.titleEl.textContent = `🤝 Trade with ${t.them.name}`;
    if (t.state === "asked") {
      this.body.append(el("p", "hint", `Waiting for ${t.them.name} to say yes…`), this.err);
      this.body.append(button("Call it off", () => this.hide(), "subtle"));
      return;
    }
    const cols = el("div", "trade-cols");
    cols.append(this.column("You give", t.me, true), this.column(`${t.them.name} gives`, t.them, false));
    this.body.append(cols);
    if (!t.me.items.length && !t.me.coins && (t.them.items.length || t.them.coins)) this.body.append(el("p", "hint", "Your side's empty: you'd get this as a present."));
    else if (!t.them.items.length && !t.them.coins && (t.me.items.length || t.me.coins)) this.body.append(el("p", "hint", "Their side's empty: this goes to them as a present."));
    this.body.append(this.err);
    // Lock in; then, both locked, Trade.
    const row = el("div", "trade-actions");
    const both = t.me.locked && t.them.locked;
    if (t.state === "swapping") row.append(el("p", "hint", "Changing hands…"));
    else if (both && t.me.confirmed) row.append(el("p", "hint", `Waiting for ${t.them.name} to press Trade…`));
    else if (both) row.append(button("✅ Trade!", () => void this.call(() => this.social.tradeConfirm(t.id)), "primary"));
    else if (t.me.locked) row.append(el("p", "hint", `Locked in. Waiting for ${t.them.name}…`), button("Unlock", () => void this.call(() => this.social.tradeLock(t.id, false)), "small"));
    else row.append(button("🔒 Lock in", () => void this.call(() => this.social.tradeLock(t.id, true)), "primary"));
    row.append(button("Cancel", () => this.hide(), "subtle"));
    this.body.append(row);
    if (this.picking) this.body.append(this.bag(t));
  }

  /** One side of the table: what's on it, and (yours) the ways to change it. */
  private column(title: string, s: Side, mine: boolean): HTMLElement {
    const col = el("div", `trade-side${s.locked ? " locked" : ""}`);
    const head = el("div", "trade-head");
    head.append(el("strong", "", title), el("span", "trade-lock", s.confirmed ? "✅ Ready" : s.locked ? "🔒 Locked" : ""));
    col.append(head);
    const list = el("div", "rows");
    for (const [item, q] of s.items) {
      const it = this.eco.items.get(item);
      const row = el("div", "row");
      row.append(icon(it), el("span", "name", `${it?.name ?? "Something"} ×${q}`));
      if (mine) row.append(button("−", () => this.put(item, -1), "small"), button("+", () => this.put(item, 1), "small"));
      list.append(row);
    }
    if (!s.items.length && !s.coins) list.append(el("p", "empty", mine ? "Nothing yet." : "Nothing yet."));
    col.append(list);
    // Coins.
    const coins = el("div", "trade-coins");
    coins.append(icon(this.eco.items.get(COIN)));
    if (mine) {
      const input = el("input");
      input.type = "number";
      input.min = "0";
      input.max = String(this.eco.coins);
      input.value = String(s.coins);
      input.onchange = () => this.put(null, 0, Math.max(0, Math.min(this.eco.coins, Math.floor(Number(input.value) || 0))));
      coins.append(input, el("span", "", "coins"));
    } else coins.append(el("span", "", `${s.coins} coins`));
    col.append(coins);
    if (mine) col.append(button(this.picking ? "Close bag" : "＋ Add from bag", () => ((this.picking = !this.picking), this.render()), "small"));
    return col;
  }

  /** Your bag: what you could put up (not what's yours to keep), a tap to add one. */
  private bag(t: TradeView): HTMLElement {
    const offered = new Map(t.me.items);
    const wrap = el("div", "trade-bag");
    const things = [...this.eco.items.values()]
      .filter((i) => i.id !== COIN && i.kind !== "currency" && !i.meta.account_bound && this.eco.qty(i.id) - (offered.get(i.id) ?? 0) > 0)
      .sort((a, b) => (b.rarity ?? 0) - (a.rarity ?? 0) || a.name.localeCompare(b.name));
    if (!things.length) wrap.append(el("p", "empty", "Nothing in your bag you can trade."));
    for (const it of things) {
      const b = el("button", "trade-pick");
      b.type = "button";
      b.title = it.name;
      b.append(icon(it), el("span", "trade-count", String(this.eco.qty(it.id) - (offered.get(it.id) ?? 0))));
      b.onclick = () => this.put(it.id, 1);
      wrap.append(b);
    }
    return wrap;
  }

  destroy() {
    this.ask.destroy();
    super.destroy();
  }
}
