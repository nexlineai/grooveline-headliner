// Where the "which deck?" popup goes (library/loadpop.ts); the DOM part is checked in the page.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { popPosition } from "../src/library/loadpop.ts";

const view = { w: 1440, h: 770 }, size = { w: 244, h: 120 };

describe("the load popup's place", () => {
  test("above the record, centred on it", () => {
    const p = popPosition({ x: 600, y: 560, w: 94, h: 94 }, size, view);
    assert.equal(p.x, 600 + 47 - 122);
    assert.equal(p.y, 560 - 8 - 120);
  });
  test("under the record when there is no room above", () => {
    const p = popPosition({ x: 600, y: 40, w: 94, h: 94 }, size, view);
    assert.equal(p.y, 40 + 94 + 8);
  });
  test("never outside the window: at the left edge, the right edge, and when it fits nowhere", () => {
    assert.equal(popPosition({ x: 0, y: 500, w: 90, h: 90 }, size, view).x, 6);
    assert.equal(popPosition({ x: 1400, y: 500, w: 90, h: 90 }, size, view).x, 1440 - 244 - 6);
    const tight = popPosition({ x: 100, y: 30, w: 90, h: 700 }, size, { w: 1440, h: 200 });
    assert.ok(tight.y >= 6 && tight.y + 120 <= 200 - 6 + 1e-9);
  });
});
