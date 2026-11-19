// Finds a steady tempo and where the first beat falls in a piece of music (your own files; the game's
// records are known). Pure code on a mono signal, so it runs in a Worker and in node tests.
//
// The idea: 1) an onset strength per 2.5 ms (a rise in the energy of the low band, the kick and bass,
// and of the rest), 2) fold that over every candidate tempo and see which one makes the onsets pile up
// in one place (peak against the average), 3) the beats found one by one and a straight line fitted
// through them (time = first + beat x length): the slope is the tempo, precise to a few thousandths of
// a BPM, the intercept is the grid. A tempo that drifts leaves a big scatter: low confidence.

export interface Tempo {
  /** Beats per minute, steady for the whole piece. */
  bpm: number;
  /** Seconds into the piece where a beat falls, the first with a real onset (a cue point for the grid). */
  firstBeat: number;
  /** 0...1: how steady and clear the beat is. Below about 0.25 the grid is probably wrong (a third of the wrong ones are there): show it as unsure. */
  confidence: number;
  /** What the confidence is made of (for tuning): the share of beats on the line, their scatter in ms, and how sharply the onsets pile up. */
  detail?: { inside: number; spreadMs: number; sharpness: number };
}

/** Mono and, when the rate is high, decimated by averaging (kicks live far below 5 kHz): `rate` of the result is returned. */
export function monoForAnalysis(left: Float32Array, right: Float32Array, rate: number, maxRate = 12_500): { data: Float32Array; rate: number } {
  const step = Math.max(1, Math.floor(rate / maxRate));
  const n = Math.floor(Math.min(left.length, right.length) / step);
  const out = new Float32Array(n);
  const k = 0.5 / step;
  for (let i = 0; i < n; i++) {
    let s = 0;
    const from = i * step;
    for (let j = 0; j < step; j++) s += left[from + j] + right[from + j];
    out[i] = s * k;
  }
  return { data: out, rate: rate / step };
}

const HOP_SECONDS = 0.0025;

/** The onset strength of a mono signal: one value per 2.5 ms, never negative, the slow average taken out. */
export function onsetStrength(x: Float32Array, rate: number): { o: Float32Array; fps: number } {
  const hop = Math.max(1, Math.round(rate * HOP_SECONDS));
  const fps = rate / hop;
  const n = Math.floor(x.length / hop);
  const a = 1 - Math.exp(-2 * Math.PI * 180 / rate); // the low band: two one-pole filters at 180 Hz
  let lp1 = 0, lp2 = 0;
  const lowE = new Float32Array(n), highE = new Float32Array(n);
  for (let b = 0; b < n; b++) {
    let sl = 0, sh = 0;
    for (let i = b * hop, end = i + hop; i < end; i++) {
      const v = x[i];
      lp1 += a * (v - lp1);
      lp2 += a * (lp1 - lp2);
      const h = v - lp1;
      sl += lp2 * lp2;
      sh += h * h;
    }
    lowE[b] = sl / hop;
    highE[b] = sh / hop;
  }
  const o = new Float32Array(n);
  let prevL = Math.log(1e-8), prevH = Math.log(1e-8);
  for (let b = 0; b < n; b++) {
    // 5 ms windows (this block and the one before), in log: a relative rise, as loud for a soft kick as a hard one.
    const l = Math.log(1e-8 + lowE[b] + (b > 0 ? lowE[b - 1] : 0));
    const h = Math.log(1e-8 + highE[b] + (b > 0 ? highE[b - 1] : 0));
    o[b] = Math.max(0, l - prevL) + 0.5 * Math.max(0, h - prevH);
    prevL = l; prevH = h;
  }
  // Take out the slow average (about a second) and keep what stands above it.
  const w = Math.max(2, Math.round(fps * 0.5));
  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + o[i];
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const from = Math.max(0, i - w), to = Math.min(n, i + w + 1);
    const mean = (prefix[to] - prefix[from]) / (to - from);
    out[i] = Math.max(0, o[i] - mean * 1.2);
  }
  return { o: out, fps };
}

/** How sharply the onsets pile up in one place of the beat at this tempo: the peak of the folded
 * strength against its average (1 = no beat at all). Returns the score and the phase of the peak (0...1 of a beat). */
function fold(o: Float32Array, fps: number, bpm: number, bins: number, hist: Float64Array): { score: number; phase: number } {
  hist.fill(0);
  const inc = bpm / (60 * fps);
  let ph = 0, total = 0;
  for (let n = 0; n < o.length; n++) {
    const v = o[n];
    if (v > 0) { hist[Math.min(bins - 1, Math.trunc(ph * bins))] += v; total += v; }
    ph += inc;
    if (ph >= 1) ph -= 1;
  }
  if (total <= 0) return { score: 1, phase: 0 };
  let best = 0, at = 0;
  for (let b = 0; b < bins; b++) {
    const s = hist[(b + bins - 1) % bins] + 2 * hist[b] + hist[(b + 1) % bins];
    if (s > best) { best = s; at = b; }
  }
  return { score: (best / 4) / (total / bins), phase: (at + 0.5) / bins };
}

/** Prefers tempos in the middle of what dance music uses (a log-normal around 122 BPM), to choose between a tempo and its double or half. */
function prior(bpm: number): number {
  const z = Math.log2(bpm / 122) / 0.6;
  return Math.exp(-0.5 * z * z);
}

/** The strongest onset near `t` (seconds), to a fraction of a hop: [time, strength], or null. */
function peakNear(o: Float32Array, fps: number, t: number, reach: number): [number, number] | null {
  const c = Math.round(t * fps), r = Math.max(1, Math.round(reach * fps));
  let best = -1, bi = -1;
  for (let i = Math.max(1, c - r); i <= Math.min(o.length - 2, c + r); i++) {
    if (o[i] > best) { best = o[i]; bi = i; }
  }
  if (bi < 0 || best <= 0) return null;
  const a = o[bi - 1], b = o[bi], c2 = o[bi + 1];
  const d = a - 2 * b + c2;
  const frac = d < 0 ? 0.5 * (a - c2) / d : 0;
  return [(bi + Math.max(-0.5, Math.min(0.5, frac))) / fps, best];
}

/** Estimates the tempo and the first beat. `hint`: the BPM from a file's tag, used only to choose between a tempo and its double or half. */
export function analyseTempo(mono: Float32Array, rate: number, hint = 0): Tempo | null {
  // The onsets of the whole piece (a straight pass), but the tempo is found in the middle of a long one:
  // up to eight minutes, from a quarter in. The first beat is then looked for from the very start.
  const { o: all, fps } = onsetStrength(mono, rate);
  if (all.length < fps * 8) return null; // under about eight seconds: nothing to find
  const maxFrames = Math.floor(fps * 480);
  let from = 0;
  if (all.length > maxFrames) from = Math.min(Math.floor(all.length * 0.25), all.length - maxFrames);
  const o = all.subarray(from, Math.min(all.length, from + maxFrames));
  const windowStart = from / fps; // seconds of the file where the analysed window begins
  let total = 0;
  for (let i = 0; i < o.length; i++) total += o[i];
  if (total <= 0) return null;

  // Coarse: every tempo from 70 to 180 in quarter-BPM steps.
  const bins = 64;
  const hist = new Float64Array(bins);
  const scan: { bpm: number; s: number }[] = [];
  for (let bpm = 70; bpm <= 180; bpm += 0.25) scan.push({ bpm, s: fold(o, fps, bpm, bins, hist).score * prior(bpm) });
  // The best few local peaks of the scan.
  const peaks: { bpm: number; s: number }[] = [];
  for (let i = 1; i < scan.length - 1; i++) if (scan[i].s >= scan[i - 1].s && scan[i].s > scan[i + 1].s) peaks.push(scan[i]);
  peaks.sort((p, q) => q.s - p.s);
  const top = peaks.slice(0, 3);
  if (top.length === 0) return null;

  // Fine: around each, to a hundredth of a BPM; the best of them.
  let best = { bpm: top[0].bpm, s: -1, phase: 0 };
  for (const p of top) {
    for (let bpm = p.bpm - 0.4; bpm <= p.bpm + 0.4; bpm += 0.01) {
      const f = fold(o, fps, bpm, bins, hist);
      const s = f.score * prior(bpm);
      if (s > best.s) best = { bpm, s, phase: f.phase };
    }
  }
  let bpm0 = best.bpm;

  // A tag that agrees with this tempo or its double or half chooses between them; a tag that agrees with none is ignored.
  if (hint > 0) {
    let pick = bpm0, gap = Infinity;
    for (const m of [0.5, 1, 2]) {
      const g = Math.abs(bpm0 * m - hint) / hint;
      if (g < gap) { gap = g; pick = bpm0 * m; }
    }
    if (gap < 0.03) bpm0 = pick;
  }

  // Beat by beat: the strongest onset near each predicted beat, a straight line through them.
  const period = 60 / bpm0;
  const dur = o.length / fps;
  // The phase of the first fold, as a time of the first beat within [0, period).
  const first = ((best.phase * period) % period + period) % period;
  const found: { k: number; t: number; w: number }[] = [];
  for (let k = 0; first + k * period < dur - 0.05; k++) {
    const hit = peakNear(o, fps, first + k * period, Math.min(0.03, period / 6));
    if (hit) found.push({ k, t: hit[0], w: hit[1] });
  }
  if (found.length < 12) return null;
  const sorted = found.map((f) => f.w).sort((p, q) => p - q);
  const median = sorted[Math.floor(sorted.length / 2)];
  let pts = found.filter((f) => f.w >= median * 0.4);

  // A weighted least squares fit t = a + b k, twice, dropping what lies more than 12 ms from the line.
  let a = first, b = period;
  for (let pass = 0; pass < 3; pass++) {
    let sw = 0, sk = 0, st = 0, skk = 0, skt = 0;
    for (const p of pts) { sw += p.w; sk += p.w * p.k; st += p.w * p.t; skk += p.w * p.k * p.k; skt += p.w * p.k * p.t; }
    const den = sw * skk - sk * sk;
    if (den <= 0) return null;
    b = (sw * skt - sk * st) / den;
    a = (st - b * sk) / sw;
    if (pass < 2) pts = pts.filter((p) => Math.abs(p.t - (a + b * p.k)) < 0.012);
    if (pts.length < 12) return null;
  }
  const bpm = 60 / b;
  let sq = 0, sw2 = 0;
  for (const p of pts) { const r = p.t - (a + b * p.k); sq += p.w * r * r; sw2 += p.w; }
  const spread = Math.sqrt(sq / sw2);
  const inside = pts.length / found.length;
  // The first beat that really sounds (not an empty intro), on the fitted line, counted from the start of the piece.
  const strong = median * 0.6;
  // The line in the file's own time, walked back to the start of the piece: the first beat is the first
  // one with a real onset (and one of the next two), so an empty or beatless intro is skipped.
  const aFile = a + windowStart;
  const total2 = all.length / fps;
  const real = (t: number): boolean => { const hit = peakNear(all, fps, t, Math.min(0.03, b / 6)); return hit !== null && hit[1] >= strong; };
  let firstBeat = NaN;
  for (let j = Math.ceil(-aFile / b - 1e-9); aFile + j * b < total2 - 0.5; j++) {
    const t = aFile + j * b;
    if (real(t) && (real(t + b) || real(t + 2 * b))) { firstBeat = t; break; }
  }
  if (Number.isNaN(firstBeat)) { // (a tempo that wanders too much for the line to reach back): the first beat inside the window
    const firstReal = pts.find((p) => p.w >= strong) ?? pts[0];
    firstBeat = aFile + firstReal.k * b;
  }
  const confidence = Math.max(0, Math.min(1, inside * Math.exp(-Math.pow(spread / 0.008, 2)) * Math.min(1, best.s / (1.6 * prior(bpm0)))));
  return { bpm, firstBeat, confidence, detail: { inside, spreadMs: spread * 1000, sharpness: best.s / prior(bpm0) } };
}

/** How strong the onsets are on a grid: the average of the strongest onset within 10 ms of each predicted beat. A grid on the kicks scores high, one on the off-beats low. */
export function gridScore(mono: Float32Array, rate: number, bpm: number, firstBeat: number): number {
  const { o, fps } = onsetStrength(mono, rate);
  const period = 60 / bpm, dur = o.length / fps;
  let sum = 0, n = 0;
  for (let t = ((firstBeat % period) + period) % period; t < dur - 0.05; t += period) {
    const hit = peakNear(o, fps, t, 0.01);
    sum += hit ? hit[1] : 0;
    n++;
  }
  return n ? sum / n : 0;
}
