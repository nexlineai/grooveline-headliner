// The links the SHARE popup offers (share.ts).
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { SHARE_TEXT, SHARE_URL, shareLinks } from "../src/share.ts";

describe("share links", () => {
  const links = shareLinks("https://grooveline.org/dj/?dj=NA&x=1", "Listen live: DJ NA");
  test("six networks, each a real https (or mailto) link with the page's address encoded in it", () => {
    assert.deepEqual(links.map((l) => l.name), ["X", "FACEBOOK", "WHATSAPP", "TELEGRAM", "REDDIT", "EMAIL"]);
    for (const l of links) assert.ok(/^(https:\/\/|mailto:)/.test(l.href), l.href);
    for (const l of links) assert.ok(l.href.includes(encodeURIComponent("https://grooveline.org/dj/?dj=NA&x=1")), `${l.name} carries the address, encoded`);
  });
  test("the words are encoded too, so an & or a space in them cannot break the link", () => {
    for (const l of shareLinks("https://a.b/", "Rock & roll live")) assert.ok(!/text=Rock &/.test(l.href) && !l.href.includes(" "), l.href);
  });
  test("the default is the radio's page", () => {
    assert.equal(SHARE_URL, "https://grooveline.org/");
    assert.ok(SHARE_TEXT.length > 0);
  });
});
