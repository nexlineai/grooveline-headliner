// The player's account, for the paywall (the Worker's side: tools/paywall/). Chapters 1-2 are free;
// 3-12 need the career, bought once and tied to an email address (a link in your mail, no password).
// This file is only what the page SHOWS: the paid media are withheld by the Worker, so nothing
// here (or in the browser's storage) can open them.

export interface Account {
  /** The paywall is on for this visitor (off: everything is open, as before). */
  paywall: boolean;
  signedIn: boolean;
  email: string | null;
  /** Owns the career (always true while the paywall is off). */
  owns: boolean;
}

/** What the unlock costs, as the buttons say it. The checkout shows the same price in the buyer's own currency, VAT included. */
export const PRICE_TEXT = "$4.99";
export const FIRST_PAID_CHAPTER = 3;

let state: Account = { paywall: false, signedIn: false, email: null, owns: true };
export const account = (): Account => state;
/** A chapter the player cannot open yet because the career is not unlocked. */
export const paywalled = (chapter: number): boolean => state.paywall && !state.owns && chapter >= FIRST_PAID_CHAPTER;

const listeners: (() => void)[] = [];
export const onAccountChange = (fn: () => void): void => { listeners.push(fn); };
function set(next: Account): void {
  const changed = JSON.stringify(next) !== JSON.stringify(state);
  state = next;
  if (changed) for (const fn of listeners) fn();
}

/** Asks the Worker who this is. A server that does not answer (the dev server, an error) leaves
 * the game open: the Worker is the gate, the page only shows it. */
export async function refreshAccount(): Promise<Account> {
  try {
    const res = await fetch("api/me", { cache: "no-store", credentials: "same-origin", signal: AbortSignal.timeout(6000) }); // never hold the game back
    if (!res.ok) { set({ paywall: false, signedIn: false, email: null, owns: true }); return state; }
    const j = await res.json() as { paywall?: boolean; signedIn?: boolean; email?: string; owns?: boolean };
    set(j.paywall
      ? { paywall: true, signedIn: !!j.signedIn, email: j.signedIn ? j.email ?? null : null, owns: !!j.owns }
      : { paywall: false, signedIn: false, email: null, owns: true });
  } catch {
    set({ paywall: false, signedIn: false, email: null, owns: true });
  }
  return state;
}

export type LinkResult = { ok: true } | { ok: false; message: string };

/** Asks for the sign-in link. `next: "unlock"` lands on the checkout page after the link. */
export async function requestLink(email: string, next: "" | "unlock"): Promise<LinkResult> {
  try {
    const res = await fetch("api/login", {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, next }),
    });
    if (res.ok) return { ok: true };
    const j = await res.json().catch(() => ({})) as { error?: string };
    if (res.status === 503) return { ok: false, message: "Signing in is not available yet." };
    return { ok: false, message: j.error ?? "That did not work. Try again." };
  } catch {
    return { ok: false, message: "Could not reach Grooveline. Check the connection and try again." };
  }
}

export async function signOut(): Promise<void> {
  try {
    await fetch("api/logout", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: "{}" });
  } catch { /* the cookie goes with the next successful call */ }
  await refreshAccount();
}

/** To the checkout page (a page of its own: Paddle's checkout cannot run inside the game's isolated page). */
export const goToCheckout = (): void => { location.href = "unlock/"; };

// MARK: - The ACCOUNT sheet

const el = (tag: string, className = "", text = ""): HTMLElement => {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text) e.textContent = text;
  return e;
};

/** Fills the sheet's body: sign in (an email, then "check your mail"), or who is signed in. `then` is
 * what the link should lead to ("unlock" = straight on to paying). */
export function fillAccount(body: HTMLElement, then: "" | "unlock", closeSheet: () => void): void {
  body.replaceChildren();
  const a = state;
  if (!a.paywall) { body.append(el("p", "", "Everything is open: no account needed.")); return; }

  if (a.signedIn) {
    body.append(el("p", "who", `Signed in as ${a.email}`));
    if (a.owns) body.append(el("p", "ok", "FULL CAREER UNLOCKED. Chapters 3 to 12 are yours on every device you sign in on."));
    else {
      body.append(el("p", "", "Chapters 3 to 12 are not unlocked on this account yet."));
      const buy = el("button", "primary", `UNLOCK CAREER  ·  ${PRICE_TEXT}`);
      buy.addEventListener("click", goToCheckout);
      body.append(buy);
    }
    const out = el("button", "quiet", "SIGN OUT");
    out.addEventListener("click", () => { signOut().then(() => { fillAccount(body, "", closeSheet); }); });
    body.append(out);
    return;
  }

  body.append(el("p", "", then === "unlock"
    ? "First, your email: we send you a link, it signs you in, and then you pay. No password."
    : "Bought the career already, or want to? Enter your email and we send you a link. No password."));
  const form = el("form", "signin") as HTMLFormElement;
  const input = el("input") as HTMLInputElement;
  input.type = "email"; input.required = true; input.autocomplete = "email"; input.placeholder = "you@example.com"; input.setAttribute("aria-label", "Email");
  const send = el("button", "primary", "SEND THE LINK") as HTMLButtonElement;
  send.type = "submit";
  const status = el("p", "status");
  status.setAttribute("role", "status");
  form.append(input, send);
  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    send.disabled = true;
    status.textContent = "Sending…";
    requestLink(input.value.trim(), then).then((r) => {
      send.disabled = false;
      status.textContent = r.ok
        ? "Check your email. The link works once, for 15 minutes. Open it on THIS device: it signs in the browser that opens it."
        : r.message;
    });
  });
  body.append(form, status);
  setTimeout(() => input.focus(), 0);
  void closeSheet;
}
