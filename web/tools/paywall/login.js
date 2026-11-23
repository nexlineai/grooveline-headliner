// Email-link sign-in (no password): POST /headliner/api/login sends the link, GET /headliner/login
// shows a button, POST /headliner/login uses the link and sets the session cookie.
import { addLink, normEmail, peekLink, playerByEmail, rateLimit, touchLogin, useLink, validEmail } from "./accounts.js";
import { randomToken, sha256Hex } from "./crypto.js";
import { loginPage, messagePage } from "./pages.js";
import { SESSION_COOKIE, makeSession, setCookie } from "./session.js";

const NEXT = { "": "/headliner/", unlock: "/headliner/unlock/" };

export const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers } });
export const html = (page, extra = {}) =>
  new Response(page.html ?? page, { status: page.status ?? 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", ...extra } });

const clientIp = (request) => request.headers.get("CF-Connecting-IP") || "unknown";

/** A POST from this site's own pages only: JSON (a cross-site form cannot send it without a
 * preflight, which this Worker never answers) from the same origin. */
export function sameSitePost(request) {
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) return false;
  return (request.headers.get("Content-Type") || "").toLowerCase().startsWith("application/json");
}

export async function sendLink(env, email, url) {
  if (!env.RESEND_API_KEY) { console.log(`[login] no RESEND_API_KEY; the link for ${email} is ${url}`); return; }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: env.MAIL_FROM || "Grooveline Headliner <headliner@grooveline.org>",
      reply_to: env.REPLY_TO || "info@grooveline.org",
      to: [email],
      subject: "Your Grooveline Headliner sign-in link",
      html: `<p style="font:16px system-ui">Press the link to sign in to Grooveline Headliner. It works once, for 15 minutes.</p>` +
        `<p style="font:16px system-ui"><a href="${url}">Sign in</a></p>` +
        `<p style="font:13px system-ui;color:#666">It signs in the browser that opens it: if you are playing on a computer and read this on your phone, ask for a new link on the computer, or copy this link to the computer's browser. If you did not ask for it, ignore this email.</p>`,
    }),
  });
  console.log(`[login] Resend ${res.status}`);
}

export async function requestLink(request, env, ctx) {
  if (!sameSitePost(request)) return json({ error: "bad request" }, 400);
  let body;
  try { body = await request.json(); } catch { return json({ error: "bad request" }, 400); }
  const email = normEmail(body?.email);
  if (!validEmail(email)) return json({ error: "That does not look like an email address." }, 400);
  const next = body?.next === "unlock" ? "unlock" : "";
  if (!(await rateLimit(env, `link-ip:${clientIp(request)}`, 8, 900)) || !(await rateLimit(env, `link-mail:${email}`, 4, 3600))) {
    return json({ error: "Too many requests. Wait a few minutes and try again." }, 429);
  }
  const token = randomToken(32);
  await addLink(env, await sha256Hex(token), email, next);
  const url = `${new URL(request.url).origin}/headliner/login?t=${token}`;
  ctx.waitUntil(sendLink(env, email, url));
  // The same answer for every address: the page never tells whether an account exists.
  return json({ ok: true, ...(env.DEV_ECHO_LINK === "1" ? { link: url } : {}) });
}

/** GET /headliner/login?t=...: a button, nothing is used up. */
export async function landing(request, env) {
  const token = new URL(request.url).searchParams.get("t") || "";
  const link = token && token.length < 100 ? await peekLink(env, await sha256Hex(token)) : null;
  if (!link) return html(messagePage("LINK EXPIRED", "This link has run out or was already used. Ask for a new one on the game's sign-in.", 410));
  return html(loginPage(token));
}

/** POST /headliner/login (the button): uses the link, signs in, goes back to the game. */
export async function consume(request, env) {
  if (!(await rateLimit(env, `use-ip:${clientIp(request)}`, 20, 900))) return html(messagePage("TOO MANY TRIES", "Wait a few minutes and try again.", 429));
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) return html(messagePage("NOT ALLOWED", "Open the link from your email.", 403));
  let token = "";
  try { token = String((await request.formData()).get("t") ?? ""); } catch { /* falls through */ }
  const link = token && token.length < 100 ? await useLink(env, await sha256Hex(token)) : null;
  if (!link) return html(messagePage("LINK EXPIRED", "This link has run out or was already used. Ask for a new one on the game's sign-in.", 410));
  const player = await playerByEmail(env, link.email);
  await touchLogin(env, player.id);
  const session = await makeSession(env.SESSION_SECRET, player);
  return new Response(null, {
    status: 303,
    headers: { Location: `${NEXT[link.next] ?? NEXT[""]}?signedin=1`, "Set-Cookie": setCookie(SESSION_COOKIE, session), "Cache-Control": "no-store" },
  });
}
