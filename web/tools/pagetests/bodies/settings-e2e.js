// SETTINGS in LIVE: one button in the bar for the tempo range, KEYS & MIDI and PHONES; the tempo fader's travel; the MIDI config file (save, import); the clock.
const T = (...a) => console.log("T", a.map((x) => typeof x === "number" ? +x.toFixed(4) : x).join(" "));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (name, cond, extra = "") => T(cond ? "PASS" : "FAIL", name, extra);
const $ = (id) => document.getElementById(id);
const shown = (el) => getComputedStyle(el).display !== "none";
const key = (k) => window.dispatchEvent(new KeyboardEvent("keydown", { key: k, code: "Slash", bubbles: true }));
(async () => {
  for (let i = 0; i < 100 && !(engine.decks[0].isLoaded && engine.decks[1].isLoaded); i++) await sleep(100);
  await sleep(2500);
  ok("LIVE: the bar has SETTINGS, SHARE; KEYS & MIDI and PHONES are inside SETTINGS, not in the bar", booth.mode === "live" && shown($("settings-button")) && shown($("share-button")) && !shown($("controls-button")) && !shown($("phones-button")));
  const sb = $("settings-button").getBoundingClientRect();
  ok("SETTINGS is the topmost thing at its place (a click reaches it)", document.elementFromPoint(sb.x + sb.width / 2, sb.y + sb.height / 2) === $("settings-button"));

  // the clock
  const clock = document.querySelector("#livebar .clock"), now = new Date();
  ok("the clock shows the time of day (24 h) before OFF AIR", /^\d\d:\d\d$/.test(clock.textContent) && Math.abs(Number(clock.textContent.slice(0, 2)) - now.getHours()) <= 1
    && clock.getBoundingClientRect().right <= document.querySelector("#livebar .onair").getBoundingClientRect().left, clock.textContent);

  // open, tabs
  $("settings-button").click(); await sleep(600);
  ok("SETTINGS opens on TEMPO with six ranges, 8 % lit", !$("settings").hidden && $("settings-tabs").querySelector(".on").dataset.tab === "tempo"
    && [...document.querySelectorAll(".tempo-options .pill")].map((b) => b.textContent.replace(/\s/g, "")).join(",") === "±8%,±12%,±16%,±25%,±35%,±50%" && document.querySelector(".tempo-options .pill.on").textContent.includes("8"));
  $("settings-tabs").querySelector("[data-tab=keys]").click(); await sleep(400);
  ok("KEYS & MIDI is a tab (keys, SAVE CONFIG, IMPORT CONFIG)", $("settings-body").textContent.includes("KEYBOARD") && $("settings-body").textContent.includes("SAVE CONFIG") && $("settings-body").textContent.includes("IMPORT CONFIG"));
  $("settings-tabs").querySelector("[data-tab=phones]").click(); await sleep(900);
  ok("PHONES is a tab", $("settings-body").textContent.includes("SPLIT") && $("settings-body").className === "phones-tab", $("settings-body").className);
  $("settings-close").click(); await sleep(200);
  ok("CLOSE closes", $("settings").hidden);
  key("?"); await sleep(500);
  ok("the ? key opens SETTINGS on KEYS & MIDI in LIVE", !$("settings").hidden && $("settings-tabs").querySelector(".on").dataset.tab === "keys" && $("controls").hidden);
  key("?"); await sleep(300);
  ok("and ? again closes it", $("settings").hidden);

  // the tempo fader's travel
  booth.setValue({ t: "pitch", d: 0 }, 0); await sleep(200);
  ok("8 %: the fader at its top end is +8 %", Math.abs(engine.decks[0].pitch - 0.08) < 1e-9, String(engine.decks[0].pitch));
  $("settings-button").click(); await sleep(400);
  ok("SETTINGS opens on the tab it was left on (KEYS & MIDI, from the ? key)", $("settings-tabs").querySelector(".on").dataset.tab === "keys");
  $("settings-tabs").querySelector("[data-tab=tempo]").click(); await sleep(300);
  const pick = (label) => [...document.querySelectorAll(".tempo-options .pill")].find((b) => b.textContent.replace(/\s/g, "") === label).click();
  pick("±50%"); await sleep(300);
  ok("50 %: the tempo stays (+8 %), the fader moved to where it is now", Math.abs(engine.decks[0].pitch - 0.08) < 1e-9 && Math.abs(booth.valueOf({ t: "pitch", d: 0 }) - 0.42) < 1e-9, `${engine.decks[0].pitch} ${booth.valueOf({ t: "pitch", d: 0 })}`);
  ok("50 % is lit, the example says 64 to 192 BPM for a 128 BPM record", document.querySelector(".tempo-options .pill.on").textContent.includes("50") && document.querySelector(".tempo-example").textContent.includes("from 64 to 192"));
  booth.setValue({ t: "pitch", d: 0 }, 0); booth.setValue({ t: "pitch", d: 1 }, 1);
  ok("50 %: the fader ends are +50 % and -50 %", Math.abs(engine.decks[0].pitch - 0.5) < 1e-9 && Math.abs(engine.decks[1].pitch + 0.5) < 1e-9, `${engine.decks[0].pitch} ${engine.decks[1].pitch}`);
  ok("kept in this browser", localStorage.getItem("headliner.pitchRange") === "0.5");
  pick("±25%"); await sleep(300);
  ok("back to 25 %: a tempo beyond the new travel stops at its end (+25 %, -25 %)", Math.abs(engine.decks[0].pitch - 0.25) < 1e-9 && Math.abs(engine.decks[1].pitch + 0.25) < 1e-9 && booth.valueOf({ t: "pitch", d: 0 }) === 0, `${engine.decks[0].pitch} ${engine.decks[1].pitch}`);
  booth.setValue({ t: "pitch", d: 0 }, 0.3); const keep = engine.decks[0].pitch; // a tempo inside the range
  pick("±35%"); await sleep(300);
  ok("widening keeps the tempo", Math.abs(engine.decks[0].pitch - keep) < 1e-9, `${keep} ${engine.decks[0].pitch}`);

  // sync follows the wider travel: deck 1 at 170 BPM against deck 0 at 128 (the records' own tempi are what the test files have; use what is loaded)
  const a = engine.decks[0], b = engine.decks[1];
  ok("the tempo the engine plays is what the fader says (no clamp in the way)", Math.abs(a.pitch - (0.5 - booth.valueOf({ t: "pitch", d: 0 })) * 2 * booth.pitchRange) < 1e-9);

  // the game's booth keeps 8 %
  pick("±8%"); await sleep(300);
  $("settings-close").click();
  ok("8 % again", booth.pitchRange === 0.08 && localStorage.getItem("headliner.pitchRange") === "0.08");

  // the MIDI config file
  const blobs = []; const make = URL.createObjectURL; URL.createObjectURL = (x) => { blobs.push(x); return make.call(URL, x); };
  midi.clear();
  midi.importBindings({ "Test controller": [{ source: "cc:0:7", target: "pitch:0:", kind: "absolute", mode: "abs" }, { source: "note:0:41", target: "play:1:", kind: "button", mode: "push" }] });
  $("settings-button").click(); await sleep(300);
  $("settings-tabs").querySelector("[data-tab=keys]").click(); await sleep(400);
  [...$("settings-body").querySelectorAll(".pill")].find((x) => x.textContent === "SAVE CONFIG").click(); await sleep(500);
  const text = blobs.length ? await blobs[blobs.length - 1].text() : "";
  let saved = null; try { saved = JSON.parse(text); } catch {}
  ok("SAVE CONFIG makes a file with what was learned", !!saved && saved.app === "grooveline-headliner-midi" && saved.version === 1 && saved.bindings["Test controller"].length === 2, text.slice(0, 80).replace(/\s+/g, " "));
  ok("and says so", $("settings-body").textContent.includes("Saved 2 controls"));
  midi.clear(); await sleep(300);
  ok("(forgotten)", midi.bindingsOf("Test controller").length === 0);
  const give = async (content, name = "x.json") => {
    const picker = $("settings-body").querySelector("input[type=file]"), dt = new DataTransfer();
    dt.items.add(new File([content], name, { type: "application/json" }));
    picker.files = dt.files; picker.dispatchEvent(new Event("change")); await sleep(600);
  };
  await give(text);
  ok("IMPORT CONFIG puts it back (no learning needed)", midi.bindingsOf("Test controller").length === 2 && midi.bindingsOf("Test controller")[0].target === "pitch:0:", JSON.stringify(midi.bindingsOf("Test controller")).slice(0, 100));
  ok("and says what it loaded", $("settings-body").textContent.includes("Loaded 2 controls for Test controller"), $("settings-body").querySelector(".midi-status")?.textContent);
  midi.clear();
  await give("this is not json");
  ok("a wrong file is refused with words, and nothing changes", midi.bindingsOf("Test controller").length === 0 && $("settings-body").querySelector(".midi-status.bad")?.textContent.includes("not a MIDI config"), $("settings-body").querySelector(".midi-status")?.textContent);
  await give(JSON.stringify({ app: "grooveline-headliner-midi", version: 1, bindings: { K: [{ source: "cc:0:1", target: "nothing:0:" }] } }));
  ok("a file with only unknown controls is refused", midi.bindingsOf("K").length === 0 && $("settings-body").querySelector(".midi-status.bad")?.textContent.includes("Nothing in that MIDI config fits"), $("settings-body").querySelector(".midi-status")?.textContent);
  midi.clear(); URL.createObjectURL = make;

  // the game's booth: its own buttons, no SETTINGS, always 8 %
  $("settings-close").click();
  booth.setValue({ t: "pitch", d: 0 }, 0.25);
  booth.setPitchRange(0.5); const live50 = booth.pitchRange; const tempo = engine.decks[0].pitch;
  booth.setMode("game"); await sleep(7000);
  ok("the game's booth keeps its buttons: KEYS & MIDI, PHONES; no SETTINGS", shown($("controls-button")) && shown($("phones-button")) && !shown($("settings-button")));
  ok("the game's booth always has 8 %, and the tempo stays", booth.pitchRange === 0.08 && live50 === 0.5 && Math.abs(engine.decks[0].pitch - Math.max(-0.08, Math.min(0.08, tempo))) < 1e-9, `${booth.pitchRange} ${tempo} -> ${engine.decks[0].pitch}`);
  booth.setMode("live"); booth.setPitchRange(0.08);
  T("DONE");
})().catch((e) => T("ERROR", e && e.stack || e));
