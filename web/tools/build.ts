// Builds the web version for grooveline.org/headliner/ into web/dist/ (a Cloudflare Worker's
// static assets, see web/wrangler.toml):  node tools/build.ts
// - The page, the code (types stripped, `.ts` imports rewritten to `.js`), fonts and content.
// - The iPhone app's media (records, rooms, scenes, voices, fonts) from ../App, HARD-LINKED, not
//   copied: Omarchy's disk is nearly full and the media is ~380 MB. Only files git knows.
// - `_headers`: cross-origin isolation (shared memory with the audio thread), noindex until Zé
//   links it from the site.

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, linkSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { stripTypeScriptTypes } from "node:module";

const WEB = path.resolve(import.meta.dirname, "..");
const ROOT = path.resolve(WEB, "..");
const OUT = path.join(WEB, "dist");
const SITE = path.join(OUT, "headliner");
const MEDIA = ["Tracks", "Art", "Story", "Lessons", "Fonts"];

rmSync(OUT, { recursive: true, force: true });
mkdirSync(SITE, { recursive: true });

/** `.ts` imports and worklet URLs to `.js` (the page loads plain JavaScript once built). */
const toJs = (code: string) => code
  .replace(/(from\s+["'][^"']+)\.ts(["'])/g, "$1.js$2")
  .replace(/(import\s*\(\s*["'][^"']+)\.ts(["']\s*\))/g, "$1.js$2")
  .replace(/(new URL\(\s*["'][^"']+)\.ts(["'])/g, "$1.js$2");

// The code.
let files = 0;
function code(dir: string): void {
  for (const name of readdirSync(dir)) {
    const from = path.join(dir, name);
    const rel = path.relative(WEB, from);
    const to = path.join(SITE, rel);
    if (statSync(from).isDirectory()) { code(from); continue; }
    mkdirSync(path.dirname(to), { recursive: true });
    if (name.endsWith(".d.ts")) continue;
    if (name.endsWith(".ts")) {
      const js = toJs(stripTypeScriptTypes(readFileSync(from, "utf8"), { mode: "strip" }));
      writeFileSync(to.replace(/\.ts$/, ".js"), js);
    } else {
      cpSync(from, to);
    }
    files++;
  }
}
code(path.join(WEB, "src"));

// The page and the small things next to it.
writeFileSync(path.join(SITE, "index.html"), readFileSync(path.join(WEB, "index.html"), "utf8").replace('src="src/main.ts"', 'src="src/main.js"'));
cpSync(path.join(WEB, "icon.svg"), path.join(SITE, "icon.svg"));
cpSync(path.join(WEB, "fonts"), path.join(SITE, "fonts"), { recursive: true });
cpSync(path.join(WEB, "content"), path.join(SITE, "content"), { recursive: true });
files += 3;

// The media, hard-linked from the iPhone app (same disk: no space used).
const tracked = execFileSync("git", ["ls-files", ...MEDIA.map((m) => `App/${m}`)], { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean);
let media = 0, bytes = 0, biggest = 0;
/** The media files' sizes, for the Worker's byte ranges (the asset service does not say them). */
const sizes: Record<string, number> = {};
for (const rel of tracked) {
  const from = path.join(ROOT, rel);
  if (!existsSync(from)) continue;
  const to = path.join(SITE, "assets", rel.slice("App/".length));
  mkdirSync(path.dirname(to), { recursive: true });
  try { linkSync(from, to); } catch { cpSync(from, to); }
  const size = statSync(from).size;
  sizes[`/headliner/assets/${rel.slice("App/".length)}`] = size;
  bytes += size;
  biggest = Math.max(biggest, size);
  media++;
}

// Bundled into the Worker by wrangler (tools/worker.js imports it); outside headliner/, so the
// route never serves it.
writeFileSync(path.join(OUT, "sizes.json"), JSON.stringify(sizes));

// Headers for every page of the game.
writeFileSync(path.join(OUT, "_headers"), `/headliner/*
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp
  Cross-Origin-Resource-Policy: same-origin
  X-Content-Type-Options: nosniff
  X-Robots-Tag: noindex
`);

// Fail before a deploy that Cloudflare would refuse.
const LIMIT = 25 * 1024 * 1024;
if (biggest > LIMIT) throw new Error(`a media file is ${biggest} bytes: over the 25 MiB per-file limit of static assets`);
console.log(`build: ${files} code/page files, ${media} media files (${(bytes / 1e6).toFixed(0)} MB, hard links), biggest ${(biggest / 1e6).toFixed(1)} MB -> ${path.relative(ROOT, OUT)}`);
