// Your pet: how it's doing (fed and happy, or not), and looking after it:
// a meal (a few coins; each kind of pet has its own favourites), its
// minigame, a cuddle, a walk. A pet low on food or fun is sad: it droops,
// sheds a tear, and says what it wants in a thought bubble.

import { GAMES } from "../activities/petgames";
import * as psfx from "../ambient/petsfx";
import type { Economy } from "../economy";
import { type Care, FISH_TIER_MOST, MAX_LEVEL, MEAL_PRICES, type Meal, type Pet, type Pets, SKILL_LEVELS, SKILLS, type Skill, type SkillKey, TRICKS, knows, levelOf, levelProgress, levelTitle, pointsLeft, tierOf, xpFor } from "../pets";
import { PET_H, PET_W, type PetFace, type PetPose, petArt } from "../world/petart";
import { BUNNY, CAT, DOG, DUCK, HEDGEHOG, decodeDesign, describe, speciesOfCode } from "../world/petlook";
import { Panel, button, confirmButton, el } from "./panels";

/** What each kind of pet eats: a snack, a meal, a treat. */
const FOODS: Record<number, [string, string, string]> = {
  [DOG]: ["🦴 Kibble", "🍲 Bowl of stew", "🥓 Bacon chew"],
  [CAT]: ["🥣 Crunchies", "🐟 Tuna dinner", "🍣 Salmon treat"],
  [BUNNY]: ["🌾 Pellets", "🥗 Big salad", "🥕 Carrot"],
  [DUCK]: ["🌻 Seeds", "🌿 Pond-weed dinner", "🫛 Peas"],
  [HEDGEHOG]: ["🥣 Kibble", "🐛 Mealworm feast", "🍓 Strawberry"],
};
const MEALS: Meal[] = ["snack", "meal", "treat"];

const px = (c: CanvasRenderingContext2D, color: string, x: number, y: number, w = 1, h = 1) => {
  c.fillStyle = color;
  c.fillRect(x, y, w, h);
};

let outdoorCanvas: HTMLCanvasElement | null = null;
/** Out under the sky: blue sky and a cloud, trees far off, green grass underfoot. At the pet's own scale (PET_W×PET_H). */
function outdoorScene(): HTMLCanvasElement {
  if (outdoorCanvas) return outdoorCanvas;
  const c = document.createElement("canvas");
  c.width = PET_W;
  c.height = PET_H;
  const x = c.getContext("2d")!;
  px(x, "#8fcdf0", 0, 0, PET_W, 6);
  px(x, "#a6d8f3", 0, 6, PET_W, 6);
  px(x, "#bfe3f6", 0, 12, PET_W, 6);
  // A cloud.
  px(x, "#ffffff", 4, 4, 9, 2);
  px(x, "#ffffff", 6, 3, 4, 1);
  px(x, "#e4f1fa", 5, 6, 8, 1);
  px(x, "#ffffff", 28, 8, 6, 1);
  px(x, "#ffffff", 29, 7, 3, 1);
  // Trees far off, and the meadow.
  for (const [tx, r] of [[3, 3], [9, 4], [16, 3], [24, 4], [32, 3], [38, 4]]) {
    for (let dy = -r; dy <= r; dy++) {
      const w = Math.round(Math.sqrt(r * r - dy * dy));
      px(x, "#5f9e58", tx - w, 17 + dy, w * 2 + 1, 1);
    }
  }
  px(x, "#8ccc72", 0, 18, PET_W, 12);
  px(x, "#7cbf62", 0, 22, PET_W, 8);
  px(x, "#6fb257", 0, 26, PET_W, 4);
  // Grass tufts and a few flowers.
  for (const [gx, gy] of [[2, 20], [12, 19], [21, 21], [33, 20], [6, 24], [27, 25], [37, 24]]) {
    px(x, "#4f9a45", gx, gy, 1, 2);
    px(x, "#4f9a45", gx + 2, gy, 1, 2);
    px(x, "#4f9a45", gx + 1, gy - 1, 1, 3);
  }
  for (const [fx, fy, col] of [[8, 21, "#ffffff"], [30, 22, "#ffe066"], [18, 27, "#f27aac"], [35, 27, "#ffffff"]] as [number, number, string][]) {
    px(x, col, fx, fy);
    px(x, "#3a8a2e", fx, fy + 1);
  }
  outdoorCanvas = c;
  return c;
}

let indoorCanvas: HTMLCanvasElement | null = null;
/** At home (or indoors): a warm light-brown wall, a skirting board, a dark wooden floor and a rug to sit on. */
function indoorScene(): HTMLCanvasElement {
  if (indoorCanvas) return indoorCanvas;
  const c = document.createElement("canvas");
  c.width = PET_W;
  c.height = PET_H;
  const x = c.getContext("2d")!;
  // Wallpaper: light brown with soft stripes.
  px(x, "#d9b98f", 0, 0, PET_W, 18);
  for (let sx = 1; sx < PET_W; sx += 4) px(x, "#cfac80", sx, 0, 2, 18);
  // A window with daylight, and a picture.
  px(x, "#8a5a32", 25, 3, 11, 9);
  px(x, "#bfe3f6", 26, 4, 9, 7);
  px(x, "#8a5a32", 30, 4, 1, 7);
  px(x, "#8a5a32", 26, 7, 9, 1);
  px(x, "#e6f4fb", 27, 5, 2, 1);
  px(x, "#8a5a32", 5, 5, 7, 6);
  px(x, "#f2c53a", 6, 6, 5, 4);
  px(x, "#4fae4f", 6, 8, 5, 2);
  px(x, "#e8566b", 9, 7, 1, 1);
  // Skirting board.
  px(x, "#7a4e2c", 0, 17, PET_W, 2);
  px(x, "#9a6a40", 0, 17, PET_W, 1);
  // Floorboards: dark brown, staggered seams.
  px(x, "#6e4428", 0, 19, PET_W, 11);
  for (let row = 0; row < 4; row++) {
    const y = 19 + row * 3;
    px(x, "#5a3720", 0, y + 2, PET_W, 1);
    px(x, "#7d5030", 0, y, PET_W, 1);
    for (let sx = (row % 2) * 6 + 2; sx < PET_W; sx += 12) px(x, "#5a3720", sx, y, 1, 2);
  }
  // A round rug where it sits.
  for (let dy = -2; dy <= 2; dy++) {
    const w = Math.round(13 * Math.sqrt(1 - (dy / 2.6) ** 2));
    px(x, dy === -2 || dy === 2 ? "#6a3ea4" : "#8c6ad0", 20 - w, 27 + dy, w * 2, 1);
  }
  px(x, "#a98be0", 11, 27, 18, 1);
  indoorCanvas = c;
  return c;
}

export interface PetPanelHost {
  /** Out for a walk, or home. */
  walk(out: boolean): void;
  /** Its minigame. */
  play(p: Pet): void;
  /** Hearts on the pet in the world. */
  cheer(n?: number): void;
  /** Acted out in the world (a hug, a brush, a bath, a meal), if it's there to see; whether it was. */
  care(kind: "cuddle" | "brush" | "bath" | "feed"): boolean;
  /** A trick, in the world (everyone nearby sees it, out on a walk). */
  trick(key: string): void;
  toast(text: string, ms?: number): void;
  /** After putting it up for adoption (it leaves your side, if out). */
  rehomed(): void;
  /** Whether you're outdoors just now (a pet out with you is, too). */
  outdoors(): boolean;
  /** It leads the way (`Skill.lead`): to the lucky crate, the nearest player, home. */
  lead(skill: SkillKey): void;
  /** Tells the world what your pet can do now (after learning a skill). */
  refreshLook(): void;
}

export class PetPanel extends Panel {
  private canvas = document.createElement("canvas");
  private raf = 0;
  /** Eating (or delighted) until. */
  private happyUntil = 0;
  private eating = false;
  /** Doing a trick in the portrait (spin and dance turn about). */
  private turning = false;
  private msg = el("p", "error");
  private busy = false;
  private off: () => void;

  constructor(
    private pets: Pets,
    private eco: Economy,
    private host: PetPanelHost,
  ) {
    super("Your pet", "petpanel");
    this.canvas.width = PET_W * 5;
    this.canvas.height = PET_H * 5;
    this.canvas.className = "pet-portrait";
    this.off = pets.onChange(() => this.open && !this.busy && this.render());
    eco.onChange(() => this.open && !this.busy && this.render());
  }

  show() {
    this.msg.textContent = "";
    super.show();
    // It says hello (a little sadly, if it's low).
    const p = this.pets.mine;
    if (p) psfx.voice(speciesOfCode(p.code), this.pets.sad(p) ? "sad" : "happy", 0.8);
    cancelAnimationFrame(this.raf);
    const tick = (t: number) => {
      this.paint(t);
      if (this.open) this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  hide() {
    super.hide();
    cancelAnimationFrame(this.raf);
  }

  private paint(now: number) {
    const p = this.pets.mine;
    const ctx = this.canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (!p) return;
    // Where it is: out with you under the sky, or at home (or indoors with you).
    const outside = p.out && this.host.outdoors();
    ctx.drawImage(outside ? outdoorScene() : indoorScene(), 0, 0, this.canvas.width, this.canvas.height);
    const sad = this.pets.sad(p);
    let pose: PetPose = "stand";
    let face: PetFace = sad ? "sad" : Math.floor(now / 3200) % 9 === 0 && now % 3200 < 140 ? "blink" : "open";
    let lift = 0;
    if (now < this.happyUntil) {
      if (this.eating) {
        pose = "sit";
        face = Math.floor(now / 250) % 2 ? "happy" : "blink";
      } else {
        lift = Math.max(0, Math.sin(now / 110)) * 10;
        pose = lift > 3 ? "jump" : "stand";
        face = "happy";
      }
    } else if (!sad && Math.floor(now / 5000) % 3 === 2) pose = "sit";
    const flip = this.turning && now < this.happyUntil && Math.floor(now / 120) % 2 === 1;
    if (flip) {
      ctx.save();
      ctx.translate(this.canvas.width, 0);
      ctx.scale(-1, 1);
    }
    const wag = !sad && pose !== "jump" ? Math.sin(now / 95) : 0;
    ctx.drawImage(petArt(p.code, pose, 0, face, sad && now >= this.happyUntil, wag), 0, -lift, this.canvas.width, this.canvas.height);
    if (flip) ctx.restore();
  }

  private bar(label: string, v: number, cls: string): HTMLElement {
    const row = el("div", "pet-bar");
    const track = el("div", "track");
    const fill = el("div", `fill ${cls}${v < this.pets.sadBelow ? " low" : ""}`);
    fill.style.width = `${Math.round(v)}%`;
    track.append(fill);
    row.append(el("span", "pet-bar-label", label), track, el("span", "val", `${Math.round(v)}`));
    return row;
  }

  render() {
    this.body.replaceChildren();
    const p = this.pets.mine;
    if (!p) {
      this.titleEl.textContent = "Pets";
      this.body.append(
        el("p", "hint", "You don't have a pet yet. Adopt one at the Pets shop in the Commons Mall, or have the Pet Breeder next door make one just how you like it."),
        el("p", "hint", "A pet needs a house with a garden to live in."),
      );
      return;
    }
    const sp = speciesOfCode(p.code);
    this.titleEl.textContent = `🐾 ${p.name}`;
    const n = this.pets.needs(p);
    const sad = this.pets.sad(p);
    const top = el("div", "pet-top");
    const stage = el("div", "pet-stage");
    stage.append(this.canvas);
    const side = el("div", "pet-side");
    const mood = sad
      ? n.food < this.pets.sadBelow && n.joy < this.pets.sadBelow
        ? "😢 Hungry and lonely. Feed them and play!"
        : n.food < this.pets.sadBelow
          ? "😢 So hungry… a meal would help."
          : "😢 Bored and blue. Play with them!"
      : n.food > 75 && n.joy > 75
        ? "🥰 Over the moon!"
        : n.food < 45
          ? "🙂 Getting peckish."
          : n.joy < 45
            ? "🙂 Fancies a game."
            : "😊 Happy and content.";
    const level = levelOf(p.xp ?? 0);
    const lv = el("div", level >= MAX_LEVEL ? "pet-level gold" : level >= 50 ? "pet-level star" : "pet-level");
    lv.append(el("span", "lv", `Lv ${level}`), el("span", "title", levelTitle(level)));
    const xpRow = el("div", "pet-xp");
    const xpFill = el("div", "fill");
    xpFill.style.width = `${Math.round(levelProgress(p.xp ?? 0) * 100)}%`;
    xpRow.append(xpFill);
    xpRow.title = level >= MAX_LEVEL ? "The very top!" : `${(p.xp ?? 0) - xpFor(level)} / ${xpFor(level + 1) - xpFor(level)} to level ${level + 1}`;
    side.append(
      lv,
      xpRow,
      el("p", "pet-kind", describe(decodeDesign(p.code))),
      this.bar("🍖 Food", n.food, "food"),
      this.bar("💛 Fun", n.joy, "joy"),
      el("p", sad ? "pet-mood sad" : "pet-mood", mood),
      el("p", "hint", `${p.walks} walk${p.walks === 1 ? "" : "s"} · ${p.plays} game${p.plays === 1 ? "" : "s"} together${p.walked_today ? " · walked today ✓" : ""}`),
    );
    top.append(stage, side);
    this.body.append(top);

    // Meals.
    this.body.append(el("h3", "", "Feed"));
    const foods = el("div", "pet-foods");
    const names = FOODS[sp] ?? FOODS[DOG];
    MEALS.forEach((m, i) => {
      const price = MEAL_PRICES[m];
      const b = button("", () => void this.feed(m, names[i]), "pet-food");
      b.append(el("span", "food-name", names[i]), el("span", "food-what", m === "snack" ? "a little" : m === "meal" ? "fills them up" : "their favourite ♥"), el("span", "price", `${price}c`));
      b.disabled = this.busy || this.eco.coins < price || (n.food >= 97 && (m !== "treat" || n.joy >= 97));
      foods.append(b);
    });
    this.body.append(foods);

    // Play.
    const g = GAMES[sp] ?? GAMES[DOG];
    const play = el("div", "pet-actions");
    play.append(button(`${g.emoji} Play ${g.name}`, () => (this.hide(), this.host.play(p)), "primary"));
    if (p.out) play.append(button(`🏠 Bring ${p.name} home`, () => (this.hide(), this.host.walk(false)), ""));
    else play.append(button(`🐾 Take for a walk`, () => (this.hide(), this.host.walk(true)), p.walked_today ? "" : "pulse"));
    this.body.append(play);
    // Looking after it.
    this.body.append(el("h3", "", "Care"));
    const care = el("div", "pet-care");
    for (const [what, label] of [["cuddle", "💕 Cuddle"], ["brush", "🪮 Brush"], ["bath", "🛁 Bath"]] as [Care, string][]) {
      const b = button(label, () => void this.care(what), "");
      b.disabled = this.busy;
      care.append(b);
    }
    this.body.append(care);
    // Tricks it knows (and the ones still to learn).
    this.body.append(el("h3", "", "Tricks"));
    const tricks = el("div", "pet-tricks");
    for (const t of TRICKS) {
      const known = level >= t.level;
      const b = button("", () => this.trick(t.key), known ? "pet-trick" : "pet-trick locked");
      b.append(el("span", "emoji", known ? t.emoji : "🔒"), el("span", "", t.name));
      if (!known) b.append(el("span", "lv", `Lv ${t.level}`));
      b.disabled = !known;
      b.title = known ? `${p.name} knows this one!` : `${p.name} learns this at level ${t.level}`;
      tricks.append(b);
    }
    this.body.append(tricks);
    this.renderSkills(p, level);
    // Its friends: the pets it's played Treat Catch with (a walk together, then tap their owner).
    this.body.append(el("h3", "", "Pet friends"));
    const friends = el("div", "pet-friends");
    friends.append(el("p", "hint", "Out on a walk with someone else's pet? Tap them and play 🐾 Bounce Buddies or Treat Catch together: your pets become friends."));
    this.body.append(friends);
    void this.pets
      .friends()
      .then((fs) => {
        if (!fs.length) return;
        friends.replaceChildren(
          ...fs.map((f) => {
            const row = el("div", "pet-friend");
            row.append(el("b", "", f.pet ?? "Their pet"), el("span", "", ` (${f.owner}'s)`), el("span", "pet-friend-hearts", `${"💛".repeat(Math.min(5, Math.ceil(f.level / 2)))} Lv ${f.level}`));
            return row;
          }),
        );
      })
      .catch(() => {});
    this.body.append(this.msg);
    const adopt = confirmButton("pet-rehome", `🏡 Put ${p.name} up for adoption`, `Really say goodbye to ${p.name}? Tap again`, () => void this.rehome(), "subtle");
    adopt.disabled = this.busy;
    this.body.append(adopt);
    this.body.append(el("p", "hint small", "Pets get hungry and bored as the hours pass: a meal, a game or a walk every day keeps them happy. Want a new look? The Pet Breeder at the Commons Mall restyles pets."));
  }

  /**
   * The skill tree: three branches, a skill at the root of each and one that
   * grows from it. A skill point at level 1 and a few more as it grows; a
   * skill learnt is a tap away (the ones that lead you somewhere: a Go).
   */
  private renderSkills(p: Pet, level: number) {
    const left = pointsLeft(p);
    const next = SKILL_LEVELS.find((l) => l > level);
    const head = el("div", "pet-skills-head");
    head.append(el("h3", "", "Skills"));
    const pts = el("span", left > 0 ? "pet-points has" : "pet-points", left > 0 ? `⭐ ${left} skill point${left === 1 ? "" : "s"} to spend!` : next ? `Next skill point at Lv ${next}` : "Every skill learnt!");
    head.append(pts);
    this.body.append(head);
    const tree = el("div", "pet-tree");
    for (const root of SKILLS.filter((k) => !k.after)) {
      const branch = el("div", "pet-branch");
      // (A skill's own tiers go in its box; what grows from it, below.)
      const kids = SKILLS.filter((k) => k.after === root.key && !k.upgradeOf);
      branch.append(this.skillNode(p, root, left));
      for (const k of kids) {
        branch.append(el("div", knows(p, root.key) ? "pet-twig lit" : "pet-twig"), this.skillNode(p, k, left));
      }
      tree.append(branch);
    }
    this.body.append(tree);
  }

  private skillNode(p: Pet, k: Skill, left: number): HTMLElement {
    const learnt = knows(p, k.key);
    const ready = !learnt && (!k.after || knows(p, k.after));
    const can = ready && left > 0;
    const node = el("div", learnt ? "pet-skill learnt" : can ? "pet-skill can" : "pet-skill locked");
    node.append(el("span", "icon", ready || learnt ? k.emoji : "🔒"), el("b", "", k.name), el("span", "does", k.does));
    // Tiers (the fishing buddy: what it can bring up): how far up it is, and the next one to learn.
    const tiers = SKILLS.filter((u) => u.upgradeOf === k.key).sort((a, b) => (a.tier ?? 0) - (b.tier ?? 0));
    if (tiers.length) {
      const at = tierOf(p, k.key);
      const top = tiers.length + 1;
      const pips = el("span", "pet-tiers");
      for (let t = 1; t <= top; t++) pips.append(el("i", t <= at ? "on" : "", ["", "I", "II", "III"][t] ?? String(t)));
      node.append(pips);
      node.append(el("span", "pet-tier-now", at ? `Tier ${["", "I", "II", "III"][at]}: up to ${FISH_TIER_MOST[at]} fish` : `Tier I: up to ${FISH_TIER_MOST[1]} fish`));
      const next = tiers.find((u) => !knows(p, u.key));
      if (learnt && next) {
        if (left > 0) {
          const up = button(`⭐ Tier ${["", "I", "II", "III"][next.tier ?? 2]}: ${FISH_TIER_MOST[next.tier ?? 2]}`, () => void this.learn(next), "small primary");
          up.disabled = this.busy;
          node.append(up);
        } else node.append(el("span", "why", `Tier ${["", "I", "II", "III"][next.tier ?? 2]} (up to ${FISH_TIER_MOST[next.tier ?? 2]}) needs a skill point`));
      }
    }
    if (learnt) {
      if (k.lead) {
        const go = button(`🐾 Go!`, () => (this.hide(), this.host.lead(k.key)), "small primary");
        go.disabled = !p.out;
        go.title = p.out ? `${p.name} leads the way` : `Take ${p.name} for a walk first`;
        node.append(go);
        if (!p.out) node.append(el("span", "why", "Take them for a walk to use it"));
      } else node.append(el("span", "on", p.out ? "✓ Learnt: always on, out on walks" : "✓ Learnt: works when they're out with you"));
    } else if (can) {
      const b = button(`⭐ Learn`, () => void this.learn(k), "small primary");
      b.disabled = this.busy;
      node.append(b);
    } else {
      const after = k.after ? SKILLS.find((x) => x.key === k.after) : null;
      node.append(el("span", "why", !ready && after ? `Learn ${after.name} first` : "Needs a skill point"));
    }
    return node;
  }

  private async learn(k: Skill) {
    const p = this.pets.mine;
    if (!p || this.busy) return;
    this.busy = true;
    this.msg.textContent = "";
    try {
      await this.pets.learn(k.key);
      this.host.refreshLook();
      this.happyUntil = performance.now() + 1500;
      this.host.cheer(3);
      psfx.levelFanfare();
      this.host.toast(`${k.emoji} ${p.name} learnt ${k.name}! ${k.does}`, 5500);
    } catch (e) {
      this.msg.textContent = e instanceof Error ? e.message : "That didn't work.";
    } finally {
      this.busy = false;
      if (this.open) this.render();
    }
  }

  private async feed(m: Meal, name: string) {
    const p = this.pets.mine;
    if (!p || this.busy) return;
    this.busy = true;
    this.msg.textContent = "";
    try {
      await this.pets.feed(m);
      this.eating = true;
      this.happyUntil = performance.now() + 2200;
      // Its bowl set down in front of it, wherever it is; or (out of sight) a crunch.
      if (!this.host.care("feed")) {
        psfx.bowl();
        psfx.crunch(1, 300, 1);
        this.host.cheer(m === "treat" ? 3 : 1);
      }
      this.host.toast(`${name.split(" ")[0]} ${p.name} gobbles up the ${name.replace(/^\S+\s/, "").toLowerCase()}. ${m === "treat" ? "Pure joy!" : "Yum!"}`, 3500);
    } catch (e) {
      this.msg.textContent = e instanceof Error ? e.message : "That didn't work.";
    } finally {
      this.busy = false;
      if (this.open) this.render();
    }
  }

  /** Up for adoption at the Pets shop: a new family for it, room for another for you. */
  private async rehome() {
    const p = this.pets.mine;
    if (!p || this.busy) return;
    this.busy = true;
    this.msg.textContent = "";
    try {
      await this.pets.rehome();
      this.host.rehomed();
      this.hide();
      this.host.toast(`🏡 ${p.name} is off to the Pets shop to find a new family who'll love them. You can adopt a new pet there, or design one at the Pet Breeder.`, 6500);
    } catch (e) {
      this.msg.textContent = e instanceof Error ? e.message : "That didn't work.";
    } finally {
      this.busy = false;
    }
  }

  /** A trick: in the world, and in the portrait. */
  private trick(key: string) {
    this.eating = false;
    this.turning = key === "spin" || key === "dance" || key === "zoomies";
    this.happyUntil = performance.now() + 1400;
    this.host.trick(key);
  }

  private async care(what: Care) {
    const p = this.pets.mine;
    if (!p || this.busy) return;
    this.busy = true;
    try {
      const counted = await this.pets.care(what);
      this.eating = false;
      this.turning = false;
      this.happyUntil = performance.now() + 1500;
      if (!this.host.care(what)) {
        this.host.cheer(2);
        psfx.voice(speciesOfCode(p.code), "happy");
      }
      const sp = speciesOfCode(p.code);
      const lines: Record<Care, string> = {
        cuddle: sp === CAT ? "purrs like a little engine" : sp === DOG ? "wriggles with joy and licks your nose" : sp === BUNNY ? "flops over, blissed out" : sp === DUCK ? "nestles in and peeps softly" : "uncurls and snuffles your hand",
        brush: sp === HEDGEHOG ? "gets a careful little quill polish, and sparkles" : sp === DUCK ? "gets every feather smoothed, and preens proudly" : "leans into every stroke of the brush, all fluffy and shiny",
        bath: sp === DUCK ? "splashes about having the time of their life" : sp === CAT ? "puts up with the bath… then zooms off, squeaky clean" : "comes out of the bubbles clean, then shakes water everywhere",
      };
      const emoji: Record<Care, string> = { cuddle: "💕", brush: "✨", bath: "🫧" };
      this.host.toast(`${emoji[what]} ${p.name} ${lines[what]}.${counted ? "" : " (They loved it, but they're a bit spoilt just now: give it a minute.)"}`, 3500);
    } catch (e) {
      this.msg.textContent = e instanceof Error ? e.message : "That didn't work.";
    } finally {
      this.busy = false;
      if (this.open) this.render();
    }
  }

  destroy() {
    this.off();
    super.destroy();
  }
}
