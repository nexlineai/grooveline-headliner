// Prints the shot.ts --do steps that drive the effect controls with the REAL mouse (CDP mouse events), computed from the geometry for W x H.
// Optional 3rd and 4th arguments: where the page's top bar has room (the right edge of #livebar and the left edge of #top as the page measures them:
// 363 and 739 at 1152 x 720 with EXIT FULLSCREEN), which put the effects in the same place as in the page.
import { liveGeometry } from "../../src/booth/live-geometry.ts";
const W = Number(process.argv[2]), H = Number(process.argv[3]);
const room = process.argv[4] && process.argv[5] ? { left: Number(process.argv[4]), right: Number(process.argv[5]) } : undefined;
const g = liveGeometry(W, H, room), F = g.fx, L = F.level, S = F.send;
const r = Math.round, cx = (b: { x: number; w: number }) => r(b.x + b.w / 2), cy = (b: { y: number; h: number }) => r(H - (b.y + b.h / 2));
const ev = (x: string) => `eval ${x}`;
const state = "JSON.stringify([booth.fx.send, +booth.fx.amount.toFixed(3), booth.fx.params.map((v)=>+v.toFixed(2)), booth.fx.type])";
const capX = (amt: number) => L.x + (amt - 0.5) * L.travel, ly = r(H - L.y);
const steps = [
  "wait 5", ev(state),
  `click ${cx(S[0])} ${cy(S[0])}`, "wait 1", ev(state),
  `click ${cx(S[1])} ${cy(S[1])}`, "wait 1", ev(state),
  `click ${cx(S[0])} ${cy(S[0])}`, "wait 1", ev(state),
  // LEVEL: drag the cap 20 px to the right, then click the slot near its right end, then drag back 10 px
  `drag ${r(capX(0.5))} ${ly} ${r(capX(0.5)) + 20} ${ly}`, "wait 1", ev(state),
  `click ${r(L.x + 0.4 * L.travel)} ${ly}`, "wait 1", ev(state),
  // an FX knob: drag up 30 px (knob 2 = FEEDBACK-like), and the next effect by a click on the name
  `drag ${r(F.knobs[1].c.x)} ${r(H - F.knobs[1].c.y)} ${r(F.knobs[1].c.x)} ${r(H - F.knobs[1].c.y) - 30}`, "wait 1", ev(state),
  `click ${r(F.name.x + F.name.w * 0.7)} ${cy(F.name)}`, "wait 1", ev(state),
];
console.log(JSON.stringify({ travel: r(L.travel), inBar: g.fxInBar, steps: steps.join("; ") }));
