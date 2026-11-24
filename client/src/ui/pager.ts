// Menus that don't fit, a page at a time: when a panel's sections (each
// starting at an <h3> or <h4>) won't all fit in it, they become pages, with a row of
// tabs along the top (and ‹ › to step through them), instead of a long
// scroll. What's above the first heading (a pet's portrait, say) goes on
// the first page. A panel whose sections fit as they are is left alone,
// and so is one with tabs of its own. The page you were on is remembered
// (per panel), across its redraws and the next time it's opened.

/** An element (as `panels.el`, kept here so the two don't lean on each other). */
function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = ""): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

/** Whether a panel's body has tabs of its own already (left as it is). */
const ownTabs = (n: Element) => /(^|[\s-])tabs(\s|$)/.test(n.className);

export class Pager {
  /** The row of tabs, over the body. */
  readonly bar = el("div", "panel-pages");
  /**
   * Under the body: what still doesn't fit (a long list, a grid of finds, a
   * full page), a page at a time: ‹ Page 1 of 3 ›, no scrollbar (the wheel
   * and a swipe still scroll it, the count keeping up).
   */
  readonly steps = el("div", "panel-steps");
  private stepLabel = el("span", "steps-label");
  private observer: MutationObserver;
  private queued = false;
  /** The page shown (its title), remembered per panel. */
  private current: string;
  private busy = false;

  constructor(
    private body: HTMLElement,
    private key: string,
  ) {
    this.bar.hidden = true;
    this.steps.hidden = true;
    const step = (d: number) => {
      const b = this.body;
      b.scrollBy({ top: d * Math.max(40, b.clientHeight - 36), behavior: "smooth" });
    };
    const arrow = (label: string, d: number, title: string) => {
      const b = el("button", "page-step", label);
      b.type = "button";
      b.title = title;
      b.setAttribute("aria-label", title);
      b.onclick = () => step(d);
      return b;
    };
    this.steps.append(arrow("‹", -1, "Previous page"), this.stepLabel, arrow("›", 1, "Next page"));
    body.addEventListener("scroll", () => this.count(), { passive: true });
    try {
      this.current = sessionStorage.getItem(`commons.page.${key}`) ?? "";
    } catch {
      this.current = "";
    }
    this.observer = new MutationObserver(() => this.queue());
    this.observer.observe(body, { childList: true });
    // (Taller or shorter, a wider screen: whether it needs pages may change.)
    if (typeof ResizeObserver !== "undefined") new ResizeObserver(() => this.queue()).observe(body);
  }

  /** Looks again soon (once, however many changes come at once). */
  queue() {
    if (this.queued || this.busy) return;
    this.queued = true;
    requestAnimationFrame(() => {
      this.queued = false;
      this.layout();
    });
  }

  /** Its content, as it was put there: whatever the pages hold, back in order. */
  private nodes(): Node[] {
    const out: Node[] = [];
    for (const c of Array.from(this.body.childNodes)) {
      if (c instanceof HTMLElement && (c.classList.contains("page") || c.classList.contains("page-top"))) out.push(...Array.from(c.childNodes));
      else out.push(c);
    }
    return out;
  }

  private layout() {
    if (!this.body.isConnected || this.body.offsetParent === null) return;
    this.busy = true;
    this.observer.disconnect();
    try {
      this.paginate();
    } finally {
      this.observer.observe(this.body, { childList: true });
      this.busy = false;
    }
    this.fit();
    this.count();
  }

  /**
   * A game in it (a canvas, as wide as the panel) that makes it too tall:
   * smaller, the same shape, till the rest fits under it (not a page more
   * to step to). Enlarged panels size theirs themselves (`enlargeable`).
   */
  private fit() {
    const b = this.body;
    if (b.closest(".big")) return;
    const shown = Array.from(b.querySelectorAll("canvas")).filter((c) => c.offsetParent !== null);
    for (const c of shown) {
      if (!c.dataset.fit) continue;
      c.style.maxWidth = c.style.height = c.style.marginLeft = c.style.marginRight = "";
      delete c.dataset.fit;
    }
    const over = b.scrollHeight - b.clientHeight;
    if (over <= 6) return;
    // (The tallest one gives, down to two fifths of its size at most.)
    const c = shown.reduce<HTMLCanvasElement | null>((a, x) => (!a || x.offsetHeight > a.offsetHeight ? x : a), null);
    if (!c || c.offsetHeight < 120) return;
    const h = Math.max(c.offsetHeight * 0.4, c.offsetHeight - over - 4);
    c.dataset.fit = "1";
    c.style.maxWidth = `${Math.floor((c.offsetWidth * h) / c.offsetHeight)}px`;
    c.style.height = "auto";
    c.style.marginLeft = c.style.marginRight = "auto";
  }

  /** Still too much to fit (the page shown, or all of it): the page count under it, not a scrollbar. */
  private count() {
    const b = this.body;
    const view = Math.max(40, b.clientHeight - 36);
    const over = b.scrollHeight > b.clientHeight + 6;
    b.classList.toggle("stepped", over);
    this.steps.hidden = !over;
    if (!over) return;
    const pages = 1 + Math.ceil((b.scrollHeight - b.clientHeight) / view);
    const at = b.scrollTop + b.clientHeight >= b.scrollHeight - 4 ? pages : 1 + Math.round(b.scrollTop / view);
    this.stepLabel.textContent = `Page ${Math.min(pages, at)} of ${pages}`;
  }

  private paginate() {
    const nodes = this.nodes();
    // The sections: what's before the first heading, then a section a heading.
    const top: Node[] = [];
    const sections: { title: string; nodes: Node[] }[] = [];
    for (const n of nodes) {
      // (A heading: an <h3>, or a heading row with one first in it, a count or a badge beside.)
      const heading = (e: Element | null | undefined) => !!e && (e.tagName === "H3" || e.tagName === "H4");
      const h = n instanceof HTMLElement ? (heading(n) ? n : heading(n.firstElementChild) ? (n.firstElementChild as HTMLElement) : null) : null;
      if (h) sections.push({ title: (h.textContent ?? "").trim(), nodes: [n] });
      else if (sections.length) sections[sections.length - 1].nodes.push(n);
      else top.push(n);
    }
    const flat = () => {
      this.body.classList.remove("paged");
      this.body.replaceChildren(...nodes);
      this.bar.hidden = true;
    };
    if (sections.length < 2 || nodes.some((n) => n instanceof Element && ownTabs(n))) return flat();
    // All of it fits as it is: no pages.
    flat();
    if (this.body.scrollHeight <= this.body.clientHeight + 6) return;
    // Pages: the top above them all, a page a section, the one you were on shown.
    let at = sections.findIndex((s) => s.title === this.current);
    if (at < 0) at = 0;
    const pages = sections.map((s, i) => {
      const p = el("div", "page");
      p.append(...s.nodes);
      p.hidden = i !== at;
      return p;
    });
    // (What's above the first heading, an overview, a pet's portrait: on the first page, the
    // others with the whole of the panel to themselves.)
    pages[0].prepend(...top);
    this.body.classList.add("paged");
    this.body.replaceChildren(...pages);
    this.drawBar(sections.map((s) => s.title), at, pages);
    this.bar.hidden = false;
  }

  private drawBar(titles: string[], at: number, pages: HTMLElement[]) {
    const go = (i: number) => {
      const n = titles.length;
      const to = ((i % n) + n) % n;
      this.current = titles[to];
      try {
        sessionStorage.setItem(`commons.page.${this.key}`, this.current);
      } catch {
        // storage unavailable
      }
      pages.forEach((p, k) => (p.hidden = k !== to));
      tabs.forEach((t, k) => t.classList.toggle("on", k === to));
      tabs[to].scrollIntoView({ block: "nearest", inline: "nearest" });
      this.body.scrollTop = 0;
      at = to;
      this.fit();
      this.count();
    };
    const arrow = (label: string, d: number, title: string) => {
      const b = el("button", "page-step", label);
      b.type = "button";
      b.title = title;
      b.setAttribute("aria-label", title);
      b.onclick = () => go(at + d);
      return b;
    };
    const strip = el("div", "page-tabs");
    const tabs = titles.map((t, i) => {
      const b = el("button", i === at ? "page-tab on" : "page-tab", t);
      b.type = "button";
      b.onclick = () => go(i);
      return b;
    });
    strip.append(...tabs);
    this.bar.replaceChildren(arrow("‹", -1, "Previous page"), strip, arrow("›", 1, "Next page"));
    requestAnimationFrame(() => tabs[at]?.scrollIntoView({ block: "nearest", inline: "nearest" }));
  }
}
