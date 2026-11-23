# Career pack for the iPhone v1.2.0 (Cloudflare R2)

Chapters 3-12's media (437 files, 284 MiB at `e336400`) leave the app and live in an R2 bucket; the app keeps chapters 1-2
(110 files, 61 MiB) and downloads the rest once, after the purchase. What is in the pack is decided by `web/tools/gating.ts`
(usage-based: used by a chapter 3-12 step and never by chapters 1-2, the menus or the code), the same list the web paywall uses.
The spec for the app side (the iPhone agent): vault `04_projects/grooveline/notes/headliner-v1.2-r2-pack-spec.md`.

## Files
- `make-manifest.mjs [--repo DIR]` writes `out/pack-manifest.json` (path, bytes, chapter, sha256, bucket key, type per file) and
  `out/bundle-excludes.txt` (App/ paths the default bundle leaves out). `--repo` = a checkout that HAS the media (the main clone).
- `upload.sh` (Zé runs it: it writes to his Cloudflare account) creates the bucket `headliner-media` if needed, uploads every object as
  `pack/<sha256>.<ext>` (immutable, so rerunning is safe; `out/uploaded.txt` is the resume ledger) and then `pack/manifest.json`.
- Tests: `web/test/media-pack.test.ts` (made-up content, runs in CI), and a local round trip of the script: `BUCKET=x WR_FLAGS="--local --persist-to DIR" LIMIT=4 bash upload.sh`.

## Zé's steps
1. `bash tools/media-pack/upload.sh` (from a clone of this branch; about 15 minutes for 437 files).
2. Cloudflare dashboard > R2 > `headliner-media` > Settings > Custom Domains > add `media.grooveline.org` (the zone is already on Cloudflare).
   Check: `curl -sI https://media.grooveline.org/pack/manifest.json` answers 200.
3. Nothing else: the bucket is public by its custom domain. (Gated version: not built, see the spec's open question.)

R2's free allowance (check Cloudflare's pricing page): 10 GB stored, no charge for downloads out of R2, 1M writes and 10M reads a month;
one full install is 437 reads.
