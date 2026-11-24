// The Pet Breeder's studio (in the Commons Mall): make a pet exactly how
// you like it. Pick the animal, then the breed (big or small), its coat,
// a pattern and that pattern's colour, its eyes and something to wear;
// every choice is shown as a tile of your pet wearing it, and the big
// preview walks, sits, hops and wags as you go. Somebody with a pet already
// can have it restyled instead (the same animal, a new look).

import * as psfx from "../ambient/petsfx";
import { till } from "../ambient/salvagesfx";
import type { Economy } from "../economy";
import type { Pets } from "../pets";
import { PET_H, PET_W, type PetFace, type PetPose, WALK_FRAMES, petArt, walkLift } from "../world/petart";
import { ACCESSORIES, EYES, FUR, type PetDesign, SPECIES_LIST, TINTS, TINTED, decodeDesign, describe, encodeDesign, fitDesign, patternName, randomDesign, speciesOf } from "../world/petlook";
import type { PetHome } from "./mall";
import { Panel, button, el } from "./panels";

type Tab = "species" | "breed" | "coat" | "pattern" | "eyes" | "wear";
const TABS: [Tab, string][] = [
  ["species", "Animal"],
  ["breed", "Breed"],
  ["coat", "Coat"],
  ["pattern", "Pattern"],
  ["eyes", "Eyes"],
  ["wear", "Wear"],
];

/** A little animated show on the stage: what the pet does, in turn. */
const SHOW: { pose: PetPose; ms: number; face?: PetFace; hop?: boolean; turn?: boolean }[] = [
  { pose: "stand", ms: 1800 },
  { pose: "walk", ms: 1600 },
  { pose: "stand", ms: 400, turn: true },
  { pose: "walk", ms: 1600 },
  { pose: "sit", ms: 1700, face: "happy" },
  { pose: "jump", ms: 900, hop: true, face: "happy" },
  { pose: "stand", ms: 400, turn: true },
  { pose: "lie", ms: 1600, face: "sleep" },
];
const SHOW_MS = SHOW.reduce((a, s) => a + s.ms, 0);

/** A pet tile: the design drawn 2×. */
function tile(code: number, pose: PetPose = "stand"): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = PET_W * 2;
  c.height = PET_H * 2;
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(petArt(code, pose, 0, "open"), 0, 0, c.width, c.height);
  return c;
}

export class PetMakerPanel extends Panel {
  private d: PetDesign = randomDesign(1);
  private tab: Tab = "species";
  private stage = document.createElement("canvas");
  private raf = 0;
  private name = el("input", "pet-name");
  private msg = el("p", "error");
  private busy = false;
  /** Restyling the pet you have (rather than designing a new one). */
  private restyling = false;

  constructor(
    private pets: Pets,
    private eco: Economy,
    /** Whether you can give a new pet a home. */
    private petHome: () => PetHome,
    private done: (text: string) => void,
  ) {
    super("Pet Breeder", "petmaker");
    this.stage.width = PET_W * 6;
    this.stage.height = PET_H * 6 + 24;
    this.stage.className = "petmaker-stage";
    this.name.placeholder = "Their name";
    this.name.maxLength = 16;
    this.name.onkeydown = (e) => e.stopPropagation();
    eco.onChange(() => this.open && !this.busy && this.render());
  }

  /** Opens the studio: your pet to restyle, if you have one, or a fresh design. */
  openStudio() {
    const mine = this.pets.mine;
    this.restyling = !!mine;
    this.d = mine ? decodeDesign(mine.code) : randomDesign();
    this.tab = mine ? "coat" : "species";
    this.msg.textContent = "";
    this.show();
  }

  show() {
    super.show();
    cancelAnimationFrame(this.raf);
    const t0 = performance.now();
    const tick = (now: number) => {
      this.paintStage(now - t0);
      if (this.open) this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  hide() {
    super.hide();
    cancelAnimationFrame(this.raf);
  }

  private paintStage(t: number) {
    const c = this.stage;
    const ctx = c.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, c.width, c.height);
    // Which act of the show, and how far into it.
    let at = t % SHOW_MS;
    let i = 0;
    let flip = Math.floor(t / SHOW_MS) % 2 === 1;
    while (at >= SHOW[i].ms) {
      at -= SHOW[i].ms;
      if (SHOW[i].turn) flip = !flip;
      i++;
    }
    const s = SHOW[i];
    const lift = s.hop ? Math.sin((at / s.ms) * Math.PI) * 26 : 0;
    const code = encodeDesign(this.d);
    const face: PetFace = s.face ?? (Math.floor(t / 2600) % 5 === 0 && t % 2600 < 140 ? "blink" : "open");
    const wag = s.pose === "stand" || s.pose === "sit" ? Math.sin(t / 95) : 0;
    // Walking in place: a stride every 0.6 s, riding up and down with it.
    const frac = (t / 600) % 1;
    const art = petArt(code, s.pose, Math.floor(frac * WALK_FRAMES), face, false, wag);
    const ride = s.pose === "walk" ? walkLift(code, frac) * 6 : 0;
    ctx.save();
    if (flip) {
      ctx.translate(c.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(art, 0, Math.round(12 - lift - ride), PET_W * 6, PET_H * 6);
    ctx.restore();
  }

  private set(change: Partial<PetDesign>) {
    psfx.hop(0.5);
    this.d = fitDesign({ ...this.d, ...change });
    this.render();
  }

  render() {
    this.body.replaceChildren();
    const sp = speciesOf(this.d.species);
    const mine = this.pets.mine;
    this.titleEl.textContent = this.restyling && mine ? `Pet Breeder · restyling ${mine.name}` : "Pet Breeder";
    const top = el("div", "petmaker-top");
    const stageBox = el("div", "petmaker-stagebox");
    stageBox.append(this.stage);
    const side = el("div", "petmaker-side");
    side.append(
      el("p", "petmaker-kind", `${sp.emoji} ${describe(this.d)}`),
      el("p", "hint", sp.breeds[this.d.breed]?.blurb ?? ""),
      button("🎲 Surprise me", () => {
        const r = randomDesign(this.restyling ? this.d.species : undefined);
        this.d = this.restyling ? fitDesign({ ...r, species: this.d.species }) : r;
        this.render();
      }, "small"),
    );
    if (this.restyling && mine) side.append(button("Undo all", () => ((this.d = decodeDesign(mine.code)), this.render()), "small subtle"));
    top.append(stageBox, side);
    this.body.append(top);

    const tabs = el("div", "tabs");
    for (const [t, label] of TABS) {
      if (t === "species" && this.restyling) continue;
      tabs.append(button(label, () => ((this.tab = t), this.render()), t === this.tab ? "on" : ""));
    }
    this.body.append(tabs, this.section());
    this.body.append(this.footer(), this.msg);
  }

  private section(): HTMLElement {
    const box = el("div", "petmaker-section");
    const sp = speciesOf(this.d.species);
    const d = this.d;
    switch (this.tab) {
      case "species":
        box.append(
          this.tiles(
            SPECIES_LIST.map((s) => ({
              label: `${s.emoji} ${s.name}`,
              on: s.id === d.species,
              code: encodeDesign(fitDesign({ ...randomDesign(s.id, () => 0.5), species: s.id, accessory: d.accessory, tint: d.tint })),
              pick: () => (psfx.voice(s.id, "excited", 0.9), (this.d = fitDesign({ ...randomDesign(s.id), accessory: d.accessory, tint: d.tint, species: s.id })), this.render()),
            })),
          ),
        );
        break;
      case "breed":
        box.append(
          this.tiles(
            sp.breeds.map((b, i) => ({
              label: b.name,
              sub: b.size,
              on: i === d.breed,
              code: encodeDesign({ ...d, breed: i }),
              pick: () => this.set({ breed: i }),
            })),
          ),
        );
        break;
      case "coat":
        box.append(el("p", "hint", `Colours a real ${sp.noun} comes in.`));
        box.append(this.swatches(sp.coats.map((c) => ({ color: FUR[c].hex, name: FUR[c].name, on: c === d.coat, pick: () => this.set({ coat: c }) }))));
        box.append(this.tiles(sp.coats.map((c) => ({ label: FUR[c].name, on: c === d.coat, code: encodeDesign({ ...d, coat: c }), pick: () => this.set({ coat: c }) })), true));
        break;
      case "pattern":
        box.append(this.tiles(sp.patterns.map((p) => ({ label: patternName(sp, p), on: p === d.pattern, code: encodeDesign({ ...d, pattern: p }), pick: () => this.set({ pattern: p }) }))));
        if (d.pattern) {
          box.append(el("h3", "", "Pattern colour"));
          box.append(this.swatches(sp.patternColors.map((c) => ({ color: FUR[c].hex, name: FUR[c].name, on: c === d.patternColor, pick: () => this.set({ patternColor: c }) }))));
        }
        break;
      case "eyes":
        box.append(this.swatches(sp.eyes.map((e) => ({ color: EYES[e].hex, name: EYES[e].name, on: e === d.eyes, pick: () => this.set({ eyes: e }) }))));
        box.append(this.tiles(sp.eyes.map((e) => ({ label: EYES[e].name, on: e === d.eyes, code: encodeDesign({ ...d, eyes: e }), pick: () => this.set({ eyes: e }) })), true, true));
        break;
      case "wear":
        box.append(this.tiles(ACCESSORIES.map((a, i) => ({ label: a, on: i === d.accessory, code: encodeDesign({ ...d, accessory: i }), pick: () => this.set({ accessory: i }) })), true, true));
        if (TINTED.has(d.accessory) && d.accessory !== 12) {
          box.append(el("h3", "", "Its colour"));
          box.append(this.swatches(TINTS.map((t, i) => ({ color: t.hex, name: t.name, on: i === d.tint, pick: () => this.set({ tint: i }) }))));
        }
        break;
    }
    return box;
  }

  private tiles(opts: { label: string; sub?: string; on: boolean; code: number; pick: () => void }[], small = false, head = false): HTMLElement {
    const grid = el("div", small ? "petmaker-tiles small" : "petmaker-tiles");
    for (const o of opts) {
      const b = button("", o.pick, o.on ? "pet-tile on" : "pet-tile");
      b.title = o.label;
      const pic = el("div", head ? "pic head" : "pic");
      pic.append(tile(o.code));
      b.append(pic, el("span", "", o.label));
      if (o.sub) b.append(el("span", "sub", o.sub));
      grid.append(b);
    }
    return grid;
  }

  private swatches(opts: { color: string; name: string; on: boolean; pick: () => void }[]): HTMLElement {
    const row = el("div", "swatches");
    for (const o of opts) {
      const b = button("", o.pick, o.on ? "swatch on" : "swatch");
      b.style.background = o.color;
      b.title = o.name;
      b.setAttribute("aria-label", o.name);
      row.append(b);
    }
    return row;
  }

  private footer(): HTMLElement {
    const box = el("div", "petmaker-footer");
    const coins = this.eco.coins;
    const mine = this.pets.mine;
    if (this.restyling && mine) {
      const price = this.pets.restylePrice;
      const same = encodeDesign(this.d) === mine.code;
      const go = button(`✂️ Restyle ${mine.name} for ${price}`, () => void this.restyle(), "primary");
      go.disabled = this.busy || same || coins < price;
      box.append(el("p", "hint", `You have ${coins} coins. The same ${speciesOf(this.d.species).noun}, a whole new look.`), go);
      return box;
    }
    const home = this.petHome();
    const why: Record<Exclude<PetHome, "ok">, string> = {
      no_house: "A pet needs a home with a garden: rent a house first (ask at the Post Office). Design away, though!",
      apartment: "A pet needs a garden: the apartments don't have one. A house in the home blocks does.",
      have_pet: "You have a pet already: one is plenty of love. To swap, put yours up for adoption from its panel (the paw button).",
    };
    const price = this.pets.breedPrice;
    if (home !== "ok") {
      box.append(el("p", "hint", why[home]));
      return box;
    }
    const go = button(`🐾 Welcome them home for ${price}`, () => void this.breed(), "primary");
    go.disabled = this.busy || coins < price;
    box.append(el("p", "hint", `You have ${coins} coins.`), this.name, go);
    return box;
  }

  private async breed() {
    const n = this.name.value.trim();
    if (n.length < 2) return void (this.msg.textContent = "Give them a name first.");
    this.busy = true;
    this.msg.textContent = "";
    try {
      await this.pets.breed(encodeDesign(this.d), n);
      till(this.pets.breedPrice);
      psfx.voice(this.d.species, "excited", 1, 400);
      this.hide();
      this.done(`🐾 Welcome to the family, ${n}! Your ${describe(this.d).toLowerCase()} has gone home ahead of you: find them inside your house.`);
    } catch (e) {
      this.msg.textContent = e instanceof Error ? e.message : "That didn't work.";
    } finally {
      this.busy = false;
      if (this.open) this.render();
    }
  }

  private async restyle() {
    const mine = this.pets.mine;
    if (!mine) return;
    this.busy = true;
    this.msg.textContent = "";
    try {
      await this.pets.restyle(encodeDesign(this.d));
      till(this.pets.restylePrice);
      psfx.sparkle();
      psfx.voice(this.d.species, "excited", 1, 300);
      this.hide();
      this.done(`✂️ ${mine.name} looks fabulous! A ${describe(this.d).toLowerCase()} now.`);
    } catch (e) {
      this.msg.textContent = e instanceof Error ? e.message : "That didn't work.";
    } finally {
      this.busy = false;
      if (this.open) this.render();
    }
  }
}
