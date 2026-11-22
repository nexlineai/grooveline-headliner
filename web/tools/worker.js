// grooveline.org/headliner/: the web version of Grooveline Headliner, as a Worker's static assets
// (built by tools/build.ts into dist/). The route is a prefix; the radio site keeps its own Pages
// deployment, navigation and API. Every response of the game gets cross-origin isolation (the
// page shares memory with its audio thread) and noindex until the game is linked from the site.
import SIZES from "../dist/sizes.json"; // written by tools/build.ts: media path -> bytes

const HEADERS = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Resource-Policy": "same-origin",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex",
  // Only the game's own files; the ways out are the link to grooveline.org (a new tab) and, for the SOUND CHECK / going live, the account API (the DJ's sign-in and key)
  // and the WHIP proxy on the stream host (the booth's audio): nothing else.
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
    "media-src 'self' blob:; font-src 'self'; connect-src 'self' https://api.grooveline.org https://stream.grooveline.org; worker-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'",
  "Referrer-Policy": "strict-origin-when-cross-origin",
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/headliner") {
      url.pathname = "/headliner/";
      return Response.redirect(url.toString(), 308);
    }
    // Grooveline Booth (22 Nov 2026): the DJ software at its own address, grooveline.org/booth/. For now it is the same build as the
    // Headliner (the files are served from /headliner/), and the page opens straight in the booth when its address starts with /booth.
    if (url.pathname === "/booth") {
      url.pathname = "/booth/";
      return Response.redirect(url.toString(), 308);
    }
    // The old LIVE links go to the Booth: /headliner/live and /headliner/?live (other parameters, e.g. ?publishCamera, are kept).
    if (url.pathname === "/headliner/live" || url.pathname === "/headliner/live/" || (url.pathname === "/headliner/" && url.searchParams.has("live"))) {
      url.pathname = "/booth/";
      const kept = url.search.slice(1).split("&").filter((p) => p && p.split("=")[0] !== "live"); // the rest exactly as written (?publishCamera stays bare)
      url.search = kept.length ? `?${kept.join("&")}` : "";
      return Response.redirect(url.toString(), 302);
    }
    const booth = url.pathname.startsWith("/booth/");
    if (!booth && !url.pathname.startsWith("/headliner/")) return fetch(request); // a neighbouring path stays with the site
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
    }
    // Static assets always answer a Range request with the whole file (Cloudflare's docs); the
    // media players need byte ranges (Safari probes bytes=0-1 and plays video only with them).
    // The Booth's files are the Headliner's: /booth/<file> is read from /headliner/<file>.
    const assetPath = booth ? `/headliner/${url.pathname.slice("/booth/".length)}` : url.pathname;
    const assetUrl = new URL(url);
    assetUrl.pathname = assetPath;
    const plain = new Request(assetUrl.toString(), { method: request.method, headers: withoutRange(request.headers) });
    const response = await env.ASSETS.fetch(plain);
    const headers = new Headers(response.headers);
    for (const [k, v] of Object.entries(HEADERS)) headers.set(k, v);
    if (response.status === 200 && /\.(m4a|mp4|mp3)$/.test(assetPath)) {
      headers.set("Accept-Ranges", "bytes");
      const range = request.headers.get("Range");
      if (range) return ranged(range, response, headers, request.method, SIZES[assetPath]);
    }
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  },
};

const MAX_SLICE = 2 * 1024 * 1024;

function withoutRange(h) {
  const out = new Headers(h);
  out.delete("Range");
  out.delete("If-Range");
  return out;
}

/** 206 with the bytes asked for (one range: "a-b", "a-" or the last "-n"), streamed: the file
 * is never held in memory, only the wanted slice of each chunk is passed on. */
async function ranged(range, response, headers, method, known) {
  let size = known ?? Number(response.headers.get("Content-Length") || NaN);
  if (!(size > 0)) {
    // Size unknown: read the file (at most a few MB) and answer from memory.
    const all = new Uint8Array(await response.arrayBuffer());
    size = all.byteLength;
    response = new Response(all);
  }
  const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  let start = 0, end = size - 1;
  let valid = Number.isFinite(size) && size > 0 && !!m && !!(m[1] || m[2]);
  if (valid) {
    if (!m[1]) { const n = Number(m[2]); valid = n > 0; start = Math.max(0, size - n); }
    else { start = Number(m[1]); if (m[2]) end = Math.min(end, Number(m[2])); }
    valid = valid && start <= end && start < size;
  }
  if (!valid) {
    response.body?.cancel();
    headers.set("Content-Range", `bytes */${Number.isFinite(size) ? size : "*"}`);
    headers.delete("Content-Length");
    return new Response(null, { status: 416, headers });
  }
  // A slice from the middle is at most 2 MiB: players then ask for the next piece. This bounds a
  // Worker's memory however many seeks arrive at once (128 MB per isolate).
  const whole = start === 0 && end === size - 1;
  if (!whole) end = Math.min(end, start + MAX_SLICE - 1);
  const length = end - start + 1;
  headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
  headers.set("Content-Length", String(length));
  if (method === "HEAD" || !response.body) { response.body?.cancel(); return new Response(null, { status: 206, headers }); }
  // The whole file asked as a range (Chrome's first media request): passed on as it is.
  if (whole) return new Response(response.body, { status: 206, headers });
  // Otherwise read only as far as needed, keep just the wanted bytes, and stop reading.
  return new Response(await sliceOf(response.body, start, end), { status: 206, headers });
}

async function sliceOf(body, start, end) {
  const out = new Uint8Array(end - start + 1);
  const reader = body.getReader();
  let at = 0, filled = 0;
  try {
    while (at <= end) {
      const { value, done } = await reader.read();
      if (done) break;
      const from = Math.max(0, start - at), to = Math.min(value.byteLength, end + 1 - at);
      if (to > from) { out.set(value.subarray(from, to), filled); filled += to - from; }
      at += value.byteLength;
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  return filled === out.length ? out : out.subarray(0, filled);
}
