// Screenshots of the web version from headless Chromium, with its console and errors:
//   node tools/shot.ts OUT.png [URL] [--size 1600x740] [--wait 6] [--chromium /usr/bin/chromium] [--gpu]
//                      [--do "click 181 697; wait 2; drag 515 518 515 440; eval engine.decks[0].pitch"]
// Verbs: click X Y | down X Y | up X Y (a held button: down, wait, eval, up) | drag X1 Y1 X2 Y2 | wait S | run FILE | eval EXPR
// `run FILE` evaluates a script file in the page (a bot that plays a lesson, for instance).
// `--do` runs after the wait, then the picture is taken: clicks and drags with the mouse (screen
// pixels, y down), pauses, and `eval` prints what an expression in the page gives (the page puts
// its parts on `window.headliner`, so `eval` sees `engine` and `booth`).
// The page runs muted and in its own throwaway profile; no window opens. Sound may start without
// a click (--autoplay-policy), so `?autostart&demo` shows both records turning.

import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const opt = (name: string, fallback: string): string => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const positional = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--")));
const out = positional[0] ?? "shot.png";
const url = positional[1] ?? "http://localhost:5173/?autostart&demo";
const [width, height] = opt("--size", "1600x740").split("x").map(Number);
const wait = Number(opt("--wait", "6"));
const chromium = opt("--chromium", "chromium");
const steps = opt("--do", "").split(";").map((x) => x.trim()).filter(Boolean);
const port = 9300 + Math.floor(Math.random() * 500);

const profile = await mkdtemp(path.join(process.env.TMPDIR ?? tmpdir(), "headliner-shot-"));
const browser = spawn(chromium, [
  "--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--mute-audio",
  "--autoplay-policy=no-user-gesture-required", "--no-first-run", "--hide-scrollbars",
  // Without these, headless Chromium stops animation frames after a few seconds (the page counts
  // as hidden), and everything driven by them (the booth, the lesson) freezes while sound goes on.
  "--disable-renderer-backgrounding", "--disable-background-timer-throttling", "--disable-backgrounding-occluded-windows",
  `--window-size=${width},${height}`,
  // The machine's GPU instead of software rendering (frame rates like a real browser's).
  ...(args.includes("--gpu") ? ["--use-angle=gl", "--enable-gpu-rasterization", "--ignore-gpu-blocklist"] : []),
  "about:blank",
], {
  stdio: ["ignore", "ignore", process.env.SHOT_DEBUG ? "inherit" : "ignore"],
  // Chromium puts a socket in TMPDIR; a long TMPDIR makes it fail ("Socket path too long").
  env: { ...process.env, TMPDIR: "/tmp" },
});

const sleep = (s: number) => new Promise((r) => setTimeout(r, s * 1000));

try {
  let target: { webSocketDebuggerUrl: string } | undefined;
  for (let i = 0; i < 50 && !target; i++) {
    await sleep(0.2);
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json() as { type: string; webSocketDebuggerUrl: string }[];
      target = list.find((t) => t.type === "page");
    } catch (e) { if (i === 49) console.log("devtools:", (e as Error).cause ?? e); }
  }
  if (!target) throw new Error("Chromium did not start");

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0;
  const waiting = new Map<number, (v: unknown) => void>();
  ws.onmessage = (e) => {
    const m = JSON.parse(String(e.data));
    if (m.id && waiting.has(m.id)) { waiting.get(m.id)!(m.result ?? m.error); waiting.delete(m.id); return; }
    if (m.method === "Runtime.consoleAPICalled") {
      console.log(`console.${m.params.type}:`, m.params.args.map((a: { value?: unknown; description?: string }) => a.value ?? a.description).join(" "));
    } else if (m.method === "Runtime.exceptionThrown") {
      const d = m.params.exceptionDetails;
      console.log("EXCEPTION:", d.exception?.description ?? d.text, d.url ? `(${d.url}:${d.lineNumber})` : "");
    } else if (m.method === "Log.entryAdded") {
      console.log(`log.${m.params.entry.level}:`, m.params.entry.text, m.params.entry.url ?? "");
    }
  };
  const send = (method: string, params: object = {}) => new Promise<any>((r) => {
    const n = ++id;
    waiting.set(n, r);
    ws.send(JSON.stringify({ id: n, method, params }));
  });
  await send("Runtime.enable");
  await send("Log.enable");
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
  await send("Page.enable");
  // Keep the page in front and focused: otherwise headless Chromium hides it after some seconds
  // (visibilityState "hidden") and stops its animation frames.
  await send("Page.bringToFront");
  await send("Emulation.setFocusEmulationEnabled", { enabled: true });
  await send("Page.navigate", { url });
  await sleep(wait);
  const mouse = (type: string, x: number, y: number, buttons = 1) =>
    send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons, clickCount: 1 });
  for (const step of steps) {
    const [verb, ...rest] = step.split(/\s+/);
    const n = rest.map(Number);
    if (verb === "click") {
      await mouse("mousePressed", n[0], n[1]);
      await mouse("mouseReleased", n[0], n[1], 0);
    } else if (verb === "down") {
      await mouse("mousePressed", n[0], n[1]);
    } else if (verb === "up") {
      await mouse("mouseReleased", n[0], n[1], 0);
    } else if (verb === "drag") {
      await mouse("mousePressed", n[0], n[1]);
      for (let k = 1; k <= 12; k++) {
        await mouse("mouseMoved", n[0] + (n[2] - n[0]) * k / 12, n[1] + (n[3] - n[1]) * k / 12);
        await sleep(0.016);
      }
      await mouse("mouseReleased", n[2], n[3], 0);
    } else if (verb === "wait") {
      await sleep(n[0]);
    } else if (verb === "run") {
      // A script file evaluated in the page (as is: newlines and semicolons survive).
      const code = await readFile(rest[0], "utf8");
      const r = await send("Runtime.evaluate", { expression: `with (window.headliner ?? {}) { ${code}\n }`, returnByValue: true });
      if (r?.exceptionDetails) console.log(`run ${rest[0]}:`, r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    } else if (verb === "eval") {
      const expr = rest.join(" ");
      const r = await send("Runtime.evaluate", { expression: `with (window.headliner ?? {}) { JSON.stringify(${expr}) }`, returnByValue: true });
      console.log(`${expr} =`, r?.result?.value ?? JSON.stringify(r));
    }
  }
  const shot = await send("Page.captureScreenshot", { format: "png" });
  await writeFile(out, Buffer.from(shot.data, "base64"));
  console.log(`wrote ${out}`);
  ws.close();
} finally {
  browser.kill();
  await sleep(0.3);
  await rm(profile, { recursive: true, force: true });
}
