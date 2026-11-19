// The casino's jukebox: pick a song and it plays (for you, while you're in
// the casino). Four songs, synthesised on the spot (Web Audio, no files),
// each a loop of a few bars: a lounge in F with a walking bass and a
// Rhodes, a shuffling boogie-woogie, neon synthwave on four to the floor,
// and a swinging big-band vamp with horn stabs.

import { musicVolume } from "./jam";
import { Panel, button, el } from "../ui/panels";

/** A song: its tempo, swing (0 straight, ~0.6 a shuffle), and what plays on each of 16 steps a bar. */
interface Song {
  key: string;
  title: string;
  artist: string;
  bpm: number;
  swing: number;
  bars: number;
  /** Drums by step (k kick, s snare, h hat, r ride, '.' nothing), one bar repeated. */
  drums: string;
  /** The bass: a note per step (semitones over the root's A1, null: rest), for each bar. */
  bass: (number | null)[][];
  /** Each bar's chord (semitones over A3), played on the steps in `comp`. */
  chords: number[][];
  comp: number[];
  voice: "rhodes" | "piano" | "saw" | "brass";
  /** A melody over it (semitones over A4, null: rest), a note per step, for each bar (optional). */
  lead?: (number | null)[][];
  bassVoice: "upright" | "synth";
}

const A1 = 55;
const A3 = 220;
const A4 = 440;
const hz = (base: number, semis: number) => base * 2 ** (semis / 12);

const SONGS: Song[] = [
  {
    key: "lounge",
    title: "Velvet Lounge",
    artist: "The Croupiers",
    bpm: 96,
    swing: 0.55,
    bars: 4,
    drums: "r..rr..rr..rr..r",
    // Fmaj7 · Dm7 · Gm7 · C7, a walking bass.
    bass: [
      [8, null, null, null, 12, null, null, null, 15, null, null, null, 13, null, null, null],
      [5, null, null, null, 8, null, null, null, 12, null, null, null, 10, null, null, null],
      [10, null, null, null, 13, null, null, null, 17, null, null, null, 15, null, null, null],
      [3, null, null, null, 7, null, null, null, 10, null, null, null, 6, null, null, null],
    ],
    chords: [
      [8, 12, 15, 19],
      [5, 8, 12, 15],
      [10, 13, 17, 20],
      [3, 7, 10, 13],
    ],
    comp: [2, 10],
    voice: "rhodes",
    lead: [
      [null, null, 15, null, 12, null, null, null, 10, null, 12, null, null, null, null, null],
      [null, null, 8, null, 10, null, 12, null, null, null, null, null, 13, null, 12, null],
      [null, null, 17, null, 15, null, 13, null, 12, null, null, null, 10, null, null, null],
      [7, null, null, null, 10, null, 12, null, 13, null, 12, null, 10, null, null, null],
    ],
    bassVoice: "upright",
  },
  {
    key: "boogie",
    title: "Lucky Boogie",
    artist: "Seven Come Eleven",
    bpm: 132,
    swing: 0.62,
    bars: 4,
    drums: "k.h.s.h.k.h.s.h.",
    // A boogie bass in A: up the chord and back, a bar each on A, A, D, E.
    bass: [
      [0, null, 4, null, 7, null, 9, null, 10, null, 9, null, 7, null, 4, null],
      [0, null, 4, null, 7, null, 9, null, 10, null, 9, null, 7, null, 4, null],
      [5, null, 9, null, 12, null, 14, null, 15, null, 14, null, 12, null, 9, null],
      [7, null, 11, null, 14, null, 16, null, 17, null, 16, null, 14, null, 11, null],
    ],
    chords: [
      [0, 4, 7, 10],
      [0, 4, 7, 10],
      [5, 9, 12, 15],
      [7, 11, 14, 17],
    ],
    comp: [4, 12],
    voice: "piano",
    lead: [
      [12, null, 15, 16, null, 19, null, null, 16, null, 15, null, 12, null, null, null],
      [12, null, 15, 16, null, 19, null, 21, null, 19, 16, null, 15, null, 12, null],
      [17, null, null, 19, null, 21, null, null, 19, null, 17, null, 15, null, null, null],
      [19, null, 16, null, 14, null, 12, null, 11, null, 12, null, null, null, null, null],
    ],
    bassVoice: "upright",
  },
  {
    key: "neon",
    title: "Neon Nights",
    artist: "Strip Lights",
    bpm: 112,
    swing: 0,
    bars: 4,
    drums: "k.h.s.hkk.h.s.hh",
    // Am · F · C · G, driving eighths.
    bass: [
      [0, null, 0, null, 12, null, 0, null, 0, null, 0, null, 12, null, 0, 3],
      [-4, null, -4, null, 8, null, -4, null, -4, null, -4, null, 8, null, -4, -2],
      [3, null, 3, null, 15, null, 3, null, 3, null, 3, null, 15, null, 3, 5],
      [-2, null, -2, null, 10, null, -2, null, -2, null, -2, null, 10, null, 7, 5],
    ],
    chords: [
      [0, 3, 7, 12],
      [-4, 0, 3, 8],
      [3, 7, 10, 15],
      [-2, 2, 5, 10],
    ],
    comp: [0, 3, 6, 8, 11, 14],
    voice: "saw",
    lead: [
      [12, null, null, 15, null, null, 19, null, 17, null, 15, null, 14, null, 12, null],
      [12, null, null, 15, null, null, 20, null, 19, null, 17, null, 15, null, null, null],
      [15, null, null, 19, null, null, 22, null, 20, null, 19, null, 17, null, 15, null],
      [14, null, null, 17, null, null, 19, null, null, null, 17, null, 14, null, null, null],
    ],
    bassVoice: "synth",
  },
  {
    key: "swing",
    title: "High Roller",
    artist: "The Rat Pack Rats",
    bpm: 150,
    swing: 0.6,
    bars: 4,
    drums: "r..r.sr..r.sr..r",
    // D6 · B7 · E9 · A7, walking.
    bass: [
      [5, null, 9, null, 12, null, 14, null, 17, null, 14, null, 12, null, 9, null],
      [2, null, 6, null, 9, null, 11, null, 14, null, 11, null, 9, null, 6, null],
      [7, null, 11, null, 14, null, 16, null, 19, null, 16, null, 14, null, 11, null],
      [0, null, 4, null, 7, null, 9, null, 10, null, 9, null, 7, null, 4, null],
    ],
    chords: [
      [5, 9, 12, 14],
      [2, 6, 9, 12],
      [7, 11, 14, 17],
      [0, 4, 7, 10],
    ],
    comp: [6, 14],
    voice: "brass",
    lead: [
      [17, null, 19, null, 21, null, null, null, 19, null, 17, null, 14, null, null, null],
      [14, null, 18, null, 21, null, 23, null, null, null, 21, null, 18, null, null, null],
      [19, null, 23, null, 26, null, null, null, 23, null, 21, null, 19, null, null, null],
      [16, null, 19, null, 22, null, 21, null, 19, null, 16, null, 12, null, null, null],
    ],
    bassVoice: "upright",
  },
];

/** The jukebox's sound: one song looping at a time. */
export class JukeboxMusic {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private timer = 0;
  /** What's on (null: nothing). */
  playing: Song | null = null;
  onChange: () => void = () => {};

  get songs(): Song[] {
    return SONGS;
  }

  play(key: string) {
    this.stop();
    const song = SONGS.find((s) => s.key === key);
    if (!song) return;
    try {
      this.ctx = new AudioContext();
    } catch {
      return;
    }
    const ctx = this.ctx;
    // (Picked with a tap: the browser lets it play.)
    void ctx.resume().catch(() => {});
    this.out = ctx.createGain();
    this.out.gain.value = 0.28 * musicVolume();
    // A little room: a short delay fed back, low-passed.
    const delay = ctx.createDelay();
    delay.delayTime.value = 0.18;
    const fb = ctx.createGain();
    fb.gain.value = 0.22;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 2600;
    this.out.connect(ctx.destination);
    this.out.connect(delay);
    delay.connect(lp).connect(fb).connect(delay);
    lp.connect(ctx.destination);
    this.noise = ctx.createBuffer(1, ctx.sampleRate / 2, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.playing = song;
    const step = 60 / song.bpm / 4;
    const t0 = ctx.currentTime + 0.1;
    let next = 0;
    const pump = () => {
      if (!this.ctx || !this.out) return;
      this.out.gain.value = 0.28 * musicVolume();
      while (true) {
        // Swung sixteenths: every other one late.
        const t = t0 + next * step + (next % 2 ? song.swing * step * 0.5 : 0);
        if (t > this.ctx.currentTime + 0.5) break;
        this.step(song, next, t, step);
        next++;
      }
      this.timer = window.setTimeout(pump, 120);
    };
    pump();
    this.onChange();
  }

  stop() {
    window.clearTimeout(this.timer);
    void this.ctx?.close();
    this.ctx = null;
    this.out = null;
    const was = this.playing;
    this.playing = null;
    if (was) this.onChange();
  }

  private step(song: Song, n: number, t: number, len: number) {
    const s = n % 16;
    const bar = Math.floor(n / 16) % song.bars;
    const d = song.drums[s];
    if (d === "k") this.kick(t);
    if (d === "s") this.snare(t);
    if (d === "h") this.hiss(t, 0.035, 0.12, 8000);
    if (d === "r") this.hiss(t, 0.12, 0.07, 6000);
    if (song.drums[s] !== "h" && song.drums.includes("k") && s % 2 === 0) this.hiss(t, 0.03, 0.05, 9000);
    const b = song.bass[bar][s];
    if (b !== null) this.bass(t, hz(A1, b), song.bassVoice === "synth" ? len * 1.6 : len * 3.6, song.bassVoice);
    if (song.comp.includes(s)) for (const c of song.chords[bar]) this.voice(t, hz(A3, c), len * (song.voice === "saw" ? 2 : 3), song.voice, 0.06);
    const l = song.lead?.[bar][s];
    if (l !== null && l !== undefined) this.voice(t, hz(A4, l - 12), len * 2.2, song.voice === "saw" ? "saw" : song.voice === "brass" ? "brass" : "rhodes", 0.09);
  }

  private kick(t: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(130, t);
    o.frequency.exponentialRampToValueAtTime(44, t + 0.12);
    g.gain.setValueAtTime(0.75, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.24);
    o.connect(g).connect(this.out!);
    o.start(t);
    o.stop(t + 0.3);
  }

  private snare(t: number) {
    this.hiss(t, 0.14, 0.28, 2400, "bandpass");
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(190, t);
    g.gain.setValueAtTime(0.18, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    o.connect(g).connect(this.out!);
    o.start(t);
    o.stop(t + 0.12);
  }

  private hiss(t: number, len: number, level: number, freq: number, type: BiquadFilterType = "highpass") {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(level, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + len);
    src.connect(f).connect(g).connect(this.out!);
    src.start(t);
    src.stop(t + len + 0.02);
  }

  private bass(t: number, f: number, len: number, voice: Song["bassVoice"]) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = voice === "synth" ? "sawtooth" : "triangle";
    o.frequency.value = f;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = voice === "synth" ? 600 : 420;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(voice === "synth" ? 0.32 : 0.42, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + len);
    o.connect(lp).connect(g).connect(this.out!);
    o.start(t);
    o.stop(t + len + 0.05);
  }

  /** A chord tone or a melody note in one of the voices. */
  private voice(t: number, f: number, len: number, voice: Song["voice"], level: number) {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    const parts: OscillatorType[] = voice === "rhodes" ? ["sine", "triangle"] : voice === "piano" ? ["triangle", "square"] : voice === "saw" ? ["sawtooth", "sawtooth"] : ["square", "sawtooth"];
    lp.frequency.value = voice === "rhodes" ? 1800 : voice === "piano" ? 2400 : voice === "saw" ? 1500 : 2000;
    parts.forEach((type, i) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f * (i ? (voice === "saw" ? 1.006 : 2) : 1);
      const og = ctx.createGain();
      og.gain.value = i ? 0.35 : 1;
      o.connect(og).connect(lp);
      o.start(t);
      o.stop(t + len + 0.1);
    });
    const attack = voice === "brass" ? 0.04 : voice === "saw" ? 0.02 : 0.005;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(level, t + attack);
    g.gain.exponentialRampToValueAtTime(0.001, t + len);
    lp.connect(g).connect(this.out!);
  }
}

/** The jukebox's window: the songs on its cards, what's playing, stop. */
export class JukeboxPanel extends Panel {
  constructor(private music: JukeboxMusic) {
    super("🎵 Jukebox", "jukebox");
    music.onChange = () => this.open && this.render();
  }

  render() {
    this.body.replaceChildren();
    const now = this.music.playing;
    this.body.append(el("p", "hint", now ? `♪ Now playing: ${now.title} · ${now.artist}` : "Pick a song. It plays while you're in the casino."));
    const list = el("div", "jukebox-songs");
    for (const s of this.music.songs) {
      const on = now?.key === s.key;
      const b = button("", () => (on ? this.music.stop() : this.music.play(s.key)), on ? "jukebox-song on" : "jukebox-song");
      b.append(el("span", "jukebox-title", s.title), el("span", "jukebox-artist", s.artist), el("span", "jukebox-play", on ? "■" : "▶"));
      list.append(b);
    }
    this.body.append(list);
    if (now) this.body.append(button("Stop the music", () => this.music.stop(), "subtle"));
  }
}
