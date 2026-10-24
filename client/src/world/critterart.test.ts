import { describe, expect, it } from "vitest";
import { BUG_SPECS } from "./critterart";

describe("bug art", () => {
  it("has rows of the right width for every shape a bug uses", async () => {
    // Read as a file (the client has no Node types; tests run under Node).
    const fs = (await import(/* @vite-ignore */ ["node", "fs"].join(":"))) as { readFileSync(p: URL, enc: string): string };
    const src = fs.readFileSync(new URL("./critterart.ts", import.meta.url), "utf8");
    const blocks = [...src.matchAll(/(\w+): (half|full)\(\[([\s\S]*?)\]\)/g)];
    expect(blocks.length).toBeGreaterThan(10);
    for (const [, name, kind, body] of blocks) {
      const rows = [...body.matchAll(/"([^"]*)"/g)].map((m) => m[1]);
      for (const r of rows) expect(r.length, `${name}: "${r}"`).toBe(kind === "half" ? 8 : 16);
      expect(rows.length, name).toBeLessThanOrEqual(16);
    }
    const shapes = new Set(blocks.map((b) => b[1]));
    for (const [key, s] of Object.entries(BUG_SPECS)) expect(shapes.has(s.shape), key).toBe(true);
  });
});
