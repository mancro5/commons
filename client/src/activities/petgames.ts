// Your pet's minigames: one for each kind of pet, starring your own pet
// (its sprite, coat, hat and all). A game cheers your pet up (more for a
// better score) and the day's first few pay a few coins (server: pets.rs
// `play`).
//
//   Dog: Frisbee Fetch: time the throw, then the leap: catch it in the air.
//   Cat: Laser Chase: lead the cat onto the toy mice, round the vases.
//   Bunny: Carrot Hop: hop the fences, grab the carrots (hold to hop higher).
//   Duck: Bread Splash: paddle under the bread, dodge the pine cones.
//   Hedgehog: Apple Roll: roll downhill picking up apples on your spines.

import type { Pet, PetGame, Pets } from "../pets";
import { Panel, button, el, isTyping } from "../ui/panels";
import { GAMES, H, type Input, type MiniGame, SCALE, W, cloud, makeGame, pet, rect, sfx, text } from "./petgamesim";
import { at, tone } from "../ambient/sfx";
import { DOG, speciesOfCode } from "../world/petlook";

export { GAMES };

function bestOf(game: string): number {
  try {
    return Number(localStorage.getItem(`commons.petbest.${game}`) ?? 0) || 0;
  } catch {
    return 0;
  }
}
function setBest(game: string, n: number) {
  try {
    localStorage.setItem(`commons.petbest.${game}`, String(n));
  } catch {
    // storage unavailable
  }
}

/** The minigame window: how to play, the game, and how it went. */
export class PetGamePanel extends Panel {
  private canvas = document.createElement("canvas");
  private ctx = this.canvas.getContext("2d")!;
  private game: MiniGame | null = null;
  private stage: "intro" | "count" | "play" | "done" = "intro";
  private countFrom = 0;
  private raf = 0;
  private last = 0;
  private pet: Pet | null = null;
  private inp: Input = { x: W / 2, y: H / 2, down: false, pressed: false, released: false, left: false, right: false, up: false, downKey: false, pointer: false };
  private result = el("div", "petgame-result");
  /** After a game: how your pet took it. */
  onPlayed: (game: PetGame, score: number) => void = () => {};

  constructor(private pets: Pets) {
    super("Play", "petgame");
    this.sticky = true;
    this.canvas.width = W * SCALE;
    this.canvas.height = H * SCALE;
    this.canvas.className = "petgame-canvas";
    this.ctx.imageSmoothingEnabled = false;
    const pos = (e: PointerEvent) => {
      const r = this.canvas.getBoundingClientRect();
      this.inp.x = ((e.clientX - r.left) / r.width) * W;
      this.inp.y = ((e.clientY - r.top) / r.height) * H;
    };
    this.canvas.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      pos(e);
      this.inp.pointer = true;
      this.inp.down = true;
      this.inp.pressed = true;
      this.canvas.setPointerCapture(e.pointerId);
    });
    this.canvas.addEventListener("pointermove", (e) => {
      pos(e);
      this.inp.pointer = true;
    });
    const up = () => {
      if (this.inp.down) this.inp.released = true;
      this.inp.down = false;
    };
    this.canvas.addEventListener("pointerup", up);
    this.canvas.addEventListener("pointercancel", up);
    // First in line (capturing, at the window): while a game's on, its keys
    // are the game's, not the chat's (Enter) or your walk's (the arrows).
    window.addEventListener("keydown", (e) => this.key(e, true), true);
    window.addEventListener("keyup", (e) => this.key(e, false), true);
  }

  private key(e: KeyboardEvent, down: boolean) {
    if (!this.open || (this.stage !== "play" && this.stage !== "count") || isTyping(e)) return;
    if (e.key === "Escape") return;
    const k = e.key;
    let used = true;
    if (k === " " || k === "Enter") {
      if (down && !e.repeat) this.inp.pressed = true;
      if (!down) this.inp.released = true;
      this.inp.down = down;
    } else if (k === "ArrowLeft" || k === "a" || k === "A") this.inp.left = down;
    else if (k === "ArrowRight" || k === "d" || k === "D") this.inp.right = down;
    else if (k === "ArrowUp" || k === "w" || k === "W") {
      this.inp.up = down;
      if (down && !e.repeat) (this.inp.pressed = true), (this.inp.down = true);
      if (!down) (this.inp.released = true), (this.inp.down = false);
    } else if (k === "ArrowDown" || k === "s" || k === "S") this.inp.downKey = down;
    else used = false;
    if (used) {
      this.inp.pointer = false;
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }

  /** Opens your pet's game. */
  openFor(p: Pet) {
    this.pet = p;
    this.game = null;
    this.stage = "intro";
    this.show();
  }

  private info() {
    return GAMES[speciesOfCode(this.pet?.code ?? 1)] ?? GAMES[DOG];
  }

  render() {
    const g = this.info();
    this.titleEl.textContent = `${g.emoji} ${g.name}`;
    this.body.replaceChildren();
    this.body.append(this.canvas);
    if (this.stage === "intro") {
      const best = bestOf(g.key);
      this.body.append(
        el("p", "hint", g.how),
        el("p", "hint", best ? `Best: ${best}` : `${this.pet?.name ?? "Your pet"} can't wait!`),
        button(`Play with ${this.pet?.name ?? "your pet"} ▶`, () => this.start(), "primary"),
      );
    } else if (this.stage === "done") {
      this.body.append(this.result, button("Play again ↻", () => this.start(), "primary"), button("Done", () => this.hide(), "subtle"));
    } else {
      this.body.append(el("p", "hint", g.how));
    }
    this.loop();
  }

  private start() {
    if (!this.pet) return;
    this.game = makeGame(this.pet.code);
    this.stage = "count";
    this.countFrom = performance.now();
    this.inp.pressed = false;
    this.render();
  }

  private loop() {
    cancelAnimationFrame(this.raf);
    this.last = performance.now();
    const frame = (now: number) => {
      if (!this.open) return;
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      this.frame(now, dt);
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }

  private frame(now: number, dt: number) {
    const c = this.ctx;
    c.setTransform(SCALE, 0, 0, SCALE, 0, 0);
    c.imageSmoothingEnabled = false;
    const g = this.game;
    if (this.stage === "intro" || !g) {
      // The pet, waiting eagerly on its grass.
      rect(c, "#bfe6f7", 0, 0, W, H);
      rect(c, "#86c56c", 0, 96, W, H - 96);
      rect(c, "#9ad47e", 0, 96, W, 2);
      cloud(c, 30, 20);
      cloud(c, 150, 34);
      if (this.pet) {
        const hop = Math.max(0, Math.sin(now / 260)) * 6;
        pet(c, this.pet.code, W / 2, 112 - hop, false, hop > 2 ? "jump" : "stand", 0, "happy");
        text(c, this.pet.name, W / 2, 118, "#fff9ec", "center", 9);
      }
      text(c, this.info().name, W / 2, 50, "#fff9ec", "center", 14);
      this.inp.pressed = this.inp.released = false;
      return;
    }
    if (this.stage === "count") {
      const left = 3 - Math.floor((now - this.countFrom) / 700);
      g.draw(c, now);
      if (left > 0) {
        if (left !== (this as unknown as { lastBeep?: number }).lastBeep) {
          (this as unknown as { lastBeep?: number }).lastBeep = left;
          sfx.tick();
        }
        text(c, String(left), W / 2, H / 2 - 14, "#ffe066", "center", 24);
      } else {
        this.stage = "play";
        tone(at(0), 0.25, 0.05, "square", 1046);
      }
      this.inp.pressed = this.inp.released = false;
      return;
    }
    if (this.stage === "play") {
      g.tick(dt, this.inp);
      this.inp.pressed = this.inp.released = false;
      g.draw(c, now);
      if (g.over) void this.finish();
      return;
    }
    g.draw(c, now);
    rect(c, "#3b2f3f", W / 2 - 60, H / 2 - 22, 120, 40);
    rect(c, "#fff3e0", W / 2 - 59, H / 2 - 21, 118, 38);
    text(c, "Score", W / 2, H / 2 - 18, "#a0768a", "center", 7);
    text(c, `${g.score}`, W / 2, H / 2 - 9, "#e8566b", "center", 16);
  }

  private async finish() {
    const g = this.game;
    if (!g || this.stage !== "play") return;
    this.stage = "done";
    sfx.end();
    const info = this.info();
    const best = bestOf(info.key);
    const fresh = g.score > best;
    if (fresh) setBest(info.key, g.score);
    this.result.replaceChildren(el("strong", "", `${g.score} points${fresh && best ? " · a new best! 🏆" : ""}`), el("p", "hint", "…"));
    this.render();
    try {
      const coins = await this.pets.play(info.key, g.score);
      const name = this.pet?.name ?? "Your pet";
      const note = el("p", "hint", `${name} had a wonderful time! 💕${coins ? ` You earned ${coins} coins.` : ""}`);
      this.result.replaceChildren(el("strong", "", `${g.score} points${fresh && best ? " · a new best! 🏆" : ""}`), note);
      this.onPlayed(info.key, g.score);
    } catch (e) {
      this.result.replaceChildren(el("strong", "", `${g.score} points`), el("p", "error", e instanceof Error ? e.message : "That didn't save."));
    }
  }

  hide() {
    super.hide();
    cancelAnimationFrame(this.raf);
    this.inp.left = this.inp.right = this.inp.up = this.inp.downKey = this.inp.down = false;
  }
}
