// A volume that moves to `to` over `seconds` (HTML audio has no fades of its own).
export function fade(a: HTMLAudioElement, to: number, seconds: number): void {
  const from = a.volume, start = performance.now();
  const step = () => {
    const t = Math.min(1, (performance.now() - start) / (seconds * 1000));
    a.volume = Math.max(0, Math.min(1, from + (to - from) * t));
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
