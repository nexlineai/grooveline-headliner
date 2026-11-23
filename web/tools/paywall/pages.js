// The two small pages the Worker writes itself (the sign-in landing and its errors). Plain HTML, one
// inline style block, no script: the page's CSP allows only a form to this site.
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const shell = (title, body) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(title)}</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #050508; color: #dfe6f5; font: 16px/1.5 system-ui, sans-serif; }
  main { width: min(440px, 100% - 32px); padding: 28px; border: 1px solid rgba(0,212,200,.25); border-radius: 6px; background: #0d0d18; }
  h1 { margin: 0 0 12px; font-size: 18px; letter-spacing: .18em; color: #00d4c8; }
  p { margin: 0 0 16px; }
  small { color: rgba(223,230,245,.6); display: block; margin-top: 16px; }
  button, a.btn { display: inline-block; border: 0; border-radius: 4px; background: #00d4c8; color: #050508; font: 700 13px system-ui; letter-spacing: .18em; padding: 14px 26px; text-decoration: none; cursor: pointer; }
</style></head><body><main>${body}</main></body></html>`;

/** The page behind the link in the email: a button (the POST uses the link; opening the page does
 * not, so a mail scanner that fetches every link cannot spend it). */
export function loginPage(token) {
  return shell("Sign in · Grooveline Headliner", `
<h1>GROOVELINE HEADLINER</h1>
<p>Press the button to sign in on this browser.</p>
<form method="post" action="/headliner/login"><input type="hidden" name="t" value="${esc(token)}"><button type="submit">SIGN IN</button></form>
<small>Opening the link signs in the browser that opens it. If you play on another device, ask for a new link there.</small>`);
}

export function messagePage(title, text, status = 200) {
  return { status, html: shell(`${title} · Grooveline Headliner`, `<h1>${esc(title)}</h1><p>${esc(text)}</p><a class="btn" href="/headliner/">BACK TO THE GAME</a>`) };
}
