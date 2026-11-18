// The local dev server: `node tools/serve.ts [--port 5173] [--lan]`. No dependencies.
// - Serves web/ and strips the TypeScript types of .ts files on the fly (node:module).
// - Serves the iPhone app's content from ../App at /assets/ (records, room pictures and clips,
//   story, coach lines, fonts): one copy on disk for both versions.
// - Sends the COOP/COEP headers, so the page may share memory with its audio thread.
// - Listens on localhost only, unless --lan is given. Over plain http a phone on the Wi-Fi gets
//   the page but NO sound: browsers allow AudioWorklet (and shared memory) only on https or
//   localhost. Phones need an https preview deploy (or a tunnel).

import http from "node:http";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { stripTypeScriptTypes } from "node:module";

const web = path.resolve(import.meta.dirname, "..");
const app = path.resolve(web, "../App");
const args = process.argv.slice(2);
const port = Number(args[args.indexOf("--port") + 1]) || 5173;
const host = args.includes("--lan") ? "0.0.0.0" : "127.0.0.1";

/** What /assets/<folder>/ may show of the iPhone app. */
const ASSET_FOLDERS = new Set(["Tracks", "Art", "Story", "Lessons", "Fonts"]);

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".ts": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".m4a": "audio/mp4",
  ".ttf": "font/ttf",
  ".woff2": "font/woff2",
};

/** The file a URL path names, or null when it lies outside what may be served. */
function resolve(urlPath: string): string | null {
  const clean = decodeURIComponent(urlPath.split("?")[0]);
  if (clean.startsWith("/assets/")) {
    const rest = clean.slice("/assets/".length);
    const folder = rest.split("/")[0];
    if (!ASSET_FOLDERS.has(folder)) return null;
    const file = path.resolve(app, rest);
    return file.startsWith(app + path.sep) ? file : null;
  }
  const rel = clean === "/" ? "index.html" : clean.slice(1);
  if (rel.startsWith("tools/") || rel.startsWith("test/") || rel.startsWith("node_modules/")) return null;
  const file = path.resolve(web, rel);
  return file.startsWith(web + path.sep) ? file : null;
}

const server = http.createServer(async (req, res) => {
  const headers: Record<string, string> = {
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Embedder-Policy": "require-corp",
    "Cross-Origin-Resource-Policy": "same-origin",
    "X-Content-Type-Options": "nosniff",
  };
  const file = resolve(req.url ?? "/");
  try {
    if (!file) throw new Error("not served");
    const info = await stat(file);
    if (!info.isFile()) throw new Error("not a file");
    const ext = path.extname(file);
    headers["Content-Type"] = TYPES[ext] ?? "application/octet-stream";
    if (ext === ".ts") {
      const code = stripTypeScriptTypes(await readFile(file, "utf8"), { mode: "strip" });
      res.writeHead(200, { ...headers, "Cache-Control": "no-store" });
      res.end(code);
      return;
    }
    if (ext === ".html" || ext === ".css" || ext === ".json") headers["Cache-Control"] = "no-store";
    // Byte ranges, for the room's video loops.
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
    if (range && (range[1] || range[2])) {
      const size = info.size;
      const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
      const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
      if (start >= size || start > end) {
        res.writeHead(416, { ...headers, "Content-Range": `bytes */${size}` });
        res.end();
        return;
      }
      res.writeHead(206, { ...headers, "Accept-Ranges": "bytes", "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) });
      createReadStream(file, { start, end }).pipe(res);
      return;
    }
    res.writeHead(200, { ...headers, "Accept-Ranges": "bytes", "Content-Length": String(info.size) });
    createReadStream(file).pipe(res);
  } catch {
    res.writeHead(404, { ...headers, "Content-Type": "text/plain" });
    res.end("not found");
  }
});

server.listen(port, host, () => {
  console.log(`Grooveline Headliner (web): http://${host === "0.0.0.0" ? "<this machine's address>" : "localhost"}:${port}/`);
});
