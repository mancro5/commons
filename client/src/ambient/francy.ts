// Fisherman Franci, who fishes the little pond west of the Apartments: sat at
// the end of his dock in a sun hat, rod out over the water a couple of tiles
// in front of him, his bobber bobbing. Now and then something bites: the line
// tugs, he reels it in with a flick and the catch leaps out of the water to
// him (the same show as your own catches), with a word about it, and he casts
// again. Tap him for a chat and his shop: he buys your fish and sells the rod
// and lures, like the fisherman on the pier.

import type { Item } from "../economy";
import type { EntityInfo } from "../net/protocol.gen";
import { TILE } from "../world/art";
import { Avatar } from "../world/avatars";
import { encodeLook } from "../world/look";
import type { MapObject } from "../world/map";
import type { TileXY } from "../world/motion";
import type { Props } from "../world/props";
import type { Scene } from "../world/scene";

export const FRANCY_ID = 0xfffffffa;
/** A sun hat, a green jumper and a tidy short cut. */
const LOOK = encodeLook({ hue: 120, skin: 0, hair: 1, hat: 2, hatHue: 45, style: 0, accessory: 0, outfit: 3 });
const SITTING = 1;

const CHAT = [
  "Oh hello! Lovely day for a sit by the water. Caught anything? I'll buy it.",
  "This little pond's my secret spot. Well, it was!",
  "I name every fish I catch. That last one was Gerald.",
  "The frogs gossip on the lily pads after dark. Terrible gossips.",
  "Nothing beats a flask of tea and a quiet line in the water.",
  "Sit on the bench a while, it's ever so comfy.",
  "Patience, that's the trick. Patience and a good hat.",
];
/** What he says over a catch (`%` is its name). */
const CATCHES = ["Ooh, a %! Lovely.", "Got one! A % this time.", "Ha! That's the third % today.", "A %! Cheeky thing, fought like a good 'un."];
const JUNK = ["Oh, a %. Again.", "Not a fish, is it. A %!"];

export class Francy {
  readonly avatar: Avatar;
  /** Where he stands (sits), and where his bobber sits in the pond. */
  readonly tile: TileXY;
  private bobber: TileXY;
  private next = 0;
  private stage: "fishing" | "bite" | "reeling" = "fishing";
  private stageAt = 0;
  private tip = 0;

  constructor(
    spot: MapObject,
    scene: Scene,
    labels: HTMLElement,
    private props: Props,
    /** Shows a catch leaping from `from` to his head; returns what it was. */
    private onCatch: (from: TileXY, head: () => { x: number; y: number } | null) => Item | null,
  ) {
    const at = { x: spot.x, y: spot.y };
    this.tile = at;
    this.bobber = { x: spot.x - 2, y: spot.y };
    const info: EntityInfo = { id: FRANCY_ID, name: "Fisherman Franci 🎣", look: LOOK, x: at.x, y: at.y, state: 0, speedX10: 0, t0: 0, sprintIn: 0, path: [], mood: 0, away: false, reading: 0, calling: false, style: 0, pet: 0, vehicle: 0, tool: 0 };
    this.avatar = new Avatar(info, scene, labels, false, Date.now());
    this.avatar.markNpc();
    this.avatar.setState(SITTING, at);
    this.avatar.rodOut = true;
    this.cast(performance.now());
  }

  private cast(now: number) {
    this.avatar.castLine(this.bobber, now);
    this.props.cast(FRANCY_ID, this.bobber);
    this.stage = "fishing";
    this.stageAt = now;
    this.next = now + 18_000 + Math.random() * 22_000;
  }

  update(now: number, wallNow: number) {
    if (this.stage === "fishing" && wallNow > this.next) {
      // A bite: the line tugs.
      this.stage = "bite";
      this.stageAt = wallNow;
      this.avatar.bite(wallNow);
      this.props.bite(FRANCY_ID);
    } else if (this.stage === "bite" && wallNow - this.stageAt > 2200) {
      // Reel it in: out of the water it leaps, over to him, with a word about it.
      this.stage = "reeling";
      this.stageAt = wallNow;
      this.avatar.reelIn(wallNow);
      this.props.reelIn(FRANCY_ID);
      const a = this.avatar;
      const it = this.onCatch(this.bobber, () => ({ x: a.pos.x * TILE + TILE / 2, y: a.pos.y * TILE + TILE - 4 - 34 }));
      if (it) {
        const lines = it.kind === "junk" ? JUNK : CATCHES;
        this.avatar.say(lines[Math.floor(Math.random() * lines.length)].replace("%", it.name.toLowerCase()));
      }
    } else if (this.stage === "reeling" && wallNow - this.stageAt > 4200) {
      this.cast(wallNow);
    }
    this.avatar.update(now, wallNow);
  }

  /** His rod tip this frame, for the line to his bobber. */
  get rodTip() {
    return this.avatar.rodTip;
  }

  /** Whether a tap at tile coordinates (fractional) hits him. */
  hit(tx: number, ty: number): boolean {
    const p = this.avatar.pos;
    return Math.abs(tx - (p.x + 0.5)) < 0.8 && ty > p.y - 0.6 && ty < p.y + 1.1;
  }

  say(text: string) {
    this.avatar.say(text);
  }

  chat() {
    this.avatar.say(CHAT[this.tip++ % CHAT.length]);
  }

  destroy() {
    this.props.reelIn(FRANCY_ID);
    this.avatar.destroy();
  }
}
