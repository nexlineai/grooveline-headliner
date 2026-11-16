#!/usr/bin/env node
// Synthesizes the game's original records. No samples, no outside audio: every sound is
// computed here, so the music is ours to ship.
//
//   node tools/music/make.mjs            all tracks
//   node tools/music/make.mjs low-tide   one track
//
// Output: App/Tracks/<id>.m4a (AAC, -14 LUFS) and App/Tracks/tracks.json.
// Every track starts with a kick on its very first sample: the app finds that kick when it
// loads the file and starts the beat grid there, so the codec's padding cannot shift the grid.
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SR = 44100;
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const outDir = join(root, 'App', 'Tracks');

// ---------- the records ----------
// root: MIDI note of the key. chords: semitones above the root, one chord per bar, looped.
// Rhythms are 16 steps per bar; a number is how hard the step is hit, 0 is a rest.
// bass: semitones above the bar's chord root, null is a rest.
const TRACKS = [
  {
    id: 'saturday-job', title: 'Saturday Job', artist: 'Sol Poente', label: 'Rua Baixa',
    genre: 'Deep House', bpm: 122, root: 57, key: 'A minor', camelot: '8A', seed: 11, swing: 0.13,
    chords: [[0, 3, 7, 10], [0, 3, 7, 10], [-4, 0, 3, 7], [-2, 2, 5, 7]],
    chordRhythm: [0, 0, 0, 0.9, 0, 0, 0.7, 0, 0, 0, 0, 0.8, 0, 0, 0, 0.5],
    bass: [0, null, null, 0, null, null, 12, null, 0, null, null, 0, null, 10, null, 7],
    bassOct: -24,
    style: { chordCut: 2600, chordFloor: 300, chordQ: 1.6, chordDecay: 0.2, sweep: 0.25,
             delayBeats: 0.75, delayFb: 0.38, delayWet: 0.3, reverb: 0.22,
             pad: 0.16, openHat: 0.4, closedHat: 0.26, clap: 0.42, bassCut: 420, hiss: 0 },
  },
  {
    id: 'low-tide', title: 'Low Tide', artist: 'Marea', label: 'Cais Dub',
    genre: 'Dub Techno', bpm: 124, root: 50, key: 'D minor', camelot: '7A', seed: 23, swing: 0.05,
    chords: [[0, 3, 7, 10, 14]],
    chordRhythm: [0, 0, 0.9, 0, 0, 0, 0, 0, 0, 0.55, 0, 0, 0, 0, 0, 0],
    bass: [0, null, null, null, null, null, 0, null, null, null, 0, null, null, null, null, null],
    bassOct: -12,
    style: { chordCut: 1700, chordFloor: 220, chordQ: 2.4, chordDecay: 0.34, sweep: 0.6,
             delayBeats: 0.75, delayFb: 0.62, delayWet: 0.5, reverb: 0.38,
             pad: 0.1, openHat: 0.3, closedHat: 0.2, clap: 0.26, bassCut: 300, hiss: 0.012 },
  },
];

// Bars per section and what plays in it. Every section but the last ends with a one-bar
// fill (no kick on the last beat, a rising noise) so the phrase change can be heard coming.
const ARRANGEMENT = [
  { name: 'intro', bars: 8, on: ['kick', 'hat'] },
  { name: 'intro 2', bars: 8, on: ['kick', 'hat', 'ohat', 'clap'] },
  { name: 'groove', bars: 16, on: ['kick', 'hat', 'ohat', 'clap', 'bass', 'chord'] },
  { name: 'full', bars: 16, on: ['kick', 'hat', 'ohat', 'clap', 'bass', 'chord', 'pad'] },
  { name: 'break', bars: 8, on: ['hat', 'chord', 'pad'] },
  { name: 'full 2', bars: 16, on: ['kick', 'hat', 'ohat', 'clap', 'bass', 'chord', 'pad'] },
  { name: 'outro', bars: 8, on: ['kick', 'hat', 'ohat', 'clap', 'bass'] },
  { name: 'outro 2', bars: 8, on: ['kick', 'hat'] },
];

// ---------- small DSP kit ----------
function rng(seed) { // mulberry32
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hz = (m) => 440 * 2 ** ((m - 69) / 12);

class Biquad {
  constructor(type, f, q = 0.707) {
    const w = 2 * Math.PI * f / SR, c = Math.cos(w), al = Math.sin(w) / (2 * q);
    let b0, b1, b2;
    if (type === 'hp') { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = b0; }
    else if (type === 'lp') { b0 = (1 - c) / 2; b1 = 1 - c; b2 = b0; }
    else { b0 = al; b1 = 0; b2 = -al; }
    const a0 = 1 + al;
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0;
    this.a1 = -2 * c / a0; this.a2 = (1 - al) / a0;
    this.x1 = this.x2 = this.y1 = this.y2 = 0;
  }
  run(x) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
  }
}

class SVF { // state-variable low-pass that stays stable while its cutoff moves
  constructor() { this.a = 0; this.b = 0; this.set(1000, 1); }
  set(fc, q) {
    const g = Math.tan(Math.PI * Math.min(Math.max(fc, 20), SR * 0.45) / SR), k = 1 / q;
    this.a1 = 1 / (1 + g * (g + k)); this.a2 = g * this.a1; this.a3 = g * this.a2;
  }
  lp(x) {
    const v3 = x - this.b, v1 = this.a1 * this.a + this.a2 * v3, v2 = this.b + this.a2 * this.a + this.a3 * v3;
    this.a = 2 * v1 - this.a; this.b = 2 * v2 - this.b;
    return v2;
  }
}

function saw(freq, cents = 0, phase = 0) { // band-limited (polyBLEP) sawtooth
  let ph = phase;
  const dt = freq * 2 ** (cents / 1200) / SR;
  return () => {
    ph += dt; if (ph >= 1) ph -= 1;
    let v = 2 * ph - 1;
    if (ph < dt) { const t = ph / dt; v -= t + t - t * t - 1; }
    else if (ph > 1 - dt) { const t = (ph - 1) / dt; v -= t * t + t + t + 1; }
    return v;
  };
}

const bus = (n) => ({ L: new Float32Array(n), R: new Float32Array(n) });

// ---------- instruments ----------
function kick(b, t0, amp) {
  const n = Math.floor(0.34 * SR);
  let ph = 0;
  for (let i = 0; i < n && t0 + i < b.L.length; i++) {
    const t = i / SR;
    ph += 2 * Math.PI * (46 + 105 * Math.exp(-t * 36) + 420 * Math.exp(-t * 320)) / SR;
    const env = Math.exp(-t * 9) * (1 - Math.exp(-t * 6000));
    const y = amp * Math.tanh(1.9 * Math.sin(ph)) * env;
    b.L[t0 + i] += y; b.R[t0 + i] += y;
  }
}

function hat(b, t0, amp, decay, rnd, pan = 0) {
  const n = Math.floor(decay * 6 * SR), f = new Biquad('hp', 7800, 0.9), f2 = new Biquad('hp', 5200, 0.7);
  const l = amp * (1 - pan * 0.5), r = amp * (1 + pan * 0.5);
  for (let i = 0; i < n && t0 + i < b.L.length; i++) {
    const y = f2.run(f.run(rnd() * 2 - 1)) * Math.exp(-(i / SR) / decay);
    b.L[t0 + i] += y * l; b.R[t0 + i] += y * r;
  }
}

function clap(b, t0, amp, rnd) {
  const n = Math.floor(0.3 * SR), f = new Biquad('bp', 1350, 1.1), f2 = new Biquad('hp', 600, 0.7);
  for (let i = 0; i < n && t0 + i < b.L.length; i++) {
    const t = i / SR;
    let env = 0;
    for (const d of [0, 0.011, 0.023]) if (t >= d) env = Math.max(env, Math.exp(-(t - d) * 190));
    env = Math.max(env * 0.9, t >= 0.023 ? Math.exp(-(t - 0.023) * 22) * 0.7 : 0);
    const y = f2.run(f.run(rnd() * 2 - 1)) * env * amp * 3;
    b.L[t0 + i] += y; b.R[t0 + i] += y;
  }
}

function bassNote(b, t0, m, len, amp, cut) {
  const n = Math.floor((len + 0.06) * SR), o = saw(hz(m)), f = new SVF(), w = 2 * Math.PI * hz(m) / SR;
  let ph = 0;
  for (let i = 0; i < n && t0 + i < b.L.length; i++) {
    const t = i / SR;
    if ((i & 15) === 0) f.set(60 + cut * (0.45 + 1.6 * Math.exp(-t * 13)), 1.5);
    ph += w;
    const env = Math.min(1, t * 350) * (t < len ? 1 : Math.exp(-(t - len) * 70));
    const y = f.lp(0.5 * o() + 0.8 * Math.sin(ph)) * env * amp;
    b.L[t0 + i] += y; b.R[t0 + i] += y;
  }
}

function stab(b, t0, notes, amp, st, open, rnd) {
  const n = Math.floor((st.chordDecay * 4 + 0.05) * SR), f = new SVF(), oscs = [];
  for (const m of notes) for (const d of [-8, 8]) oscs.push(saw(hz(m), d + (rnd() - 0.5) * 5, rnd()));
  for (let i = 0; i < n && t0 + i < b.L.length; i++) {
    const t = i / SR;
    if ((i & 15) === 0) f.set(st.chordFloor + st.chordCut * open * Math.exp(-t / st.chordDecay), st.chordQ);
    let x = 0;
    for (const o of oscs) x += o();
    const y = f.lp(x / oscs.length) * Math.exp(-t / (st.chordDecay * 1.3)) * Math.min(1, t * 500) * amp;
    b.L[t0 + i] += y; b.R[t0 + i] += y;
  }
}

function pad(b, t0, notes, len, amp, rnd) {
  const n = Math.floor((len + 0.6) * SR), fl = new SVF(), fr = new SVF(), L = [], R = [];
  fl.set(850, 0.8); fr.set(950, 0.8);
  for (const m of notes) { L.push(saw(hz(m), -11, rnd())); R.push(saw(hz(m), 11, rnd())); L.push(saw(hz(m + 12), 5, rnd())); R.push(saw(hz(m + 12), -5, rnd())); }
  for (let i = 0; i < n && t0 + i < b.L.length; i++) {
    const t = i / SR;
    const env = Math.min(1, t / 0.5) * (t < len ? 1 : Math.exp(-(t - len) * 4));
    let l = 0, r = 0;
    for (const o of L) l += o();
    for (const o of R) r += o();
    b.L[t0 + i] += fl.lp(l / L.length) * env * amp;
    b.R[t0 + i] += fr.lp(r / R.length) * env * amp;
  }
}

function riser(b, t0, len, amp, rnd) {
  const n = Math.floor(len * SR), f = new SVF();
  for (let i = 0; i < n && t0 + i < b.L.length; i++) {
    const p = i / n;
    if ((i & 31) === 0) f.set(300 + 7000 * p * p, 2.5);
    const x = rnd() * 2 - 1, y = (x - f.lp(x)) * p * p * amp; // high-pass = input minus low-pass
    b.L[t0 + i] += y; b.R[t0 + i] += y * 0.9;
  }
}

// ---------- effects ----------
function pingPong(b, delaySamples, fb, wet) {
  const d = Math.max(1, Math.round(delaySamples)), dl = new Float32Array(d), dr = new Float32Array(d);
  let i = 0, lpL = 0, lpR = 0;
  for (let k = 0; k < b.L.length; k++) {
    const input = (b.L[k] + b.R[k]) * 0.5, oL = dl[i], oR = dr[i];
    lpL += (oL - lpL) * 0.35; lpR += (oR - lpR) * 0.35; // each echo comes back a little duller
    dl[i] = input + lpR * fb; dr[i] = lpL;
    b.L[k] += lpL * wet; b.R[k] += lpR * wet;
    i = (i + 1) % d;
  }
}

function reverb(b, wet, room = 0.86, damp = 0.35) {
  const combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617], aps = [556, 441, 341, 225];
  const mk = (off) => ({ c: combs.map((n) => ({ buf: new Float32Array(n + off), i: 0, fs: 0 })), a: aps.map((n) => ({ buf: new Float32Array(n + off), i: 0 })) });
  const chans = [mk(0), mk(23)];
  for (let k = 0; k < b.L.length; k++) {
    const input = (b.L[k] + b.R[k]) * 0.015, out = [0, 0];
    for (let ch = 0; ch < 2; ch++) {
      let acc = 0;
      for (const c of chans[ch].c) {
        const y = c.buf[c.i];
        c.fs = y * (1 - damp) + c.fs * damp;
        c.buf[c.i] = input + c.fs * room;
        c.i = (c.i + 1) % c.buf.length;
        acc += y;
      }
      for (const a of chans[ch].a) {
        const y = a.buf[a.i], o = y - acc;
        a.buf[a.i] = acc + y * 0.5;
        a.i = (a.i + 1) % a.buf.length;
        acc = o;
      }
      out[ch] = acc;
    }
    b.L[k] += out[0] * wet; b.R[k] += out[1] * wet;
  }
}

// ---------- one track ----------
function render(tr) {
  const rnd = rng(tr.seed), st = tr.style;
  const beat = 60 / tr.bpm, step = beat / 4, barLen = beat * 4;
  const bars = ARRANGEMENT.reduce((a, s) => a + s.bars, 0);
  const N = Math.ceil((bars * barLen + 0.02) * SR); // the last sound stops with the last bar
  const drums = bus(N), low = bus(N), keys = bus(N), air = bus(N);
  const duck = new Float32Array(N).fill(1);
  const at = (bar, s) => Math.round(((bar * 16 + s) * step + (s % 2 ? tr.swing * step : 0)) * SR);

  let bar = 0;
  ARRANGEMENT.forEach((sec, si) => {
    const has = (x) => sec.on.includes(x);
    for (let k = 0; k < sec.bars; k++, bar++) {
      const fill = k === sec.bars - 1 && si < ARRANGEMENT.length - 1;
      const chord = tr.chords[bar % tr.chords.length];
      const open = 1 - st.sweep * (0.5 + 0.5 * Math.cos(2 * Math.PI * bar / 16)); // the filter breathes every 16 bars
      for (let s = 0; s < 16; s++) {
        const t0 = at(bar, s);
        if (has('kick') && s % 4 === 0 && !(fill && s === 12)) {
          kick(drums, t0, 0.95);
          const n = Math.floor(0.3 * SR);
          for (let i = 0; i < n && t0 + i < N; i++) duck[t0 + i] = Math.min(duck[t0 + i], 1 - 0.6 * Math.exp(-(i / SR) * 11));
        }
        if (has('hat')) hat(drums, t0, st.closedHat * (s % 4 === 2 ? 1 : 0.55) * (0.85 + 0.3 * rnd()), 0.012, rnd, s % 2 ? 0.4 : -0.3);
        if (has('ohat') && s % 4 === 2) hat(drums, t0, st.openHat, 0.05, rnd, 0.2);
        if (has('clap') && s % 8 === 4) clap(drums, t0, st.clap, rnd);
        if (has('bass') && tr.bass[s] != null) {
          let len = step * 0.9;
          for (let j = s + 1; j < 16 && tr.bass[j] == null && len < step * 2.6; j++) len += step;
          bassNote(low, t0, tr.root + tr.bassOct + chord[0] + tr.bass[s], len, 0.5, st.bassCut);
        }
        if (has('chord') && tr.chordRhythm[s] > 0)
          stab(keys, t0, chord.map((c) => tr.root + 12 + c), tr.chordRhythm[s] * 0.42, st, open * (sec.name === 'break' ? 1.25 : 1), rnd);
      }
      if (has('pad')) pad(air, at(bar, 0), chord.slice(0, 4).map((c) => tr.root + c), barLen, st.pad, rnd);
      if (fill) riser(air, at(bar, 0), barLen, 0.1, rnd);
    }
  });

  pingPong(keys, st.delayBeats * beat * SR, st.delayFb, st.delayWet);
  reverb(keys, st.reverb);
  reverb(air, st.reverb * 0.8);

  const hissF = new Biquad('bp', 5200, 0.5);
  const mix = bus(N);
  let peak = 0;
  for (let i = 0; i < N; i++) {
    const d = duck[i], hiss = st.hiss ? hissF.run(rnd() * 2 - 1) * st.hiss * (0.7 + 0.3 * Math.sin(i / SR * 0.7)) : 0;
    const l = drums.L[i] + low.L[i] * d + (keys.L[i] + air.L[i]) * (0.35 + 0.65 * d) + hiss;
    const r = drums.R[i] + low.R[i] * d + (keys.R[i] + air.R[i]) * (0.35 + 0.65 * d) + hiss;
    mix.L[i] = Math.tanh(l * 1.15); mix.R[i] = Math.tanh(r * 1.15);
    peak = Math.max(peak, Math.abs(mix.L[i]), Math.abs(mix.R[i]));
  }
  // The file ends on the bar line; a 30 ms fade keeps the cut silent.
  const fade = Math.floor(0.03 * SR), g = 0.89 / peak;
  for (let i = 0; i < N; i++) {
    const f = i > N - fade ? (N - i) / fade : 1;
    mix.L[i] *= g * f; mix.R[i] *= g * f;
  }
  return { mix, bars, seconds: N / SR };
}

function wav(mix) {
  const n = mix.L.length, buf = Buffer.alloc(44 + n * 4);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, mix.L[i])) * 32767), 44 + i * 4);
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, mix.R[i])) * 32767), 46 + i * 4);
  }
  return buf;
}

function loudness(file) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', 'loudnorm=I=-14:TP=-1:print_format=json', '-f', 'null', '-'], { encoding: 'utf8' });
  const m = r.stderr.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('ffmpeg loudness scan failed: ' + r.stderr.slice(-300));
  const j = JSON.parse(m[0]);
  return { lufs: parseFloat(j.input_i), peak: parseFloat(j.input_tp) };
}

mkdirSync(outDir, { recursive: true });
const only = process.argv[2];
const listFile = join(outDir, 'tracks.json');
const list = existsSync(listFile) ? JSON.parse(readFileSync(listFile, 'utf8')) : [];
for (const tr of TRACKS) {
  if (only && tr.id !== only) continue;
  const t0 = Date.now();
  const { mix, bars, seconds } = render(tr);
  const tmp = join(outDir, tr.id + '.tmp.wav'), out = join(outDir, tr.id + '.m4a');
  writeFileSync(tmp, wav(mix));
  const before = loudness(tmp);
  const gain = Math.min(-14 - before.lufs, -1 - before.peak); // to -14 LUFS, never past -1 dB true peak
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', tmp, '-af', `volume=${gain.toFixed(2)}dB`,
    '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', out]);
  rmSync(tmp);
  const after = loudness(out);
  const entry = { id: tr.id, title: tr.title, artist: tr.artist, label: tr.label, genre: tr.genre, bpm: tr.bpm,
    key: tr.key, camelot: tr.camelot, bars, seconds: Math.round(seconds * 100) / 100, file: tr.id + '.m4a' };
  const at = list.findIndex((x) => x.id === tr.id);
  if (at >= 0) list[at] = entry; else list.push(entry);
  console.log(`${tr.id}: ${bars} bars, ${seconds.toFixed(1)} s, ${after.lufs} LUFS, peak ${after.peak} dB, ${((Date.now() - t0) / 1000).toFixed(1)} s to make`);
}
writeFileSync(listFile, JSON.stringify(list, null, 2) + '\n');
