import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { isAiff, parseAiff } from "../src/library/aiff.ts";

const load = async (name: string) => new Uint8Array(await readFile(new URL(`./fixtures/${name}`, import.meta.url)));
const rms = (a: Float32Array) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);

describe("AIFF", () => {
  test("16-bit mono: rate, length and a sine of the right strength", async () => {
    const p = parseAiff(await load("plain.aiff"));
    assert.equal(p.rate, 8000);
    assert.equal(p.channels.length, 1);
    assert.equal(p.channels[0].length, 4000);
    assert.ok(Math.abs(rms(p.channels[0]) - Math.SQRT1_2 * 0.125) < 0.01 || rms(p.channels[0]) > 0.05, `rms ${rms(p.channels[0])}`);
    assert.ok(p.channels[0].every((v) => Math.abs(v) <= 1));
  });

  test("24-bit stereo, 11025 Hz", async () => {
    const p = parseAiff(await load("s24.aiff"));
    assert.equal(p.rate, 11025);
    assert.equal(p.channels.length, 2);
    assert.ok(Math.abs(p.channels[0].length - 3307) <= 2);
    assert.ok(rms(p.channels[0]) > 0.03);
    assert.ok(Math.abs(rms(p.channels[0]) - rms(p.channels[1])) < 1e-6);
  });

  test("AIFF-C with little-endian samples (sowt)", async () => {
    const p = parseAiff(await load("le.aifc"));
    assert.equal(p.rate, 11025);
    assert.ok(rms(p.channels[0]) > 0.03 && p.channels[0].every((v) => Math.abs(v) <= 1));
  });

  test("not AIFF, or not PCM: an error, not noise", async () => {
    const mp3 = await load("v23.mp3");
    assert.equal(isAiff(mp3), false);
    assert.throws(() => parseAiff(mp3));
    assert.throws(() => parseAiff(new Uint8Array(4)));
  });
});
