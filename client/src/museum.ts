// The Museum & Gallery (ADR 0018; server: crates/social/src/museum.rs):
// paintings made in the Studio in three sizes, hung in turn in the Salon,
// hearted, and the best kept in the Hall of Fame; and the town's natural
// history, given one fish at a time.

import type { Auth } from "./net/api";

/** The canvas sizes, small to large, and what they're called. */
export const SIZES = [16, 32, 64] as const;
export type Size = (typeof SIZES)[number];
export const SIZE_NAMES: Record<Size, string> = { 16: "Small", 32: "Medium", 64: "Large" };

/**
 * The Studio's 32 colours (index 0 is the bare canvas). The first 16 are
 * the park easels' palette; the rest add depth for bigger work.
 */
export const ART_PALETTE = [
  "#fbf7ee", "#1d2b3a", "#ffffff", "#e8566b", "#f28c6b", "#f6c343", "#7dbb5c", "#3f7a4a",
  "#5ea9c8", "#2b5f8f", "#9b6fd4", "#f4a7b9", "#b07d4f", "#a9a69c", "#efe3cf", "#5a3b2b",
  "#8f1f2b", "#d45d2c", "#e8a33d", "#fff2a8", "#b7e07a", "#2e8b57", "#1f4a3a", "#9fe3f0",
  "#3f6fd8", "#1a2a6c", "#5b3a8a", "#d68fe3", "#7a4a2a", "#e6c9a8", "#6e6e6e", "#3b3a2e",
];

export interface Art {
  id: number;
  artist: string;
  size: Size;
  title: string;
  /** base64, one palette index per cell, row by row. */
  cells: string;
  week: string;
  theme: string;
  hearts: number;
  hearted: boolean;
  /** 1–3: in the Hall of Fame. */
  fame: number | null;
  at: number;
  mine: boolean;
  /** For your own entry: when it's next on the wall (unix seconds). */
  showings?: number[];
}

export interface MuseumStatus {
  week: string;
  theme: string;
  week_ends: number;
  frames: number[];
  min_painted: number;
  salon_days: number;
  prizes: number[];
  mine: Art[];
  counts: number[];
  drafts: number[];
}

export interface Wall {
  size: Size;
  frames: number;
  total: number;
  art: Art[];
}

export interface Salon {
  hour: number;
  /** When the walls next turn (unix seconds). */
  next: number;
  walls: Wall[];
}

/** Natural History's three rooms of specimens. */
export interface NaturalHistory {
  fish: Specimen[];
  bugs: Specimen[];
  shrooms: Specimen[];
}

export interface Specimen {
  item: number;
  key: string;
  name: string;
  rarity: number;
  given: boolean;
  first: { name: string; at: number } | null;
  givers: number;
}

export function toBytes(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function toB64(cells: Uint8Array): string {
  let s = "";
  for (let i = 0; i < cells.length; i += 0x8000) s += String.fromCharCode(...cells.subarray(i, i + 0x8000));
  return btoa(s);
}

/** A painting drawn `scale` px per cell. */
export function paintingCanvas(cells: Uint8Array, size: number, scale: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = size * scale;
  const ctx = c.getContext("2d")!;
  for (let i = 0; i < size * size; i++) {
    ctx.fillStyle = ART_PALETTE[cells[i] ?? 0] ?? ART_PALETTE[0];
    ctx.fillRect((i % size) * scale, Math.floor(i / size) * scale, scale, scale);
  }
  return c;
}

export class Museum {
  status: MuseumStatus | null = null;
  salon: Salon | null = null;
  private listeners = new Set<() => void>();

  constructor(private auth: Auth) {}

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private changed() {
    this.listeners.forEach((f) => f());
  }

  async load(): Promise<MuseumStatus> {
    this.status = await this.auth.get<MuseumStatus>("/api/social/museum");
    this.changed();
    return this.status;
  }

  async loadSalon(): Promise<Salon> {
    this.salon = await this.auth.get<Salon>("/api/social/museum/salon");
    this.changed();
    return this.salon;
  }

  catalogue(size: Size, sort: "new" | "hearts", page: number) {
    return this.auth.get<{ art: Art[]; more: boolean }>(`/api/social/museum/catalogue?size=${size}&sort=${sort}&page=${page}`);
  }

  fame() {
    return this.auth.get<{ art: Art[] }>("/api/social/museum/fame");
  }

  art(id: number) {
    return this.auth.get<Art>(`/api/social/museum/art/${id}`);
  }

  async draft(size: Size): Promise<Uint8Array> {
    return toBytes((await this.auth.get<{ cells: string }>(`/api/social/museum/drafts/${size}`)).cells);
  }

  saveDraft(size: Size, cells: Uint8Array) {
    return this.auth.send(`/api/social/museum/drafts/${size}`, { cells: toB64(cells) });
  }

  async submit(size: Size, title: string, cells: Uint8Array) {
    const r = await this.auth.send<{ id: number; theme: string }>("/api/social/museum/submit", { size, title, cells: toB64(cells) });
    await Promise.all([this.load(), this.loadSalon()]).catch(() => {});
    return r;
  }

  async heart(id: number, on: boolean) {
    const r = await this.auth.send<{ hearts: number; hearted: boolean }>(`/api/social/museum/art/${id}/heart`, { on });
    // The walls show hearts too.
    for (const w of this.salon?.walls ?? []) {
      for (const a of w.art) {
        if (a.id === id) {
          a.hearts = r.hearts;
          a.hearted = r.hearted;
        }
      }
    }
    this.changed();
    return r;
  }

  async report(id: number) {
    await this.auth.send(`/api/social/museum/art/${id}/report`, {});
    await this.loadSalon().catch(() => {});
  }

  nature() {
    return this.auth.get<NaturalHistory>("/api/social/museum/nature");
  }

  donate(item: number) {
    return this.auth.send<{ name: string; first: boolean }>("/api/social/museum/donate", { item });
  }
}
