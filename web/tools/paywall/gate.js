// Which requests are for the paid media (the list is made at build time: tools/gating.ts).

/** The path as the asset store will read it: percent-decoded, slashes collapsed, lower case, no
 * trailing slash. null = malformed (refused). Both sides of the comparison are made this way, so
 * /headliner/assets/Tracks/%4cow.m4a, //, and upper case do not step round the list. */
export function normalizePath(pathname) {
  let p;
  try { p = decodeURIComponent(pathname); } catch { return null; }
  p = p.replace(/\\/g, "/").replace(/\/+/g, "/").toLowerCase();
  return p.length > 1 ? p.replace(/\/$/, "") : p;
}

/** A Set of normalized paths from the build's list. */
export const gatedSet = (list) => new Set(list.map((p) => normalizePath(p)));

/** "free" | "gated" | "bad". */
export function classify(pathname, gated) {
  const p = normalizePath(pathname);
  if (p === null) return "bad";
  return gated.has(p) ? "gated" : "free";
}
