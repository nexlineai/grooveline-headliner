// The Grooveline mark as on grooveline.org (port of App/GroovelineLogo.swift): eleven level bars
// that breathe, and the name in Orbitron Bold, teal. Pure CSS animation (src/style.css, .gl-*):
// each bar swings up and down at its own speed, from its own starting point.

/** Same bars as the site's header: height in px at a logo height of 28, seconds per swing, start offset. */
const BARS: [number, number, number][] = [
  [7, 1.15, 0.22], [15, 1.55, 0.78], [24, 1.28, 0.41], [28, 1.72, 1.02], [20, 1.38, 0.63], [26, 1.86, 0.34],
  [13, 1.21, 0.86], [22, 1.64, 0.52], [17, 1.34, 0.12], [24, 1.76, 0.71], [9, 1.18, 0.48],
];

/** Fills `root` with the logo, `height` px tall (the bars' height; the rest follows). */
export function groovelineLogo(root: HTMLElement, height = 28): void {
  const k = height / 28;
  root.classList.add("gl-logo");
  root.style.setProperty("--k", String(k));
  root.replaceChildren();
  const bars = document.createElement("span");
  bars.className = "gl-bars";
  for (const [h, speed, delay] of BARS) {
    const bar = document.createElement("i");
    bar.style.height = `${h * k}px`;
    bar.style.animationDuration = `${speed}s`;
    bar.style.animationDelay = `${-delay}s`;
    bars.append(bar);
  }
  const name = document.createElement("span");
  name.className = "gl-name";
  name.textContent = "GROOVELINE";
  root.append(bars, name);
}
