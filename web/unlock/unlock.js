// The checkout page: sign in (an email link), pay with Paddle, wait until the Worker has heard of the
// payment (Paddle's notification can come after its success page), then back to the game.
// Paddle-specific code is this file's checkout() and the Worker's tools/paywall/paddle.js.
const $ = (id) => document.getElementById(id);
const app = $("app"), title = $("title"), fine = $("fine");
const PRICE = "$4.99 / €4.99";
const el = (tag, className = "", text = "") => { const e = document.createElement(tag); if (className) e.className = className; if (text) e.textContent = text; return e; };
const say = (...nodes) => app.replaceChildren(...nodes);

async function me() {
  const res = await fetch("../api/me", { cache: "no-store", credentials: "same-origin" });
  if (!res.ok) throw new Error(`me ${res.status}`);
  return res.json();
}

function signInForm() {
  title.textContent = "SIGN IN, THEN PAY";
  const form = el("form");
  const input = el("input"); input.type = "email"; input.required = true; input.autocomplete = "email"; input.placeholder = "you@example.com"; input.setAttribute("aria-label", "Email");
  const send = el("button", "", "SEND THE LINK"); send.type = "submit";
  const status = el("p", "status"); status.setAttribute("role", "status");
  form.append(input, send);
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    send.disabled = true; status.textContent = "Sending…";
    try {
      const res = await fetch("../api/login", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: input.value.trim(), next: "unlock" }) });
      const j = await res.json().catch(() => ({}));
      status.textContent = res.ok ? "Check your email. The link works once, for 15 minutes. Open it on THIS device: it signs in the browser that opens it, and brings you back here to pay." : (j.error ?? "That did not work. Try again.");
      if (res.ok && j.link) { const a = el("a", "", "Local test: no email is sent, open the sign-in link here"); a.href = j.link; status.append(document.createElement("br"), a); } // only the local test setup sends `link`
    } catch { status.textContent = "Could not reach Grooveline. Check the connection and try again."; }
    send.disabled = false;
  });
  say(el("p", "", "Your purchase is tied to your email, so it follows you to every device. No password: we send you a link."), form, status);
}

function owned() {
  title.textContent = "FULL CAREER UNLOCKED";
  const go = el("a", "btn", "PLAY"); go.href = "../";
  say(el("p", "ok", "Chapters 3 to 12 are yours. Sign in with the same email on any device to play them."), go);
  fine.textContent = "";
}

/** The payment is done on Paddle's side: ask until the Worker has the notification (usually seconds). */
async function confirming() {
  title.textContent = "CONFIRMING YOUR PURCHASE";
  say(el("p", "", "Thank you. Waiting for the payment to arrive…"));
  for (let i = 0; i < 60; i++) {
    try { if ((await me()).owns) return owned(); } catch { /* try again */ }
    await new Promise((r) => setTimeout(r, 2000));
  }
  say(el("p", "", "Your payment went through, but it has not shown up here yet. It usually does within a few minutes: reload this page later. If it still says locked after an hour, write to info@grooveline.org with the email you paid with."));
}

function checkout(state) {
  title.textContent = "UNLOCK THE CAREER";
  const { env, token, price } = state.checkout;
  const pay = el("button", "", "UNLOCK CAREER");
  const status = el("p", "status");
  say(el("p", "", "10 more chapters · 60+ original records · vinyl by ear, drum machine, B2B and a 60,000-person festival. One payment, no ads, no subscription."), pay, el("p", "price", `${PRICE} · one payment`), status);
  fine.textContent = `Signed in as ${state.email}. You pay Paddle, our reseller: the price at checkout is in your currency, and the total shows the tax before you pay (VAT is included in the euro countries; sales tax is added on top where that is the norm, for example in the US).`;
  if (!window.Paddle) { status.textContent = "The checkout could not load. Turn off a content blocker for this page and reload."; pay.disabled = true; return; }
  if (env === "sandbox") window.Paddle.Environment.set("sandbox");
  window.Paddle.Initialize({
    token,
    eventCallback: (ev) => {
      if (ev?.name === "checkout.completed") confirming();
      if (ev?.name === "checkout.error") {
        // Paddle's own window only says "Something went wrong": the code is what says why (23 Nov: transaction_default_checkout_url_not_set).
        const e = ev.error || ev.data?.error || {};
        console.error("Paddle checkout.error", JSON.stringify(ev));
        status.textContent = `The checkout could not open${e.code ? ` (${e.code})` : ""}. Try again, and if it keeps happening write to info@grooveline.org.`;
      }
    },
  });
  pay.addEventListener("click", () => {
    window.Paddle.Checkout.open({
      items: [{ priceId: price, quantity: 1 }],
      customer: { email: state.email },
      customData: { player: state.player },
      settings: { displayMode: "overlay", theme: "dark", successUrl: new URL("./?paid=1", location.href).href },
    });
  });
}

(async () => {
  let state;
  try { state = await me(); } catch { say(el("p", "status", "Could not reach Grooveline. Reload the page to try again.")); return; }
  if (!state.paywall) { title.textContent = "EVERYTHING IS OPEN"; say(el("p", "", "The full career is not for sale yet: every chapter is open to play.")); return; }
  if (state.owns) return owned();
  if (!state.signedIn) return signInForm();
  if (new URLSearchParams(location.search).has("paid")) return confirming();
  if (!state.checkout) { say(el("p", "", "The checkout is not open yet. Try again soon.")); return; }
  checkout(state);
})();
