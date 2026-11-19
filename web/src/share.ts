// SHARE (LIVE): one small popup under the top bar to pass the stream's listening link on: copy it, the system share sheet where the browser has
// one, and a few networks. Nothing is sent anywhere by the page itself.

/** The link people listen at (the radio's player; a DJ's own page later: grooveline.org/dj/?dj=NAME). */
export const SHARE_URL = "https://grooveline.org/";
export const SHARE_TEXT = "Listen live on Grooveline Radio";

/** The links of the networks: each opens its own share page in a new tab. */
export function shareLinks(url: string, text: string): { name: string; href: string }[] {
  const u = encodeURIComponent(url), t = encodeURIComponent(text), both = encodeURIComponent(`${text} ${url}`);
  return [
    { name: "X", href: `https://twitter.com/intent/tweet?text=${t}&url=${u}` },
    { name: "FACEBOOK", href: `https://www.facebook.com/sharer/sharer.php?u=${u}` },
    { name: "WHATSAPP", href: `https://wa.me/?text=${both}` },
    { name: "TELEGRAM", href: `https://t.me/share/url?url=${u}&text=${t}` },
    { name: "REDDIT", href: `https://www.reddit.com/submit?url=${u}&title=${t}` },
    { name: "EMAIL", href: `mailto:?subject=${t}&body=${both}` },
  ];
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = ""): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text) e.textContent = text;
  return e;
};

/** Makes `button` open the share popup. */
export function createShare(button: HTMLElement, url = SHARE_URL, text = SHARE_TEXT): { close(): void; readonly open: boolean } {
  const pop = el("div", "share-pop");
  pop.hidden = true;
  pop.setAttribute("role", "dialog");
  pop.setAttribute("aria-label", "Share the stream");
  const head = el("p", "sp-head", "SHARE THE STREAM");
  const say = el("p", "sp-text", text);
  const field = el("input", "sp-link");
  field.type = "text";
  field.readOnly = true;
  field.value = url;
  field.setAttribute("aria-label", "Link to the stream");
  field.addEventListener("focus", () => field.select());
  const copy = el("button", "sp-copy", "COPY LINK");
  copy.type = "button";
  const row = el("div", "sp-row");
  row.append(field, copy);
  const nets = el("div", "sp-nets");
  for (const l of shareLinks(url, text)) {
    const a = el("a", "", l.name);
    a.href = l.href;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    nets.append(a);
  }
  pop.append(head, say, row);
  if (typeof navigator.share === "function") {
    const more = el("button", "sp-more", "SHARE…");
    more.type = "button";
    more.addEventListener("click", () => { navigator.share({ title: text, text, url }).catch(() => {}); });
    pop.append(more);
  }
  pop.append(nets);
  document.body.append(pop);

  let isOpen = false;
  const close = (): void => { isOpen = false; pop.hidden = true; button.classList.remove("on"); };
  const open = (): void => {
    isOpen = true;
    pop.hidden = false;
    button.classList.add("on");
    const r = button.getBoundingClientRect();
    pop.style.top = `${Math.round(r.bottom + 8)}px`;
    pop.style.left = `${Math.round(Math.max(8, Math.min(window.innerWidth - pop.offsetWidth - 8, r.right - pop.offsetWidth)))}px`;
  };
  copy.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(url); } catch { field.focus(); field.select(); document.execCommand("copy"); }
    copy.textContent = "COPIED";
    setTimeout(() => { copy.textContent = "COPY LINK"; }, 1600);
  });
  button.addEventListener("click", (e) => { e.stopPropagation(); if (isOpen) close(); else open(); });
  document.addEventListener("pointerdown", (e) => { if (isOpen && !pop.contains(e.target as Node) && e.target !== button) close(); }, true);
  document.addEventListener("keydown", (e) => { if (isOpen && e.key === "Escape") close(); });
  window.addEventListener("resize", close);
  return { close, get open(): boolean { return isOpen; } };
}
