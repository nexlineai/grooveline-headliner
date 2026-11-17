#!/usr/bin/env python3
"""Cuts the dead air off both ends of a spoken clip and writes the copy the app ships.

  tools/art/trim-line.py IN.mp4 OUT.mp4

A clip made with `animate.py --voice --return` starts and ends on the scene's still picture, but
the character waits before speaking and takes a while to settle afterwards. Played one after the
other, that makes the pauses between lines too long (Zé, 16 Nov). This keeps LEAD seconds before
the first word and BREATH seconds after the last (a little more if the body is still moving
a lot, never more than LINGER), and dissolves the cut ends into the original first and last
frame, so every clip still starts and ends on the still and lines join without a jump.
The picture is re-encoded smaller (x264, crf 21).
"""
import math, os, re, struct, subprocess, sys, tempfile

LEAD = 0.30      # seconds kept before the first word
BREATH = 0.60    # seconds kept after the last word, at least
LINGER = 1.30    # ... and at most, when the picture has not come to rest
NEAR = 33.0      # dB against the last frame: close enough to dissolve from
MELT_IN, MELT_OUT = 0.15, 0.25

def run(*cmd, **kw):
    return subprocess.run(cmd, check=True, **kw)

def main():
    src, out = sys.argv[1], sys.argv[2]
    raw = run("ffmpeg", "-v", "error", "-i", src, "-ac", "1", "-ar", "8000", "-f", "s16le", "-", capture_output=True).stdout
    samples = struct.unpack("<%dh" % (len(raw) // 2), raw)
    loud = []
    for i in range(0, len(samples), 400):  # 50 ms steps
        w = samples[i:i + 400]
        rms = math.sqrt(sum(x * x for x in w) / max(1, len(w)))
        if 20 * math.log10(max(rms, 1) / 32768) > -40:
            loud.append(i // 400)
    if not loud:
        sys.exit(f"{src}: no speech found")
    speech_start, speech_end = loud[0] * 0.05, (loud[-1] + 1) * 0.05
    num, den = run("ffprobe", "-v", "error", "-select_streams", "v", "-show_entries", "stream=r_frame_rate",
                   "-of", "csv=p=0", src, capture_output=True, text=True).stdout.strip().split("/")
    fps = float(num) / float(den)
    with tempfile.TemporaryDirectory() as tmp:
        first, last, log = (os.path.join(tmp, n) for n in ("first.png", "last.png", "psnr.log"))
        run("ffmpeg", "-v", "error", "-y", "-i", src, "-frames:v", "1", "-update", "1", first)
        # The last picture: read the final half second and keep overwriting, so the file ends up
        # holding the very last frame (a fixed -0.08 s found nothing when the sound outlasts the picture).
        run("ffmpeg", "-v", "error", "-y", "-sseof", "-0.5", "-i", src, "-an", "-update", "1", last)
        run("ffmpeg", "-v", "error", "-y", "-i", src, "-i", last, "-filter_complex", f"[0:v][1:v]psnr=stats_file={log}", "-f", "null", "-")
        psnr = [float(re.search(r"psnr_avg:(\S+)", l).group(1).replace("inf", "99")) for l in open(log)]
        total = len(psnr) / fps
        start = max(0.0, speech_start - LEAD)
        end = min(total, speech_end + BREATH)
        while end < min(total, speech_end + LINGER) and psnr[min(len(psnr) - 1, int(end * fps))] < NEAR:
            end += 1 / fps
        length = end - start
        graph = (f"[1:v]format=rgba,fade=t=out:st=0:d={MELT_IN}:alpha=1[a];"
                 f"[2:v]format=rgba,fade=t=in:st={length - MELT_OUT:.3f}:d={MELT_OUT}:alpha=1[b];"
                 f"[0:v][a]overlay=shortest=1[x];[x][b]overlay=shortest=1,format=yuv420p[v];"
                 f"[0:a]afade=t=in:d=0.03,afade=t=out:st={length - 0.06:.3f}:d=0.06[s]")
        run("ffmpeg", "-v", "error", "-y", "-ss", f"{start:.3f}", "-t", f"{length:.3f}", "-i", src,
            "-loop", "1", "-framerate", str(fps), "-t", f"{length:.3f}", "-i", first,
            "-loop", "1", "-framerate", str(fps), "-t", f"{length:.3f}", "-i", last,
            "-filter_complex", graph, "-map", "[v]", "-map", "[s]", "-t", f"{length:.3f}",
            "-c:v", "libx264", "-preset", "slow", "-crf", "21", "-c:a", "aac", "-b:a", "96k",
            "-movflags", "+faststart", out)
    print(f"{out}: speech {speech_start:.2f}-{speech_end:.2f}s, kept {start:.2f}-{end:.2f}s of {total:.2f}s "
          f"(quiet before {speech_start - start:.2f}s, after {end - speech_end:.2f}s), {os.path.getsize(out) // 1024} KB")

if __name__ == "__main__":
    main()
