// Two things that make the live pixel art (fires, fighters and their gear,
// golf, fishing…: drawn over again every frame, a little rectangle at a
// time) cheap for Pixi to draw, the same pixels as ever.
//
// Clearing what's already empty: most of it is cleared every frame whether
// or not it's in use, and Pixi counts a clear as a change (its geometry
// built, uploaded and batched over again). Here it costs nothing.
//
// Runs of rectangles in one colour: Pixi makes a path, a shape and a batch of
// every filled rectangle on its own. Here one after another in the same
// plain colour join up into one shape (drawn in the same order).

import { ExtensionType, GraphicsContext, GraphicsPath, type Matrix, Rectangle, ShapePath, extensions } from "pixi.js";

/** Many rectangles as one shape (x, y, w, h, …). */
class Pixels {
  readonly type = "pixels";
  constructor(readonly r: number[]) {}

  get x(): number {
    return this.r[0] ?? 0;
  }

  get y(): number {
    return this.r[1] ?? 0;
  }

  contains(x: number, y: number): boolean {
    const r = this.r;
    for (let i = 0; i < r.length; i += 4) if (x >= r[i] && x < r[i] + r[i + 2] && y >= r[i + 1] && y < r[i + 1] + r[i + 3]) return true;
    return false;
  }

  strokeContains(): boolean {
    return false;
  }

  getBounds(out?: Rectangle): Rectangle {
    const b = out ?? new Rectangle();
    const r = this.r;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (let i = 0; i < r.length; i += 4) {
      if (r[i] < x0) x0 = r[i];
      if (r[i + 1] < y0) y0 = r[i + 1];
      if (r[i] + r[i + 2] > x1) x1 = r[i] + r[i + 2];
      if (r[i + 1] + r[i + 3] > y1) y1 = r[i + 1] + r[i + 3];
    }
    b.x = x0;
    b.y = y0;
    b.width = x1 - x0;
    b.height = y1 - y0;
    return b;
  }

  clone(): Pixels {
    return new Pixels(this.r.slice());
  }

  copyFrom(): this {
    return this;
  }

  copyTo<T>(o: T): T {
    return o;
  }
}

extensions.add({
  extension: { type: ExtensionType.ShapeBuilder, name: "pixels" },
  build(shape: Pixels, points: number[]): boolean {
    const r = shape.r;
    let k = 0;
    for (let i = 0; i < r.length; i += 4) {
      const [x, y, w, h] = [r[i], r[i + 1], r[i + 2], r[i + 3]];
      if (!(w > 0 && h > 0)) continue;
      points[k++] = x;
      points[k++] = y;
      points[k++] = x + w;
      points[k++] = y;
      points[k++] = x;
      points[k++] = y + h;
      points[k++] = x + w;
      points[k++] = y + h;
    }
    return k > 0;
  },
  triangulate(points: number[], vertices: number[], stride: number, offset: number, indices: number[], at: number) {
    let v = offset * stride;
    for (let i = 0; i < points.length; i += 8) {
      const n = v / stride;
      for (let c = 0; c < 8; c += 2) {
        vertices[v] = points[i + c];
        vertices[v + 1] = points[i + c + 1];
        v += stride;
      }
      indices[at++] = n;
      indices[at++] = n + 1;
      indices[at++] = n + 2;
      indices[at++] = n + 1;
      indices[at++] = n + 3;
      indices[at++] = n + 2;
    }
  },
});

(ShapePath.prototype as unknown as { pixels: (r: number[]) => unknown }).pixels = function (this: ShapePath, r: number[]) {
  return this.drawShape(new Pixels(r) as never, undefined as unknown as Matrix);
};

interface Step {
  action: string;
  data: unknown[];
}

/** A context, as it is inside. */
interface Inside {
  _activePath: { instructions: Step[]; clear(): unknown };
  _transform: Matrix;
  _tick: number;
  _initNextPathLocation(): void;
  onUpdate(): void;
  instructions: { action: string; data: { path?: GraphicsPath } }[];
}

/** The run being added to, kept with the path it makes: its rectangles, its colour, and where its last fill's begin. */
interface Run {
  r: number[];
  color: number;
  alpha: number;
  last: number;
}
const runs = new WeakMap<GraphicsPath, Run>();

const proto = GraphicsContext.prototype as unknown as {
  clear(this: GraphicsContext): GraphicsContext;
  fill(this: GraphicsContext, style?: unknown, alpha?: number): GraphicsContext;
  stroke(this: GraphicsContext, style?: unknown): GraphicsContext;
};
const { clear, fill, stroke } = proto;

proto.clear = function () {
  const me = this as unknown as Inside;
  if (me.instructions.length === 0 && me._activePath.instructions.length === 0) {
    this.resetTransform();
    return this;
  }
  return clear.call(this);
};

/** The last thing drawn, if it's a run. */
function lastRun(me: Inside): { run: Run; path: GraphicsPath } | null {
  const last = me.instructions[me.instructions.length - 1];
  const path = last?.action === "fill" ? last.data.path : undefined;
  const run = path && runs.get(path);
  return run ? { run, path } : null;
}

proto.fill = function (style, alpha) {
  const me = this as unknown as Inside;
  let color = -1;
  let a = 1;
  if (alpha === undefined && me._tick > 0) {
    if (typeof style === "number") color = style;
    else if (style && typeof style === "object") {
      // (Only a plain colour, and how see-through.)
      const o = style as Record<string, unknown>;
      let plain = typeof o.color === "number";
      for (const k in o) if (k !== "color" && k !== "alpha") plain = false;
      if (plain && (o.alpha === undefined || typeof o.alpha === "number")) {
        color = o.color as number;
        a = (o.alpha as number | undefined) ?? 1;
      }
    }
  }
  const steps = me._activePath.instructions;
  const t = me._transform;
  if (color < 0 || t.a !== 1 || t.b !== 0 || t.c !== 0 || t.d !== 1 || t.tx !== 0 || t.ty !== 0) return fill.call(this, style, alpha);
  for (const q of steps) if (q.action !== "rect" && q.action !== "moveTo") return fill.call(this, style, alpha);
  const on = lastRun(me);
  const joins = on && on.run.color === color && on.run.alpha === a;
  const r = joins ? on.run.r : [];
  const from = r.length;
  for (const q of steps) {
    if (q.action !== "rect") continue;
    const m = q.data[4] as Matrix | undefined;
    if (m && (m.a !== 1 || m.b !== 0 || m.c !== 0 || m.d !== 1 || m.tx !== 0 || m.ty !== 0)) {
      r.length = from;
      return fill.call(this, style, alpha);
    }
    r.push(q.data[0] as number, q.data[1] as number, q.data[2] as number, q.data[3] as number);
  }
  if (joins) {
    on.run.last = from;
    (on.path as unknown as { _dirty: boolean })._dirty = true;
    me.onUpdate();
    me._initNextPathLocation();
    me._tick = 0;
    return this;
  }
  if (!r.length) return fill.call(this, style, alpha);
  // A run begins: as Pixi would fill it, with its rectangles as one shape.
  fill.call(this, style, alpha);
  const path = new GraphicsPath();
  (path.instructions as unknown as Step[]).push({ action: "pixels", data: [r] });
  me.instructions[me.instructions.length - 1].data.path = path;
  runs.set(path, { r, color, alpha: a, last: 0 });
  return this;
};

proto.stroke = function (style) {
  const me = this as unknown as Inside;
  // (An outline for what's just been filled: of the last of the run, not the whole of it.)
  const on = me._tick === 0 ? lastRun(me) : null;
  if (on) for (let i = on.run.last; i < on.run.r.length; i += 4) this.rect(on.run.r[i], on.run.r[i + 1], on.run.r[i + 2], on.run.r[i + 3]);
  return stroke.call(this, style);
};
