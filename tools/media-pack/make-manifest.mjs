// Makes the career pack's manifest from a checkout of this repo:
//   node tools/media-pack/make-manifest.mjs [--repo DIR] [--out DIR]
// --repo: the repo root that holds App/ (default: this one; its media may be sparse-checked-out, then give the main clone),
// --out:  where pack-manifest.json and bundle-excludes.txt go (default: tools/media-pack/out, not committed).
// Prints what goes to the bucket and what the app keeps. Needs only Node.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { packManifest } from "../../web/tools/media-pack.ts";

const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : fallback; };
const HERE = path.resolve(import.meta.dirname, "..", "..");
const REPO = path.resolve(arg("--repo", HERE));
const OUT = path.resolve(arg("--out", path.join(import.meta.dirname, "out")));
const MEDIA = ["Tracks", "Art", "Story", "Lessons", "Fonts"];

const git = (...a) => execFileSync("git", a, { cwd: REPO, encoding: "utf8" }).trim();
// The files git knows (not scratch files lying in the folder), the same set the web build uses.
const media = git("ls-files", ...MEDIA.map((m) => `App/${m}`)).split("\n").filter(Boolean).map((p) => p.slice("App/".length));
const abs = (rel) => path.join(REPO, "App", rel);
const read = (rel) => JSON.parse(readFileSync(abs(rel), "utf8"));
const career = JSON.parse(readFileSync(path.join(HERE, "web/content/career.json"), "utf8"));

const m = packManifest(career, read("Story/scenes.json"), read("Tracks/tracks.json"), media,
  (rel) => statSync(abs(rel)).size,
  (rel) => createHash("sha256").update(readFileSync(abs(rel))).digest("hex"),
  git("rev-parse", "HEAD"));

mkdirSync(OUT, { recursive: true });
writeFileSync(path.join(OUT, "pack-manifest.json"), JSON.stringify(m, null, 1) + "\n");
// For the app's build: every file in this list is left out of the default bundle (BUNDLE_ALL_CONTENT puts them back).
writeFileSync(path.join(OUT, "bundle-excludes.txt"), m.files.map((f) => `App/${f.path}`).join("\n") + "\n");
const MiB = (n) => (n / 1048576).toFixed(1) + " MiB";
console.log(`pack: ${m.files.length} files, ${MiB(m.totalBytes)} (${(m.totalBytes / 1e6).toFixed(0)} MB) -> the bucket`);
console.log(`stays in the app: ${m.staysInApp.files} files, ${MiB(m.staysInApp.bytes)} (${(m.staysInApp.bytes / 1e6).toFixed(0)} MB)`);
console.log(`from ${m.generatedFrom.slice(0, 7)}; wrote ${path.relative(process.cwd(), OUT)}/pack-manifest.json and bundle-excludes.txt`);
