// How long a file is, from its header (library/length.ts): the fixtures' lengths were measured with ffprobe.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readSeconds } from "../src/library/length.ts";
import type { Source } from "../src/library/tags.ts";

const fixture = async (name: string): Promise<Source> => {
  const b = new Uint8Array(await readFile(new URL(`./fixtures/${name}`, import.meta.url)));
  return { size: b.length, read: async (start, length) => b.slice(start, Math.min(b.length, start + length)) };
};
const bytes = (b: Uint8Array): Source => ({ size: b.length, read: async (start, length) => b.slice(start, Math.min(b.length, start + length)) });

describe("the length of a file from its header", () => {
  const known: [string, number][] = [
    ["v1.mp3", 1.5], ["v23.mp3", 1.5], ["v24.mp3", 1.5], ["none.mp3", 1.5],
    ["tagged.flac", 1.5], ["plain.wav", 0.5], ["plain.aiff", 0.5], ["s24.aiff", 0.3], ["le.aifc", 0.3],
    ["itunes.m4a", 1.5], ["alac.m4a", 1.5], ["fast.m4a", 1.5], ["end.m4a", 1.5],
  ];
  for (const [name, want] of known) {
    test(`${name}: ${want} s`, async () => {
      const got = await readSeconds(await fixture(name));
      // An mp3's own header counts the encoder's start-up frames too (about 50 ms more than ffprobe says).
      assert.ok(got !== undefined && Math.abs(got - want) < (name.endsWith(".mp3") ? 0.1 : 0.05), `${name}: ${got}`);
    });
  }

  test("Ogg is not read: undefined, not a wrong number", async () => {
    assert.equal(await readSeconds(await fixture("tagged.ogg")), undefined);
  });

  test("nothing throws: an empty file, junk, a cut-short file all give undefined", async () => {
    assert.equal(await readSeconds(bytes(new Uint8Array(0))), undefined);
    assert.equal(await readSeconds(bytes(new Uint8Array(5000).fill(7))), undefined);
    const wav = new Uint8Array(await readFile(new URL("./fixtures/plain.wav", import.meta.url)));
    assert.equal(await readSeconds(bytes(wav.slice(0, 30))), undefined);
    const mp3 = new Uint8Array(await readFile(new URL("./fixtures/v23.mp3", import.meta.url)));
    assert.equal(await readSeconds(bytes(mp3.slice(0, 40))), undefined);
  });

  test("a VBR mp3 with a Xing header is told by its frame count, not by its size", async () => {
    // One MPEG1 layer III frame at 128 kbps / 44.1 kHz stereo with a Xing header saying 1000 frames: 1000 * 1152 / 44100 s.
    const frame = new Uint8Array(417 * 3).fill(0);
    for (const at of [0, 417, 834]) { frame[at] = 0xff; frame[at + 1] = 0xfb; frame[at + 2] = 0x90; frame[at + 3] = 0x00; }
    frame.set(new TextEncoder().encode("Xing"), 4 + 32);
    frame.set([0, 0, 0, 1], 4 + 32 + 4); // flags: frames present
    frame.set([0, 0, 0x03, 0xe8], 4 + 32 + 8); // 1000 frames
    const got = await readSeconds(bytes(frame));
    assert.ok(got !== undefined && Math.abs(got - 1000 * 1152 / 44100) < 1e-6, String(got));
  });

  test("a constant-bitrate mp3 with no Xing header is told by its size over its bitrate", async () => {
    const n = 417 * 100; // 100 frames of 128 kbps: 100 * 1152 / 44100 = 2.612 s
    const b = new Uint8Array(n);
    for (let i = 0; i < 100; i++) { b[i * 417] = 0xff; b[i * 417 + 1] = 0xfb; b[i * 417 + 2] = 0x90; b[i * 417 + 3] = 0x00; }
    const got = await readSeconds(bytes(b));
    assert.ok(got !== undefined && Math.abs(got - n * 8 / 128000) < 1e-6, String(got));
  });
});
