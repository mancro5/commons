// How far behind the server's clock to draw the others in a fight (the arena,
// paintball): just far enough that the next word of where they are has come
// before it's needed, so they glide, whoever's connection it is. On a good
// one that's close behind; on a slow or uneven one (a friend's, through a
// tunnel) a little further, instead of running out, guessing, and jerking
// back when the word does come.

/** Updates it goes by (a few seconds' worth). */
const KEEP = 40;
/** Never closer than this, nor further (ms). */
const LEAST = 120;
const MOST = 420;
/** A little over, to be safe. */
const SPARE = 24;
/** How quickly it goes further behind, and closes up again (ms an update). */
const OUT = 14;
const IN = 5;
/** Updates this close together (ms) came in one go, after a wait. */
const TOGETHER = 30;

export class GlideDelay {
  private late: number[] = [];
  private gaps: number[] = [];
  private lastT = 0;
  private lastNow = -Infinity;
  private at: number;

  constructor(start: number) {
    this.at = start;
  }

  /** How far behind to draw (ms). */
  get ms(): number {
    return this.at;
  }

  /** An update of server time `t`'s come, at `now` (the server's clock, as we have it). */
  heard(t: number, now: number) {
    const late = now - t;
    // (A tab asleep, or a clock just being set: nothing to go by.)
    if (late < -50 || late > 3000) return;
    const gap = t - this.lastT;
    this.lastT = t;
    if (gap > 0 && gap < 400) {
      this.gaps.push(gap);
      if (this.gaps.length > KEEP) this.gaps.shift();
    }
    // (A heap of them at once, after a wait (a moment's hitch, here or on the
    // way): that's one wait, not as many as were in it.)
    if (now - this.lastNow < TOGETHER && this.late.length) this.late[this.late.length - 1] = late;
    else this.late.push(late);
    this.lastNow = now;
    if (this.late.length > KEEP) this.late.shift();
    if (this.late.length < 5 || this.gaps.length < 3) return;
    const of = (a: number[], q: number) => [...a].sort((x, y) => x - y)[Math.floor((a.length - 1) * q)];
    const want = Math.max(LEAST, Math.min(MOST, of(this.gaps, 0.5) + of(this.late, 0.9) + SPARE));
    this.at += Math.max(-IN, Math.min(OUT, want - this.at));
  }
}
