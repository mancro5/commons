// What a pet looks like (server: crates/api/src/pets.rs `design_ok`). A
// pet's code is either an old Pets-shop coat code (species in the low byte,
// coat above) or a design, as the Breeder makes them:
//
//   bits 0–3 species · 4–6 breed · 7–10 coat colour · 11–13 pattern ·
//   14–17 pattern colour · 18–20 eyes · 21–24 accessory · 25–27 its colour ·
//   28–29 mood (on the wire only: 1 sad) · bit 30 set (a design).
//
// Everything here is a pure function of the code, so a pet looks the same
// for everyone who sees it.

export const DESIGN_FLAG = 1 << 30;
const MOOD_SAD = 1 << 28;

export const DOG = 1;
export const CAT = 2;
export const BUNNY = 3;
export const DUCK = 4;
export const HEDGEHOG = 5;

export interface PetDesign {
  species: number;
  breed: number;
  coat: number;
  pattern: number;
  patternColor: number;
  eyes: number;
  accessory: number;
  tint: number;
}

/** Fur, feather and spine colours (by index). */
export const FUR: { name: string; hex: string }[] = [
  { name: "Cream", hex: "#f1e2c2" },
  { name: "White", hex: "#f8f5ee" },
  { name: "Golden", hex: "#e2ad55" },
  { name: "Ginger", hex: "#e7883a" },
  { name: "Rust", hex: "#b45a30" },
  { name: "Chocolate", hex: "#76492c" },
  { name: "Fawn", hex: "#c99a6a" },
  { name: "Grey", hex: "#9b9aa3" },
  { name: "Silver", hex: "#c3cad3" },
  { name: "Charcoal", hex: "#56545f" },
  { name: "Black", hex: "#2e2c35" },
  { name: "Apricot", hex: "#eeb48a" },
  { name: "Sunny", hex: "#f7d74a" },
  { name: "Sandy", hex: "#d9c08c" },
  { name: "Blue", hex: "#7f8ca3" },
  { name: "Mallard", hex: "#3d7d52" },
];

export const EYES: { name: string; hex: string }[] = [
  { name: "Dark", hex: "#25222c" },
  { name: "Brown", hex: "#7a4522" },
  { name: "Amber", hex: "#df9426" },
  { name: "Green", hex: "#4fb35d" },
  { name: "Blue", hex: "#4b92e8" },
  { name: "Gold", hex: "#ecc63a" },
  { name: "Violet", hex: "#9a6ad8" },
  { name: "Odd", hex: "#4b92e8" },
];

export const TINTS: { name: string; hex: string; dark: string }[] = [
  { name: "Red", hex: "#e04a4a", dark: "#a82e36" },
  { name: "Blue", hex: "#4a82e0", dark: "#2e55a8" },
  { name: "Green", hex: "#4fb84f", dark: "#2f7f3a" },
  { name: "Yellow", hex: "#f2c53a", dark: "#c18f1e" },
  { name: "Pink", hex: "#f27aac", dark: "#c04d7e" },
  { name: "Purple", hex: "#9a62d6", dark: "#6a3ea4" },
  { name: "Black", hex: "#3a3842", dark: "#1f1d24" },
  { name: "White", hex: "#f6f3ec", dark: "#c9c2b4" },
];

export const PATTERNS = ["Solid", "Stripes", "Spots", "Patches", "Socks", "Tuxedo", "Points", "Saddle"];
const SOLID = 0;
const STRIPES = 1;
const SPOTS = 2;
const PATCHES = 3;
const SOCKS = 4;
const TUXEDO = 5;
const POINTS = 6;
const SADDLE = 7;

export const ACCESSORIES = ["None", "Collar", "Bell collar", "Bow", "Bandana", "Bow tie", "Scarf", "Flower crown", "Party hat", "Top hat", "Beanie", "Sunglasses", "Crown"];
/** Which accessories take a colour. */
export const TINTED = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);

export interface Species {
  id: number;
  name: string;
  /** Singular, lower-case, for "your …". */
  noun: string;
  emoji: string;
  breeds: { name: string; blurb: string; size: "Tiny" | "Small" | "Medium" | "Big" }[];
  coats: number[];
  patterns: number[];
  /** What each pattern's called for this animal. */
  patternNames?: Partial<Record<number, string>>;
  patternColors: number[];
  eyes: number[];
}

export const SPECIES_LIST: Species[] = [
  {
    id: DOG,
    name: "Dog",
    noun: "dog",
    emoji: "🐶",
    breeds: [
      { name: "Mutt", blurb: "A bit of everything, all heart.", size: "Medium" },
      { name: "Terrier", blurb: "Small, scruffy and fearless.", size: "Small" },
      { name: "Dachshund", blurb: "Long, low and very proud of it.", size: "Small" },
      { name: "Corgi", blurb: "Short legs, big ears, bigger smile.", size: "Small" },
      { name: "Retriever", blurb: "Big, soft, and lives for fetch.", size: "Big" },
      { name: "Husky", blurb: "Big and fluffy, curled tail, loud opinions.", size: "Big" },
    ],
    coats: [1, 0, 2, 11, 3, 4, 6, 5, 7, 8, 9, 10],
    patterns: [SOLID, SPOTS, PATCHES, SOCKS, TUXEDO, POINTS, SADDLE],
    patternNames: { [POINTS]: "Mask", [PATCHES]: "Patches" },
    patternColors: [1, 0, 2, 3, 4, 6, 5, 7, 9, 10],
    eyes: [0, 1, 2, 4, 7],
  },
  {
    id: CAT,
    name: "Cat",
    noun: "cat",
    emoji: "🐱",
    breeds: [
      { name: "Shorthair", blurb: "Sleek, nosy, naps in sunbeams.", size: "Medium" },
      { name: "Fluffy", blurb: "Long-haired, a ruff and a plume of a tail.", size: "Medium" },
      { name: "Maine Coon", blurb: "A big gentle lion with ear tufts.", size: "Big" },
      { name: "Kitten", blurb: "Tiny, all head and mischief.", size: "Tiny" },
    ],
    coats: [1, 0, 3, 2, 6, 5, 7, 8, 14, 9, 10],
    patterns: [SOLID, STRIPES, SPOTS, PATCHES, SOCKS, TUXEDO, POINTS],
    patternNames: { [STRIPES]: "Tabby", [PATCHES]: "Calico", [POINTS]: "Siamese" },
    patternColors: [1, 0, 3, 4, 6, 5, 7, 9, 10],
    eyes: [3, 5, 2, 4, 6, 7],
  },
  {
    id: BUNNY,
    name: "Bunny",
    noun: "bunny",
    emoji: "🐰",
    breeds: [
      { name: "Lop", blurb: "Floppy ears, floppier naps.", size: "Medium" },
      { name: "Upright", blurb: "Tall ears, always listening.", size: "Medium" },
      { name: "Lionhead", blurb: "A fluffy mane like a tiny lion.", size: "Small" },
      { name: "Dwarf", blurb: "A round little bean of a bunny.", size: "Tiny" },
    ],
    coats: [1, 0, 13, 6, 11, 5, 7, 8, 9, 10],
    patterns: [SOLID, SPOTS, PATCHES, SOCKS, POINTS],
    patternNames: { [PATCHES]: "Dutch", [POINTS]: "Himalayan" },
    patternColors: [1, 0, 6, 5, 7, 9, 10],
    eyes: [0, 1, 4, 2],
  },
  {
    id: DUCK,
    name: "Duck",
    noun: "duck",
    emoji: "🦆",
    breeds: [
      { name: "Duckling", blurb: "A fuzzy little peep on legs.", size: "Tiny" },
      { name: "Pond Duck", blurb: "All grown up, a proper waddle.", size: "Small" },
      { name: "Crested", blurb: "A duck with a pom-pom hairdo.", size: "Small" },
    ],
    coats: [12, 1, 0, 6, 13, 5, 7, 9],
    patterns: [SOLID, SPOTS, POINTS, SADDLE],
    patternNames: { [POINTS]: "Hood", [SADDLE]: "Wings" },
    patternColors: [15, 14, 5, 6, 1, 9, 10, 12],
    eyes: [0, 1],
  },
  {
    id: HEDGEHOG,
    name: "Hedgehog",
    noun: "hedgehog",
    emoji: "🦔",
    breeds: [
      { name: "Pygmy", blurb: "Palm-sized and very snuffly.", size: "Tiny" },
      { name: "Woodland", blurb: "A big round pincushion.", size: "Small" },
    ],
    coats: [5, 6, 13, 9, 0, 1],
    patterns: [SOLID, POINTS, SADDLE],
    patternNames: { [POINTS]: "Masked", [SADDLE]: "Frosted" },
    patternColors: [1, 0, 13, 5, 9],
    eyes: [0, 1],
  },
];

export function speciesOf(id: number): Species {
  return SPECIES_LIST.find((s) => s.id === id) ?? SPECIES_LIST[0];
}

export function patternName(sp: Species, p: number): string {
  return sp.patternNames?.[p] ?? PATTERNS[p];
}

export function encodeDesign(d: PetDesign): number {
  return (
    (DESIGN_FLAG |
      (d.species & 0xf) |
      ((d.breed & 7) << 4) |
      ((d.coat & 0xf) << 7) |
      ((d.pattern & 7) << 11) |
      ((d.patternColor & 0xf) << 14) |
      ((d.eyes & 7) << 18) |
      ((d.accessory & 0xf) << 21) |
      ((d.tint & 7) << 25)) >>>
    0
  );
}

/** The old Pets-shop pets, as designs. */
const LEGACY: Record<number, PetDesign> = {
  0x0101: { species: DOG, breed: 0, coat: 2, pattern: SOLID, patternColor: 1, eyes: 0, accessory: 1, tint: 0 },
  0x0201: { species: DOG, breed: 0, coat: 1, pattern: SPOTS, patternColor: 10, eyes: 1, accessory: 0, tint: 0 },
  0x0301: { species: DOG, breed: 3, coat: 3, pattern: TUXEDO, patternColor: 1, eyes: 1, accessory: 4, tint: 1 },
  0x0102: { species: CAT, breed: 3, coat: 3, pattern: STRIPES, patternColor: 4, eyes: 3, accessory: 0, tint: 0 },
  0x0202: { species: CAT, breed: 3, coat: 10, pattern: SOLID, patternColor: 1, eyes: 5, accessory: 2, tint: 0 },
  0x0103: { species: BUNNY, breed: 0, coat: 0, pattern: SOLID, patternColor: 1, eyes: 0, accessory: 0, tint: 0 },
  0x0104: { species: DUCK, breed: 0, coat: 12, pattern: SOLID, patternColor: 15, eyes: 0, accessory: 0, tint: 0 },
  0x0105: { species: HEDGEHOG, breed: 0, coat: 5, pattern: SOLID, patternColor: 0, eyes: 0, accessory: 0, tint: 0 },
};

export function decodeDesign(code: number): PetDesign {
  if (code & DESIGN_FLAG) {
    return {
      species: code & 0xf || DOG,
      breed: (code >>> 4) & 7,
      coat: (code >>> 7) & 0xf,
      pattern: (code >>> 11) & 7,
      patternColor: (code >>> 14) & 0xf,
      eyes: (code >>> 18) & 7,
      accessory: (code >>> 21) & 0xf,
      tint: (code >>> 25) & 7,
    };
  }
  const legacy = LEGACY[code & 0xffff] ?? LEGACY[0x0100 | (code & 0xff)] ?? LEGACY[0x0101];
  return { ...legacy };
}

/** The look without the mood and level bits. */
export function lookOf(code: number): number {
  return code & DESIGN_FLAG ? (code & 0x4fffffff) >>> 0 : code & 0xffff;
}

/** How grown-up a pet out on a walk is, from the wire: 2 level 100 (golden), 1 level 50+ (a sparkle), else 0. */
export function codeStars(code: number): number {
  return (code & 0x80000000) !== 0 ? 2 : (code & (1 << 29)) !== 0 ? 1 : 0;
}

/** Whether a code (from the wire) says the pet is sad. */
export function codeIsSad(code: number): boolean {
  return (code & MOOD_SAD) !== 0;
}

export function speciesOfCode(code: number): number {
  return code & DESIGN_FLAG ? code & 0xf : code & 0xff;
}

/** "Grey Tabby Shorthair" */
export function describe(d: PetDesign): string {
  const sp = speciesOf(d.species);
  const breed = sp.breeds[d.breed]?.name ?? sp.name;
  const coat = FUR[d.coat]?.name ?? "";
  const pat = d.pattern === SOLID ? "" : ` ${patternName(sp, d.pattern)}`;
  const tail = d.species === DOG || d.species === CAT ? breed : breed.includes(sp.name) || d.species === DUCK ? breed : `${breed} ${sp.name}`;
  return `${coat}${pat} ${tail}`.replace(/\s+/g, " ").trim();
}

/** A random (but sensible) pet of a species, or any. */
export function randomDesign(species?: number, rnd: () => number = Math.random): PetDesign {
  const pick = <T>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)];
  const sp = species ? speciesOf(species) : pick(SPECIES_LIST);
  const coat = pick(sp.coats);
  const pattern = rnd() < 0.35 ? SOLID : pick(sp.patterns);
  const pcs = sp.patternColors.filter((c) => c !== coat);
  return {
    species: sp.id,
    breed: Math.floor(rnd() * sp.breeds.length),
    coat,
    pattern,
    patternColor: pick(pcs.length ? pcs : sp.patternColors),
    eyes: pick(sp.eyes),
    accessory: rnd() < 0.4 ? 0 : 1 + Math.floor(rnd() * (ACCESSORIES.length - 1)),
    tint: Math.floor(rnd() * TINTS.length),
  };
}

/** Pulls a design into what its species allows (after changing species). */
export function fitDesign(d: PetDesign): PetDesign {
  const sp = speciesOf(d.species);
  return {
    ...d,
    breed: Math.min(d.breed, sp.breeds.length - 1),
    coat: sp.coats.includes(d.coat) ? d.coat : sp.coats[0],
    pattern: sp.patterns.includes(d.pattern) ? d.pattern : SOLID,
    patternColor: sp.patternColors.includes(d.patternColor) ? d.patternColor : sp.patternColors[0],
    eyes: sp.eyes.includes(d.eyes) ? d.eyes : sp.eyes[0],
  };
}

export const PATTERN = { SOLID, STRIPES, SPOTS, PATCHES, SOCKS, TUXEDO, POINTS, SADDLE };
