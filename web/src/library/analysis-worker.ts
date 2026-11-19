// The tempo analysis off the page's thread (a few seconds of arithmetic for a long track).
import { analyseTempo } from "./beats.ts";

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<{ id: number; mono: Float32Array; rate: number; hint: number }>) => void) | null;
  postMessage(message: unknown): void;
};

scope.onmessage = (e) => {
  const { id, mono, rate, hint } = e.data;
  let tempo = null;
  try { tempo = analyseTempo(mono, rate, hint); } catch { /* a piece it cannot read: no tempo */ }
  scope.postMessage({ id, tempo });
};
