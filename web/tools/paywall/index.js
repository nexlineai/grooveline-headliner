// The paywall: who is signed in, what they own, and the requests the Worker answers itself.
// Dark launch (Zé deploys it OFF and flips it later): var PAYWALL = "off" serves every file as the
// game always did; "on" gates the paid media. A browser that visits /headliner/api/preview?on=1 gets
// the paywall for itself while it is still off for everyone (to try a purchase in production).
import { owns, playerById } from "./accounts.js";
import { classify } from "./gate.js";
import { consume, json, landing, requestLink, sameSitePost } from "./login.js";
import { webhook } from "./paddle.js";
import { PREVIEW_COOKIE, SESSION_COOKIE, clearCookie, cookieValue, readSession, setCookie } from "./session.js";

export const paywallOn = (request, env) => env.PAYWALL === "on" || cookieValue(request, PREVIEW_COOKIE) === "1";

const NOT_READY = () => json({ error: "The account service is not set up yet." }, 503);

export async function session(request, env) {
  return readSession(cookieValue(request, SESSION_COOKIE), env.SESSION_SECRET);
}

/** The answer for a request of the paid media: null = let it through, or a Response (403/400). */
export async function gateMedia(request, env, pathname, gated) {
  if (!paywallOn(request, env)) return null;
  const kind = classify(pathname, gated);
  if (kind === "free") return null;
  if (kind === "bad") return new Response("Bad request", { status: 400, headers: { "Cache-Control": "no-store" } });
  if (env.DB) {
    const s = await session(request, env);
    if (s && (await owns(env, s.p))) return null;
  }
  return new Response("Chapters 3-12 are for the full career: sign in or unlock it in the game.", {
    status: 403, headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" },
  });
}

/** /headliner/api/*, /headliner/login: a Response, or null for anything else. */
export async function handle(request, env, ctx, url) {
  const { pathname } = url;
  const m = request.method;
  if (pathname === "/headliner/api/me" && m === "GET") return me(request, env);
  if (pathname === "/headliner/api/login" && m === "POST") return env.DB && env.SESSION_SECRET ? requestLink(request, env, ctx) : NOT_READY();
  if (pathname === "/headliner/api/logout" && m === "POST") {
    if (!sameSitePost(request)) return json({ error: "bad request" }, 400);
    return json({ ok: true }, 200, { "Set-Cookie": clearCookie(SESSION_COOKIE) });
  }
  if (pathname === "/headliner/api/paddle" && m === "POST") return webhook(request, env);
  if (pathname === "/headliner/api/preview" && m === "GET") {
    const on = url.searchParams.get("on") !== "0";
    return new Response(null, { status: 303, headers: { Location: "/headliner/", "Cache-Control": "no-store", "Set-Cookie": on ? setCookie(PREVIEW_COOKIE, "1", { httpOnly: false }) : clearCookie(PREVIEW_COOKIE) } });
  }
  if (pathname === "/headliner/login") {
    if (!env.DB || !env.SESSION_SECRET) return NOT_READY();
    if (m === "GET") return landing(request, env);
    if (m === "POST") return consume(request, env);
  }
  if (pathname.startsWith("/headliner/api/")) return json({ error: "not found" }, 404);
  return null;
}

async function me(request, env) {
  if (!paywallOn(request, env)) return json({ paywall: false, signedIn: false, owns: true });
  const out = { paywall: true, signedIn: false, owns: false };
  if (env.PADDLE_PRICE_ID && env.PADDLE_CLIENT_TOKEN) out.checkout = { env: env.PADDLE_ENV === "live" ? "live" : "sandbox", token: env.PADDLE_CLIENT_TOKEN, price: env.PADDLE_PRICE_ID };
  if (!env.DB || !env.SESSION_SECRET) return json({ ...out, notReady: true });
  const s = await session(request, env);
  if (!s) return json(out);
  const player = await playerById(env, s.p);
  if (!player) return json(out, 200, { "Set-Cookie": clearCookie(SESSION_COOKIE) });
  // The account page and the purchase wait both come here: always the database, never a remembered answer.
  return json({ ...out, signedIn: true, email: player.email, player: player.id, owns: await owns(env, player.id, { fresh: true }) });
}
