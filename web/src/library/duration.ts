// How long a file is, without decoding it: the browser reads just the header (a decoded hour of music
// is two gigabytes, so the page asks first).

/** Seconds, or null when the browser cannot tell in a few seconds (AIFF, a damaged file). */
export function probeDuration(file: Blob, timeoutMs = 4000): Promise<number | null> {
  return new Promise((done) => {
    const audio = new Audio();
    const url = URL.createObjectURL(file);
    let finished = false;
    const end = (v: number | null) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      audio.removeAttribute("src");
      audio.load();
      URL.revokeObjectURL(url);
      done(v);
    };
    const timer = setTimeout(() => end(null), timeoutMs);
    audio.preload = "metadata";
    audio.onloadedmetadata = () => end(Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : null);
    audio.onerror = () => end(null);
    audio.src = url;
  });
}
