// Test stand-in for the sync agent's /mediamtx-auth (rules copied from production, 20 Nov): read allowed; publish only live/<key> for a key in ALLOWED.
// (The production rule also lets 127.0.0.1 publish anything: NOT copied, the test would then allow everything; see the vault note.)
import http from "node:http";
const ALLOWED = new Set((process.env.ALLOWED || "goodkey").split(","));
http.createServer((req, res) => {
  let b = ""; req.on("data", (c) => (b += c));
  req.on("end", () => {
    let p = {}; try { p = JSON.parse(b || "{}"); } catch {}
    const m = /^live\/([A-Za-z0-9._-]{1,80})$/.exec(String(p.path || ""));
    const allow = p.action === "read" || (p.action === "publish" && !!m && ALLOWED.has(m[1]));
    console.log(`[auth] ${JSON.stringify(p)} -> ${allow ? "allow" : "DENY"}`);
    res.writeHead(allow ? 200 : 401, { "Content-Type": "application/json" }); res.end("{}");
  });
}).listen(4010, "127.0.0.1", () => console.log("auth stub on 4010"));
