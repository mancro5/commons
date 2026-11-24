// The corner dock: the buttons for whatever's about you (the skatepark's
// Skate! and its missions, the mini golf, the arena, the Splat Yard, getting
// off your board), up in the top-right corner one under another, never one
// on top of another, however many show at once.

import { el } from "./panels";

let dock: HTMLElement | null = null;

/**
 * Puts `btn` in the corner dock (made on first use), at place `order` (the
 * lower, the higher up: what's here to play first, then missions, then
 * getting off). Shown and hidden as before, by its own `hidden`.
 */
export function inCorner<T extends HTMLElement>(btn: T, order: number): T {
  if (!dock || !dock.isConnected) {
    dock = el("div", "corner-dock");
    document.body.append(dock);
    // (Where it ends, for what else comes down that corner, the notices, to start below it.)
    const d = dock;
    const mark = () => {
      const r = d.getBoundingClientRect();
      document.documentElement.style.setProperty("--corner-dock-bottom", `${r.height > 0 ? Math.round(r.bottom) : 0}px`);
    };
    if (typeof ResizeObserver !== "undefined") new ResizeObserver(mark).observe(d);
    mark();
  }
  btn.style.order = String(order);
  btn.classList.add("corner-btn");
  dock.append(btn);
  return btn;
}

/** Places in the dock, top to bottom. */
export const CORNER = { PLAY: 10, MISSIONS: 20, OFF: 30 } as const;
