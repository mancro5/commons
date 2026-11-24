// Pixel-art pictures for the pets' emoji (the pet panel, the Breeder's
// studio, the pet games, their toasts): drawn from simple shapes on a 16×16
// grid, then outlined boldly all round, in the style of ui/pixicons.ts (which
// puts them in place of the emoji wherever they turn up), so each reads at a
// glance even small: a bone, a fish, a carrot, a bath, a lock…

import type { Icon } from "./pixicons";

const O = "#2a2433";
const S = 16;

/** A little canvas of colour keys to paint shapes onto. */
class Grid {
  readonly px: string[][];
  constructor(
    readonly w = S,
    readonly h = S,
  ) {
    this.px = Array.from({ length: h }, () => Array<string>(w).fill("."));
  }
  set(x: number, y: number, c: string) {
    x = Math.floor(x);
    y = Math.floor(y);
    if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.px[y][x] = c;
  }
  rect(x: number, y: number, w: number, h: number, c: string) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c);
  }
  /** A filled oval (only where `keep` says, if given). */
  ell(cx: number, cy: number, rx: number, ry: number, c: string, keep?: (x: number, y: number) => boolean) {
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const dx = (x + 0.5 - cx) / rx;
        const dy = (y + 0.5 - cy) / ry;
        if (dx * dx + dy * dy <= 1 && (!keep || keep(x, y))) this.set(x, y, c);
      }
    }
  }
  /** A heart, `s` across half its width, its dip at (cx, cy). */
  heart(cx: number, cy: number, s: number, c: string) {
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const X = (x + 0.5 - cx) / s;
        const Y = -(y + 0.5 - cy) / s + 0.2;
        if ((X * X + Y * Y - 1) ** 3 - X * X * Y ** 3 <= 0) this.set(x, y, c);
      }
    }
  }
  /** A line `t` thick. */
  line(x0: number, y0: number, x1: number, y1: number, c: string, t = 1) {
    const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 3) || 1;
    for (let i = 0; i <= n; i++) {
      const x = x0 + ((x1 - x0) * i) / n;
      const y = y0 + ((y1 - y0) * i) / n;
      this.rect(x - (t - 1) / 2, y - (t - 1) / 2, t, t, c);
    }
  }
  /** A filled triangle. */
  tri(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, c: string) {
    const side = (px: number, py: number, x1: number, y1: number, x2: number, y2: number) => (px - x2) * (y1 - y2) - (x1 - x2) * (py - y2);
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const d1 = side(x + 0.5, y + 0.5, ax, ay, bx, by);
        const d2 = side(x + 0.5, y + 0.5, bx, by, cx, cy);
        const d3 = side(x + 0.5, y + 0.5, cx, cy, ax, ay);
        if (!((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))) this.set(x, y, c);
      }
    }
  }
  /** An arc round (cx, cy) of radius r from angle a0 to a1, `t` thick, ending in an arrowhead. */
  arrowArc(cx: number, cy: number, r: number, a0: number, a1: number, c: string, head: string) {
    const n = 60;
    for (let i = 0; i <= n; i++) {
      const a = a0 + ((a1 - a0) * i) / n;
      this.rect(cx + Math.cos(a) * r - 0.5, cy + Math.sin(a) * r - 0.5, 2, 2, c);
    }
    // The head: along the way round, at the end.
    const ex = cx + Math.cos(a1) * r + 0.5;
    const ey = cy + Math.sin(a1) * r + 0.5;
    const dir = a1 > a0 ? 1 : -1;
    const tx = -Math.sin(a1) * dir;
    const ty = Math.cos(a1) * dir;
    const nx = Math.cos(a1);
    const ny = Math.sin(a1);
    this.tri(ex + tx * 3.2, ey + ty * 3.2, ex + nx * 3 - tx * 0.6, ey + ny * 3 - ty * 0.6, ex - nx * 3 - tx * 0.6, ey - ny * 3 - ty * 0.6, head);
  }
  /** Each pixel in `pts` ("x,y …"). */
  dots(c: string, ...pts: [number, number][]) {
    for (const [x, y] of pts) this.set(x, y, c);
  }
  /** The bold dark outline round everything (where it touches nothing). */
  outline() {
    const filled = (x: number, y: number) => x >= 0 && y >= 0 && x < this.w && y < this.h && this.px[y][x] !== "." && this.px[y][x] !== "o";
    const add: [number, number][] = [];
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (this.px[y][x] !== ".") continue;
        if (filled(x - 1, y) || filled(x + 1, y) || filled(x, y - 1) || filled(x, y + 1)) add.push([x, y]);
      }
    }
    for (const [x, y] of add) this.px[y][x] = "o";
  }
  rows(): string[] {
    return this.px.map((r) => r.join(""));
  }
}

/** An icon drawn by `paint` (then outlined), in `colors` (plus the outline, `o`). */
function draw(name: string, colors: Record<string, string>, paint: (g: Grid) => void, w = S, h = S): Icon {
  const g = new Grid(w, h);
  paint(g);
  g.outline();
  return { name, rows: g.rows(), colors: { o: O, ...colors } };
}

// ---- food ----

const BONE = draw("bone", { w: "#fffaf0", s: "#d9ccb4" }, (g) => {
  g.line(4, 11, 11, 4, "w", 2);
  for (const [x, y] of [[3, 10], [5, 12], [10, 3], [12, 5]]) g.ell(x + 0.5, y + 0.5, 1.8, 1.8, "w");
  g.dots("s", [4, 12], [6, 13], [11, 6], [13, 6], [7, 9], [9, 7]);
});

const MEAT = draw("meat", { r: "#c0502f", R: "#8f3a24", h: "#e88a5e", w: "#fffaf0" }, (g) => {
  g.line(3, 13, 7, 9, "w", 2);
  g.ell(2.5, 12.5, 1.5, 1.5, "w");
  g.ell(4, 14, 1.4, 1.2, "w");
  g.ell(10, 6.5, 5, 4.8, "r");
  g.ell(11, 8, 3.4, 3, "R", (x, y) => y > 7 && x > 8);
  g.dots("h", [8, 4], [9, 3], [10, 3], [7, 5]);
});

const STEW = draw("stew", { b: "#b8693a", B: "#8a4a26", s: "#e0962c", c: "#f2c94c", g: "#5aa04a", w: "#ffffff" }, (g) => {
  g.ell(8, 9, 6.5, 2, "s");
  g.ell(8, 10, 6.5, 4.5, "b", (_x, y) => y >= 9);
  g.rect(3, 13, 10, 1, "B");
  g.dots("c", [5, 8], [10, 9], [8, 8]);
  g.dots("g", [6, 9], [11, 8]);
  g.dots("w", [6, 4], [6, 3], [7, 2], [9, 4], [10, 3], [9, 2]);
});

const BACON = draw("bacon", { r: "#d2483e", R: "#9a2e2a", w: "#ffd9cc" }, (g) => {
  for (let x = 1; x < 15; x++) {
    const y = 4 + Math.round(Math.sin(x / 1.6) * 1.2);
    g.rect(x, y, 1, 3, "r");
    g.set(x, y + 1, "w");
    g.rect(x, y + 6, 1, 3, "R");
    g.set(x, y + 7, "w");
  }
});

const KIBBLE = draw("kibble", { b: "#4a82e0", B: "#2e55a8", h: "#8fb8f0", k: "#b07038", K: "#7a4a22" }, (g) => {
  g.ell(8, 7.5, 6.5, 1.8, "k");
  g.dots("K", [5, 7], [8, 6], [10, 8], [7, 8], [11, 6]);
  g.ell(8, 9, 6.5, 4.5, "b", (_x, y) => y >= 9);
  g.rect(3, 9, 2, 1, "h");
  g.rect(4, 13, 8, 1, "B");
});

const FISH = draw("fish", { b: "#5aa6e0", B: "#2f6fa8", w: "#ffffff", f: "#ffd24a" }, (g) => {
  g.ell(6.5, 8, 5, 3.6, "b");
  g.ell(6.5, 9.5, 4.6, 1.6, "B", (_x, y) => y >= 10);
  g.tri(10.5, 8, 14.5, 4, 14.5, 12, "b");
  g.dots("w", [3, 6]);
  g.dots("o", [3, 7]);
  g.dots("f", [7, 4], [8, 4], [9, 5]);
});

const SUSHI = draw("sushi", { r: "#fffaf0", R: "#ddd3c0", s: "#f2804a", S: "#ffc29a", n: "#2a3a2a" }, (g) => {
  g.ell(8, 10.5, 6, 3.5, "r");
  g.rect(3, 11, 10, 2, "R");
  g.ell(8, 7.5, 6.5, 2.6, "s");
  g.dots("S", [4, 7], [7, 7], [10, 7], [5, 8], [8, 8], [11, 8]);
  g.rect(7, 6, 2, 7, "n");
});

const WHEAT = draw("wheat", { y: "#f2c53a", Y: "#c18f1e", g: "#8a9a3a" }, (g) => {
  g.line(8, 15, 8, 6, "g");
  for (let i = 0; i < 4; i++) {
    g.ell(6.5, 3.5 + i * 2.2, 1.4, 1.1, "y");
    g.ell(9.5, 3.5 + i * 2.2, 1.4, 1.1, "y");
  }
  g.ell(8, 2, 1, 1.3, "Y");
  g.dots("Y", [6, 5], [9, 7], [6, 9]);
});

const SALAD = draw("salad", { b: "#e8e0d0", B: "#b8ae9a", g: "#5fbf45", G: "#3a8a2e", t: "#e04a4a" }, (g) => {
  g.ell(5, 7, 2.6, 2.4, "g");
  g.ell(9, 6, 2.8, 2.6, "G");
  g.ell(11.5, 8, 2.2, 2, "g");
  g.ell(7.5, 8, 1.4, 1.3, "t");
  g.ell(8, 9, 6.5, 4.8, "b", (_x, y) => y >= 9);
  g.rect(4, 13, 8, 1, "B");
});

const CARROT = draw("carrot", { c: "#f2892e", C: "#c0601a", g: "#4fae4f", G: "#2f7f3a" }, (g) => {
  for (let i = 0; i <= 8; i++) {
    const t = 3.2 - i * 0.33;
    g.ell(9 - i * 0.85, 7 + i * 0.85, t, t, "c");
  }
  g.dots("C", [8, 9], [6, 11], [9, 6], [7, 12], [5, 13]);
  g.line(10, 5, 12, 1, "g", 1);
  g.line(10, 5, 14, 3, "G", 1);
  g.line(10, 5, 13, 5, "g", 1);
});

const SUNFLOWER = draw("sunflower", { y: "#f6c933", Y: "#d99a1e", b: "#6b4428", B: "#3e2716" }, (g) => {
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    g.ell(8 + Math.cos(a) * 4.5, 8 + Math.sin(a) * 4.5, 2, 2, i % 2 ? "Y" : "y");
  }
  g.ell(8, 8, 3.4, 3.4, "b");
  g.dots("B", [7, 7], [9, 8], [8, 9], [7, 9], [9, 6]);
});

const HERB = draw("herb", { g: "#5fbf45", G: "#2f7f3a" }, (g) => {
  g.line(4, 14, 11, 3, "G");
  for (const [x, y, s] of [[6, 10, 1], [9, 6, 1], [5, 7, -1], [8, 3, -1], [11, 9, 1]] as [number, number, number][]) g.ell(x + 0.5, y + 0.5, 2.2, 1.3, s > 0 ? "g" : "G");
});

const PEAS = draw("peas", { g: "#6fc24a", G: "#3a8a2e", p: "#a8f08a" }, (g) => {
  g.ell(8, 8, 7, 3.6, "G");
  g.ell(8, 7.5, 6, 2.4, "g");
  for (const x of [4, 7, 10]) g.ell(x + 1, 7.5, 1.4, 1.4, "p");
  g.line(14, 8, 15, 5, "G");
});

const WORM = draw("worm", { g: "#8ed04a", G: "#5a9a2a", w: "#ffffff" }, (g) => {
  for (let i = 0; i < 5; i++) g.ell(3 + i * 2.4, 9 - Math.sin(i * 1.3) * 2, 2, 2, i % 2 ? "G" : "g");
  g.ell(13.5, 5.5, 2.2, 2.2, "g");
  g.dots("w", [13, 4]);
  g.dots("o", [14, 4]);
});

const STRAWBERRY = draw("strawberry", { r: "#e8364a", R: "#a8202f", y: "#ffe066", g: "#4fae4f" }, (g) => {
  g.heart(8, 6.5, 5.5, "r");
  g.ell(8, 4, 4, 1.5, "g");
  g.dots("g", [8, 2], [8, 1]);
  g.dots("y", [6, 7], [10, 7], [8, 9], [5, 10], [11, 10], [8, 12]);
  g.dots("R", [7, 13], [9, 12], [12, 8]);
});

const BREAD = draw("bread", { b: "#c98a3e", B: "#9a5f22", c: "#f7e3b5" }, (g) => {
  g.ell(8, 8, 6.5, 4.5, "b");
  g.rect(2, 8, 13, 5, "b");
  g.rect(3, 9, 11, 3, "c");
  g.dots("B", [5, 5], [8, 4], [11, 5]);
});

const APPLE = draw("apple", { r: "#e04a4a", R: "#a8282f", h: "#ff9a9a", s: "#6b4428", g: "#4fae4f" }, (g) => {
  g.ell(6, 9.5, 4.2, 4.6, "r");
  g.ell(10, 9.5, 4.2, 4.6, "r");
  g.ell(10.5, 11, 3, 3, "R", (x, y) => x > 9 && y > 10);
  g.dots("h", [5, 7], [5, 8], [6, 6]);
  g.line(8, 5, 9, 2, "s");
  g.ell(11, 3, 2, 1, "g");
});

// ---- feelings and things ----

const FACE = { y: "#ffd447", Y: "#e8a92a", p: "#f39aab", b: "#5aaef0", w: "#ffffff", r: "#e8566b", R: "#b8304a" };
const face = (g: Grid) => {
  g.ell(8, 8, 6.5, 6.5, "y");
  g.ell(8, 9, 6, 5.5, "Y", (_x, y) => y >= 12);
};

const SAD = draw("sad", FACE, (g) => {
  face(g);
  g.dots("o", [5, 6], [10, 6], [5, 7], [10, 7], [6, 11], [7, 10], [8, 10], [9, 11]);
  g.dots("b", [4, 8], [4, 9], [3, 10]);
});
const SMILE = draw("smile", FACE, (g) => {
  face(g);
  g.dots("o", [5, 6], [10, 6], [5, 7], [10, 7], [5, 10], [6, 11], [7, 11], [8, 11], [9, 11], [10, 10]);
});
const BLUSH = draw("blush", FACE, (g) => {
  face(g);
  g.dots("o", [4, 7], [5, 6], [6, 7], [9, 7], [10, 6], [11, 7], [5, 10], [6, 11], [7, 11], [8, 11], [9, 11], [10, 10]);
  g.dots("p", [3, 9], [4, 9], [11, 9], [12, 9]);
});
const LOVE = draw("love", FACE, (g) => {
  g.ell(8, 9, 6, 6, "y");
  g.ell(8, 10, 5.5, 5, "Y", (_x, y) => y >= 13);
  g.dots("o", [5, 8], [6, 7], [7, 8], [9, 8], [10, 7], [11, 8], [6, 12], [7, 13], [8, 13], [9, 13], [10, 12]);
  g.dots("p", [4, 10], [12, 10]);
  g.heart(3, 3, 1.6, "r");
  g.heart(13, 4, 1.4, "r");
});
const PLEAD = draw("plead", FACE, (g) => {
  face(g);
  for (const x of [5, 10]) {
    g.ell(x + 0.5, 7, 1.8, 2, "o");
    g.dots("w", [x, 6], [x + 1, 8]);
  }
  g.dots("o", [7, 11], [8, 11]);
  g.dots("b", [4, 10], [12, 10]);
});

const HEART = (name: string, c: string, hi: string) =>
  draw(name, { r: c, h: hi }, (g) => {
    g.heart(8, 6.5, 6, "r");
    g.dots("h", [4, 5], [4, 6], [5, 4]);
  });
const RED_HEART = HEART("heart-red", "#e8364a", "#ff9aa8");
const YELLOW_HEART = HEART("heart-yellow", "#f6c933", "#fff3a0");
const TWO_HEARTS = draw("hearts", { r: "#f27aac", R: "#e8364a", h: "#ffffff" }, (g) => {
  g.heart(10, 4.5, 4, "r");
  g.heart(5.5, 9, 4.2, "R");
  g.dots("h", [3, 8], [9, 3]);
});

const HOUSE = (name: string, garden: boolean) =>
  draw(name, { r: "#d2483e", R: "#9a2e2a", w: "#f6ead2", W: "#d9c8a6", d: "#8a5a32", b: "#8fd0ff", g: "#5fbf45", G: "#3a8a2e" }, (g) => {
    for (let y = 1; y <= 6; y++) g.rect(8 - y - 1, y, (y + 1) * 2, 1, y < 3 ? "R" : "r");
    g.rect(3, 7, 10, 7, "w");
    g.rect(3, 12, 10, 2, "W");
    g.rect(7, 9, 3, 5, "d");
    g.rect(4, 8, 2, 2, "b");
    if (garden) {
      g.ell(13.5, 12, 2.2, 2.2, "g");
      g.ell(1.8, 12.5, 1.6, 1.8, "G");
    }
  });

const BRUSH = draw("brush", { n: "#c98a5a", N: "#8a5a32", w: "#fff3e0", p: "#f27aac" }, (g) => {
  g.line(2, 14, 7, 9, "n", 2);
  g.ell(10, 6, 4.5, 3.2, "N");
  for (let i = 0; i < 6; i++) g.line(7 + i * 1.2, 3 + i * 0.4, 9 + i * 1.2, 1 + i * 0.4, "w");
  g.dots("p", [10, 6], [11, 7]);
});

const BATH = draw("bath", { w: "#ffffff", W: "#d9e2ec", b: "#8fd0ff", B: "#4a9ad6", f: "#c9a24a" }, (g) => {
  g.ell(5, 5, 2, 2, "b");
  g.ell(9, 3.5, 1.6, 1.6, "b");
  g.ell(12, 5.5, 2, 2, "b");
  g.rect(1, 8, 14, 1, "B");
  g.ell(8, 9, 7, 4.5, "w", (_x, y) => y >= 9);
  g.rect(2, 12, 12, 1, "W");
  g.dots("f", [4, 14], [11, 14]);
  g.dots("w", [4, 4], [8, 3], [11, 5]);
});

const BUBBLES = draw("bubbles", { b: "#bfe6ff", B: "#6ab8f0", w: "#ffffff" }, (g) => {
  g.ell(6, 9.5, 4, 4, "b");
  g.ell(12, 5, 2.6, 2.6, "b");
  g.ell(11.5, 12.5, 1.8, 1.8, "b");
  g.dots("w", [4, 7], [5, 7], [4, 8], [11, 4], [11, 12]);
  g.dots("B", [8, 12], [7, 13], [13, 6]);
});

const SPARKLES = draw("sparkles", { y: "#ffe066", Y: "#f2a91e", w: "#ffffff" }, (g) => {
  const star = (cx: number, cy: number, r: number, c: string) => {
    g.line(cx, cy - r, cx, cy + r, c);
    g.line(cx - r, cy, cx + r, cy, c);
    g.rect(cx - 1, cy - 1, 3, 3, c);
  };
  star(6, 9, 5, "y");
  star(12, 4, 2, "Y");
  star(13, 12, 1, "y");
  g.dots("w", [6, 9]);
});

const LOCK = draw("lock", { y: "#f2c53a", Y: "#c18f1e", s: "#b7bcc4", S: "#7d838e" }, (g) => {
  g.ell(8, 6, 4, 4.5, "s", (x, y) => y < 8 && !(Math.abs(x + 0.5 - 8) < 2.2 && y > 2));
  g.rect(3, 7, 10, 8, "y");
  g.rect(3, 13, 10, 2, "Y");
  g.rect(7, 9, 2, 2, "o");
  g.rect(7.5, 11, 1, 2, "o");
});

const DIE = draw("die", { w: "#ffffff", W: "#d9d2c4", r: "#e04a4a" }, (g) => {
  g.rect(2, 2, 12, 12, "w");
  g.rect(2, 12, 12, 2, "W");
  g.rect(12, 2, 2, 12, "W");
  g.dots("r", [4, 4], [5, 4], [4, 5], [5, 5], [7, 7], [8, 7], [7, 8], [8, 8], [10, 10], [11, 10], [10, 11], [11, 11]);
});

const SCISSORS = draw("scissors", { s: "#d0d6de", S: "#8a929c", r: "#e04a4a" }, (g) => {
  g.line(3, 2, 10, 10, "s", 2);
  g.line(13, 2, 6, 10, "S", 2);
  g.ell(4.5, 12.5, 2.4, 2.4, "r");
  g.ell(11.5, 12.5, 2.4, 2.4, "r");
  g.ell(4.5, 12.5, 1, 1, ".");
  g.ell(11.5, 12.5, 1, 1, ".");
});

const PLAY = draw("play", { w: "#ffffff" }, (g) => {
  for (let y = 3; y <= 12; y++) g.rect(4, y, Math.round(8 - Math.abs(y - 7.5) * 1.5), 1, "w");
});

// ---- games ----

const FRISBEE = draw("frisbee", { r: "#e8364a", R: "#a8202f", h: "#ff9aa8" }, (g) => {
  g.ell(8, 8, 7, 4, "r");
  g.ell(8, 9.5, 7, 2.6, "R", (_x, y) => y >= 10);
  g.ell(8, 7, 4, 1.4, "h");
});

const LASER = draw("laser", { r: "#ff2a2a", R: "#ff8080", w: "#ffffff" }, (g) => {
  g.ell(8, 8, 5, 5, "R");
  g.ell(8, 8, 3, 3, "r");
  g.dots("w", [7, 7]);
  g.dots("R", [8, 1], [8, 14], [1, 8], [14, 8]);
});

// ---- tricks ----

const CHAIR = draw("chair", { n: "#c98a5a", N: "#8a5a32" }, (g) => {
  g.rect(9, 2, 2, 12, "N");
  g.rect(3, 8, 8, 2, "n");
  g.rect(3, 10, 2, 4, "n");
  g.rect(9, 4, 2, 1, "n");
});

const SWIRL = draw("swirl", { b: "#5a8af0", B: "#2e55a8" }, (g) => {
  for (let i = 0; i < 70; i++) {
    const a = i / 7;
    const r = 0.4 + i * 0.085;
    g.set(8 + Math.cos(a) * r, 8 + Math.sin(a) * r, i % 9 < 5 ? "b" : "B");
    g.set(8.4 + Math.cos(a) * r, 8 + Math.sin(a) * r, "b");
  }
});

const ROLL = draw("roll", { g: "#4fae4f", G: "#2f7f3a" }, (g) => {
  // Round and round: an arc most of the way, with its arrowhead.
  g.arrowArc(7.5, 8.5, 5, 0.5, 0.5 + Math.PI * 1.5, "g", "G");
});

const HAND = draw("hand", { s: "#f5d0b0", S: "#d9a47a" }, (g) => {
  for (const [x, top] of [[3, 4], [6, 2], [9, 2], [12, 4]]) g.rect(x, top, 2, 8, "s");
  g.ell(8.5, 11.5, 5, 3.5, "s");
  g.line(2, 11, 0.5, 8.5, "s", 2);
  g.dots("S", [6, 12], [8, 13], [10, 12], [11, 13]);
});

const DIZZY = draw("dizzy", { y: "#ffe066", Y: "#f2a91e" }, (g) => {
  const star = (cx: number, cy: number) => {
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (i / 5) * Math.PI * 2;
      g.line(cx, cy, cx + Math.cos(a) * 4, cy + Math.sin(a) * 4, "y", 2);
    }
    g.ell(cx + 0.5, cy + 0.5, 2.2, 2.2, "y");
  };
  star(10, 6);
  for (let i = 0; i < 12; i++) g.set(2 + i * 0.6, 13 - Math.sin(i / 3) * 2.5, "Y");
});

const NOTES = draw("notes", { b: "#9a62d6", B: "#6a3ea4" }, (g) => {
  g.ell(4.5, 12.5, 2.2, 1.8, "b");
  g.ell(11.5, 10.5, 2.2, 1.8, "b");
  g.rect(6, 3, 1, 10, "B");
  g.rect(13, 1, 1, 10, "B");
  g.line(6, 3, 13, 1, "B", 2);
  g.line(6, 5, 13, 3, "B", 1);
});

const FLIP = draw("flip", { r: "#f2892e", R: "#c0601a" }, (g) => {
  // Up, over and back down: a looping arrow.
  g.arrowArc(9, 7.5, 4.5, Math.PI * 0.75, Math.PI * 2.2, "r", "R");
  // (Taking off from the ground.)
  g.line(1, 14, 5.6, 10.6, "r", 2);
});

const DASH = draw("dash", { w: "#ffffff", W: "#c9d6e3" }, (g) => {
  g.ell(10.5, 8, 4, 3.2, "w");
  g.ell(7, 9, 2.6, 2.2, "w");
  g.dots("W", [9, 10], [12, 10]);
  g.rect(1, 6, 4, 1, "W");
  g.rect(0, 9, 3, 1, "W");
  g.rect(2, 12, 4, 1, "W");
});

const TOP_HAT = draw("tophat", { k: "#2e2c35", K: "#4a4855", r: "#e04a4a" }, (g) => {
  g.rect(4, 2, 8, 9, "k");
  g.rect(5, 2, 1, 8, "K");
  g.rect(4, 8, 8, 2, "r");
  g.rect(1, 11, 14, 2, "k");
});

const PARTY = draw("party", { y: "#f2c53a", Y: "#c18f1e", r: "#e04a4a", b: "#4a82e0", g: "#4fae4f", p: "#f27aac" }, (g) => {
  for (let i = 0; i < 8; i++) g.rect(2 + i * 0.6, 14 - i * 1.4, 2 + i * 0.6, 1.4, i % 2 ? "y" : "Y");
  g.dots("r", [9, 2], [12, 6], [8, 5]);
  g.dots("b", [11, 3], [14, 8]);
  g.dots("g", [13, 4], [10, 8]);
  g.dots("p", [14, 2], [11, 10]);
});

const CROWN = draw("crown", { y: "#f6c933", Y: "#c18f1e", r: "#e8364a", b: "#4a82e0" }, (g) => {
  g.rect(2, 7, 12, 6, "y");
  for (const x of [2, 7, 12]) g.rect(x, 3, 2, 5, "y");
  g.rect(2, 11, 12, 2, "Y");
  g.dots("r", [7, 9], [8, 9]);
  g.dots("b", [4, 9], [11, 9]);
});

const ZZZ = draw("zzz", { b: "#5a8af0", B: "#8fb8f0" }, (g) => {
  const z = (x: number, y: number, s: number, c: string) => {
    g.rect(x, y, s, 1, c);
    g.line(x + s - 1, y, x, y + s - 1, c);
    g.rect(x, y + s - 1, s, 1, c);
  };
  z(1, 8, 6, "b");
  z(8, 4, 4, "B");
  z(12, 1, 3, "B");
});

// ---- animals ----

const DOG = draw("dog", { b: "#c98a4a", B: "#8a5a2e", w: "#f6e2c2", n: "#2a2433", p: "#f27aac" }, (g) => {
  g.ell(8, 8.5, 5, 5, "b");
  g.ell(2.8, 8, 2, 4, "B");
  g.ell(13.2, 8, 2, 4, "B");
  g.ell(8, 11, 3, 2.4, "w");
  g.dots("o", [6, 7], [10, 7]);
  g.dots("n", [7, 10], [8, 10]);
  g.dots("p", [8, 13]);
});

const CAT = draw("cat", { b: "#f2892e", B: "#c0601a", w: "#fff3e0", p: "#f27aac", g: "#4fae4f" }, (g) => {
  for (let i = 0; i < 4; i++) {
    g.rect(3, 2 + i, 1 + i, 1, "b");
    g.rect(13 - i, 2 + i, 1 + i, 1, "b");
  }
  g.ell(8, 9, 5.5, 4.8, "b");
  g.dots("B", [6, 6], [8, 5], [10, 6]);
  g.ell(8, 11, 2.4, 1.6, "w");
  g.dots("g", [5, 8], [10, 8]);
  g.dots("o", [6, 8], [11, 8]);
  g.dots("p", [8, 10]);
});

const BUNNY = draw("bunny", { w: "#f8f5ee", W: "#d9d0c2", p: "#f2a2ae" }, (g) => {
  g.ell(5.5, 4.5, 1.6, 4, "w");
  g.ell(10.5, 4.5, 1.6, 4, "w");
  g.rect(5, 2, 1, 5, "p");
  g.rect(10, 2, 1, 5, "p");
  g.ell(8, 10.5, 5, 4.2, "w");
  g.ell(8, 12, 4, 2.4, "W", (_x, y) => y >= 13);
  g.dots("o", [6, 9], [10, 9]);
  g.dots("p", [8, 11]);
});

const DUCK = draw("duck", { y: "#f6d64a", Y: "#d9b02a", b: "#f39a2b" }, (g) => {
  g.ell(7, 7.5, 5, 5, "y");
  g.ell(7, 9.5, 4.6, 3, "Y", (_x, y) => y >= 11);
  g.ell(12.5, 9, 3, 1.6, "b");
  g.dots("o", [8, 6]);
});

const HEDGEHOG = draw("hedgehog", { s: "#8a6a4a", S: "#5a4030", f: "#f2dfc4", n: "#2a2433" }, (g) => {
  g.ell(7, 9, 6, 5, "s");
  for (let x = 2; x <= 11; x += 2) g.set(x, 3 + Math.abs(x - 6.5) * 0.4, "S");
  g.dots("S", [3, 7], [5, 6], [7, 7], [4, 10], [6, 9], [8, 10]);
  g.ell(11.5, 10.5, 3.4, 2.8, "f");
  g.dots("n", [14, 10], [11, 9]);
});

/** Each emoji, and the picture drawn in its place. */
// The skill tree.
const ROD = draw("rod", { r: "#8a5a2c", R: "#c98a4a", l: "#e8eef4", b: "#e8465a", w: "#ffffff", h: "#9aa3ad" }, (g) => {
  g.line(2, 14, 12, 2, "r", 2);
  g.line(3, 13, 12, 2, "R");
  g.rect(2, 11, 3, 3, "r");
  g.line(13, 2, 13, 10, "l");
  g.ell(13, 11.5, 1.8, 1.8, "b");
  g.dots("w", [12, 11]);
  g.dots("h", [13, 14], [14, 13]);
});

const MAGNET = draw("magnet", { r: "#e04848", R: "#a82a2a", s: "#d9e2ec", S: "#9aa3ad", y: "#ffe066" }, (g) => {
  g.ell(8, 7, 6, 6, "r", (_x, y) => y < 8);
  g.ell(8, 7, 2.6, 2.6, ".", (_x, y) => y < 8);
  g.rect(2, 7, 4, 5, "r");
  g.rect(10, 7, 4, 5, "r");
  g.rect(5, 1, 6, 1, "R");
  g.rect(2, 11, 4, 3, "s");
  g.rect(10, 11, 4, 3, "s");
  g.rect(2, 13, 4, 1, "S");
  g.rect(10, 13, 4, 1, "S");
  g.dots("y", [1, 15], [15, 15], [8, 14]);
});

const CRATE = draw("crate", { w: "#d9a05a", W: "#a86e32", d: "#7a4a1e", y: "#ffe066", Y: "#f2a91e" }, (g) => {
  g.rect(2, 5, 12, 10, "w");
  g.rect(2, 5, 12, 2, "W");
  g.line(3, 8, 13, 14, "W");
  g.line(13, 8, 3, 14, "W");
  g.rect(2, 10, 12, 1, "d");
  g.rect(7, 2, 2, 3, "y");
  g.dots("Y", [6, 3], [9, 3], [4, 1], [12, 1]);
  g.dots("y", [3, 2], [13, 3]);
});

const SHOVEL = draw("shovel", { h: "#8a5a2c", H: "#c98a4a", s: "#c9d2dc", S: "#8a94a0", c: "#ffd23f", C: "#e0a020" }, (g) => {
  g.line(3, 2, 9, 8, "h", 2);
  g.rect(1, 1, 4, 2, "H");
  g.tri(8, 8, 14, 9, 9, 14, "s");
  g.line(10, 13, 13, 10, "S");
  g.ell(4.5, 12.5, 2.6, 2.6, "c");
  g.ell(4.5, 12.5, 1.2, 1.2, "C");
});

const FRIENDS = draw("friends", { a: "#4fb3e8", A: "#2a7ab0", b: "#f27aac", B: "#c04a80", s: "#f2c49a" }, (g) => {
  g.ell(5, 5, 2.6, 2.6, "s");
  g.ell(11, 5, 2.6, 2.6, "s");
  g.ell(5, 13, 4, 4, "a", (_x, y) => y < 15);
  g.ell(11, 13, 4, 4, "b", (_x, y) => y < 15);
  g.rect(1, 14, 8, 1, "A");
  g.rect(8, 14, 7, 1, "B");
  g.dots("s", [8, 10], [8, 11]);
});

const STAR = draw("star", { y: "#ffe066", Y: "#f2a91e", w: "#ffffff" }, (g) => {
  g.tri(8, 0.5, 5, 7, 11, 7, "y");
  g.tri(0.5, 6, 15.5, 6, 8, 11, "y");
  g.tri(8, 9, 2.5, 15.5, 6, 7, "y");
  g.tri(8, 9, 13.5, 15.5, 10, 7, "y");
  g.dots("Y", [5, 13], [11, 13], [8, 10]);
  g.dots("w", [7, 4], [6, 7]);
});

// (Not a pet's, but drawn the same way: the mini golf's flag in its hole, for its corner button.)
const GOLF = draw("golf", { g: "#5fc36a", G: "#3a9a4a", h: "#1e2a22", p: "#e9e2cf", f: "#e8465a", F: "#b02a3a", w: "#ffffff" }, (g) => {
  g.ell(8, 13, 7, 2.6, "g");
  g.ell(8, 13.6, 6, 1.6, "G", (_x, y) => y >= 14);
  g.ell(9.5, 12.6, 1.8, 1, "h");
  g.rect(9, 1, 1, 12, "p");
  g.tri(10, 1, 15, 3.5, 10, 6, "f");
  g.rect(10, 5, 2, 1, "F");
  g.dots("w", [4, 12], [5, 12]);
});

export const PET_ICONS: [string, Icon][] = [
  ["⛳", GOLF],
  ["🎣", ROD],
  ["🧲", MAGNET],
  ["📦", CRATE],
  ["⛏", SHOVEL],
  ["👥", FRIENDS],
  ["⭐", STAR],
  ["\u{1F43E}", draw("paw", { p: "#f27aac", P: "#ffc0d6" }, (g) => {
    g.ell(8, 12, 3.6, 2.8, "p");
    for (const [x, y] of [[2.6, 7.2], [5.8, 3.6], [10.2, 3.6], [13.4, 7.2]]) g.ell(x, y, 1.4, 1.7, "p");
    g.dots("P", [6, 11], [7, 10], [5, 3], [9, 3]);
  })],
  ["\u{1F9B4}", BONE],
  ["\u{1F356}", MEAT],
  ["\u{1F372}", STEW],
  ["\u{1F953}", BACON],
  ["\u{1F963}", KIBBLE],
  ["\u{1F41F}", FISH],
  ["\u{1F363}", SUSHI],
  ["\u{1F33E}", WHEAT],
  ["\u{1F957}", SALAD],
  ["\u{1F955}", CARROT],
  ["\u{1F33B}", SUNFLOWER],
  ["\u{1F33F}", HERB],
  ["\u{1FADB}", PEAS],
  ["\u{1F41B}", WORM],
  ["\u{1F353}", STRAWBERRY],
  ["\u{1F35E}", BREAD],
  ["\u{1F34E}", APPLE],
  ["\u{1F622}", SAD],
  ["\u{1F642}", SMILE],
  ["\u{1F60A}", BLUSH],
  ["\u{1F970}", LOVE],
  ["\u{1F97A}", PLEAD],
  ["♥", RED_HEART],
  ["❤", RED_HEART],
  ["\u{1F49B}", YELLOW_HEART],
  ["\u{1F495}", TWO_HEARTS],
  ["\u{1F3E0}", HOUSE("house", false)],
  ["\u{1F3E1}", HOUSE("house-garden", true)],
  ["\u{1FAAE}", BRUSH],
  ["\u{1F6C1}", BATH],
  ["\u{1FAE7}", BUBBLES],
  ["✨", SPARKLES],
  ["\u{1F512}", LOCK],
  ["\u{1F3B2}", DIE],
  ["✂", SCISSORS],
  ["▶", PLAY],
  ["\u{1F94F}", FRISBEE],
  ["\u{1F534}", LASER],
  ["\u{1FA91}", CHAIR],
  ["\u{1F300}", SWIRL],
  ["\u{1F504}", ROLL],
  ["✋", HAND],
  ["\u{1F4AB}", DIZZY],
  ["\u{1F483}", NOTES],
  ["\u{1F938}", FLIP],
  ["\u{1F4A8}", DASH],
  ["\u{1F3A9}", TOP_HAT],
  ["\u{1F389}", PARTY],
  ["\u{1F451}", CROWN],
  ["\u{1F4A4}", ZZZ],
  ["\u{1F436}", DOG],
  ["\u{1F431}", CAT],
  ["\u{1F430}", BUNNY],
  ["\u{1F986}", DUCK],
  ["\u{1F994}", HEDGEHOG],
];
