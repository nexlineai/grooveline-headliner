#!/usr/bin/env node
// Synthesizes the game's original records. No samples, no outside audio: every sound is
// computed here, so the music is ours to ship.
//
//   node tools/music/make.mjs low-tide [squelch ...]   the named tracks
//   node tools/music/make.mjs --all                   every track (re-renders the approved ones too)
//
// Output: App/Tracks/<id>.m4a (AAC, -14 LUFS) and App/Tracks/tracks.json.
// Every track starts with a kick on its very first sample: the app finds that kick when it
// loads the file and starts the beat grid there, so the codec's padding cannot shift the grid.
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
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
  {
    id: 'bairro-lights', title: 'Bairro Lights', artist: 'Dona Lua', label: 'Rua Baixa',
    genre: 'Soulful House', bpm: 120, root: 48, key: 'C minor', camelot: '5A', seed: 41, swing: 0.16,
    chords: [[0, 3, 7, 10, 14], [-4, 0, 3, 7, 10], [5, 8, 12, 15], [-5, -1, 2, 5]],
    chordRhythm: [0.9, 0, 0, 0, 0, 0, 0.6, 0, 0, 0.7, 0, 0, 0, 0, 0.5, 0],
    bass: [0, null, null, 12, null, null, 0, null, null, 7, null, null, 0, null, 10, null],
    bassOct: -12,
    style: { chordCut: 2900, chordFloor: 350, chordQ: 1.4, chordDecay: 0.28, sweep: 0.2,
             delayBeats: 0.75, delayFb: 0.3, delayWet: 0.25, reverb: 0.28,
             pad: 0.2, openHat: 0.38, closedHat: 0.24, clap: 0.4, bassCut: 460, hiss: 0 },
  },
  {
    id: 'miradouro', title: 'Miradouro', artist: 'Os Sete Colinas', label: 'Fita Dourada',
    genre: 'Disco House', bpm: 118, root: 52, key: 'E minor', camelot: '9A', seed: 67, swing: 0.08,
    chords: [[0, 3, 7, 10], [-4, 0, 3, 7], [3, 7, 10, 14], [-2, 2, 5, 7]],
    chordRhythm: [0, 0, 0.8, 0, 0, 0, 0.7, 0, 0, 0, 0.8, 0, 0, 0, 0.7, 0.4],
    bass: [0, null, 12, null, 0, null, 12, null, 0, null, 12, null, 0, null, 12, 10],
    bassOct: -12,
    style: { chordCut: 3400, chordFloor: 500, chordQ: 1.3, chordDecay: 0.16, sweep: 0.15,
             delayBeats: 0.75, delayFb: 0.25, delayWet: 0.18, reverb: 0.2,
             pad: 0.18, openHat: 0.45, closedHat: 0.22, clap: 0.46, bassCut: 600, hiss: 0 },
  },
  {
    id: 'night-bus', title: 'Night Bus', artist: 'Tejo Line', label: 'Cais Dub',
    genre: 'Tech House', bpm: 126, root: 53, key: 'F minor', camelot: '4A', seed: 37, swing: 0.1,
    chords: [[0, 3, 7, 10], [0, 3, 7, 10], [5, 8, 12, 15], [3, 7, 10, 14]],
    chordRhythm: [0, 0, 0.8, 0, 0, 0.6, 0, 0, 0.8, 0, 0, 0.6, 0, 0, 0.7, 0],
    bass: [0, null, 0, null, null, 0, null, 12, 0, null, 0, null, null, 7, null, 10],
    bassOct: -12,
    style: { chordCut: 3200, chordFloor: 400, chordQ: 2.0, chordDecay: 0.12, sweep: 0.3,
             delayBeats: 0.5, delayFb: 0.3, delayWet: 0.2, reverb: 0.15,
             pad: 0.08, openHat: 0.42, closedHat: 0.3, clap: 0.45, bassCut: 520, hiss: 0 },
  },
  {
    id: 'foundry', title: 'Foundry', artist: 'Kiln', label: 'Betão',
    genre: 'Techno', bpm: 128, root: 55, key: 'G minor', camelot: '6A', seed: 53, swing: 0.02,
    chords: [[0, 7, 10, 15]],
    chordRhythm: [0, 0, 0, 0, 0, 0, 0.9, 0, 0, 0, 0, 0, 0, 0.6, 0, 0],
    bass: [null, 0, 0, 0, null, 0, 0, 0, null, 0, 0, 0, null, 0, 0, 12],
    bassOct: -24,
    arrangement: 'long',
    style: { chordCut: 1400, chordFloor: 200, chordQ: 3.0, chordDecay: 0.4, sweep: 0.7,
             delayBeats: 0.75, delayFb: 0.55, delayWet: 0.45, reverb: 0.42,
             pad: 0.06, openHat: 0.36, closedHat: 0.3, clap: 0.2, bassCut: 260, hiss: 0.01 },
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
// A DJ tool: sixteen bars of drums at each end to mix in and out of, and a longer breakdown.
const ARRANGEMENT_LONG = [
  { name: 'intro', bars: 16, on: ['kick', 'hat'] },
  { name: 'intro 2', bars: 16, on: ['kick', 'hat', 'ohat', 'clap', 'bass'] },
  { name: 'groove', bars: 16, on: ['kick', 'hat', 'ohat', 'clap', 'bass', 'chord'] },
  { name: 'full', bars: 16, on: ['kick', 'hat', 'ohat', 'clap', 'bass', 'chord', 'pad'] },
  { name: 'break', bars: 16, on: ['hat', 'chord', 'pad'] },
  { name: 'full 2', bars: 16, on: ['kick', 'hat', 'ohat', 'clap', 'bass', 'chord', 'pad'] },
  { name: 'outro', bars: 16, on: ['kick', 'hat', 'ohat', 'clap', 'bass'] },
  { name: 'outro 2', bars: 16, on: ['kick', 'hat'] },
];

// ---------- chapter 2: house parties ----------
// Six records with sounds of their own (kit), drum patterns of their own (drums: 16 steps, the
// number is how hard), their own order of sections and their own mix. Same rules as above:
// a kick on the very first sample, sections in eights, the last bar of each a fill, straight
// 4/4 kicks at both ends so they can be beatmatched by ear.
const S = (name, bars, on) => ({ name, bars, on: on.split(' ') });
const x4 = (a) => [...a, ...a, ...a, ...a];
const CHAPTER2 = [
  {
    id: 'telhado', title: 'Telhado', artist: 'Organo Rua', label: 'Fita Dourada', chapter: 2,
    genre: 'Organ House', bpm: 124, root: 58, key: 'B♭ minor', camelot: '3A', seed: 71, swing: 0.1,
    chords: [[0, 3, 7, 10], [-4, 0, 3, 7], [-2, 2, 5, 9], [-5, -2, 2, 5]],
    chordRhythm: [0, 0, 0.9, 0, 0, 0, 0.8, 0, 0, 0, 0.9, 0, 0, 0.6, 0, 0.7],
    bass: [0, null, null, null, null, null, 12, null, 0, null, null, 7, null, null, 12, null], bassOct: -24,
    kit: { kick: 'punch', hat: 'metal', snare: 'clap', chord: 'organ', bass: 'organ', chordOct: 0 },
    drums: { hat: x4([0, 0.45, 0, 0.6]), ohat: x4([0, 0, 1, 0]), clap: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0.35],
             perc: { shaker: x4([0.5, 0.3, 0.6, 0.3]), cowbell: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.5, 0, 0, 0, 0] } },
    style: { sweep: 0.2, delayBeats: 0.75, delayFb: 0.3, delayWet: 0.2, reverb: 0.2, pad: 0.12,
             openHat: 0.35, closedHat: 0.3, clap: 0.44, perc: 0.3, hiss: 0 },
    mix: { duck: 0.5, drive: 1.3 },
    sections: [S('intro', 8, 'kick hat perc'), S('intro 2', 8, 'kick hat ohat clap perc'),
               S('groove', 16, 'kick hat ohat clap perc bass chord'), S('break', 8, 'chord pad hat'),
               S('full', 16, 'kick hat ohat clap perc bass chord pad'), S('full 2', 8, 'kick hat ohat clap perc bass chord'),
               S('outro', 8, 'kick hat ohat clap bass'), S('outro 2', 8, 'kick hat')],
  },
  {
    id: 'squelch', title: 'Squelch', artist: 'Linha 303', label: 'Betão', chapter: 2,
    genre: 'Acid House', bpm: 125, root: 54, key: 'F♯ minor', camelot: '11A', seed: 83, swing: 0.04,
    chords: [[0, 3, 7, 10]], chordRhythm: x4([0, 0, 0, 0]),
    bass: [0, null, 12, 0, null, 3, 0, 15, 0, null, 10, 12, null, 7, 5, null], bassOct: -12,
    bassAccent: [1, 0, 1, 0, 0, 1, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0],
    bassSlide: [0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1, 0],
    kit: { hat: 'metal', snare: 'clap', bass: 'acid' },
    drums: { hat: x4([0.5, 0.3, 0.7, 0.3]), ohat: x4([0, 0, 1, 0]), clap: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
             perc: { rim: [0, 0, 0, 0.6, 0, 0, 0, 0, 0, 0, 0.5, 0, 0, 0, 0, 0] } },
    style: { sweep: 0.6, acidCut: 260, acidEnv: 2400, acidQ: 7, delayBeats: 0.75, delayFb: 0.45, delayWet: 0.25,
             reverb: 0.18, pad: 0.06, openHat: 0.32, closedHat: 0.26, clap: 0.4, perc: 0.3, hiss: 0 },
    mix: { duck: 0.45, drive: 1.4 },
    sections: [S('intro', 16, 'kick hat'), S('intro 2', 8, 'kick hat ohat clap perc'),
               S('acid', 16, 'kick hat ohat clap perc bass'), S('break', 8, 'bass hat pad'),
               S('full', 16, 'kick hat ohat clap perc bass pad'), S('outro', 8, 'kick hat ohat clap bass'),
               S('outro 2', 8, 'kick hat')],
  },
  {
    id: 'garage-door', title: 'Garage Door', artist: 'Os Primos', label: 'Rua Baixa', chapter: 2,
    genre: 'Deep House', bpm: 121, root: 51, key: 'E♭ minor', camelot: '2A', seed: 97, swing: 0.2,
    chords: [[0, 3, 7, 10, 14], [-4, 0, 3, 7, 10], [-2, 2, 5, 9], [5, 8, 12, 15]],
    chordRhythm: [0.8, 0, 0, 0, 0, 0, 0, 0.5, 0, 0, 0.7, 0, 0, 0, 0, 0],
    bass: [0, null, null, null, null, null, null, 12, null, null, 0, null, null, 7, null, null], bassOct: -12,
    kit: { kick: 'deep', hat: 'shaker', ohat: 'metal', snare: 'rim', chord: 'rhodes', bass: 'sub', chordOct: 0 },
    drums: { hat: x4([0.7, 0.3, 0.5, 0.35]), ohat: x4([0, 0, 0.8, 0]), clap: [0, 0, 0, 0, 1, 0, 0, 0.3, 0, 0, 0, 0, 1, 0, 0.4, 0],
             perc: { congaLo: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.5, 0, 0, 0, 0, 0] } },
    style: { sweep: 0.2, delayBeats: 0.75, delayFb: 0.35, delayWet: 0.3, reverb: 0.32, pad: 0.16,
             openHat: 0.22, closedHat: 0.3, clap: 0.45, perc: 0.3, hiss: 0.006 },
    mix: { duck: 0.55, drive: 1.1 },
    sections: [S('intro', 8, 'kick hat clap'), S('intro 2', 8, 'kick hat ohat clap perc bass'),
               S('groove', 16, 'kick hat ohat clap perc bass chord'), S('break', 16, 'chord pad hat'),
               S('full', 16, 'kick hat ohat clap perc bass chord pad'), S('outro', 8, 'kick hat ohat clap bass'),
               S('outro 2', 8, 'kick hat')],
  },
  {
    id: 'conga-line', title: 'Conga Line', artist: 'Batucada FM', label: 'Cais Dub', chapter: 2,
    genre: 'Tribal House', bpm: 126, root: 49, key: 'C♯ minor', camelot: '12A', seed: 109, swing: 0.08,
    chords: [[0, 3, 7, 10]], chordRhythm: x4([0, 0, 0, 0]),
    bass: [0, null, null, 0, null, null, 0, null, null, 0, null, null, 3, null, null, null], bassOct: -12,
    vox: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0.6, 0], vowel: 'hey', voxOct: 12, voxLen: 0.16,
    kit: { kick: 'punch', snare: 'snare', bass: 'sub' },
    drums: { hat: x4([0.5, 0.4, 0.8, 0.4]), ohat: [0, 0, 0, 0, 0, 0, 0.7, 0, 0, 0, 0, 0, 0, 0, 0.7, 0],
             clap: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.7, 0, 0, 0],
             perc: { congaHi: [0, 0, 0.7, 0, 0, 0.5, 0, 0.8, 0, 0, 0.7, 0, 0, 0.6, 0.5, 0],
                     congaLo: [0, 0, 0, 0.6, 0, 0, 0, 0, 0, 0.7, 0, 0.5, 0, 0, 0, 0.8],
                     cowbell: [0, 0, 0, 0, 0, 0, 0.6, 0, 0, 0, 0, 0, 0, 0, 0, 0.5], shaker: x4([0.4, 0.2, 0.5, 0.2]) } },
    style: { sweep: 0.3, delayBeats: 0.75, delayFb: 0.4, delayWet: 0.3, reverb: 0.22, pad: 0.08,
             openHat: 0.3, closedHat: 0.22, clap: 0.4, perc: 0.45, vox: 0.35, hiss: 0 },
    mix: { duck: 0.5, drive: 1.35 },
    sections: [S('intro', 8, 'kick hat perc'), S('intro 2', 8, 'kick hat ohat perc clap'),
               S('drums', 16, 'kick hat ohat clap perc bass'), S('voices', 16, 'kick hat ohat clap perc bass vox'),
               S('break', 8, 'perc vox pad hat'), S('full', 16, 'kick hat ohat clap perc bass vox'),
               S('outro', 8, 'kick hat perc')],
  },
  {
    id: 'neon-pluck', title: 'Neon Pluck', artist: 'Marta Vidro', label: 'Fita Dourada', chapter: 2,
    genre: 'Melodic House', bpm: 123, root: 56, key: 'G♯ minor', camelot: '1A', seed: 131, swing: 0,
    chords: [[0, 3, 7, 10], [-4, 0, 3, 7], [3, 7, 10, 14], [-2, 2, 5, 9]], chordRhythm: x4([0, 0, 0, 0]),
    arp: [0, 1, 2, 3, 2, 1, 0, 1, 0, 1, 2, 3, 4, 3, 2, 1],
    bass: [0, null, null, null, null, null, null, null, 0, null, null, null, null, null, 12, null], bassOct: -12,
    kit: { kick: 'deep', hat: 'metal', snare: 'clap', bass: 'reese' },
    drums: { hat: x4([0, 0.4, 0.6, 0.4]), ohat: x4([0, 0, 1, 0]), clap: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0] },
    style: { sweep: 0.5, delayBeats: 0.75, delayFb: 0.5, delayWet: 0.35, reverb: 0.38, pad: 0.2,
             openHat: 0.28, closedHat: 0.24, clap: 0.38, arp: 0.3, hiss: 0 },
    mix: { duck: 0.65, drive: 1.15 },
    sections: [S('intro', 8, 'kick hat'), S('intro 2', 8, 'kick hat ohat clap arp'),
               S('groove', 16, 'kick hat ohat clap arp bass'), S('break', 16, 'arp pad'),
               S('full', 16, 'kick hat ohat clap arp bass pad'), S('outro', 8, 'kick hat ohat clap bass'),
               S('outro 2', 8, 'kick hat')],
  },
  {
    id: 'maos-no-ar', title: 'Mãos no Ar', artist: 'Clube Sete', label: 'Rua Baixa', chapter: 2,
    genre: 'Piano House', bpm: 122, root: 59, key: 'B minor', camelot: '10A', seed: 151, swing: 0.12,
    chords: [[0, 3, 7, 10], [-4, 0, 3, 7], [-2, 2, 5, 9], [-5, -2, 2, 5]],
    chordRhythm: [0, 0, 0.8, 0, 0, 0, 0.9, 0, 0, 0, 0.8, 0, 0, 0.5, 0.9, 0],
    bass: [0, null, null, 0, null, null, 12, null, 0, null, null, 0, null, 10, null, 7], bassOct: -24,
    vox: [0.8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], vowel: 'ah', voxOct: 12, voxLen: 0.45,
    kit: { snare: 'clap', chord: 'piano', chordOct: 0 },
    drums: { perc: { rim: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.4, 0, 0, 0, 0] } },
    style: { sweep: 0.25, bassCut: 420, delayBeats: 0.75, delayFb: 0.35, delayWet: 0.22, reverb: 0.26, pad: 0.14,
             openHat: 0.38, closedHat: 0.26, clap: 0.42, perc: 0.3, vox: 0.3, hiss: 0 },
    mix: { duck: 0.6, drive: 1.2 },
    sections: [S('intro', 8, 'kick hat'), S('intro 2', 8, 'kick hat ohat clap perc'),
               S('groove', 16, 'kick hat ohat clap perc bass chord'), S('full', 16, 'kick hat ohat clap perc bass chord pad vox'),
               S('break', 8, 'chord vox pad'), S('full 2', 16, 'kick hat ohat clap perc bass chord'),
               S('outro', 8, 'kick hat ohat clap bass')],
  },
];
TRACKS.push(...CHAPTER2);

// ---------- chapter 3: Grooveline Records, the rare-groove wall ----------
// Older sounds from the shop's crates: disco strings and brass, Detroit strings and bleeps, a
// Chicago jack track, Italo octaves, a jazzy sax-like lead, a dub with long echoes. Major keys,
// so the crate covers the other side of the key wheel.
const CHAPTER3 = [
  {
    id: 'vinil-raro', title: 'Vinil Raro', artist: 'Os Discos da Tia', label: 'Fita Dourada', chapter: 3,
    genre: 'Disco', bpm: 118, root: 53, key: 'F major', camelot: '7B', seed: 173, swing: 0.06,
    chords: [[0, 4, 7, 11], [-3, 0, 4, 7], [5, 9, 12, 16], [7, 11, 14, 17]],
    chordRhythm: [0, 0, 0, 0, 0, 0, 0.8, 0, 0, 0, 0, 0, 0, 0, 0.9, 0.6],
    bass: [0, null, 12, null, 0, null, 12, null, 0, null, 12, null, 0, null, 12, 10], bassOct: -24,
    kit: { snare: 'clap', chord: 'brass', bass: 'disco' },
    drums: { hat: x4([0.5, 0.3, 0.6, 0.3]), ohat: x4([0, 0, 1, 0]), clap: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
             perc: { tambourine: x4([0, 0.4, 0.8, 0.4]) } },
    style: { sweep: 0.2, delayBeats: 0.75, delayFb: 0.25, delayWet: 0.15, reverb: 0.24, pad: 0.1, strings: 0.13,
             openHat: 0.32, closedHat: 0.26, clap: 0.42, perc: 0.3, hiss: 0.004 },
    mix: { duck: 0.4, drive: 1.2 },
    sections: [S('intro', 8, 'kick hat perc'), S('intro 2', 8, 'kick hat ohat clap perc bass'),
               S('groove', 16, 'kick hat ohat clap perc bass chord'), S('strings', 16, 'kick hat ohat clap perc bass chord strings'),
               S('break', 8, 'strings perc bass'), S('full', 16, 'kick hat ohat clap perc bass chord strings'),
               S('outro', 8, 'kick hat ohat clap bass')],
  },
  {
    id: 'fabrica', title: 'Fábrica', artist: 'Turno da Noite', label: 'Betão', chapter: 3,
    genre: 'Detroit Techno', bpm: 127, root: 48, key: 'C major', camelot: '8B', seed: 191, swing: 0,
    chords: [[0, 4, 7, 11, 14], [-3, 0, 4, 7, 11], [5, 9, 12, 16], [7, 11, 14, 16]], chordRhythm: x4([0, 0, 0, 0]),
    lead: [0, null, 7, null, 12, null, 7, null, 4, null, 7, null, 11, null, 7, null], leadOct: 12,
    bass: [0, null, null, null, null, null, 0, null, null, null, 0, null, null, null, null, null], bassOct: -12,
    kit: { hat: 'metal', snare: 'clap', bass: 'sub', lead: 'square' },
    drums: { hat: x4([0, 0.4, 0.7, 0.4]), clap: [0, 0, 0, 0, 0.8, 0, 0, 0, 0, 0, 0, 0, 0.8, 0, 0, 0],
             perc: { ride: x4([0.5, 0, 0.7, 0]) } },
    style: { sweep: 0.4, delayBeats: 0.75, delayFb: 0.45, delayWet: 0.3, reverb: 0.3, pad: 0.08, strings: 0.14, lead: 0.1,
             openHat: 0.3, closedHat: 0.26, clap: 0.38, perc: 0.35, hiss: 0 },
    mix: { duck: 0.5, drive: 1.25 },
    sections: [S('intro', 16, 'kick hat perc'), S('groove', 16, 'kick hat clap perc bass lead'),
               S('strings', 16, 'kick hat clap perc bass lead strings'), S('break', 8, 'strings lead'),
               S('full', 16, 'kick hat clap perc bass lead strings'), S('outro', 8, 'kick hat perc')],
  },
  {
    id: 'mexe', title: 'Mexe', artist: 'Zé do Jack', label: 'Rua Baixa', chapter: 3,
    genre: 'Chicago House', bpm: 124, root: 55, key: 'G major', camelot: '9B', seed: 211, swing: 0.14,
    chords: [[0, 4, 7, 10], [0, 4, 7, 10], [5, 9, 12, 15], [0, 4, 7, 10]],
    chordRhythm: [0.8, 0, 0, 0.6, 0, 0, 0.8, 0, 0, 0.6, 0, 0, 0.8, 0, 0.5, 0],
    bass: [0, null, 0, 12, null, 0, null, 10, 0, null, 0, 12, null, 7, null, 5], bassOct: -24,
    kit: { kick: 'punch', snare: 'clap', chord: 'clav', chordOct: 0 },
    drums: { hat: x4([0.7, 0.3, 0.5, 0.3]), ohat: x4([0, 0, 0.8, 0]), clap: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
             perc: { clapRoll: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.6], cowbell: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.4, 0, 0, 0, 0, 0] } },
    style: { sweep: 0.3, bassCut: 520, delayBeats: 0.5, delayFb: 0.25, delayWet: 0.15, reverb: 0.14, pad: 0.06,
             openHat: 0.34, closedHat: 0.3, clap: 0.48, perc: 0.35, hiss: 0.008 },
    mix: { duck: 0.4, drive: 1.5 },
    sections: [S('intro', 8, 'kick hat'), S('intro 2', 8, 'kick hat clap perc'),
               S('jack', 16, 'kick hat ohat clap perc bass'), S('clav', 16, 'kick hat ohat clap perc bass chord'),
               S('break', 8, 'chord perc hat'), S('full', 16, 'kick hat ohat clap perc bass chord'),
               S('outro', 8, 'kick hat clap')],
  },
  {
    id: 'estrela', title: 'Estrela', artist: 'Laser Romano', label: 'Fita Dourada', chapter: 3,
    genre: 'Italo Disco', bpm: 120, root: 50, key: 'D major', camelot: '10B', seed: 229, swing: 0,
    chords: [[0, 4, 7], [-3, 0, 4, 7], [5, 9, 12], [7, 11, 14]], chordRhythm: x4([0, 0, 0, 0]),
    bass: x4([0, 12, 0, 12]), bassOct: -24,
    lead: [7, null, 9, null, 11, null, 9, 7, null, null, 4, null, 7, null, null, null], leadOct: 12,
    leadSlide: [0, 0, 1, 0, 1, 0, 1, 1, 0, 0, 0, 0, 1, 0, 0, 0],
    kit: { snare: 'snare', bass: 'disco', lead: 'square' },
    drums: { hat: x4([0.4, 0.3, 0.6, 0.3]), clap: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
             perc: { tambourine: x4([0, 0, 0.6, 0]) } },
    style: { sweep: 0.2, delayBeats: 0.75, delayFb: 0.35, delayWet: 0.22, reverb: 0.3, pad: 0.08, strings: 0.11, lead: 0.12,
             openHat: 0.3, closedHat: 0.24, clap: 0.42, perc: 0.3, hiss: 0 },
    mix: { duck: 0.45, drive: 1.2 },
    sections: [S('intro', 8, 'kick hat'), S('intro 2', 8, 'kick hat clap bass'),
               S('groove', 16, 'kick hat clap perc bass strings'), S('lead', 16, 'kick hat clap perc bass strings lead'),
               S('break', 8, 'strings lead'), S('full', 16, 'kick hat clap perc bass strings lead'),
               S('outro', 8, 'kick hat clap bass')],
  },
  {
    id: 'varanda', title: 'Varanda', artist: 'Quarteto Lento', label: 'Rua Baixa', chapter: 3,
    genre: 'Jazzy House', bpm: 122, root: 58, key: 'B♭ major', camelot: '6B', seed: 241, swing: 0.18,
    chords: [[0, 4, 7, 11, 14], [-3, 0, 4, 7, 11], [5, 9, 12, 16], [7, 11, 14, 17]],
    chordRhythm: [0.7, 0, 0, 0, 0, 0, 0.5, 0, 0, 0, 0, 0, 0.6, 0, 0, 0],
    lead: [null, null, 2, null, 4, null, null, 7, null, 9, null, 7, 4, null, 2, null], leadOct: 12,
    leadSlide: [0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 1, 0, 1, 0],
    bass: [0, null, null, null, null, null, 0, null, null, 7, null, null, 0, null, null, null], bassOct: -24,
    kit: { kick: 'deep', hat: 'shaker', ohat: 'metal', snare: 'rim', chord: 'rhodes', bass: 'sub', lead: 'reed', chordOct: -12 },
    drums: { hat: x4([0.6, 0.3, 0.4, 0.3]), ohat: x4([0, 0, 0.6, 0]), clap: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0.3, 0, 1, 0, 0, 0],
             perc: { congaHi: [0, 0, 0, 0, 0, 0, 0, 0.4, 0, 0, 0, 0, 0, 0.4, 0, 0] } },
    style: { sweep: 0.2, delayBeats: 0.75, delayFb: 0.4, delayWet: 0.28, reverb: 0.34, pad: 0.12, lead: 0.16,
             openHat: 0.22, closedHat: 0.3, clap: 0.45, perc: 0.3, hiss: 0.005 },
    mix: { duck: 0.5, drive: 1.1 },
    sections: [S('intro', 8, 'kick hat clap'), S('intro 2', 8, 'kick hat ohat clap perc bass'),
               S('groove', 16, 'kick hat ohat clap perc bass chord'), S('solo', 16, 'kick hat ohat clap perc bass chord lead'),
               S('break', 8, 'chord lead pad'), S('full', 16, 'kick hat ohat clap perc bass chord lead'),
               S('outro', 8, 'kick hat clap bass')],
  },
  {
    id: 'dubplate', title: 'Dubplate', artist: 'Eco Sul', label: 'Cais Dub', chapter: 3,
    genre: 'Dub House', bpm: 123, root: 52, key: 'E major', camelot: '12B', seed: 263, swing: 0.05,
    chords: [[0, 4, 7, 11], [0, 4, 7, 11], [-3, 0, 4, 7], [5, 9, 12, 16]],
    chordRhythm: [0, 0, 0.9, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    bass: [0, null, null, null, null, null, null, 0, null, null, 0, null, null, null, null, null], bassOct: -12,
    kit: { kick: 'deep', hat: 'metal', ohat: 'metal', snare: 'rim', chord: 'pluck', bass: 'sub', chordOct: 12, pluckRing: 0.998 },
    drums: { hat: x4([0.3, 0.2, 0.6, 0.2]), ohat: x4([0, 0, 0.7, 0]), clap: [0, 0, 0, 0, 0, 0, 0, 0.5, 0, 0, 0, 0, 0.8, 0, 0, 0],
             perc: { shaker: x4([0.3, 0.15, 0.3, 0.15]) } },
    style: { sweep: 0.4, delayBeats: 0.75, delayFb: 0.65, delayWet: 0.55, reverb: 0.4, pad: 0.12,
             openHat: 0.26, closedHat: 0.22, clap: 0.4, perc: 0.3, hiss: 0.01 },
    mix: { duck: 0.6, drive: 1.05 },
    sections: [S('intro', 16, 'kick hat'), S('groove', 16, 'kick hat ohat perc bass chord clap'),
               S('deep', 16, 'kick hat ohat perc bass chord clap pad'), S('break', 8, 'chord pad perc'),
               S('full', 16, 'kick hat ohat perc bass chord clap pad'), S('outro', 8, 'kick hat')],
  },
];
TRACKS.push(...CHAPTER3);

// ---------- chapter 4: pubs and beach bars ----------
// Sunny, wooden, played-by-hand sounds: marimba, strummed guitar, flute, toms. The last six
// major keys.
const CHAPTER4 = [
  {
    id: 'praia', title: 'Praia', artist: 'Areia Fina', label: 'Fita Dourada', chapter: 4,
    genre: 'Balearic House', bpm: 118, root: 57, key: 'A major', camelot: '11B', seed: 307, swing: 0.1,
    chords: [[0, 4, 7, 11, 14], [5, 9, 12, 16], [-3, 0, 4, 7], [7, 11, 14, 17]],
    chordRhythm: [0.8, 0, 0, 0, 0, 0, 0.6, 0, 0, 0, 0.7, 0, 0, 0, 0.5, 0],
    arp: [0, null, 2, null, 1, null, 3, null, 2, null, 4, null, 3, null, 1, null],
    bass: [0, null, null, null, null, null, 7, null, 0, null, null, null, null, null, 12, null], bassOct: -12,
    kit: { kick: 'deep', hat: 'shaker', snare: 'rim', chord: 'guitar', arp: 'marimba', bass: 'sub', chordOct: -12 },
    drums: { hat: x4([0.6, 0.3, 0.45, 0.3]), clap: [0, 0, 0, 0, 0.9, 0, 0, 0, 0, 0, 0, 0, 0.9, 0, 0, 0],
             perc: { congaHi: [0, 0, 0, 0.4, 0, 0, 0.5, 0, 0, 0, 0, 0.4, 0, 0.5, 0, 0] } },
    style: { sweep: 0.2, delayBeats: 0.75, delayFb: 0.4, delayWet: 0.28, reverb: 0.32, pad: 0.1, arp: 0.22,
             openHat: 0.25, closedHat: 0.3, clap: 0.42, perc: 0.3, hiss: 0.004 },
    mix: { duck: 0.45, drive: 1.1 },
    sections: [S('intro', 8, 'kick hat clap'), S('intro 2', 8, 'kick hat clap perc bass'),
               S('guitar', 16, 'kick hat clap perc bass chord'), S('marimba', 16, 'kick hat clap perc bass chord arp'),
               S('break', 8, 'chord arp pad'), S('full', 16, 'kick hat clap perc bass chord arp'),
               S('outro', 8, 'kick hat clap bass')],
  },
  {
    id: 'tambor', title: 'Tambor', artist: 'Kizomba Club', label: 'Cais Dub', chapter: 4,
    genre: 'Afro House', bpm: 122, root: 49, key: 'D♭ major', camelot: '3B', seed: 331, swing: 0.08,
    chords: [[0, 4, 7, 11], [-3, 0, 4, 7]], chordRhythm: x4([0, 0, 0, 0]),
    arp: [0, null, null, 2, null, null, 1, null, 0, null, null, 3, null, 2, null, null],
    bass: [0, null, null, 0, null, null, null, null, 0, null, null, null, 7, null, null, null], bassOct: -12,
    vox: [0, 0, 0, 0, 0, 0, 0, 0, 0.9, 0, 0, 0, 0, 0, 0, 0], vowel: 'oh', voxOct: 12, voxLen: 0.5,
    kit: { kick: 'punch', snare: 'rim', arp: 'marimba', bass: 'sub' },
    drums: { hat: x4([0.4, 0.3, 0.6, 0.3]), ohat: x4([0, 0, 0.5, 0]), clap: [0, 0, 0, 0, 0, 0, 0, 0.5, 0, 0, 0, 0, 0.8, 0, 0, 0],
             perc: { tomHi: [0, 0, 0, 0, 0, 0, 0.6, 0, 0, 0, 0, 0, 0, 0, 0.5, 0], tomLo: [0, 0, 0, 0.7, 0, 0, 0, 0, 0, 0, 0.6, 0, 0, 0, 0, 0.7],
                     congaHi: [0, 0, 0.6, 0, 0, 0.5, 0, 0, 0, 0, 0.6, 0, 0, 0.4, 0, 0], shaker: x4([0.4, 0.2, 0.5, 0.2]) } },
    style: { sweep: 0.3, delayBeats: 0.75, delayFb: 0.4, delayWet: 0.25, reverb: 0.3, pad: 0.12, arp: 0.24, vox: 0.3,
             openHat: 0.24, closedHat: 0.24, clap: 0.4, perc: 0.42, hiss: 0 },
    mix: { duck: 0.5, drive: 1.3 },
    sections: [S('intro', 8, 'kick hat perc'), S('intro 2', 8, 'kick hat ohat perc clap bass'),
               S('drums', 16, 'kick hat ohat clap perc bass arp'), S('voices', 16, 'kick hat ohat clap perc bass arp vox'),
               S('break', 8, 'perc vox pad arp'), S('full', 16, 'kick hat ohat clap perc bass arp vox'),
               S('outro', 8, 'kick hat perc')],
  },
  {
    id: 'flauta', title: 'Flauta', artist: 'Sopro', label: 'Rua Baixa', chapter: 4,
    genre: 'Lounge House', bpm: 119, root: 51, key: 'E♭ major', camelot: '5B', seed: 353, swing: 0.16,
    chords: [[0, 4, 7, 11, 14], [5, 9, 12, 16], [2, 5, 9, 12], [7, 11, 14, 17]],
    chordRhythm: [0.6, 0, 0, 0, 0, 0, 0, 0.4, 0, 0, 0.5, 0, 0, 0, 0, 0],
    lead: [7, null, null, 9, null, 11, null, null, 12, null, 11, 9, null, 7, null, null], leadOct: 12,
    leadSlide: [0, 0, 0, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0],
    bass: [0, null, null, null, null, null, null, 7, null, null, 0, null, null, null, null, null], bassOct: -12,
    kit: { kick: 'deep', hat: 'shaker', ohat: 'metal', snare: 'rim', chord: 'rhodes', bass: 'sub', lead: 'flute', chordOct: 0 },
    drums: { hat: x4([0.6, 0.3, 0.4, 0.3]), ohat: x4([0, 0, 0.5, 0]), clap: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0.3, 0] },
    style: { sweep: 0.2, delayBeats: 0.75, delayFb: 0.45, delayWet: 0.3, reverb: 0.36, pad: 0.12, lead: 0.15,
             openHat: 0.22, closedHat: 0.28, clap: 0.42, perc: 0.3, hiss: 0.005 },
    mix: { duck: 0.45, drive: 1.05 },
    sections: [S('intro', 8, 'kick hat clap'), S('intro 2', 8, 'kick hat ohat clap bass'),
               S('groove', 16, 'kick hat ohat clap bass chord'), S('flute', 16, 'kick hat ohat clap bass chord lead'),
               S('break', 8, 'chord lead pad'), S('full', 16, 'kick hat ohat clap bass chord lead pad'),
               S('outro', 8, 'kick hat clap bass')],
  },
  {
    id: 'bar-funk', title: 'Bar Funk', artist: 'Os Metais', label: 'Fita Dourada', chapter: 4,
    genre: 'Funky House', bpm: 126, root: 56, key: 'A♭ major', camelot: '4B', seed: 379, swing: 0.1,
    chords: [[0, 4, 7, 10], [5, 9, 12, 15], [0, 4, 7, 10], [7, 10, 14, 17]],
    chordRhythm: [0, 0, 0.7, 0, 0, 0.5, 0, 0.7, 0, 0, 0.7, 0, 0, 0.5, 0, 0],
    bass: [0, null, 12, null, 0, 10, null, 12, 0, null, 12, null, 7, null, 10, 12], bassOct: -24,
    kit: { kick: 'punch', snare: 'clap', chord: 'guitar', bass: 'disco', chordOct: 0 },
    drums: { hat: x4([0.6, 0.3, 0.5, 0.3]), ohat: x4([0, 0, 0.9, 0]), clap: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
             perc: { cowbell: [0, 0, 0, 0, 0, 0, 0, 0.5, 0, 0, 0, 0, 0, 0, 0.4, 0], tambourine: x4([0, 0, 0.6, 0]) } },
    style: { sweep: 0.25, delayBeats: 0.5, delayFb: 0.25, delayWet: 0.15, reverb: 0.2, pad: 0.08,
             openHat: 0.32, closedHat: 0.28, clap: 0.45, perc: 0.32, hiss: 0 },
    mix: { duck: 0.45, drive: 1.35 },
    sections: [S('intro', 8, 'kick hat'), S('intro 2', 8, 'kick hat ohat clap perc bass'),
               S('groove', 16, 'kick hat ohat clap perc bass chord'), S('full', 16, 'kick hat ohat clap perc bass chord pad'),
               S('break', 8, 'chord perc bass'), S('full 2', 16, 'kick hat ohat clap perc bass chord'),
               S('outro', 8, 'kick hat ohat clap bass')],
  },
  {
    id: 'terraco', title: 'Terraço', artist: 'Sol das Seis', label: 'Rua Baixa', chapter: 4,
    genre: 'Nu Disco', bpm: 120, root: 59, key: 'B major', camelot: '1B', seed: 397, swing: 0.04,
    chords: [[0, 4, 7, 11], [-3, 0, 4, 7], [-7, -3, 0, 4], [-5, -1, 2, 5]],
    chordRhythm: [0, 0, 0.6, 0, 0, 0, 0.6, 0, 0, 0, 0.6, 0, 0, 0, 0.6, 0],
    lead: [4, null, 7, null, 11, null, null, 9, null, 7, null, null, 4, null, 2, null], leadOct: 0,
    leadSlide: [0, 0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0],
    bass: x4([0, 12, 0, 12]), bassOct: -24,
    kit: { snare: 'clap', chord: 'guitar', bass: 'disco', lead: 'square', chordOct: -12 },
    drums: { hat: x4([0.4, 0.3, 0.6, 0.3]), ohat: x4([0, 0, 0.7, 0]), clap: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
             perc: { cowbell: [0, 0, 0, 0, 0, 0, 0.4, 0, 0, 0, 0, 0, 0, 0, 0, 0] } },
    style: { sweep: 0.3, delayBeats: 0.75, delayFb: 0.35, delayWet: 0.25, reverb: 0.28, pad: 0.08, strings: 0.11, lead: 0.1,
             openHat: 0.28, closedHat: 0.24, clap: 0.42, perc: 0.3, hiss: 0 },
    mix: { duck: 0.55, drive: 1.2 },
    sections: [S('intro', 8, 'kick hat'), S('intro 2', 8, 'kick hat ohat clap bass'),
               S('groove', 16, 'kick hat ohat clap perc bass chord'), S('strings', 16, 'kick hat ohat clap perc bass chord strings lead'),
               S('break', 8, 'strings lead'), S('full', 16, 'kick hat ohat clap perc bass chord strings lead'),
               S('outro', 8, 'kick hat clap bass')],
  },
  {
    id: 'madrugada', title: 'Madrugada', artist: 'Linha Norte', label: 'Betão', chapter: 4,
    genre: 'Speed Garage', bpm: 128, root: 54, key: 'F♯ major', camelot: '2B', seed: 419, swing: 0.17,
    chords: [[0, 4, 7, 11], [-3, 0, 4, 7], [5, 9, 12, 16], [7, 11, 14, 17]],
    chordRhythm: [0, 0, 0.8, 0, 0, 0, 0, 0, 0, 0, 0.8, 0, 0, 0, 0, 0.5],
    bass: [0, null, null, 0, null, null, 12, null, null, 0, null, null, 7, null, 12, null], bassOct: -12,
    vox: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.8, 0], vowel: 'hey', voxOct: 12, voxLen: 0.15,
    kit: { hat: 'metal', ohat: 'metal', snare: 'snare', chord: 'organ', bass: 'reese', chordOct: 0 },
    drums: { hat: x4([0.6, 0.4, 0.8, 0.4]), ohat: x4([0, 0, 1, 0]), clap: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0.4, 1, 0, 0, 0],
             perc: { rim: [0, 0, 0, 0.5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.4, 0] } },
    style: { sweep: 0.5, delayBeats: 0.75, delayFb: 0.3, delayWet: 0.2, reverb: 0.2, pad: 0.06, vox: 0.3,
             openHat: 0.3, closedHat: 0.26, clap: 0.42, perc: 0.3, hiss: 0 },
    mix: { duck: 0.55, drive: 1.35 },
    sections: [S('intro', 8, 'kick hat'), S('intro 2', 8, 'kick hat ohat clap perc'),
               S('groove', 16, 'kick hat ohat clap perc bass'), S('organ', 16, 'kick hat ohat clap perc bass chord vox'),
               S('break', 8, 'bass chord hat'), S('full', 16, 'kick hat ohat clap perc bass chord vox'),
               S('outro', 8, 'kick hat ohat clap')],
  },
];
TRACKS.push(...CHAPTER4);

// ---------- chapter 5: Grooveline Radio ----------
// Records for a radio show: bells, supersaws, a wobbling bass, robot voices. Keys repeat from here on.
const CHAPTER5 = [
  {
    id: 'onda-media', title: 'Onda Média', artist: 'Estúdio 2', label: 'Grooveline Radio', chapter: 5,
    genre: 'Progressive House', bpm: 124, root: 57, key: 'A minor', camelot: '8A', seed: 431, swing: 0,
    chords: [[0, 3, 7, 10], [-4, 0, 3, 7], [-7, -4, 0, 3], [-2, 2, 5, 9]], chordRhythm: x4([0, 0, 0, 0]),
    arp: [0, 1, 2, 4, 2, 1, 3, 2, 0, 1, 2, 4, 5, 4, 2, 1],
    bass: x4([0, 0, 12, 0]), bassOct: -24,
    kit: { hat: 'metal', snare: 'clap', arp: 'bell' },
    drums: { hat: x4([0.3, 0.5, 0.7, 0.5]), ohat: x4([0, 0, 0.8, 0]), clap: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
             perc: { ride: x4([0.4, 0, 0.6, 0]) } },
    style: { sweep: 0.6, bassCut: 380, delayBeats: 0.75, delayFb: 0.5, delayWet: 0.3, reverb: 0.34, pad: 0.12, strings: 0.09, arp: 0.2,
             openHat: 0.28, closedHat: 0.24, clap: 0.4, perc: 0.3, hiss: 0 },
    mix: { duck: 0.6, drive: 1.2 },
    sections: [S('intro', 16, 'kick hat perc'), S('rolling', 16, 'kick hat ohat clap perc bass'),
               S('bells', 16, 'kick hat ohat clap perc bass arp'), S('break', 8, 'arp strings pad'),
               S('full', 16, 'kick hat ohat clap perc bass arp strings'), S('outro', 8, 'kick hat perc')],
  },
  {
    id: 'estatica', title: 'Estática', artist: 'Ruído Branco', label: 'Betão', chapter: 5,
    genre: 'Minimal', bpm: 125, root: 50, key: 'D minor', camelot: '7A', seed: 449, swing: 0.12,
    chords: [[0, 3, 7]], chordRhythm: x4([0, 0, 0, 0]),
    bass: [0, null, null, 0, null, null, null, null, null, 0, null, null, null, null, 12, null], bassOct: -12,
    vox: [0, 0, 0, 0, 0, 0, 0.8, 0, 0, 0, 0, 0, 0, 0, 0, 0.5], vowel: 'oh', voxOct: 12, voxLen: 0.1,
    kit: { kick: 'punch', hat: 'metal', snare: 'rim', bass: 'wobble', vox: 'robot' },
    drums: { hat: x4([0, 0.3, 0.6, 0.3]), clap: [0, 0, 0, 0, 0, 0, 0, 0.6, 0, 0, 0, 0, 0.9, 0, 0, 0],
             perc: { rim: [0, 0, 0.5, 0, 0, 0, 0, 0, 0, 0, 0.4, 0, 0, 0, 0, 0.3], shaker: x4([0.3, 0.15, 0.3, 0.15]) } },
    style: { sweep: 0.3, delayBeats: 0.75, delayFb: 0.55, delayWet: 0.35, reverb: 0.25, pad: 0.06, vox: 0.25,
             openHat: 0.24, closedHat: 0.26, clap: 0.4, perc: 0.35, hiss: 0.006 },
    mix: { duck: 0.5, drive: 1.3 },
    sections: [S('intro', 16, 'kick hat perc'), S('groove', 16, 'kick hat clap perc bass'),
               S('voices', 16, 'kick hat clap perc bass vox'), S('break', 8, 'perc vox bass'),
               S('full', 16, 'kick hat clap perc bass vox'), S('outro', 8, 'kick hat perc')],
  },
  {
    id: 'frequencia', title: 'Frequência', artist: 'Alta Voltagem', label: 'Grooveline Radio', chapter: 5,
    genre: 'Electro House', bpm: 127, root: 53, key: 'F minor', camelot: '4A', seed: 467, swing: 0,
    chords: [[0, 3, 7, 10], [-4, 0, 3, 7], [3, 7, 10, 14], [-2, 2, 5, 9]],
    chordRhythm: [0, 0, 0.9, 0, 0, 0, 0, 0, 0, 0, 0.9, 0, 0, 0, 0.6, 0],
    bass: [0, null, 0, null, 0, null, 12, null, 0, null, 0, null, 7, null, 10, null], bassOct: -24,
    kit: { kick: 'punch', hat: 'metal', snare: 'clap', chord: 'supersaw', bass: 'wobble', chordOct: 0 },
    drums: { hat: x4([0.4, 0.4, 0.8, 0.4]), ohat: x4([0, 0, 1, 0]), clap: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
             perc: { clapRoll: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.7] } },
    style: { sweep: 0.5, delayBeats: 0.75, delayFb: 0.3, delayWet: 0.2, reverb: 0.26, pad: 0.06,
             openHat: 0.3, closedHat: 0.26, clap: 0.48, perc: 0.35, hiss: 0 },
    mix: { duck: 0.65, drive: 1.45 },
    sections: [S('intro', 8, 'kick hat'), S('intro 2', 8, 'kick hat ohat clap perc'),
               S('drop', 16, 'kick hat ohat clap perc bass chord'), S('break', 8, 'chord pad'),
               S('drop 2', 16, 'kick hat ohat clap perc bass chord'), S('groove', 16, 'kick hat ohat clap bass'),
               S('outro', 8, 'kick hat ohat clap')],
  },
  {
    id: 'antena', title: 'Antena', artist: 'Sala Escura', label: 'Cais Dub', chapter: 5,
    genre: 'Deep Tech', bpm: 123, root: 55, key: 'G minor', camelot: '6A', seed: 487, swing: 0.15,
    chords: [[0, 3, 7, 10], [-2, 2, 5, 9]], chordRhythm: [0, 0, 0, 0, 0, 0, 0.7, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    bass: [0, null, null, 0, null, null, 0, null, null, 0, null, null, 0, null, 10, null], bassOct: -12,
    vox: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.7, 0, 0, 0], vowel: 'ah', voxOct: 12, voxLen: 0.3,
    kit: { kick: 'deep', hat: 'shaker', ohat: 'metal', snare: 'rim', chord: 'bell', bass: 'sub', vox: 'robot', chordOct: 12 },
    drums: { hat: x4([0.6, 0.3, 0.5, 0.3]), ohat: x4([0, 0, 0.6, 0]), clap: [0, 0, 0, 0, 0.9, 0, 0, 0, 0, 0, 0, 0, 0.9, 0, 0, 0] },
    style: { sweep: 0.3, delayBeats: 0.75, delayFb: 0.5, delayWet: 0.35, reverb: 0.36, pad: 0.1, vox: 0.25,
             openHat: 0.22, closedHat: 0.28, clap: 0.42, perc: 0.3, hiss: 0.005 },
    mix: { duck: 0.55, drive: 1.15 },
    sections: [S('intro', 8, 'kick hat clap'), S('intro 2', 8, 'kick hat ohat clap bass'),
               S('bells', 16, 'kick hat ohat clap bass chord'), S('voices', 16, 'kick hat ohat clap bass chord vox'),
               S('break', 8, 'chord vox pad'), S('full', 16, 'kick hat ohat clap bass chord vox'),
               S('outro', 8, 'kick hat clap bass')],
  },
  {
    id: 'sinal', title: 'Sinal', artist: 'Torre Alta', label: 'Grooveline Radio', chapter: 5,
    genre: 'Trance', bpm: 128, root: 52, key: 'E minor', camelot: '9A', seed: 503, swing: 0,
    chords: [[0, 3, 7], [-4, 0, 3], [3, 7, 10], [-2, 2, 5]],
    chordRhythm: [0.8, 0, 0, 0, 0, 0, 0.6, 0, 0, 0, 0.7, 0, 0, 0, 0.6, 0],
    arp: x4([0, 1, 2, 1]),
    bass: x4([null, 0, 0, 0]), bassOct: -12,
    kit: { hat: 'metal', snare: 'clap', chord: 'supersaw', bass: 'saw', chordOct: 12 },
    drums: { hat: x4([0, 0.4, 0.8, 0.4]), ohat: x4([0, 0, 1, 0]), clap: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0] },
    style: { sweep: 0.5, bassCut: 600, delayBeats: 0.75, delayFb: 0.5, delayWet: 0.3, reverb: 0.38, pad: 0.12, strings: 0.1, arp: 0.18,
             openHat: 0.3, closedHat: 0.24, clap: 0.42, perc: 0.3, hiss: 0 },
    mix: { duck: 0.65, drive: 1.3 },
    sections: [S('intro', 16, 'kick hat ohat'), S('rolling', 16, 'kick hat ohat clap bass arp'),
               S('break', 16, 'chord strings pad arp'), S('lift', 16, 'kick hat ohat clap bass chord arp strings'),
               S('outro', 16, 'kick hat ohat clap bass')],
  },
  {
    id: 'ondas', title: 'Ondas', artist: 'Mar Calmo', label: 'Rua Baixa', chapter: 5,
    genre: 'Ambient House', bpm: 118, root: 48, key: 'C major', camelot: '8B', seed: 521, swing: 0.08,
    chords: [[0, 4, 7, 11, 14], [5, 9, 12, 16], [-3, 0, 4, 7, 11], [7, 11, 14, 17]], chordRhythm: x4([0, 0, 0, 0]),
    arp: [0, null, null, 2, null, null, 4, null, 3, null, null, 1, null, null, 2, null],
    bass: [0, null, null, null, null, null, null, null, 0, null, null, null, null, null, 7, null], bassOct: -12,
    kit: { kick: 'deep', hat: 'shaker', snare: 'rim', arp: 'bell', bass: 'sub' },
    drums: { hat: x4([0.5, 0.25, 0.4, 0.25]), clap: [0, 0, 0, 0, 0.8, 0, 0, 0, 0, 0, 0, 0, 0.8, 0, 0, 0] },
    style: { sweep: 0.3, delayBeats: 0.75, delayFb: 0.55, delayWet: 0.4, reverb: 0.45, pad: 0.16, strings: 0.1, arp: 0.2,
             openHat: 0.2, closedHat: 0.26, clap: 0.38, perc: 0.3, hiss: 0.008 },
    mix: { duck: 0.45, drive: 1.05 },
    sections: [S('intro', 8, 'kick hat'), S('intro 2', 8, 'kick hat clap bass pad'),
               S('bells', 16, 'kick hat clap bass arp pad'), S('break', 16, 'arp strings pad'),
               S('full', 16, 'kick hat clap bass arp strings'), S('outro', 16, 'kick hat clap bass')],
  },
];
TRACKS.push(...CHAPTER5);

// ---------- chapter 6: club CAVE ----------
// Darker and harder: rumbling kicks, industrial clangs, rave stabs, acid. The warm-up records
// first, peak time last.
const CHAPTER6 = [
  {
    id: 'porta', title: 'Porta', artist: 'Lista Fechada', label: 'Betão', chapter: 6,
    genre: 'Warm-up Minimal', bpm: 122, root: 52, key: 'E minor', camelot: '9A', seed: 541, swing: 0.1,
    chords: [[0, 3, 7, 10]], chordRhythm: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.6, 0, 0, 0, 0, 0],
    bass: [0, null, null, null, null, null, 0, null, null, null, null, 0, null, null, null, null], bassOct: -12,
    kit: { kick: 'deep', hat: 'metal', snare: 'rim', chord: 'bell', bass: 'sub', chordOct: 12 },
    drums: { hat: x4([0, 0.3, 0.5, 0.3]), clap: [0, 0, 0, 0, 0, 0, 0, 0.4, 0, 0, 0, 0, 0.7, 0, 0, 0],
             perc: { shaker: x4([0.3, 0.15, 0.3, 0.15]), rim: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.4, 0] } },
    style: { sweep: 0.3, delayBeats: 0.75, delayFb: 0.55, delayWet: 0.35, reverb: 0.3, pad: 0.08,
             openHat: 0.22, closedHat: 0.24, clap: 0.38, perc: 0.3, hiss: 0.006 },
    mix: { duck: 0.5, drive: 1.1 },
    sections: [S('intro', 16, 'kick hat perc'), S('groove', 16, 'kick hat clap perc bass'),
               S('bells', 16, 'kick hat clap perc bass chord'), S('break', 8, 'chord pad perc'),
               S('full', 16, 'kick hat clap perc bass chord'), S('outro', 8, 'kick hat perc')],
  },
  {
    id: 'seguranca', title: 'Segurança', artist: 'Nuno M.', label: 'Betão', chapter: 6,
    genre: 'Dark Techno', bpm: 128, root: 50, key: 'D minor', camelot: '7A', seed: 557, swing: 0,
    chords: [[0, 3, 7]], chordRhythm: x4([0, 0, 0, 0]),
    bass: x4([null, 0, 0, 0]), bassOct: -12,
    kit: { kick: 'rumble', hat: 'metal', ohat: 'metal', snare: 'clap', bass: 'sub' },
    drums: { hat: x4([0.5, 0.4, 0.7, 0.4]), ohat: x4([0, 0, 0.8, 0]), clap: [0, 0, 0, 0, 0.8, 0, 0, 0, 0, 0, 0, 0, 0.8, 0, 0, 0],
             perc: { clang: [0, 0, 0, 0, 0, 0, 0, 0.6, 0, 0, 0, 0, 0, 0, 0, 0.5], ride: x4([0.4, 0, 0.6, 0]) } },
    style: { sweep: 0.4, delayBeats: 0.75, delayFb: 0.5, delayWet: 0.3, reverb: 0.32, pad: 0.06,
             openHat: 0.28, closedHat: 0.26, clap: 0.4, perc: 0.38, hiss: 0.008 },
    mix: { duck: 0.55, drive: 1.45 },
    sections: [S('intro', 16, 'kick hat'), S('rumble', 16, 'kick hat ohat perc bass'),
               S('clap', 16, 'kick hat ohat clap perc bass'), S('break', 8, 'perc pad bass'),
               S('full', 16, 'kick hat ohat clap perc bass'), S('outro', 8, 'kick hat')],
  },
  {
    id: 'fila', title: 'Fila', artist: 'Os Porteiros', label: 'Rua Baixa', chapter: 6,
    genre: 'Tech House', bpm: 125, root: 55, key: 'G minor', camelot: '6A', seed: 571, swing: 0.14,
    chords: [[0, 3, 7, 10]], chordRhythm: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.7, 0],
    bass: [0, null, 0, null, null, 12, 0, null, 0, null, 10, null, null, 7, 0, null], bassOct: -24,
    vox: [0, 0, 0, 0, 0, 0, 0.7, 0, 0, 0, 0, 0, 0, 0, 0, 0], vowel: 'hey', voxOct: 12, voxLen: 0.12,
    kit: { kick: 'punch', snare: 'clap', chord: 'organ', bass: 'acid', vox: 'robot', chordOct: 0 },
    bassAccent: [1, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0], bassSlide: [0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0],
    drums: { hat: x4([0.6, 0.3, 0.6, 0.3]), ohat: x4([0, 0, 0.9, 0]), clap: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
             perc: { shaker: x4([0.4, 0.2, 0.4, 0.2]) } },
    style: { sweep: 0.4, acidCut: 220, acidEnv: 1500, acidQ: 5, delayBeats: 0.5, delayFb: 0.3, delayWet: 0.2, reverb: 0.2, pad: 0.06, vox: 0.25,
             openHat: 0.3, closedHat: 0.28, clap: 0.44, perc: 0.3, hiss: 0 },
    mix: { duck: 0.5, drive: 1.35 },
    sections: [S('intro', 8, 'kick hat'), S('intro 2', 8, 'kick hat ohat clap perc'),
               S('groove', 16, 'kick hat ohat clap perc bass'), S('hey', 16, 'kick hat ohat clap perc bass vox chord'),
               S('break', 8, 'bass vox perc'), S('full', 16, 'kick hat ohat clap perc bass vox chord'),
               S('outro', 8, 'kick hat ohat clap')],
  },
  {
    id: 'luz-vermelha', title: 'Luz Vermelha', artist: 'Sala 2', label: 'Betão', chapter: 6,
    genre: 'Acid Techno', bpm: 127, root: 53, key: 'F minor', camelot: '4A', seed: 593, swing: 0.02,
    chords: [[0, 3, 7]], chordRhythm: x4([0, 0, 0, 0]),
    bass: x4([0, 0, 12, 0]), bassOct: -12,
    bassAccent: [1, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 0], bassSlide: [0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0],
    kit: { kick: 'rumble', hat: 'metal', ohat: 'metal', snare: 'clap', bass: 'acid' },
    drums: { hat: x4([0.6, 0.4, 0.7, 0.4]), ohat: x4([0, 0, 0.9, 0]), clap: [0, 0, 0, 0, 0.9, 0, 0, 0, 0, 0, 0, 0, 0.9, 0, 0, 0],
             perc: { clang: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.6] } },
    style: { sweep: 0.8, acidCut: 200, acidEnv: 3000, acidQ: 9, delayBeats: 0.75, delayFb: 0.5, delayWet: 0.3, reverb: 0.22, pad: 0.05,
             openHat: 0.3, closedHat: 0.26, clap: 0.4, perc: 0.35, hiss: 0 },
    mix: { duck: 0.5, drive: 1.5 },
    sections: [S('intro', 16, 'kick hat ohat'), S('acid', 16, 'kick hat ohat clap bass'),
               S('acid 2', 16, 'kick hat ohat clap bass perc'), S('break', 8, 'bass hat'),
               S('full', 16, 'kick hat ohat clap bass perc'), S('outro', 8, 'kick hat')],
  },
  {
    id: 'sem-lista', title: 'Sem Lista', artist: 'Rave Velho', label: 'Fita Dourada', chapter: 6,
    genre: 'Rave', bpm: 128, root: 57, key: 'A minor', camelot: '8A', seed: 613, swing: 0,
    chords: [[0, 3, 7], [-4, 0, 3], [-2, 2, 5], [-5, -2, 2]],
    chordRhythm: [0.9, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.8, 0, 0, 0, 0, 0],
    bass: x4([null, 0, null, 0]), bassOct: -24,
    kit: { kick: 'punch', hat: 'metal', ohat: 'metal', snare: 'snare', chord: 'hoover', bass: 'reese', chordOct: 0 },
    drums: { hat: x4([0.5, 0.4, 0.8, 0.4]), ohat: x4([0, 0, 1, 0]), clap: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0.5],
             perc: { tomLo: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.6, 0.6] } },
    style: { sweep: 0.4, delayBeats: 0.75, delayFb: 0.3, delayWet: 0.2, reverb: 0.25, pad: 0.06,
             openHat: 0.32, closedHat: 0.26, clap: 0.42, perc: 0.38, hiss: 0 },
    mix: { duck: 0.6, drive: 1.45 },
    sections: [S('intro', 8, 'kick hat'), S('intro 2', 8, 'kick hat ohat clap'),
               S('stabs', 16, 'kick hat ohat clap bass chord'), S('break', 8, 'chord pad'),
               S('rave', 16, 'kick hat ohat clap perc bass chord'), S('groove', 16, 'kick hat ohat clap bass'),
               S('outro', 8, 'kick hat ohat clap')],
  },
  {
    id: 'cave', title: 'Cave', artist: 'Subsolo', label: 'Cais Dub', chapter: 6,
    genre: 'Peak-time Techno', bpm: 128, root: 48, key: 'C minor', camelot: '5A', seed: 631, swing: 0,
    chords: [[0, 3, 7, 10]], chordRhythm: [0, 0, 0.8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    bass: x4([null, 0, 0, null]), bassOct: -12,
    kit: { kick: 'rumble', hat: 'metal', ohat: 'metal', snare: 'clap', chord: 'stab', bass: 'wobble' },
    drums: { hat: x4([0.5, 0.5, 0.8, 0.5]), ohat: x4([0, 0, 1, 0]), clap: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
             perc: { ride: x4([0.5, 0, 0.7, 0]), clang: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.5, 0, 0, 0, 0] } },
    style: { chordCut: 1600, chordFloor: 220, chordQ: 2.6, chordDecay: 0.3, sweep: 0.7, delayBeats: 0.75, delayFb: 0.6, delayWet: 0.45,
             reverb: 0.36, pad: 0.06, openHat: 0.3, closedHat: 0.26, clap: 0.4, perc: 0.36, hiss: 0.006 },
    mix: { duck: 0.6, drive: 1.4 },
    sections: [S('intro', 16, 'kick hat perc'), S('peak', 16, 'kick hat ohat clap perc bass chord'),
               S('break', 8, 'chord pad'), S('peak 2', 16, 'kick hat ohat clap perc bass chord'),
               S('groove', 16, 'kick hat ohat clap perc bass'), S('outro', 8, 'kick hat perc')],
  },
];
TRACKS.push(...CHAPTER6);

// ---------- chapter 7: resident at CAVE ----------
// Peak time (128-132) and afterhours (118-120), so the chapter can teach tempo changes. New
// sounds: laser zaps, a choir, a trance gate, an 808 boom bass, a kalimba on wobbly tape, a handpan.
const CHAPTER7 = [
  {
    id: 'residente', title: 'Residente', artist: 'Turno da Noite', label: 'Betão', chapter: 7,
    genre: 'Hardgroove', bpm: 130, root: 54, key: 'F# minor', camelot: '11A', seed: 653, swing: 0.04,
    chords: [[0, 3, 7]], chordRhythm: x4([0, 0, 0, 0]),
    bass: x4([null, null, 0, null]), bassOct: -12,
    kit: { kick: 'punch', hat: 'metal', ohat: 'metal', snare: 'clap', bass: 'sub' },
    drums: { hat: x4([0.6, 0.4, 0.8, 0.4]), ohat: x4([0, 0, 0.9, 0]), clap: [0, 0, 0, 0, 0.9, 0, 0, 0, 0, 0, 0, 0, 0.9, 0, 0, 0.4],
             perc: { ride: x4([0.6, 0.3, 0.8, 0.3]), tomHi: [0, 0, 0, 0.5, 0, 0, 0, 0, 0, 0, 0.6, 0, 0, 0, 0, 0],
                     tomLo: [0, 0, 0, 0, 0, 0, 0.6, 0, 0, 0, 0, 0, 0, 0.7, 0, 0], laser: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.7, 0, 0, 0, 0.5, 0] } },
    style: { sweep: 0.3, delayBeats: 0.75, delayFb: 0.45, delayWet: 0.3, reverb: 0.25, pad: 0.06,
             openHat: 0.3, closedHat: 0.26, clap: 0.42, perc: 0.36, hiss: 0 },
    mix: { duck: 0.55, drive: 1.5 },
    sections: [S('intro', 16, 'kick hat'), S('toms', 16, 'kick hat ohat perc bass'),
               S('clap', 16, 'kick hat ohat clap perc bass'), S('break', 8, 'perc pad'),
               S('full', 16, 'kick hat ohat clap perc bass'), S('outro', 8, 'kick hat ohat')],
  },
  {
    id: 'coro', title: 'Coro', artist: 'Catedral', label: 'Betão', chapter: 7,
    genre: 'Peak-time Techno', bpm: 132, root: 46, key: 'Bb minor', camelot: '3A', seed: 661, swing: 0,
    chords: [[0, 3, 7], [0, 3, 7], [-4, 0, 3], [-2, 2, 5]], chordRhythm: [0.9, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    bass: x4([null, 0, null, 0]), bassOct: -12,
    kit: { kick: 'rumble', hat: 'metal', ohat: 'metal', snare: 'clap', chord: 'choir', bass: 'sub', chordOct: 12 },
    drums: { hat: x4([0.5, 0.4, 0.8, 0.4]), ohat: x4([0, 0, 1, 0]), clap: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
             perc: { ride: x4([0.5, 0, 0.7, 0]) } },
    style: { choir: 0.5, choirBeats: 4, sweep: 0.3, delayBeats: 0.75, delayFb: 0.4, delayWet: 0.25, reverb: 0.4, pad: 0.05,
             openHat: 0.3, closedHat: 0.26, clap: 0.4, perc: 0.32, hiss: 0 },
    mix: { duck: 0.6, drive: 1.4 },
    sections: [S('intro', 16, 'kick hat perc'), S('groove', 16, 'kick hat ohat clap perc bass'),
               S('choir', 16, 'kick hat ohat clap perc bass chord'), S('break', 8, 'chord'),
               S('full', 16, 'kick hat ohat clap perc bass chord'), S('outro', 8, 'kick hat perc')],
  },
  {
    id: 'portao', title: 'Portão', artist: 'Luz de Presença', label: 'Fita Dourada', chapter: 7,
    genre: 'Trance Techno', bpm: 130, root: 47, key: 'B minor', camelot: '10A', seed: 673, swing: 0,
    chords: [[0, 3, 7], [0, 3, 7], [-4, 0, 3], [-2, 2, 5]], chordRhythm: x4([0, 0, 0, 0]),
    gate: [1, 0, 0.8, 1, 0, 0.8, 1, 0, 1, 0, 0.8, 1, 0, 0.8, 0, 1],
    bass: x4([null, null, 0, null]), bassOct: -12,
    kit: { kick: 'punch', hat: 'metal', ohat: 'metal', snare: 'clap', bass: 'sub' },
    drums: { hat: x4([0.5, 0.3, 0.7, 0.3]), ohat: x4([0, 0, 1, 0]), clap: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0] },
    style: { gate: 0.32, sweep: 0.3, delayBeats: 0.75, delayFb: 0.4, delayWet: 0.25, reverb: 0.35, pad: 0.06,
             openHat: 0.3, closedHat: 0.24, clap: 0.4, perc: 0.3, hiss: 0 },
    mix: { duck: 0.6, drive: 1.35 },
    sections: [S('intro', 16, 'kick hat'), S('groove', 16, 'kick hat ohat clap bass'),
               S('gate', 16, 'kick hat ohat clap bass gate'), S('break', 8, 'gate pad'),
               S('full', 16, 'kick hat ohat clap bass gate'), S('outro', 8, 'kick hat')],
  },
  {
    id: 'oito-oito', title: 'Oito Oito', artist: 'Máquina Velha', label: 'Rua Baixa', chapter: 7,
    genre: 'Electro Techno', bpm: 128, root: 51, key: 'Eb minor', camelot: '2A', seed: 683, swing: 0.03,
    chords: [[0, 3, 7]], chordRhythm: x4([0, 0, 0, 0]),
    bass: [0, null, null, 0, null, null, 12, null, null, null, 0, null, 10, null, 7, null], bassOct: -12,
    bassSlide: [0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 1, 0],
    kit: { kick: 'deep', hat: 'metal', snare: 'clap', bass: '808' },
    drums: { hat: x4([0.6, 0.3, 0.7, 0.3]), clap: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
             perc: { cowbell: [0, 0, 0, 0, 0, 0, 0, 0.5, 0, 0, 0, 0, 0, 0, 0.4, 0], clapRoll: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.6] } },
    style: { sweep: 0.3, delayBeats: 0.5, delayFb: 0.35, delayWet: 0.2, reverb: 0.2, pad: 0.05,
             openHat: 0.28, closedHat: 0.26, clap: 0.45, perc: 0.34, hiss: 0 },
    mix: { duck: 0.45, drive: 1.3 },
    sections: [S('intro', 8, 'kick hat'), S('intro 2', 8, 'kick hat clap perc'),
               S('boom', 16, 'kick hat clap perc bass'), S('break', 8, 'bass perc'),
               S('full', 16, 'kick hat ohat clap perc bass'), S('groove', 16, 'kick hat clap bass'),
               S('outro', 8, 'kick hat clap')],
  },
  {
    id: 'manha', title: 'Manhã', artist: 'Janela Aberta', label: 'Cais Dub', chapter: 7,
    genre: 'Afterhours', bpm: 120, root: 56, key: 'Ab minor', camelot: '1A', seed: 691, swing: 0.12,
    chords: [[0, 3, 7, 10], [-2, 2, 5, 9]], chordRhythm: x4([0, 0, 0, 0]),
    arp: [0, null, 2, null, 1, null, 3, null, 0, 2, null, 4, null, 3, null, 1],
    bass: [0, null, null, null, null, null, 0, null, null, null, null, null, 7, null, null, null], bassOct: -12,
    kit: { kick: 'deep', hat: 'shaker', snare: 'rim', bass: 'sub', arp: 'kalimba' },
    drums: { hat: x4([0.4, 0.2, 0.5, 0.2]), clap: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.6, 0, 0, 0],
             perc: { rim: [0, 0, 0, 0.3, 0, 0, 0, 0, 0, 0, 0.4, 0, 0, 0, 0, 0] } },
    style: { arp: 0.3, wow: 3, wowRate: 0.5, sweep: 0.2, delayBeats: 0.75, delayFb: 0.5, delayWet: 0.35, reverb: 0.4, pad: 0.07,
             openHat: 0.2, closedHat: 0.26, clap: 0.36, perc: 0.3, hiss: 0.01 },
    mix: { duck: 0.45, drive: 1.1 },
    sections: [S('intro', 16, 'kick hat perc'), S('groove', 16, 'kick hat perc bass'),
               S('kalimba', 16, 'kick hat clap perc bass arp'), S('break', 8, 'arp pad'),
               S('full', 16, 'kick hat clap perc bass arp pad'), S('outro', 8, 'kick hat perc')],
  },
  {
    id: 'fumo', title: 'Fumo', artist: 'Subsolo', label: 'Cais Dub', chapter: 7,
    genre: 'Afterhours Dub', bpm: 118, root: 49, key: 'C# minor', camelot: '12A', seed: 709, swing: 0.08,
    chords: [[0, 3, 7, 10]], chordRhythm: [0, 0, 0.7, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    arp: [0, null, null, null, null, null, 2, null, null, null, null, null, 1, null, null, null],
    bass: [0, null, null, null, null, null, null, 0, null, null, 0, null, null, null, null, null], bassOct: -12,
    kit: { kick: 'deep', hat: 'metal', snare: 'rim', bass: 'sub', arp: 'hang' },
    drums: { hat: x4([0.3, 0.15, 0.5, 0.15]), clap: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.5, 0, 0, 0],
             perc: { congaLo: [0, 0, 0, 0, 0, 0, 0.4, 0, 0, 0, 0, 0, 0, 0, 0.3, 0] } },
    style: { arp: 0.32, wow: 2, wowRate: 0.35, chordCut: 1400, chordFloor: 200, chordQ: 2.2, chordDecay: 0.35,
             sweep: 0.5, delayBeats: 0.75, delayFb: 0.62, delayWet: 0.45, reverb: 0.45, pad: 0.06,
             openHat: 0.18, closedHat: 0.22, clap: 0.34, perc: 0.3, hiss: 0.012 },
    mix: { duck: 0.45, drive: 1.1 },
    sections: [S('intro', 16, 'kick hat'), S('drift', 16, 'kick hat perc bass'),
               S('hang', 16, 'kick hat clap perc bass arp'), S('break', 8, 'arp chord pad'),
               S('full', 16, 'kick hat clap perc bass arp chord'), S('outro', 8, 'kick hat perc')],
  },
];
TRACKS.push(...CHAPTER7);

// ---------- chapter 8: the studio ----------
// Records that sound made, not played: a bitcrusher, a PWM pad with a heavy pump, breakbeat ghost
// snares and stutter rolls, a hard-sync lead, an FM bass and tape stops, a talkbox. Major keys.
const CHAPTER8 = [
  {
    id: 'primeira-demo', title: 'Primeira Demo', artist: 'Quarto 4', label: 'Fita Dourada', chapter: 8,
    genre: 'Lo-fi House', bpm: 121, root: 51, key: 'E♭ major', camelot: '5B', seed: 727, swing: 0.18,
    chords: [[0, 4, 7, 11], [-3, 0, 4, 7]], chordRhythm: [0.8, 0, 0, 0, 0, 0, 0.5, 0, 0, 0, 0.6, 0, 0, 0, 0, 0],
    bass: [0, null, null, 0, null, null, 7, null, 0, null, null, null, 5, null, null, null], bassOct: -12,
    kit: { kick: 'deep', snare: 'snare', chord: 'rhodes', bass: 'sub', chordOct: 0 },
    drums: { hat: x4([0.5, 0.2, 0.6, 0.25]), clap: [0, 0, 0, 0, 0.8, 0, 0, 0, 0, 0, 0, 0, 0.8, 0, 0, 0.3],
             perc: { shaker: x4([0.3, 0.15, 0.3, 0.15]) } },
    style: { crush: [8, 3], sweep: 0.3, delayBeats: 0.75, delayFb: 0.4, delayWet: 0.25, reverb: 0.3, pad: 0.06,
             openHat: 0.2, closedHat: 0.22, clap: 0.36, perc: 0.28, hiss: 0.02 },
    mix: { duck: 0.45, drive: 1.15 },
    sections: [S('intro', 16, 'kick hat perc'), S('groove', 16, 'kick hat clap perc bass'),
               S('keys', 16, 'kick hat clap perc bass chord'), S('break', 8, 'chord pad'),
               S('full', 16, 'kick hat ohat clap perc bass chord'), S('outro', 8, 'kick hat perc')],
  },
  {
    id: 'sala-de-mistura', title: 'Sala de Mistura', artist: 'Os Técnicos', label: 'Rua Baixa', chapter: 8,
    genre: 'French House', bpm: 124, root: 53, key: 'F major', camelot: '7B', seed: 739, swing: 0.06,
    chords: [[0, 4, 7, 11], [2, 5, 9, 12]], chordRhythm: [0.9, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    bass: [0, null, 12, null, 0, null, 12, null, 0, null, 12, null, 0, null, 12, null], bassOct: -12,
    kit: { kick: 'punch', snare: 'clap', chord: 'pwm', bass: 'disco', chordOct: 0 },
    drums: { hat: x4([0.6, 0.3, 0.7, 0.3]), ohat: x4([0, 0, 1, 0]), clap: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
             perc: { tambourine: x4([0, 0.3, 0.6, 0.3]) } },
    style: { pwm: 0.45, padBeats: 4, sweep: 0.8, delayBeats: 0.75, delayFb: 0.3, delayWet: 0.2, reverb: 0.25, pad: 0.05,
             openHat: 0.3, closedHat: 0.26, clap: 0.4, perc: 0.3, hiss: 0 },
    mix: { duck: 0.85, drive: 1.3 },
    sections: [S('intro', 8, 'kick hat'), S('intro 2', 8, 'kick hat ohat clap perc'),
               S('groove', 16, 'kick hat ohat clap perc bass'), S('pump', 16, 'kick hat ohat clap perc bass chord'),
               S('break', 8, 'chord'), S('full', 16, 'kick hat ohat clap perc bass chord'),
               S('outro', 8, 'kick hat ohat clap')],
  },
  {
    id: 'corte', title: 'Corte', artist: 'Lâmina', label: 'Cais Dub', chapter: 8,
    genre: 'Breakbeat House', bpm: 128, root: 55, key: 'G major', camelot: '9B', seed: 743, swing: 0.05,
    chords: [[0, 4, 7], [-3, 0, 4], [-5, -1, 2], [0, 4, 7]], chordRhythm: [0, 0, 0.7, 0, 0, 0, 0, 0, 0, 0, 0.6, 0, 0, 0, 0, 0],
    bass: [0, null, 0, null, null, null, 7, null, 0, null, null, null, 5, null, 7, null], bassOct: -24,
    kit: { kick: 'punch', snare: 'snare', bass: 'sub' },
    drums: { hat: x4([0.6, 0.4, 0.7, 0.4]), ohat: x4([0, 0, 0.8, 0]),
             clap: [0, 0, 0.25, 0, 1, 0, 0, 0.3, 0, 0.25, 0, 0, 1, 0, 0.3, 0.2] },
    fx: { stutter: true },
    style: { chordCut: 1800, chordFloor: 300, chordQ: 2, chordDecay: 0.25, sweep: 0.5, delayBeats: 0.5, delayFb: 0.3, delayWet: 0.2,
             reverb: 0.2, pad: 0.05, openHat: 0.28, closedHat: 0.26, clap: 0.42, perc: 0.3, hiss: 0 },
    mix: { duck: 0.5, drive: 1.4 },
    sections: [S('intro', 8, 'kick hat clap'), S('intro 2', 8, 'kick hat ohat clap'),
               S('groove', 16, 'kick hat ohat clap bass'), S('stabs', 16, 'kick hat ohat clap bass chord'),
               S('break', 8, 'chord pad'), S('full', 16, 'kick hat ohat clap bass chord'),
               S('outro', 8, 'kick hat clap')],
  },
  {
    id: 'sintetizador', title: 'Sintetizador', artist: 'Máquina Velha', label: 'Betão', chapter: 8,
    genre: 'Synth Techno', bpm: 126, root: 48, key: 'C major', camelot: '8B', seed: 751, swing: 0,
    chords: [[0, 4, 7]], chordRhythm: x4([0, 0, 0, 0]),
    lead: [0, null, 7, null, 12, null, 11, null, 7, null, null, 4, null, 5, 7, null], leadOct: 12,
    leadSlide: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0],
    bass: x4([null, null, 0, null]), bassOct: -12,
    kit: { kick: 'punch', hat: 'metal', ohat: 'metal', snare: 'clap', bass: 'sub', lead: 'sync' },
    drums: { hat: x4([0.5, 0.4, 0.7, 0.4]), ohat: x4([0, 0, 1, 0]), clap: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0] },
    style: { lead: 0.28, sweep: 0.3, delayBeats: 0.75, delayFb: 0.45, delayWet: 0.3, reverb: 0.3, pad: 0.05,
             openHat: 0.3, closedHat: 0.26, clap: 0.4, perc: 0.3, hiss: 0 },
    mix: { duck: 0.55, drive: 1.35 },
    sections: [S('intro', 16, 'kick hat'), S('groove', 16, 'kick hat ohat clap bass'),
               S('lead', 16, 'kick hat ohat clap bass lead'), S('break', 8, 'lead pad'),
               S('full', 16, 'kick hat ohat clap bass lead'), S('outro', 8, 'kick hat')],
  },
  {
    id: 'fita-gasta', title: 'Fita Gasta', artist: 'Bobina', label: 'Cais Dub', chapter: 8,
    genre: 'Deep House', bpm: 120, root: 56, key: 'A♭ major', camelot: '4B', seed: 757, swing: 0.12,
    chords: [[0, 4, 7, 11], [5, 9, 12, 16]], chordRhythm: [0.7, 0, 0, 0.4, 0, 0, 0.6, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    bass: [0, null, null, null, null, null, 0, null, null, null, 7, null, null, null, null, null], bassOct: -24,
    kit: { kick: 'deep', snare: 'clap', chord: 'piano', bass: 'fm', chordOct: 0 },
    drums: { hat: x4([0.5, 0.25, 0.6, 0.25]), clap: [0, 0, 0, 0, 0.8, 0, 0, 0, 0, 0, 0, 0, 0.8, 0, 0, 0],
             perc: { shaker: x4([0.3, 0.15, 0.3, 0.15]) } },
    fx: { tapeStop: true },
    style: { sweep: 0.3, delayBeats: 0.75, delayFb: 0.4, delayWet: 0.25, reverb: 0.3, pad: 0.07,
             openHat: 0.22, closedHat: 0.24, clap: 0.36, perc: 0.28, hiss: 0.01 },
    mix: { duck: 0.45, drive: 1.15 },
    sections: [S('intro', 16, 'kick hat perc'), S('groove', 16, 'kick hat clap perc bass'),
               S('piano', 16, 'kick hat clap perc bass chord'), S('break', 8, 'chord pad'),
               S('full', 16, 'kick hat ohat clap perc bass chord'), S('outro', 8, 'kick hat perc')],
  },
  {
    id: 'rejeitado', title: 'Rejeitado', artist: 'Carta Devolvida', label: 'Fita Dourada', chapter: 8,
    genre: 'Funky House', bpm: 123, root: 46, key: 'B♭ major', camelot: '6B', seed: 769, swing: 0.15,
    chords: [[0, 4, 7, 10]], chordRhythm: x4([0, 0, 0, 0]),
    lead: [0, null, 4, null, 7, null, null, 9, null, 7, null, 4, 2, null, 0, null], leadOct: 12,
    bass: [0, null, 12, null, 0, null, 10, null, 0, null, 12, null, 7, null, 10, null], bassOct: 0,
    kit: { kick: 'punch', snare: 'clap', bass: 'disco', lead: 'talk' },
    drums: { hat: x4([0.6, 0.3, 0.7, 0.3]), ohat: x4([0, 0, 0.9, 0]), clap: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
             perc: { tambourine: x4([0.2, 0, 0.5, 0]) } },
    style: { lead: 0.32, sweep: 0.3, delayBeats: 0.5, delayFb: 0.3, delayWet: 0.2, reverb: 0.2, pad: 0.05,
             openHat: 0.3, closedHat: 0.26, clap: 0.42, perc: 0.3, hiss: 0 },
    mix: { duck: 0.55, drive: 1.3 },
    sections: [S('intro', 8, 'kick hat'), S('intro 2', 8, 'kick hat ohat clap perc'),
               S('groove', 16, 'kick hat ohat clap perc bass'), S('talk', 16, 'kick hat ohat clap perc bass lead'),
               S('break', 8, 'lead pad bass'), S('full', 16, 'kick hat ohat clap perc bass lead'),
               S('outro', 8, 'kick hat ohat clap')],
  },
];
TRACKS.push(...CHAPTER8);

// ---------- chapter 9: on the road ----------
// A record from each stop: Berlin, Amsterdam, Ibiza, Detroit, the burnout, the way home.
// New sounds: ring-modulated stabs, a phaser, castanets, a chorus, reversed swells, a whistle.
const CHAPTER9 = [
  {
    id: 'berlim', title: 'Berlim', artist: 'Fábrica Fria', label: 'Betão', chapter: 9,
    genre: 'Hypnotic Techno', bpm: 130, root: 48, key: 'C minor', camelot: '5A', seed: 787, swing: 0,
    chords: [[0, 3, 7]], chordRhythm: [0, 0, 0, 0.8, 0, 0, 0, 0, 0, 0, 0.6, 0, 0, 0, 0, 0],
    bass: x4([null, 0, 0, null]), bassOct: -12,
    kit: { kick: 'rumble', hat: 'metal', ohat: 'metal', snare: 'clap', chord: 'ring', bass: 'sub', chordOct: 12 },
    drums: { hat: x4([0.5, 0.4, 0.8, 0.4]), ohat: x4([0, 0, 1, 0]), clap: [0, 0, 0, 0, 0.8, 0, 0, 0, 0, 0, 0, 0, 0.8, 0, 0, 0],
             perc: { ride: x4([0.5, 0, 0.6, 0]) } },
    style: { sweep: 0.5, delayBeats: 0.75, delayFb: 0.55, delayWet: 0.35, reverb: 0.35, pad: 0.05,
             openHat: 0.3, closedHat: 0.26, clap: 0.38, perc: 0.32, hiss: 0.004 },
    mix: { duck: 0.6, drive: 1.4 },
    sections: [S('intro', 16, 'kick hat perc'), S('groove', 16, 'kick hat ohat clap perc bass'),
               S('ring', 16, 'kick hat ohat clap perc bass chord'), S('break', 8, 'chord pad'),
               S('full', 16, 'kick hat ohat clap perc bass chord'), S('outro', 8, 'kick hat perc')],
  },
  {
    id: 'canal', title: 'Canal', artist: 'Bicicleta', label: 'Rua Baixa', chapter: 9,
    genre: 'Progressive House', bpm: 126, root: 55, key: 'G minor', camelot: '6A', seed: 797, swing: 0,
    chords: [[0, 3, 7, 10], [-4, 0, 3, 7], [-2, 2, 5, 9], [-5, -2, 2, 5]], chordRhythm: x4([0, 0, 0, 0]),
    arp: [0, 2, 1, 3, 2, 4, 1, 3, 0, 2, 1, 3, 2, 4, 3, 5],
    bass: x4([null, null, 0, null]), bassOct: -24,
    kit: { kick: 'punch', hat: 'metal', ohat: 'metal', snare: 'clap', bass: 'sub', arp: 'pluck' },
    drums: { hat: x4([0.5, 0.3, 0.7, 0.3]), ohat: x4([0, 0, 1, 0]), clap: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0] },
    style: { arp: 0.22, phaser: 0.12, sweep: 0.6, delayBeats: 0.75, delayFb: 0.45, delayWet: 0.3, reverb: 0.35, pad: 0.07,
             openHat: 0.3, closedHat: 0.24, clap: 0.4, perc: 0.3, hiss: 0 },
    mix: { duck: 0.55, drive: 1.3 },
    sections: [S('intro', 16, 'kick hat'), S('groove', 16, 'kick hat ohat clap bass'),
               S('arp', 16, 'kick hat ohat clap bass arp'), S('break', 8, 'arp pad'),
               S('full', 16, 'kick hat ohat clap bass arp pad'), S('outro', 8, 'kick hat')],
  },
  {
    id: 'sal', title: 'Sal', artist: 'Cala Este', label: 'Fita Dourada', chapter: 9,
    genre: 'Balearic House', bpm: 120, root: 50, key: 'D major', camelot: '10B', seed: 809, swing: 0.1,
    chords: [[0, 4, 7], [-3, 0, 4], [5, 9, 12], [7, 11, 14]], chordRhythm: [0.6, 0, 0, 0.4, 0, 0, 0.5, 0, 0, 0, 0.4, 0, 0, 0, 0, 0],
    bass: [0, null, null, 0, null, null, 7, null, 0, null, null, null, 5, null, 7, null], bassOct: -12,
    kit: { kick: 'deep', snare: 'rim', chord: 'guitar', bass: 'organ', chordOct: 12 },
    drums: { hat: x4([0.4, 0.2, 0.5, 0.2]), clap: [0, 0, 0, 0, 0.6, 0, 0, 0, 0, 0, 0, 0, 0.6, 0, 0, 0],
             perc: { castanet: [0, 0, 0, 0, 0, 0, 0.7, 0, 0, 0, 0, 0.6, 0, 0, 0.8, 0], congaLo: [0, 0, 0, 0, 0, 0, 0, 0, 0.5, 0, 0, 0, 0, 0, 0, 0] } },
    style: { sweep: 0.2, delayBeats: 0.75, delayFb: 0.35, delayWet: 0.25, reverb: 0.35, pad: 0.06,
             openHat: 0.2, closedHat: 0.22, clap: 0.34, perc: 0.3, hiss: 0.008 },
    mix: { duck: 0.4, drive: 1.1 },
    sections: [S('intro', 16, 'kick hat perc'), S('groove', 16, 'kick hat clap perc bass'),
               S('guitar', 16, 'kick hat clap perc bass chord'), S('break', 8, 'chord pad perc'),
               S('full', 16, 'kick hat clap perc bass chord pad'), S('outro', 8, 'kick hat perc')],
  },
  {
    id: 'oito-milhas', title: 'Oito Milhas', artist: 'Linha de Montagem', label: 'Betão', chapter: 9,
    genre: 'Detroit Techno', bpm: 132, root: 51, key: 'E♭ minor', camelot: '2A', seed: 821, swing: 0.04,
    chords: [[0, 3, 7, 10], [-2, 2, 5, 9]], chordRhythm: [0.8, 0, 0, 0, 0, 0, 0.6, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    bass: x4([null, 0, null, 0]), bassOct: -12,
    kit: { kick: 'punch', hat: 'metal', ohat: 'metal', snare: 'clap', chord: 'stab', bass: 'sub' },
    drums: { hat: x4([0.6, 0.4, 0.8, 0.4]), ohat: x4([0, 0, 1, 0]), clap: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
             perc: { ride: x4([0.4, 0, 0.6, 0]) } },
    style: { chorus: 3, chordCut: 2200, chordFloor: 300, chordQ: 1.6, chordDecay: 0.4, strings: 0.07,
             sweep: 0.4, delayBeats: 0.75, delayFb: 0.4, delayWet: 0.25, reverb: 0.3, pad: 0.05,
             openHat: 0.3, closedHat: 0.26, clap: 0.4, perc: 0.3, hiss: 0 },
    mix: { duck: 0.55, drive: 1.35 },
    sections: [S('intro', 16, 'kick hat perc'), S('groove', 16, 'kick hat ohat clap perc bass'),
               S('chords', 16, 'kick hat ohat clap perc bass chord'), S('break', 8, 'chord strings'),
               S('full', 16, 'kick hat ohat clap perc bass chord strings'), S('outro', 8, 'kick hat perc')],
  },
  {
    id: 'cansaco', title: 'Cansaço', artist: 'Quarto de Hotel', label: 'Cais Dub', chapter: 9,
    genre: 'Downtempo', bpm: 112, root: 56, key: 'A♭ minor', camelot: '1A', seed: 829, swing: 0.14,
    chords: [[0, 3, 7, 10], [-4, 0, 3, 7]], chordRhythm: x4([0, 0, 0, 0]),
    bass: [0, null, null, null, null, null, null, null, -5, null, null, null, null, null, null, null], bassOct: -24,
    kit: { kick: 'deep', hat: 'shaker', snare: 'rim', bass: 'sub' },
    drums: { hat: x4([0.3, 0.15, 0.4, 0.15]), clap: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.5, 0, 0, 0] },
    style: { swell: 0.16, wow: 2.5, wowRate: 0.3, sweep: 0.2, delayBeats: 0.75, delayFb: 0.5, delayWet: 0.35, reverb: 0.5, pad: 0.06,
             openHat: 0.16, closedHat: 0.2, clap: 0.3, perc: 0.26, hiss: 0.014 },
    mix: { duck: 0.35, drive: 1.05 },
    sections: [S('intro', 16, 'kick hat'), S('drift', 16, 'kick hat clap bass'),
               S('swell', 16, 'kick hat clap bass swell'), S('break', 8, 'swell pad'),
               S('full', 16, 'kick hat clap bass swell pad'), S('outro', 8, 'kick hat')],
  },
  {
    id: 'regresso', title: 'Regresso', artist: 'Margem Sul', label: 'Rua Baixa', chapter: 9,
    genre: 'Afro House', bpm: 122, root: 57, key: 'A major', camelot: '11B', seed: 839, swing: 0.12,
    chords: [[0, 4, 7]], chordRhythm: x4([0, 0, 0, 0]),
    arp: [0, null, 1, null, 2, null, 1, 0, null, 2, null, 1, 0, null, 2, null],
    lead: [12, null, null, 12, null, null, 7, null, 9, null, null, 7, null, 4, null, null], leadOct: 12,
    bass: [0, null, null, 0, null, null, 0, null, null, null, 7, null, 5, null, null, null], bassOct: -12,
    kit: { kick: 'deep', hat: 'shaker', snare: 'rim', bass: 'sub', arp: 'marimba', lead: 'whistle' },
    drums: { hat: x4([0.4, 0.2, 0.5, 0.3]), clap: [0, 0, 0, 0, 0.6, 0, 0, 0, 0, 0, 0, 0, 0.6, 0, 0, 0],
             perc: { congaHi: [0, 0, 0.5, 0, 0, 0.4, 0, 0, 0, 0, 0.5, 0, 0, 0.4, 0, 0.3], congaLo: [0.5, 0, 0, 0, 0, 0, 0, 0.5, 0, 0, 0, 0, 0.5, 0, 0, 0],
                      tomLo: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.5, 0] } },
    style: { arp: 0.24, lead: 0.16, sweep: 0.2, delayBeats: 0.5, delayFb: 0.35, delayWet: 0.25, reverb: 0.3, pad: 0.05,
             openHat: 0.2, closedHat: 0.22, clap: 0.34, perc: 0.34, hiss: 0 },
    mix: { duck: 0.45, drive: 1.15 },
    sections: [S('intro', 16, 'kick hat perc'), S('groove', 16, 'kick hat clap perc bass'),
               S('marimba', 16, 'kick hat clap perc bass arp'), S('break', 8, 'perc lead'),
               S('full', 16, 'kick hat clap perc bass arp lead'), S('outro', 8, 'kick hat perc')],
  },
];
TRACKS.push(...CHAPTER9);

// ---------- chapter 10: festivals ----------
// Big rooms and open air: snare-roll builds, an anthem saw lead, orchestra hits, a crowd that
// sings, a bowed cello bass, rain on the tent. From the sunset slot (118) to the main stage (128).
const CHAPTER10 = [
  {
    id: 'por-do-sol', title: 'Pôr do Sol', artist: 'Duna', label: 'Cais Dub', chapter: 10,
    genre: 'Organic House', bpm: 118, root: 53, key: 'F minor', camelot: '4A', seed: 853, swing: 0.1,
    chords: [[0, 3, 7, 10], [-4, 0, 3, 7]], chordRhythm: x4([0, 0, 0, 0]),
    arp: [0, null, null, 2, null, null, 1, null, 3, null, null, 2, null, 1, null, null],
    bass: [0, null, null, null, null, null, null, null, -2, null, null, null, null, null, null, null], bassOct: -12,
    kit: { kick: 'deep', hat: 'shaker', snare: 'rim', bass: 'cello', arp: 'pluck' },
    drums: { hat: x4([0.4, 0.2, 0.5, 0.2]), clap: [0, 0, 0, 0, 0.5, 0, 0, 0, 0, 0, 0, 0, 0.5, 0, 0, 0],
             perc: { congaLo: [0, 0, 0, 0, 0, 0, 0.5, 0, 0, 0, 0, 0, 0, 0.4, 0, 0] } },
    style: { arp: 0.24, sweep: 0.3, delayBeats: 0.75, delayFb: 0.5, delayWet: 0.35, reverb: 0.45, pad: 0.07,
             openHat: 0.18, closedHat: 0.22, clap: 0.32, perc: 0.3, hiss: 0.008 },
    mix: { duck: 0.4, drive: 1.1 },
    sections: [S('intro', 16, 'kick hat perc'), S('cello', 16, 'kick hat clap perc bass'),
               S('pluck', 16, 'kick hat clap perc bass arp'), S('break', 8, 'bass arp pad'),
               S('full', 16, 'kick hat clap perc bass arp pad'), S('outro', 8, 'kick hat perc')],
  },
  {
    id: 'chuva', title: 'Chuva', artist: 'Lona', label: 'Cais Dub', chapter: 10,
    genre: 'Dub Techno', bpm: 120, root: 46, key: 'B♭ minor', camelot: '3A', seed: 863, swing: 0.04,
    chords: [[0, 3, 7, 10]], chordRhythm: [0, 0, 0.7, 0, 0, 0, 0, 0, 0, 0, 0.5, 0, 0, 0, 0, 0],
    bass: x4([0, null, null, null]), bassOct: 0,
    kit: { kick: 'deep', hat: 'metal', snare: 'rim', bass: 'sub', chordOct: 12 },
    drums: { hat: x4([0.3, 0.2, 0.5, 0.2]), clap: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.5, 0, 0, 0] },
    style: { rain: 0.05, chordCut: 1400, chordFloor: 200, chordQ: 2.4, chordDecay: 0.35, sweep: 0.6,
             delayBeats: 0.75, delayFb: 0.65, delayWet: 0.45, reverb: 0.5, pad: 0.06,
             openHat: 0.18, closedHat: 0.22, clap: 0.32, perc: 0.3, hiss: 0.01 },
    mix: { duck: 0.45, drive: 1.1 },
    sections: [S('intro', 16, 'kick hat'), S('dub', 16, 'kick hat bass chord'),
               S('deep', 16, 'kick hat clap bass chord'), S('break', 8, 'chord pad'),
               S('full', 16, 'kick hat clap bass chord pad'), S('outro', 8, 'kick hat')],
  },
  {
    id: 'floresta', title: 'Floresta', artist: 'Clareira', label: 'Fita Dourada', chapter: 10,
    genre: 'Melodic Techno', bpm: 122, root: 48, key: 'C minor', camelot: '5A', seed: 877, swing: 0,
    chords: [[0, 3, 7, 10], [-4, 0, 3, 7], [-2, 2, 5, 9], [-5, -2, 2, 5]], chordRhythm: x4([0, 0, 0, 0]),
    arp: [0, 1, 2, 3, 2, 1, 0, 1, 2, 3, 4, 3, 2, 1, 2, 3],
    bass: x4([null, 0, null, 0]), bassOct: -12,
    kit: { kick: 'rumble', hat: 'metal', ohat: 'metal', snare: 'clap', bass: 'sub', arp: 'bell' },
    drums: { hat: x4([0.5, 0.3, 0.7, 0.3]), ohat: x4([0, 0, 0.9, 0]), clap: [0, 0, 0, 0, 0.9, 0, 0, 0, 0, 0, 0, 0, 0.9, 0, 0, 0] },
    style: { arp: 0.16, crowd: 0.05, sweep: 0.5, delayBeats: 0.75, delayFb: 0.55, delayWet: 0.4, reverb: 0.45, pad: 0.07,
             openHat: 0.28, closedHat: 0.24, clap: 0.38, perc: 0.3, hiss: 0 },
    mix: { duck: 0.55, drive: 1.3 },
    sections: [S('intro', 16, 'kick hat'), S('groove', 16, 'kick hat ohat clap bass'),
               S('melody', 16, 'kick hat ohat clap bass arp'), S('break', 8, 'arp pad crowd'),
               S('full', 16, 'kick hat ohat clap bass arp pad crowd'), S('outro', 8, 'kick hat')],
  },
  {
    id: 'tenda', title: 'Tenda', artist: 'Lona', label: 'Rua Baixa', chapter: 10,
    genre: 'Tech House', bpm: 124, root: 55, key: 'G minor', camelot: '6A', seed: 883, swing: 0.12,
    chords: [[0, 3, 7]], chordRhythm: x4([0, 0, 0, 0]),
    vox: [0, 0, 0, 0, 0, 0, 0.8, 0, 0, 0, 0, 0, 0, 0.6, 0, 0], vowel: 'hey', voxOct: 12, voxLen: 0.14,
    bass: [0, null, 0, null, null, 7, null, 0, null, null, 10, null, 0, null, null, 7], bassOct: -24,
    kit: { kick: 'punch', snare: 'clap', bass: 'fm', vox: 'robot' },
    drums: { hat: x4([0.6, 0.3, 0.6, 0.3]), ohat: x4([0, 0, 0.9, 0]), clap: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
             perc: { tambourine: x4([0, 0.3, 0.5, 0.3]) } },
    fx: { roll: true },
    style: { vox: 0.24, sweep: 0.4, delayBeats: 0.5, delayFb: 0.3, delayWet: 0.2, reverb: 0.25, pad: 0.05,
             openHat: 0.3, closedHat: 0.26, clap: 0.42, perc: 0.3, hiss: 0 },
    mix: { duck: 0.5, drive: 1.35 },
    sections: [S('intro', 8, 'kick hat'), S('intro 2', 8, 'kick hat ohat clap perc'),
               S('groove', 16, 'kick hat ohat clap perc bass'), S('hey', 16, 'kick hat ohat clap perc bass vox'),
               S('break', 8, 'bass vox'), S('full', 16, 'kick hat ohat clap perc bass vox'),
               S('outro', 8, 'kick hat ohat clap')],
  },
  {
    id: 'encore', title: 'Encore', artist: 'Mil Vozes', label: 'Fita Dourada', chapter: 10,
    genre: 'Piano Anthem', bpm: 126, root: 48, key: 'C major', camelot: '8B', seed: 887, swing: 0.04,
    chords: [[0, 4, 7], [-3, 0, 4], [-7, -3, 0], [-5, -1, 2]], chordRhythm: [0.8, 0, 0, 0.5, 0, 0, 0.6, 0, 0, 0, 0.5, 0, 0.6, 0, 0, 0],
    bass: x4([null, null, 0, null]), bassOct: -12,
    kit: { kick: 'punch', snare: 'clap', chord: 'piano', bass: 'organ', chordOct: 12 },
    drums: { hat: x4([0.5, 0.3, 0.7, 0.3]), ohat: x4([0, 0, 1, 0]), clap: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0] },
    fx: { roll: true },
    style: { crowd: 0.08, sweep: 0.3, delayBeats: 0.75, delayFb: 0.35, delayWet: 0.25, reverb: 0.35, pad: 0.06,
             openHat: 0.3, closedHat: 0.26, clap: 0.42, perc: 0.3, hiss: 0 },
    mix: { duck: 0.55, drive: 1.3 },
    sections: [S('intro', 16, 'kick hat'), S('piano', 16, 'kick hat ohat clap bass chord'),
               S('sing', 16, 'kick hat ohat clap bass chord crowd'), S('break', 8, 'chord crowd'),
               S('full', 16, 'kick hat ohat clap bass chord crowd'), S('outro', 8, 'kick hat')],
  },
  {
    id: 'palco-principal', title: 'Palco Principal', artist: 'Sessenta Mil', label: 'Betão', chapter: 10,
    genre: 'Festival Techno', bpm: 128, root: 50, key: 'D minor', camelot: '7A', seed: 899, swing: 0,
    chords: [[0, 3, 7]], chordRhythm: x4([0, 0, 0, 0]),
    lead: [0, null, null, 0, null, null, 3, null, 5, null, null, 3, null, 0, null, null], leadOct: 12,
    leadSlide: [0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0],
    bass: x4([null, 0, 0, 0]), bassOct: -12,
    kit: { kick: 'rumble', hat: 'metal', ohat: 'metal', snare: 'clap', bass: 'sub', lead: 'saw' },
    drums: { hat: x4([0.5, 0.4, 0.8, 0.4]), ohat: x4([0, 0, 1, 0]), clap: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
             perc: { orch: [0.9, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] } },
    fx: { roll: true },
    style: { lead: 0.2, sweep: 0.4, delayBeats: 0.75, delayFb: 0.4, delayWet: 0.3, reverb: 0.4, pad: 0.06,
             openHat: 0.3, closedHat: 0.26, clap: 0.4, perc: 0.3, hiss: 0 },
    mix: { duck: 0.6, drive: 1.4 },
    sections: [S('intro', 16, 'kick hat'), S('build', 16, 'kick hat ohat clap bass'),
               S('drop', 16, 'kick hat ohat clap bass lead perc'), S('break', 8, 'lead pad'),
               S('drop 2', 16, 'kick hat ohat clap bass lead perc'), S('outro', 8, 'kick hat')],
  },
];
TRACKS.push(...CHAPTER10);

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
  retune(type, f, q) { // new coefficients, same memory: a filter that moves without clicks
    const c = new Biquad(type, f, q);
    this.b0 = c.b0; this.b1 = c.b1; this.b2 = c.b2; this.a1 = c.a1; this.a2 = c.a2;
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

// ---------- more instruments (chapter 2 on: each record picks its own with `kit`) ----------
function sine(freq, phase = 0) { // recursive sine: cheap enough to run dozens at once
  const w = 2 * Math.PI * freq / SR, k = 2 * Math.cos(w);
  let y1 = Math.sin(phase - w), y2 = Math.sin(phase - 2 * w);
  return () => { const y = k * y1 - y2; y2 = y1; y1 = y; return y; };
}
const add = (b, i, y, pan = 0) => { b.L[i] += y * (1 - pan * 0.5); b.R[i] += y * (1 + pan * 0.5); };

function kickDeep(b, t0, amp) { // long and round, little click
  const n = Math.floor(0.5 * SR);
  let ph = 0;
  for (let i = 0; i < n && t0 + i < b.L.length; i++) {
    const t = i / SR;
    ph += 2 * Math.PI * (42 + 80 * Math.exp(-t * 20) + 260 * Math.exp(-t * 260)) / SR;
    add(b, t0 + i, amp * Math.tanh(1.4 * Math.sin(ph)) * Math.exp(-t * 5.5) * (1 - Math.exp(-t * 6000)));
  }
}
function kickPunch(b, t0, amp) { // short, hard, driven
  const n = Math.floor(0.26 * SR);
  let ph = 0;
  for (let i = 0; i < n && t0 + i < b.L.length; i++) {
    const t = i / SR;
    ph += 2 * Math.PI * (54 + 170 * Math.exp(-t * 48) + 700 * Math.exp(-t * 420)) / SR;
    add(b, t0 + i, 0.92 * amp * Math.tanh(2.8 * Math.sin(ph)) * Math.exp(-t * 13) * (1 - Math.exp(-t * 6000)));
  }
}
const METAL = [205.3, 304.4, 369.6, 522.7, 540.0, 800.0]; // six square waves, as in the old drum machines
function hatMetal(b, t0, amp, decay, pan = 0, cut = 7200) {
  const n = Math.floor(decay * 6 * SR), f = new Biquad('hp', cut, 0.9), f2 = new Biquad('hp', cut * 1.15, 0.7), ph = METAL.map(() => 0);
  for (let i = 0; i < n && t0 + i < b.L.length; i++) {
    let x = 0;
    for (let k = 0; k < 6; k++) { ph[k] += METAL[k] * 1.4 / SR; if (ph[k] >= 1) ph[k] -= 1; x += ph[k] < 0.5 ? 1 : -1; }
    add(b, t0 + i, f2.run(f.run(x / 6)) * Math.exp(-(i / SR) / decay) * amp * 1.6, pan);
  }
}
function shaker(b, t0, amp, rnd, pan = 0) {
  const n = Math.floor(0.09 * SR), f = new Biquad('bp', 6500, 1.2), f2 = new Biquad('hp', 3000, 0.7);
  for (let i = 0; i < n && t0 + i < b.L.length; i++) {
    const t = i / SR;
    add(b, t0 + i, f2.run(f.run(rnd() * 2 - 1)) * Math.min(1, t / 0.008) * Math.exp(-t * 35) * amp * 2.2, pan);
  }
}
function snare(b, t0, amp, rnd) {
  const n = Math.floor(0.25 * SR), s1 = sine(185), s2 = sine(330), fn = new Biquad('bp', 3200, 0.8), hp = new Biquad('hp', 180, 0.7);
  for (let i = 0; i < n && t0 + i < b.L.length; i++) {
    const t = i / SR;
    const tone = (s1() * 0.6 + s2() * 0.4) * Math.exp(-t * 22), noise = fn.run(rnd() * 2 - 1) * Math.exp(-t * 16) * 1.8;
    add(b, t0 + i, hp.run(tone + noise) * amp);
  }
}
function rim(b, t0, amp, rnd, pan = 0) {
  const n = Math.floor(0.05 * SR), s1 = sine(1720), s2 = sine(830);
  for (let i = 0; i < n && t0 + i < b.L.length; i++) {
    const t = i / SR;
    add(b, t0 + i, ((s1() * 0.6 + s2() * 0.5) * Math.exp(-t * 110) + (rnd() - 0.5) * Math.exp(-t * 500) * 0.4) * amp, pan);
  }
}
function conga(b, t0, amp, f0, pan, rnd) {
  const n = Math.floor(0.35 * SR);
  let ph = 0;
  for (let i = 0; i < n && t0 + i < b.L.length; i++) {
    const t = i / SR;
    ph += 2 * Math.PI * f0 * (1 + 0.5 * Math.exp(-t * 90)) / SR;
    add(b, t0 + i, (Math.sin(ph) * Math.exp(-t * (f0 > 250 ? 16 : 11)) + (rnd() * 2 - 1) * Math.exp(-t * 400) * 0.3) * amp, pan);
  }
}
function cowbell(b, t0, amp) {
  const n = Math.floor(0.3 * SR), f = new Biquad('bp', 2400, 1.2);
  let p1 = 0, p2 = 0;
  for (let i = 0; i < n && t0 + i < b.L.length; i++) {
    const t = i / SR;
    p1 += 587 / SR; p2 += 845 / SR; p1 -= Math.floor(p1); p2 -= Math.floor(p2);
    const x = (p1 < 0.5 ? 1 : -1) + (p2 < 0.5 ? 1 : -1);
    add(b, t0 + i, f.run(x) * (Math.exp(-t * 30) * 0.6 + Math.exp(-t * 8) * 0.4) * amp * 2, 0.25);
  }
}
function piano(b, t0, notes, amp, len, rnd) { // house piano: bright partials, a hammer, a short release
  const n = Math.floor((len + 0.25) * SR), parts = [], fn = new Biquad('bp', 2500, 1.5);
  for (const m of notes) for (let k = 1; k <= 5; k++)
    parts.push({ o: sine(hz(m) * k * (1 + 0.0005 * k * k), rnd() * 6.28), a: 1 / k ** 1.5, e: 1, d: Math.exp(-(2.2 + 1.3 * k) / SR) });
  for (let i = 0; i < n && t0 + i < b.L.length; i++) {
    const t = i / SR;
    let x = 0;
    for (const p of parts) { x += p.o() * p.a * p.e; p.e *= p.d; }
    const rel = t < len ? 1 : Math.exp(-(t - len) * 14);
    const y = (x / notes.length + fn.run(rnd() * 2 - 1) * Math.exp(-t * 300) * 0.4) * Math.min(1, t * 2000) * rel * amp;
    b.L[t0 + i] += y * 0.95; b.R[t0 + i] += y;
  }
}
function organ(b, t0, notes, amp, rnd) { // the classic 90s house organ stab
  const n = Math.floor(0.42 * SR), oscs = [];
  for (const m of notes) for (const [k, a] of [[1, 1], [2, 0.7], [3, 0.2], [4, 0.3]]) oscs.push([sine(hz(m) * k, rnd() * 6.28), a]);
  for (let i = 0; i < n && t0 + i < b.L.length; i++) {
    const t = i / SR;
    let x = 0;
    for (const [o, a] of oscs) x += o() * a;
    const env = Math.min(1, t * 700) * Math.exp(-t * 9);
    add(b, t0 + i, Math.tanh(1.5 * (x / notes.length * 0.6 * env + (rnd() * 2 - 1) * Math.exp(-t * 900) * 0.15)) * amp);
  }
}
function rhodes(b, t0, notes, amp, rnd) { // FM electric piano with a slow stereo tremolo
  const n = Math.floor(1.6 * SR), v = notes.map((m) => ({ f: hz(m), pc: rnd() * 6.28, pm: 0, pt: 0 }));
  for (let i = 0; i < n && t0 + i < b.L.length; i++) {
    const t = i / SR, idx = 1.6 * Math.exp(-t * 7) + 0.25, bell = 0.6 * Math.exp(-t * 30);
    let x = 0;
    for (const o of v) {
      o.pc += 2 * Math.PI * o.f / SR; o.pm += 2 * Math.PI * o.f / SR; o.pt += 2 * Math.PI * o.f * 14 / SR;
      x += Math.sin(o.pc + idx * Math.sin(o.pm) + bell * Math.sin(o.pt));
    }
    const y = x / notes.length * Math.exp(-t * 1.7) * Math.min(1, t * 330) * amp, pan = 0.35 * Math.sin(2 * Math.PI * 4.2 * t);
    b.L[t0 + i] += y * (1 - pan); b.R[t0 + i] += y * (1 + pan);
  }
}
function pluck(b, t0, m, amp, rnd, pan = 0, ring = 0.996) { // plucked string (Karplus-Strong)
  const N = Math.max(2, Math.round(SR / hz(m))), buf = new Float32Array(N), n = Math.floor(0.9 * SR);
  let lp = 0;
  for (let k = 0; k < N; k++) { lp += ((rnd() * 2 - 1) - lp) * 0.6; buf[k] = lp; }
  let j = 0;
  for (let i = 0; i < n && t0 + i < b.L.length; i++) {
    const y = buf[j], nx = buf[(j + 1) % N];
    buf[j] = (y + nx) * 0.5 * ring;
    j = (j + 1) % N;
    add(b, t0 + i, y * amp * Math.min(1, i / 40), pan);
  }
}
function acidNote(b, t0, m, len, amp, accent, from, st, open) { // the squelchy little bass box
  const n = Math.floor((len + 0.05) * SR), f = new SVF(), f1 = hz(m), fA = from != null ? hz(from) : f1;
  let ph = 0;
  for (let i = 0; i < n && t0 + i < b.L.length; i++) {
    const t = i / SR, fq = f1 + (fA - f1) * Math.exp(-t * 40), dt = fq / SR;
    ph += dt; if (ph >= 1) ph -= 1;
    let s = 2 * ph - 1;
    if (ph < dt) { const u = ph / dt; s -= u + u - u * u - 1; } else if (ph > 1 - dt) { const u = (ph - 1) / dt; s -= u * u + u + u + 1; }
    if ((i & 7) === 0) f.set(st.acidCut * (0.4 + open) + st.acidEnv * (accent ? 1.7 : 1) * Math.exp(-t * (accent ? 8 : 14)), st.acidQ);
    const env = Math.min(1, t * 400) * (t < len ? 1 : Math.exp(-(t - len) * 60));
    add(b, t0 + i, Math.tanh(1.8 * f.lp(s)) * env * amp * (accent ? 1.25 : 1));
  }
}
function subNote(b, t0, m, len, amp) {
  const n = Math.floor((len + 0.05) * SR), o1 = sine(hz(m)), o2 = sine(hz(m) * 2);
  for (let i = 0; i < n && t0 + i < b.L.length; i++) {
    const t = i / SR, env = Math.min(1, t * 300) * (t < len ? 1 : Math.exp(-(t - len) * 50));
    add(b, t0 + i, Math.tanh(1.3 * (o1() + 0.3 * o2())) * env * amp);
  }
}
function reeseNote(b, t0, m, len, amp, rnd) {
  const n = Math.floor((len + 0.08) * SR), a = saw(hz(m), -14, rnd()), c = saw(hz(m), 14, rnd()), o = sine(hz(m) / 2), f = new SVF();
  f.set(420, 0.9);
  for (let i = 0; i < n && t0 + i < b.L.length; i++) {
    const t = i / SR, env = Math.min(1, t * 200) * (t < len ? 1 : Math.exp(-(t - len) * 40));
    add(b, t0 + i, Math.tanh(1.2 * (f.lp((a() + c()) * 0.5) + 0.5 * o())) * env * amp);
  }
}
function organBass(b, t0, m, len, amp) {
  const n = Math.floor((len + 0.05) * SR), o1 = sine(hz(m)), o2 = sine(hz(m) * 2);
  for (let i = 0; i < n && t0 + i < b.L.length; i++) {
    const t = i / SR, env = Math.min(1, t * 500) * Math.exp(-t * 4) * (t < len ? 1 : Math.exp(-(t - len) * 40));
    add(b, t0 + i, Math.tanh(1.6 * (o1() + 0.6 * o2())) * env * amp);
  }
}
const VOWELS = { ah: [800, 1150, 2900], oh: [450, 800, 2830], hey: [600, 1900, 2600] };
function vox(b, t0, m, len, amp, vowel, rnd, pan = 0) { // a sung or shouted syllable from a buzz and three formants
  const n = Math.floor((len + 0.1) * SR), fm = VOWELS[vowel] || VOWELS.ah;
  const fs = fm.map((f, k) => new Biquad('bp', f, [6, 8, 10][k])), w = [1, 0.6, 0.3];
  let ph = 0;
  for (let i = 0; i < n && t0 + i < b.L.length; i++) {
    const t = i / SR, fq = hz(m) * (1 + (vowel === 'hey' ? 0.12 * Math.exp(-t * 10) : 0.006 * Math.sin(2 * Math.PI * 5.5 * t))), dt = fq / SR;
    ph += dt; if (ph >= 1) ph -= 1;
    const src = 2 * ph - 1 + (rnd() - 0.5) * 0.15;
    let y = 0;
    for (let k = 0; k < 3; k++) y += fs[k].run(src) * w[k];
    const env = Math.min(1, t * 80) * (t < len ? 1 : Math.exp(-(t - len) * 25));
    add(b, t0 + i, y * env * amp * 2.5, pan);
  }
}

// ---------- chapter 3 sounds: the record shop's rare-groove wall ----------
function strings(b, t0, notes, len, amp, rnd) { // a string machine: many detuned saws, slow bow, wide
  const n = Math.floor((len + 0.5) * SR), L = [], R = [], hp = [new Biquad('hp', 180, 0.7), new Biquad('hp', 180, 0.7)], lp = [new SVF(), new SVF()];
  lp[0].set(3200, 0.7); lp[1].set(3400, 0.7);
  for (const m of notes) for (const d of [-14, -5, 6, 15]) { L.push(saw(hz(m + 12), d, rnd())); R.push(saw(hz(m + 12), -d * 0.8, rnd())); }
  for (let i = 0; i < n && t0 + i < b.L.length; i++) {
    const t = i / SR, env = Math.min(1, t / 0.18) * (t < len ? 1 : Math.exp(-(t - len) * 6));
    let l = 0, r = 0;
    for (const o of L) l += o();
    for (const o of R) r += o();
    b.L[t0 + i] += lp[0].lp(hp[0].run(l / L.length)) * env * amp;
    b.R[t0 + i] += lp[1].lp(hp[1].run(r / R.length)) * env * amp;
  }
}
function brass(b, t0, notes, amp, rnd) { // a short synth-brass stab: saws through a quickly opening filter
  const n = Math.floor(0.35 * SR), f = new SVF(), oscs = [];
  for (const m of notes) for (const d of [-7, 7]) oscs.push(saw(hz(m), d, rnd()));
  for (let i = 0; i < n && t0 + i < b.L.length; i++) {
    const t = i / SR;
    if ((i & 15) === 0) f.set(400 + 3800 * Math.min(1, t * 30) * Math.exp(-t * 7), 1.2);
    let x = 0;
    for (const o of oscs) x += o();
    add(b, t0 + i, f.lp(x / oscs.length) * Math.min(1, t * 400) * Math.exp(-t * 6) * amp);
  }
}
function clav(b, t0, m, amp, rnd, pan = 0) { // funky clavinet-ish pluck: a narrow pulse, bright and short
  const n = Math.floor(0.22 * SR), f = new SVF(), dt = hz(m) / SR;
  let ph = rnd();
  for (let i = 0; i < n && t0 + i < b.L.length; i++) {
    const t = i / SR;
    ph += dt; if (ph >= 1) ph -= 1;
    if ((i & 15) === 0) f.set(900 + 4200 * Math.exp(-t * 25), 2.2);
    add(b, t0 + i, f.lp(ph < 0.22 ? 1 : -0.28) * Math.exp(-t * 14) * Math.min(1, t * 2000) * amp, pan);
  }
}
function discoBass(b, t0, m, len, amp) { // round, plucked, the octave-jumping disco bass
  const n = Math.floor((len + 0.04) * SR), o = saw(hz(m)), s1 = sine(hz(m)), f = new SVF();
  for (let i = 0; i < n && t0 + i < b.L.length; i++) {
    const t = i / SR;
    if ((i & 15) === 0) f.set(180 + 1400 * Math.exp(-t * 22), 1.1);
    const env = Math.min(1, t * 500) * Math.exp(-t * 5) * (t < len ? 1 : Math.exp(-(t - len) * 80));
    add(b, t0 + i, Math.tanh(1.4 * (f.lp(o()) * 0.8 + s1() * 0.6)) * env * amp);
  }
}
function lead(b, t0, m, len, amp, from, kind, rnd, pan = 0) { // a monophonic synth lead: glide and vibrato
  const n = Math.floor((len + 0.12) * SR), f = new SVF(), f1 = hz(m), fA = from != null ? hz(from) : f1;
  const talk = kind === 'talk' ? [new Biquad('bp', 300, 5), new Biquad('bp', 870, 7), new Biquad('bp', 2240, 9)] : null;
  let ph = rnd(), ps = 0, ph3 = rnd();
  for (let i = 0; i < n && t0 + i < b.L.length; i++) {
    const t = i / SR, vib = 1 + 0.008 * Math.sin(2 * Math.PI * 5.2 * t) * Math.min(1, t * 3);
    const fq = (f1 + (fA - f1) * Math.exp(-t * 30)) * vib, dt = fq / SR;
    ph += dt;
    let wrapped = false;
    if (ph >= 1) { ph -= 1; wrapped = true; }
    let x;
    if (kind === 'sync') { // hard sync: a second saw restarted by this one, its pitch sweeping down: the tearing sound
      const ratio = 1.5 + 2.5 * Math.exp(-t * 7);
      ps = wrapped ? ph * ratio : ps + dt * ratio;
      ps -= Math.floor(ps);
      x = 2 * ps - 1;
    } else if (kind === 'talk') { // talkbox: a buzzing saw through a mouth that opens from 'oo' to 'ah' on every note
      const s0 = 2 * ph - 1;
      if ((i & 63) === 0) { const o = Math.min(1, t / 0.09); talk[0].retune('bp', 300 + 500 * o, 5); talk[1].retune('bp', 870 + 280 * o, 7); }
      x = 2.5 * (talk[0].run(s0) + 0.6 * talk[1].run(s0) + 0.3 * talk[2].run(s0));
    } else if (kind === 'saw') { // the anthem lead: three saws, one a touch sharp, one a touch flat
      ps += dt * 1.006; ps -= Math.floor(ps);
      ph3 += dt * 0.994; ph3 -= Math.floor(ph3);
      x = ((2 * ph - 1) + (2 * ps - 1) + (2 * ph3 - 1)) / 2;
    } else if (kind === 'whistle') { // a pea whistle / flute-ish: a pure tone with breath, sharp attack
      x = Math.sin(2 * Math.PI * ph) * (1 + 0.15 * Math.sin(2 * Math.PI * 28 * t)) + (rnd() - 0.5) * 0.12;
    } else if (kind === 'reed') x = Math.sin(2 * Math.PI * ph) + 0.5 * Math.sin(4 * Math.PI * ph) + 0.35 * Math.sin(6 * Math.PI * ph); // breathy and soft
    else if (kind === 'flute') x = Math.sin(2 * Math.PI * ph) + 0.12 * Math.sin(4 * Math.PI * ph) + (rnd() - 0.5) * 0.18 * Math.exp(-t * 6);
    else x = ph < 0.5 ? 1 : -1; // square
    if ((i & 15) === 0) f.set(kind === 'reed' ? 2400 : kind === 'flute' ? 3500 : kind === 'sync' ? 4500 : kind === 'talk' ? 5000 : kind === 'whistle' ? 6000 : kind === 'saw' ? 3000 + 3000 * Math.exp(-t * 6) : 1800 + 1600 * Math.exp(-t * 8), 1);
    const env = Math.min(1, t * (kind === 'reed' ? 40 : kind === 'flute' ? 25 : 300)) * (t < len ? 1 : Math.exp(-(t - len) * 30));
    add(b, t0 + i, (f.lp(x) + (kind === 'reed' ? (rnd() - 0.5) * 0.05 : 0)) * env * amp, pan);
  }
}
function tambourine(b, t0, amp, rnd, pan = 0) { // shaken jingles: bright noise with a ringing edge
  const n = Math.floor(0.16 * SR), f = new Biquad('bp', 8200, 2.5), f2 = new Biquad('bp', 11500, 3), s1 = sine(6800), s2 = sine(9100);
  for (let i = 0; i < n && t0 + i < b.L.length; i++) {
    const t = i / SR, x = rnd() * 2 - 1;
    add(b, t0 + i, (f.run(x) + f2.run(x) * 0.7 + (s1() + s2()) * 0.04) * Math.min(1, t / 0.004) * Math.exp(-t * 26) * amp * 2.2, pan);
  }
}

// ---------- chapter 4 sounds: pubs, beach bars, terraces ----------
function marimba(b, t0, m, amp, pan = 0) { // a wooden bar: a sine and its bright fourth partial, both dying fast
  const n = Math.floor(0.7 * SR), o1 = sine(hz(m)), o4 = sine(hz(m) * 3.93), o10 = sine(hz(m) * 9.2);
  let e1 = 1, e4 = 1, e10 = 1;
  const d1 = Math.exp(-5 / SR), d4 = Math.exp(-22 / SR), d10 = Math.exp(-60 / SR);
  for (let i = 0; i < n && t0 + i < b.L.length; i++) {
    const y = (o1() * e1 + 0.35 * o4() * e4 + 0.12 * o10() * e10) * Math.min(1, i / 30) * amp;
    e1 *= d1; e4 *= d4; e10 *= d10;
    add(b, t0 + i, y, pan);
  }
}
function guitarStrum(b, t0, notes, amp, rnd, up = false) { // six plucked strings, a few ms apart, brighter than `pluck`
  const order = up ? [...notes].reverse() : notes;
  order.forEach((m, k) => pluck(b, t0 + Math.round(k * 0.009 * SR), m, amp / Math.sqrt(notes.length), rnd, (k / Math.max(1, notes.length - 1) - 0.5) * 0.5, 0.993));
}
function tom(b, t0, amp, f0, pan, rnd) {
  const n = Math.floor(0.45 * SR);
  let ph = 0;
  for (let i = 0; i < n && t0 + i < b.L.length; i++) {
    const t = i / SR;
    ph += 2 * Math.PI * f0 * (1 + 0.6 * Math.exp(-t * 25)) / SR;
    add(b, t0 + i, (Math.tanh(1.5 * Math.sin(ph)) * Math.exp(-t * 7) + (rnd() - 0.5) * Math.exp(-t * 200) * 0.4) * amp, pan);
  }
}

// ---------- chapter 5 sounds: the radio station ----------
function bell(b, t0, m, amp, pan = 0) { // FM bell: an inharmonic modulator, a long shimmering tail
  const n = Math.floor(1.4 * SR), f = hz(m);
  let pc = 0, pm = 0;
  for (let i = 0; i < n && t0 + i < b.L.length; i++) {
    const t = i / SR;
    pc += 2 * Math.PI * f / SR; pm += 2 * Math.PI * f * 3.5 / SR;
    add(b, t0 + i, Math.sin(pc + 2.2 * Math.exp(-t * 4) * Math.sin(pm)) * Math.exp(-t * 3.2) * Math.min(1, i / 20) * amp, pan);
  }
}
function supersaw(b, t0, notes, amp, rnd, len = 0.3) { // seven detuned saws per note through an opening filter
  const n = Math.floor((len + 0.15) * SR), fl = new SVF(), fr = new SVF(), L = [], R = [];
  for (const m of notes) for (const d of [-21, -13, -6, 0, 6, 13, 21]) { L.push(saw(hz(m), d, rnd())); R.push(saw(hz(m), -d, rnd())); }
  for (let i = 0; i < n && t0 + i < b.L.length; i++) {
    const t = i / SR;
    if ((i & 15) === 0) { const c = 900 + 5200 * Math.exp(-t * 6); fl.set(c, 0.9); fr.set(c * 1.05, 0.9); }
    let l = 0, r = 0;
    for (const o of L) l += o();
    for (const o of R) r += o();
    const env = Math.min(1, t * 300) * (t < len ? 1 : Math.exp(-(t - len) * 20));
    b.L[t0 + i] += fl.lp(l / L.length) * env * amp;
    b.R[t0 + i] += fr.lp(r / R.length) * env * amp;
  }
}
function wobbleNote(b, t0, m, len, amp, beatSec) { // a saw bass whose filter swings in eighths
  const n = Math.floor((len + 0.04) * SR), a = saw(hz(m), -6), c = saw(hz(m), 6), o = sine(hz(m)), f = new SVF();
  for (let i = 0; i < n && t0 + i < b.L.length; i++) {
    const t = i / SR;
    if ((i & 15) === 0) f.set(160 + 1500 * (0.5 - 0.5 * Math.cos(2 * Math.PI * t / (beatSec / 2))), 2.2);
    const env = Math.min(1, t * 400) * (t < len ? 1 : Math.exp(-(t - len) * 60));
    add(b, t0 + i, Math.tanh(1.5 * (f.lp((a() + c()) * 0.5) + 0.5 * o())) * env * amp);
  }
}
function robot(b, t0, m, len, amp, vowel, pan = 0) { // a vocoded syllable: a square wave through the formants
  const n = Math.floor((len + 0.08) * SR), fm = VOWELS[vowel] || VOWELS.oh;
  const fs = fm.map((f, k) => new Biquad('bp', f, [7, 9, 11][k])), w = [1, 0.7, 0.4], dt = hz(m) / SR;
  let ph = 0;
  for (let i = 0; i < n && t0 + i < b.L.length; i++) {
    const t = i / SR;
    ph += dt; if (ph >= 1) ph -= 1;
    const src = ph < 0.5 ? 1 : -1;
    let y = 0;
    for (let k = 0; k < 3; k++) y += fs[k].run(src) * w[k];
    const env = Math.min(1, t * 200) * (t < len ? 1 : Math.exp(-(t - len) * 40));
    add(b, t0 + i, y * env * amp * 2, pan);
  }
}

// ---------- chapter 6 sounds: club CAVE, the door, the dark room ----------
function rumbleKick(b, t0, amp, rnd) { // a kick with a long, filtered, rolling low tail
  kick(b, t0, amp);
  const n = Math.floor(0.45 * SR), f = new SVF();
  f.set(110, 1.4);
  let ph = 0;
  for (let i = 0; i < n && t0 + i < b.L.length; i++) {
    const t = i / SR;
    ph += 2 * Math.PI * 48 / SR;
    const x = Math.sin(ph) * 0.6 + (rnd() * 2 - 1) * 0.4;
    add(b, t0 + i, f.lp(x) * Math.min(1, t / 0.05) * Math.exp(-t * 6) * amp * 0.7);
  }
}
function clang(b, t0, amp, rnd, pan = 0) { // an industrial hit: noise ringing in a short comb
  const n = Math.floor(0.4 * SR), d = Math.round(SR / 410), buf = new Float32Array(d), hp = new Biquad('hp', 300, 0.7);
  let j = 0;
  for (let i = 0; i < n && t0 + i < b.L.length; i++) {
    const t = i / SR, x = (rnd() * 2 - 1) * Math.exp(-t * 60);
    const y = x + buf[j] * 0.93;
    buf[j] = y; j = (j + 1) % d;
    add(b, t0 + i, hp.run(y) * Math.exp(-t * 7) * amp * 0.35, pan);
  }
}
function hoover(b, t0, notes, amp, rnd, len = 0.5) { // the rave stab: fat detuned saws diving in pitch
  const n = Math.floor((len + 0.1) * SR), f = new SVF(), v = [];
  for (const m of notes) for (const d of [-25, -9, 9, 25]) v.push({ f: hz(m) * 2 ** (d / 1200), ph: rnd() });
  for (let i = 0; i < n && t0 + i < b.L.length; i++) {
    const t = i / SR, bend = 2 ** ((-5 * (1 - Math.exp(-t * 6))) / 12);
    let x = 0;
    for (const o of v) { o.ph += o.f * bend / SR; if (o.ph >= 1) o.ph -= 1; x += 2 * o.ph - 1; }
    if ((i & 15) === 0) f.set(700 + 2600 * Math.exp(-t * 5), 1.3);
    const env = Math.min(1, t * 200) * (t < len ? 1 : Math.exp(-(t - len) * 25));
    add(b, t0 + i, Math.tanh(1.3 * f.lp(x / v.length)) * env * amp);
  }
}
// ---------- chapter 7 sounds: the resident, peak time and afterhours ----------
function choir(b, t0, notes, len, amp, rnd, vowel = 'ah') { // a held choir: sixteen buzzing voices with their own vibrato, one set of formants
  const n = Math.floor((len + 0.8) * SR), fm = VOWELS[vowel] || VOWELS.ah, w = [1, 0.55, 0.25];
  const fl = fm.map((f, k) => new Biquad('bp', f, [5, 7, 9][k])), fr = fm.map((f, k) => new Biquad('bp', f * 1.02, [5, 7, 9][k]));
  const voices = [];
  for (const m of notes) for (const d of [-14, -5, 6, 15]) voices.push({ f: hz(m) * 2 ** (d / 1200), ph: rnd(), v: rnd() * 6.28, right: d > 0 });
  const half = voices.length / 2;
  for (let i = 0; i < n && t0 + i < b.L.length; i++) {
    const t = i / SR;
    let l = 0, r = 0;
    for (const o of voices) {
      o.ph += o.f * (1 + 0.004 * Math.sin(2 * Math.PI * 5.2 * t + o.v)) / SR;
      if (o.ph >= 1) o.ph -= 1;
      if (o.right) r += 2 * o.ph - 1; else l += 2 * o.ph - 1;
    }
    let yl = 0, yr = 0;
    for (let k = 0; k < 3; k++) { yl += fl[k].run(l / half) * w[k]; yr += fr[k].run(r / half) * w[k]; }
    const env = Math.min(1, t / 0.35) * (t < len ? 1 : Math.exp(-(t - len) * 5));
    b.L[t0 + i] += yl * env * amp; b.R[t0 + i] += yr * env * amp;
  }
}
function gatedSaws(b, t0, notes, len, amp, rnd, pattern, stepLen) { // a held supersaw chord chopped into sixteenths: the trance gate
  const n = Math.floor(len * SR), fl = new SVF(), fr = new SVF(), L = [], R = [];
  for (const m of notes) for (const d of [-17, -8, 0, 8, 17]) { L.push(saw(hz(m), d, rnd())); R.push(saw(hz(m), -d, rnd())); }
  fl.set(2600, 0.8); fr.set(2800, 0.8);
  let g = 0;
  for (let i = 0; i < n && t0 + i < b.L.length; i++) {
    const t = i / SR, s = Math.floor(t / stepLen) % 16, into = (t % stepLen) / stepLen;
    g += ((pattern[s] > 0 && into < 0.7 ? pattern[s] : 0) - g) * 0.0045; // about 5 ms each way, no clicks
    let l = 0, r = 0;
    for (const o of L) l += o();
    for (const o of R) r += o();
    b.L[t0 + i] += fl.lp(l / L.length) * g * amp;
    b.R[t0 + i] += fr.lp(r / R.length) * g * amp;
  }
}
function boom808(b, t0, m, len, amp, from) { // the long 808 drum tuned as a bassline: a sine that slides in and rings out
  const n = Math.floor((len + 0.25) * SR), f1 = hz(m), f0 = from != null ? hz(from) : f1 * 1.6, k = from != null ? 30 : 45;
  let ph = 0;
  for (let i = 0; i < n && t0 + i < b.L.length; i++) {
    const t = i / SR;
    ph += 2 * Math.PI * (f1 + (f0 - f1) * Math.exp(-t * k)) / SR;
    const env = Math.min(1, t * 600) * (t < len ? Math.exp(-t * 1.2) : Math.exp(-len * 1.2 - (t - len) * 18));
    add(b, t0 + i, Math.tanh(1.8 * Math.sin(ph)) * env * amp);
  }
}
function laser(b, t0, amp, pan = 0) { // the 'pew': a square wave diving from 3 kHz
  const n = Math.floor(0.16 * SR);
  let ph = 0;
  for (let i = 0; i < n && t0 + i < b.L.length; i++) {
    const t = i / SR;
    ph += (180 + 3200 * Math.exp(-t * 32)) / SR; if (ph >= 1) ph -= 1;
    add(b, t0 + i, (ph < 0.5 ? 1 : -1) * Math.exp(-t * 22) * amp * 0.25, pan);
  }
}
function kalimba(b, t0, m, amp, pan = 0) { // a thumb piano: a soft tine, two high partials dying fast, and the buzz of the bridge
  const n = Math.floor(1.1 * SR), o1 = sine(hz(m)), o2 = sine(hz(m) * 5.95), o3 = sine(hz(m) * 9.8);
  let e1 = 1, e2 = 1, e3 = 1;
  const d1 = Math.exp(-3.2 / SR), d2 = Math.exp(-18 / SR), d3 = Math.exp(-45 / SR);
  for (let i = 0; i < n && t0 + i < b.L.length; i++) {
    const f = o1();
    const y = (f * e1 + 0.3 * o2() * e2 + 0.15 * o3() * e3) * (1 + 0.12 * Math.sign(f) * e2) * Math.min(1, i / 12) * amp;
    e1 *= d1; e2 *= d2; e3 *= d3;
    add(b, t0 + i, y, pan);
  }
}
function hang(b, t0, m, amp, pan = 0) { // a handpan: a round note with its octave and its fifth above ringing in
  const n = Math.floor(2.2 * SR), o1 = sine(hz(m)), o2 = sine(hz(m) * 2.01), o3 = sine(hz(m) * 2.99);
  for (let i = 0; i < n && t0 + i < b.L.length; i++) {
    const t = i / SR;
    const y = o1() * Math.exp(-t * 1.8) + 0.45 * o2() * Math.exp(-t * 2.6) * Math.min(1, t / 0.02) + 0.25 * o3() * Math.exp(-t * 3.5) * Math.min(1, t / 0.06);
    add(b, t0 + i, y * Math.min(1, i / 60) * amp * (1 + 0.08 * Math.sin(2 * Math.PI * 4 * t)), pan);
  }
}
function wow(b, depthMs, rate) { // tape wobble: the whole bus drifts a little sharp and flat, slowly
  const n = b.L.length, depth = depthMs / 1000 * SR;
  for (const ch of [b.L, b.R]) {
    const src = Float32Array.from(ch);
    for (let i = 0; i < n; i++) {
      const j = i - depth * (1 + Math.sin(2 * Math.PI * rate * i / SR)), k = Math.floor(j), f = j - k;
      ch[i] = k >= 0 && k + 1 < n ? src[k] * (1 - f) + src[k + 1] * f : 0;
    }
  }
}
// ---------- chapter 8 sounds: the studio ----------
function pwmPad(b, t0, notes, len, amp) { // a pulse-width-modulated pad: squares whose width breathes slowly, a little detuned left and right
  const n = Math.floor((len + 0.5) * SR), fl = new SVF(), fr = new SVF();
  fl.set(1800, 0.7); fr.set(2000, 0.7);
  const v = notes.map((m, k) => ({ f: hz(m), a: k * 0.13, b: k * 0.29 + 0.5 }));
  for (let i = 0; i < n && t0 + i < b.L.length; i++) {
    const t = i / SR, w = 0.5 + 0.38 * Math.sin(2 * Math.PI * 0.35 * t), dc = 2 * w - 1;
    let l = 0, r = 0;
    for (const o of v) {
      o.a += o.f * 1.003 / SR; if (o.a >= 1) o.a -= 1;
      o.b += o.f * 0.997 / SR; if (o.b >= 1) o.b -= 1;
      l += (o.a < w ? 1 : -1) - dc; r += (o.b < w ? 1 : -1) - dc;
    }
    const env = Math.min(1, t / 0.4) * (t < len ? 1 : Math.exp(-(t - len) * 4));
    b.L[t0 + i] += fl.lp(l / v.length) * env * amp;
    b.R[t0 + i] += fr.lp(r / v.length) * env * amp;
  }
}
function fmBass(b, t0, m, len, amp) { // the 80s 'solid bass': a sine bent by a sine of its own pitch, the bite dying fast
  const n = Math.floor((len + 0.05) * SR), w = 2 * Math.PI * hz(m) / SR;
  let pc = 0, pm = 0;
  for (let i = 0; i < n && t0 + i < b.L.length; i++) {
    const t = i / SR;
    pc += w; pm += w;
    const env = Math.min(1, t * 500) * (t < len ? 1 : Math.exp(-(t - len) * 40));
    add(b, t0 + i, Math.sin(pc + (0.6 + 3 * Math.exp(-t * 18)) * Math.sin(pm)) * env * amp);
  }
}
function crush(b, bits, hold) { // lo-fi: fewer bits and a lower sample rate (each sample held for `hold`)
  const q = 2 ** (bits - 1);
  for (const ch of [b.L, b.R]) {
    let held = 0;
    for (let i = 0; i < ch.length; i++) { if (i % hold === 0) held = Math.round(ch[i] * q) / q; ch[i] = held; }
  }
}
function paste(mix, src, len, to, end) { // copies a slice of the finished mix over a later spot, with 2 ms fades at both ends
  const L = mix.L.slice(src, src + len), R = mix.R.slice(src, src + len), e = 88;
  for (let i = 0; i < len && to + i < end; i++) {
    const g = Math.min(1, i / e, (len - 1 - i) / e);
    mix.L[to + i] = L[i] * g; mix.R[to + i] = R[i] * g;
  }
}
function stutterRoll(mix, from, beatLen, end) { // a beat-repeat roll over the last two beats: an eighth twice, then a sixteenth four times
  const e8 = beatLen >> 1, e16 = beatLen >> 2;
  paste(mix, from, e8, from + e8, end);
  for (let k = 0; k < 4; k++) paste(mix, from + beatLen, e16, from + beatLen + k * e16, end);
}
function tapeStop(mix, from, len) { // the last beat slows to a halt, like a tape machine switched off
  const L = mix.L.slice(from, from + len), R = mix.R.slice(from, from + len);
  let pos = 0;
  for (let i = 0; i < len; i++) {
    const k = Math.floor(pos), f = pos - k, g = 1 - i / len;
    mix.L[from + i] = k + 1 < len ? (L[k] * (1 - f) + L[k + 1] * f) * g : 0;
    mix.R[from + i] = k + 1 < len ? (R[k] * (1 - f) + R[k + 1] * f) * g : 0;
    pos += 1 - i / len;
  }
}
// ---------- chapter 9 sounds: on the road ----------
function ringStab(b, t0, notes, amp, rnd) { // a ring-modulated stab: a saw chord times a sine at an odd ratio, metallic, short
  const n = Math.floor(0.35 * SR), f = new SVF(), oscs = [], ring = sine(hz(notes[0]) * 3.17);
  for (const m of notes) oscs.push(saw(hz(m), (rnd() - 0.5) * 8, rnd()));
  for (let i = 0; i < n && t0 + i < b.L.length; i++) {
    const t = i / SR;
    if ((i & 15) === 0) f.set(400 + 3600 * Math.exp(-t * 14), 1.6);
    let x = 0;
    for (const o of oscs) x += o();
    const y = f.lp(x / oscs.length * ring()) * Math.exp(-t * 9) * Math.min(1, t * 600) * amp;
    b.L[t0 + i] += y; b.R[t0 + i] += y;
  }
}
function castanet(b, t0, amp, rnd, pan = 0) { // two quick wooden clicks: noise through a narrow band at 2.6 kHz
  const n = Math.floor(0.05 * SR), bp = new Biquad('bp', 2600, 6);
  for (let i = 0; i < n && t0 + i < b.L.length; i++) {
    const t = i / SR, hit = Math.exp(-t * 400) + 0.7 * (t > 0.016 ? Math.exp(-(t - 0.016) * 400) : 0);
    add(b, t0 + i, bp.run(rnd() * 2 - 1) * hit * amp * 3, pan);
  }
}
function swell(b, t0, notes, len, amp, rnd) { // a reversed swell: a pad that grows into the downbeat and stops dead
  const n = Math.floor(len * SR), fl = new SVF(), fr = new SVF(), L = [], R = [];
  for (const m of notes) { L.push(saw(hz(m), -9, rnd())); R.push(saw(hz(m), 9, rnd())); }
  for (let i = 0; i < n && t0 + i < b.L.length; i++) {
    const t = i / SR, rise = Math.pow(t / len, 3);
    if ((i & 15) === 0) { fl.set(300 + 3000 * rise, 0.8); fr.set(330 + 3000 * rise, 0.8); }
    let l = 0, r = 0;
    for (const o of L) l += o();
    for (const o of R) r += o();
    const cut = i > n - 40 ? (n - i) / 40 : 1;
    b.L[t0 + i] += fl.lp(l / L.length) * rise * cut * amp;
    b.R[t0 + i] += fr.lp(r / R.length) * rise * cut * amp;
  }
}
function phaser(b, rate, depth) { // four moving all-pass stages mixed with the dry sound: the sweeping 'whoosh'
  for (const [ch, off] of [[b.L, 0], [b.R, Math.PI / 2]]) {
    const z = [0, 0, 0, 0];
    for (let i = 0; i < ch.length; i++) {
      const lfo = 0.5 + 0.5 * Math.sin(2 * Math.PI * rate * i / SR + off);
      const fc = 300 + 2700 * lfo * depth, a = (Math.tan(Math.PI * fc / SR) - 1) / (Math.tan(Math.PI * fc / SR) + 1);
      let x = ch[i];
      for (let k = 0; k < 4; k++) { const y = a * x + z[k]; z[k] = x - a * y; x = y; }
      ch[i] = (ch[i] + x) * 0.6;
    }
  }
}
function chorus(b, depthMs, rate) { // two slowly moving copies a few ms late, opposite in each ear: the wide 80s synth
  const n = b.L.length, base = 0.012 * SR, depth = depthMs / 1000 * SR;
  const L = Float32Array.from(b.L), R = Float32Array.from(b.R);
  for (let i = 0; i < n; i++) {
    const m = Math.sin(2 * Math.PI * rate * i / SR);
    const tap = (src, d) => { const j = i - d, k = Math.floor(j), f = j - k; return k >= 0 && k + 1 < n ? src[k] * (1 - f) + src[k + 1] * f : 0; };
    b.L[i] = L[i] * 0.7 + tap(R, base + depth * (1 + m)) * 0.5;
    b.R[i] = R[i] * 0.7 + tap(L, base + depth * (1 - m)) * 0.5;
  }
}
// ---------- chapter 10 sounds: festivals ----------
function snareRoll(b, t0, len, amp, rnd) { // the build: snare hits doubling in speed over the bar, getting louder
  const beat = len / 4;
  let t = 0;
  for (const per of [1, 2, 4, 8]) { // per beat: quarters, eighths, sixteenths, thirty-seconds
    for (let k = 0; k < per; k++) {
      const at = t0 + Math.round((t + k * beat / per) * SR), grow = (t + k * beat / per) / len;
      snare(b, at, amp * (0.35 + 0.65 * grow), rnd);
    }
    t += beat;
  }
}
function orchHit(b, t0, m, amp, rnd) { // the stadium hit: a big saw chord (root, fifth, octave) and a timpani thump
  const n = Math.floor(0.6 * SR), f = new SVF(), oscs = [];
  for (const k of [0, 7, 12, 19]) for (const d of [-12, 12]) oscs.push(saw(hz(m + k), d, rnd()));
  let ph = 0;
  for (let i = 0; i < n && t0 + i < b.L.length; i++) {
    const t = i / SR;
    if ((i & 15) === 0) f.set(600 + 5000 * Math.exp(-t * 9), 0.9);
    let x = 0;
    for (const o of oscs) x += o();
    ph += 2 * Math.PI * hz(m - 24) * (1 + Math.exp(-t * 30)) / SR;
    const y = f.lp(x / oscs.length) * Math.exp(-t * 5) * 1.2 + Math.sin(ph) * Math.exp(-t * 8) * 0.9;
    add(b, t0 + i, y * Math.min(1, t * 800) * amp);
  }
}
function crowd(b, t0, len, amp, rnd) { // a crowd singing 'oh' and cheering: noise and buzz through two vowels, swelling
  const n = Math.floor(len * SR), fo = VOWELS.oh.map((f, k) => new Biquad('bp', f, [4, 6, 8][k])), w = [1, 0.6, 0.3];
  const fa = VOWELS.ah.map((f, k) => new Biquad('bp', f, [4, 6, 8][k]));
  for (let i = 0; i < n && t0 + i < b.L.length; i++) {
    const t = i / SR, x = rnd() * 2 - 1, mix = 0.5 + 0.5 * Math.sin(2 * Math.PI * t / len);
    let y = 0;
    for (let k = 0; k < 3; k++) y += (fo[k].run(x) * (1 - mix) + fa[k].run(x) * mix) * w[k];
    const env = Math.sin(Math.PI * Math.min(1, t / len));
    add(b, t0 + i, y * env * amp, (rnd() - 0.5) * 0.6);
  }
}
function celloNote(b, t0, m, len, amp, rnd) { // a bowed low string: saws with a slow bow, vibrato, a dark body
  const n = Math.floor((len + 0.2) * SR), f = new SVF(), f1 = hz(m);
  let p1 = rnd(), p2 = rnd();
  f.set(700, 1.1);
  for (let i = 0; i < n && t0 + i < b.L.length; i++) {
    const t = i / SR, vib = 1 + 0.005 * Math.sin(2 * Math.PI * 5.5 * t) * Math.min(1, t * 2);
    p1 += f1 * vib / SR; if (p1 >= 1) p1 -= 1;
    p2 += f1 * 1.003 * vib / SR; if (p2 >= 1) p2 -= 1;
    const env = Math.min(1, t / 0.12) * (t < len ? 1 : Math.exp(-(t - len) * 12));
    add(b, t0 + i, f.lp((2 * p1 - 1) + (2 * p2 - 1)) * 0.5 * env * amp);
  }
}
function rain(b, amp, rnd) { // rain on a tent: a soft hiss and scattered drops, the whole record long
  const lp = new Biquad('lp', 6000, 0.7), hp = new Biquad('hp', 900, 0.7);
  for (let i = 0; i < b.L.length; i++) {
    let x = hp.run(lp.run(rnd() * 2 - 1)) * 0.35;
    if (rnd() < 0.0009) x += (rnd() * 2 - 1) * 2.5; // a drop
    b.L[i] += x * amp; b.R[i] += (x * 0.7 + (rnd() * 2 - 1) * 0.08) * amp;
  }
}
function hatVoice(kind, b, t0, amp, decay, rnd, pan) {
  if (kind === 'metal') hatMetal(b, t0, amp, decay, pan);
  else if (kind === 'shaker') shaker(b, t0, amp, rnd, pan);
  else hat(b, t0, amp, decay, rnd, pan);
}
function snareVoice(kind, b, t0, amp, rnd) {
  if (kind === 'snare') snare(b, t0, amp, rnd);
  else if (kind === 'rim') rim(b, t0, amp, rnd);
  else clap(b, t0, amp, rnd);
}
let currentRoot = 50; // the key of the record being made (for pitched percussion: the orchestra hit)
function perc(name, b, t0, amp, rnd, s) {
  if (name === 'congaHi') conga(b, t0, amp, 290, 0.35, rnd);
  else if (name === 'congaLo') conga(b, t0, amp, 190, -0.3, rnd);
  else if (name === 'cowbell') cowbell(b, t0, amp * 0.6);
  else if (name === 'shaker') shaker(b, t0, amp * 0.6, rnd, s % 2 ? 0.3 : -0.3);
  else if (name === 'rim') rim(b, t0, amp * 0.8, rnd, -0.2);
  else if (name === 'ride') hatMetal(b, t0, amp * 0.5, 0.09, 0.15, 5200);
  else if (name === 'tambourine') tambourine(b, t0, amp * 0.6, rnd, s % 2 ? 0.25 : -0.15);
  else if (name === 'tomHi') tom(b, t0, amp * 0.7, 165, 0.3, rnd);
  else if (name === 'tomLo') tom(b, t0, amp * 0.8, 105, -0.3, rnd);
  else if (name === 'clang') clang(b, t0, amp, rnd, s % 2 ? 0.4 : -0.4);
  else if (name === 'orch') orchHit(b, t0, currentRoot, amp, rnd);
  else if (name === 'castanet') castanet(b, t0, amp, rnd, s % 2 ? 0.35 : -0.35);
  else if (name === 'laser') laser(b, t0, amp, s % 4 > 1 ? 0.5 : -0.5);
  else if (name === 'clapRoll') { clap(b, t0, amp * 0.5, rnd); clap(b, t0 + Math.round(0.03 * SR), amp * 0.35, rnd); }
}

// ---------- one track ----------
function render(tr) {
  const rnd = rng(tr.seed), st = tr.style;
  currentRoot = tr.root;
  const beat = 60 / tr.bpm, step = beat / 4, barLen = beat * 4;
  const sections = tr.sections || (tr.arrangement === 'long' ? ARRANGEMENT_LONG : ARRANGEMENT);
  const kit = tr.kit || {}, dr = tr.drums || {}, mx = tr.mix || {};
  const kickFn = kit.kick === 'deep' ? kickDeep : kit.kick === 'punch' ? kickPunch : kit.kick === 'rumble' ? (b, t, a) => rumbleKick(b, t, a, rnd) : kick;
  const duckDepth = mx.duck ?? 0.6, drive = mx.drive ?? 1.15;
  let lastBass = null, lastLead = null;
  const bars = sections.reduce((a, s) => a + s.bars, 0);
  const N = Math.ceil((bars * barLen + 0.02) * SR); // the last sound stops with the last bar
  const drums = bus(N), low = bus(N), keys = bus(N), air = bus(N);
  const duck = new Float32Array(N).fill(1);
  const at = (bar, s) => Math.round(((bar * 16 + s) * step + (s % 2 ? tr.swing * step : 0)) * SR);

  let bar = 0;
  const fills = [];
  sections.forEach((sec, si) => {
    const has = (x) => sec.on.includes(x);
    for (let k = 0; k < sec.bars; k++, bar++) {
      const fill = k === sec.bars - 1 && si < sections.length - 1;
      if (fill) fills.push({ at: at(bar, 0), end: at(bar + 1, 0), next: sections[si + 1].name });
      const chord = tr.chords[bar % tr.chords.length];
      const open = 1 - st.sweep * (0.5 + 0.5 * Math.cos(2 * Math.PI * bar / 16)); // the filter breathes every 16 bars
      for (let s = 0; s < 16; s++) {
        const t0 = at(bar, s);
        if (has('kick') && s % 4 === 0 && !(fill && s === 12)) {
          kickFn(drums, t0, 0.95);
          const n = Math.floor(0.3 * SR);
          for (let i = 0; i < n && t0 + i < N; i++) duck[t0 + i] = Math.min(duck[t0 + i], 1 - duckDepth * Math.exp(-(i / SR) * 11));
        }
        if (has('hat')) {
          if (dr.hat) { if (dr.hat[s] > 0) hatVoice(kit.hat, drums, t0, st.closedHat * dr.hat[s] * (0.85 + 0.3 * rnd()), 0.012, rnd, s % 2 ? 0.4 : -0.3); }
          else hat(drums, t0, st.closedHat * (s % 4 === 2 ? 1 : 0.55) * (0.85 + 0.3 * rnd()), 0.012, rnd, s % 2 ? 0.4 : -0.3);
        }
        if (has('ohat')) {
          if (dr.ohat) { if (dr.ohat[s] > 0) hatVoice(kit.ohat || kit.hat, drums, t0, st.openHat * dr.ohat[s], 0.05, rnd, 0.2); }
          else if (s % 4 === 2) hat(drums, t0, st.openHat, 0.05, rnd, 0.2);
        }
        if (has('clap')) {
          if (dr.clap) { if (dr.clap[s] > 0) snareVoice(kit.snare, drums, t0, st.clap * dr.clap[s], rnd); }
          else if (s % 8 === 4) clap(drums, t0, st.clap, rnd);
        }
        if (has('perc') && dr.perc) for (const [name, pat] of Object.entries(dr.perc)) if (pat[s] > 0) perc(name, drums, t0, st.perc * pat[s], rnd, s);
        if (has('bass') && tr.bass[s] != null) {
          let len = step * 0.9;
          for (let j = s + 1; j < 16 && tr.bass[j] == null && len < step * 2.6; j++) len += step;
          const m = tr.root + tr.bassOct + chord[0] + tr.bass[s];
          if (kit.bass === 'acid') acidNote(low, t0, m, len, 0.42, tr.bassAccent?.[s], tr.bassSlide?.[s] ? lastBass : null, st, open);
          else if (kit.bass === 'sub') subNote(low, t0, m, len, 0.6);
          else if (kit.bass === 'reese') reeseNote(low, t0, m, len, 0.45, rnd);
          else if (kit.bass === 'organ') organBass(low, t0, m, len, 0.55);
          else if (kit.bass === 'disco') discoBass(low, t0, m, len, 0.55);
          else if (kit.bass === 'wobble') wobbleNote(low, t0, m, len, 0.42, beat);
          else if (kit.bass === 'fm') fmBass(low, t0, m, len, 0.5);
          else if (kit.bass === 'cello') celloNote(low, t0, m, len, 0.7, rnd);
          else if (kit.bass === '808') boom808(low, t0, m, len, 0.6, tr.bassSlide?.[s] ? lastBass : null);
          else bassNote(low, t0, m, len, 0.5, st.bassCut);
          lastBass = m;
        }
        if (has('chord') && tr.chordRhythm[s] > 0) {
          const v = tr.chordRhythm[s], notes = chord.map((c) => tr.root + (kit.chordOct ?? 12) + c);
          if (kit.chord === 'piano') piano(keys, t0, notes, v * 0.5, step * 1.6, rnd);
          else if (kit.chord === 'organ') organ(keys, t0, notes, v * 0.45, rnd);
          else if (kit.chord === 'rhodes') rhodes(keys, t0, notes, v * 0.5, rnd);
          else if (kit.chord === 'pluck') notes.forEach((m, k) => pluck(keys, t0 + Math.round(k * 0.012 * SR), m, v * 0.3, rnd, (k - 1.5) * 0.3, kit.pluckRing ?? 0.996));
          else if (kit.chord === 'brass') brass(keys, t0, notes, v * 0.45, rnd);
          else if (kit.chord === 'guitar') guitarStrum(keys, t0, notes, v * 0.55, rnd, s % 4 === 2);
          else if (kit.chord === 'supersaw') supersaw(keys, t0, notes, v * 0.4, rnd, step * 1.5);
          else if (kit.chord === 'hoover') hoover(keys, t0, notes, v * 0.4, rnd, step * 2);
          else if (kit.chord === 'bell') notes.forEach((m, k) => bell(keys, t0 + Math.round(k * 0.02 * SR), m, v * 0.18, (k - 1.5) * 0.3));
          else if (kit.chord === 'clav') notes.slice(0, 3).forEach((m, k) => clav(keys, t0, m, v * 0.3, rnd, (k - 1) * 0.3));
          else if (kit.chord === 'ring') ringStab(keys, t0, notes, v * 0.5, rnd);
          else if (kit.chord === 'pwm') pwmPad(air, t0, notes, (st.padBeats ?? 4) * beat, v * st.pwm);
          else if (kit.chord === 'choir') choir(air, t0, notes, (st.choirBeats ?? 4) * beat, v * st.choir, rnd, tr.vowel || 'ah');
          else stab(keys, t0, chord.map((c) => tr.root + 12 + c), v * 0.42, st, open * (sec.name === 'break' ? 1.25 : 1), rnd);
        }
        if (has('arp') && tr.arp && tr.arp[s] != null) {
          const tones = chord.slice(0, 4), k = tr.arp[s];
          const m = tr.root + 12 * (1 + Math.floor(k / tones.length)) + tones[k % tones.length];
          if (kit.arp === 'marimba') marimba(keys, t0, m, st.arp * (0.7 + 0.6 * open), s % 2 ? 0.35 : -0.35);
          else if (kit.arp === 'bell') bell(keys, t0, m, st.arp * (0.7 + 0.6 * open), s % 2 ? 0.35 : -0.35);
          else if (kit.arp === 'kalimba') kalimba(keys, t0, m, st.arp * (0.7 + 0.6 * open), s % 2 ? 0.35 : -0.35);
          else if (kit.arp === 'hang') hang(keys, t0, m, st.arp * (0.7 + 0.6 * open), s % 2 ? 0.3 : -0.3);
          else pluck(keys, t0, m, st.arp * (0.7 + 0.6 * open), rnd, s % 2 ? 0.35 : -0.35);
        }
        if (has('lead') && tr.lead && tr.lead[s] != null) {
          let len = step * 0.85;
          for (let j = s + 1; j < 16 && tr.lead[j] == null && len < step * 3.6; j++) len += step;
          const m = tr.root + (tr.leadOct ?? 12) + tr.lead[s];
          lead(keys, t0, m, len, st.lead, tr.leadSlide?.[s] ? lastLead : null, kit.lead, rnd, 0.15);
          lastLead = m;
        }
        if (has('vox') && tr.vox && tr.vox[s] > 0)
          if (kit.vox === 'robot') robot(keys, t0, tr.root + (tr.voxOct ?? 12) + chord[0], tr.voxLen ?? 0.18, st.vox * tr.vox[s], tr.vowel, s % 4 ? 0.3 : -0.2);
          else vox(keys, t0, tr.root + (tr.voxOct ?? 12) + chord[0], tr.voxLen ?? 0.18, st.vox * tr.vox[s], tr.vowel, rnd, s % 4 ? 0.3 : -0.2);
      }
      if (has('pad')) pad(air, at(bar, 0), chord.slice(0, 4).map((c) => tr.root + c), barLen, st.pad, rnd);
      if (has('strings')) strings(air, at(bar, 0), chord.slice(0, 4).map((c) => tr.root + c), barLen, st.strings, rnd);
      if (has('swell')) swell(air, at(bar, 0), chord.slice(0, 4).map((c) => tr.root + 12 + c), barLen, st.swell, rnd);
      if (has('gate') && tr.gate) gatedSaws(keys, at(bar, 0), chord.slice(0, 3).map((c) => tr.root + 12 + c), barLen, st.gate, rnd, tr.gate, step);
      if (fill) {
        if (tr.fx?.roll) snareRoll(drums, at(bar, 0), barLen, st.clap * 0.9, rnd);
        else riser(air, at(bar, 0), barLen, 0.1, rnd);
      }
      if (has('crowd')) crowd(air, at(bar, 0), barLen, st.crowd, rnd);
    }
  });

  pingPong(keys, st.delayBeats * beat * SR, st.delayFb, st.delayWet);
  reverb(keys, st.reverb);
  reverb(air, st.reverb * 0.8);
  if (st.wow) { wow(keys, st.wow, st.wowRate ?? 0.5); wow(air, st.wow, st.wowRate ?? 0.5); }
  if (st.crush) crush(keys, st.crush[0], st.crush[1]);
  if (st.phaser) phaser(keys, st.phaser, 0.9);
  if (st.rain) rain(air, st.rain, rnd);
  if (st.chorus) { chorus(keys, st.chorus, 0.6); chorus(air, st.chorus, 0.45); }

  const hissF = new Biquad('bp', 5200, 0.5);
  const mix = bus(N);
  let peak = 0;
  for (let i = 0; i < N; i++) {
    const d = duck[i], hiss = st.hiss ? hissF.run(rnd() * 2 - 1) * st.hiss * (0.7 + 0.3 * Math.sin(i / SR * 0.7)) : 0;
    const l = drums.L[i] + low.L[i] * d + (keys.L[i] + air.L[i]) * (0.35 + 0.65 * d) + hiss;
    const r = drums.R[i] + low.R[i] * d + (keys.R[i] + air.R[i]) * (0.35 + 0.65 * d) + hiss;
    mix.L[i] = Math.tanh(l * drive); mix.R[i] = Math.tanh(r * drive);
    peak = Math.max(peak, Math.abs(mix.L[i]), Math.abs(mix.R[i]));
  }
  // Studio tricks at the ends of sections: a tape stop before a break, a stutter roll elsewhere.
  const fx = tr.fx || {}, beatN = Math.round(beat * SR);
  for (const fl of fills) {
    if (fx.tapeStop && fl.next === 'break') tapeStop(mix, fl.end - beatN, beatN);
    else if (fx.stutter) stutterRoll(mix, fl.end - 2 * beatN, beatN, fl.end);
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
const ids = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (!ids.length && !process.argv.includes('--all')) {
  console.error('name the tracks to make (or --all, which re-renders the approved ones too):\n  ' + TRACKS.map((t) => t.id).join(' '));
  process.exit(1);
}
const listFile = join(outDir, 'tracks.json');
const list = existsSync(listFile) ? JSON.parse(readFileSync(listFile, 'utf8')) : [];
for (const tr of TRACKS) {
  if (ids.length && !ids.includes(tr.id)) continue;
  const t0 = Date.now();
  const { mix, bars, seconds } = render(tr);
  const tmp = join(tmpdir(), 'headliner-' + tr.id + '.wav'), out = join(outDir, tr.id + '.m4a');
  writeFileSync(tmp, wav(mix));
  const before = loudness(tmp);
  const gain = Math.min(-14 - before.lufs, -1 - before.peak); // to -14 LUFS, never past -1 dB true peak
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', tmp, '-af', `volume=${gain.toFixed(2)}dB`,
    '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', out]);
  let after = loudness(out);
  if (after.peak > -1) { // the encoder can overshoot: take a little more off and encode again
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', tmp, '-af', `volume=${(gain - after.peak - 1.3).toFixed(2)}dB`,
      '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', out]);
    after = loudness(out);
  }
  rmSync(tmp);
  const entry = { id: tr.id, title: tr.title, artist: tr.artist, label: tr.label, genre: tr.genre, bpm: tr.bpm,
    key: tr.key, camelot: tr.camelot, bars, seconds: Math.round(seconds * 100) / 100, file: tr.id + '.m4a' };
  if (tr.chapter) entry.chapter = tr.chapter;
  const at = list.findIndex((x) => x.id === tr.id);
  if (at >= 0) list[at] = entry; else list.push(entry);
  console.log(`${tr.id}: ${bars} bars, ${seconds.toFixed(1)} s, ${after.lufs} LUFS, peak ${after.peak} dB, ${((Date.now() - t0) / 1000).toFixed(1)} s to make`);
}
writeFileSync(listFile, JSON.stringify(list, null, 2) + '\n');
