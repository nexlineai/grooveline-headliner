// The page's side of the tempo analysis: sends the mono signal to a Worker and waits for the answer.
import { analyseTempo } from "./beats.ts";
import type { Tempo } from "./beats.ts";

let worker: Worker | null = null;
let next = 1;
const waiting = new Map<number, (t: Tempo | null) => void>();

function start(): Worker | null {
  if (worker) return worker;
  try {
    worker = new Worker(new URL("./analysis-worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<{ id: number; tempo: Tempo | null }>) => {
      waiting.get(e.data.id)?.(e.data.tempo);
      waiting.delete(e.data.id);
    };
    worker.onerror = () => { for (const done of waiting.values()) done(null); waiting.clear(); worker = null; };
  } catch { worker = null; }
  return worker;
}

/** Tempo and first beat of a mono signal; `hint` is the tag's BPM (0 = none). Takes the buffer: do not use `mono` afterwards. */
export function analyse(mono: Float32Array, rate: number, hint: number): Promise<Tempo | null> {
  const w = start();
  if (!w) return new Promise((done) => setTimeout(() => done(analyseTempo(mono, rate, hint)), 0)); // no Worker: on the page's thread
  const id = next++;
  return new Promise((done) => {
    waiting.set(id, done);
    w.postMessage({ id, mono, rate, hint }, [mono.buffer]);
  });
}
