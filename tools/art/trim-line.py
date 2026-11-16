#!/usr/bin/env python3
"""Cuts the dead air off the end of a spoken clip and writes the copy the app ships.

  tools/art/trim-line.py IN.mp4 OUT.mp4

A clip made with `animate.py --voice --return` ends on the still picture, but the model often
reaches it well before the last frame. This finds where the speech ends and from which moment
the picture no longer changes, and cuts there (never sooner than 0.7 s after the last word).
The picture is re-encoded smaller (x264, crf 21); the sound is kept as it is.
"""
import math, os, re, struct, subprocess, sys, tempfile

SETTLED = 37.0   # dB against the last frame: no visible difference
BREATH = 0.7     # seconds kept after the last word, at least

def main():
    src, out = sys.argv[1], sys.argv[2]
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", src, "-ac", "1", "-ar", "8000", "-f", "s16le", "-"],
                         capture_output=True, check=True).stdout
    samples = struct.unpack("<%dh" % (len(raw) // 2), raw)
    loud = []
    for i in range(0, len(samples), 400):  # 50 ms steps
        w = samples[i:i + 400]
        rms = math.sqrt(sum(x * x for x in w) / max(1, len(w)))
        if 20 * math.log10(max(rms, 1) / 32768) > -40:
            loud.append(i // 400)
    if not loud:
        sys.exit(f"{src}: no speech found")
    speech_end = (loud[-1] + 1) * 0.05
    fps_text = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v", "-show_entries", "stream=r_frame_rate",
                               "-of", "csv=p=0", src], capture_output=True, text=True, check=True).stdout.strip()
    num, den = fps_text.split("/")
    fps = float(num) / float(den)
    with tempfile.TemporaryDirectory() as tmp:
        last, log = os.path.join(tmp, "last.png"), os.path.join(tmp, "psnr.log")
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-sseof", "-0.08", "-i", src, "-frames:v", "1", "-update", "1", last], check=True)
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", src, "-i", last, "-filter_complex",
                        f"[0:v][1:v]psnr=stats_file={log}", "-f", "null", "-"], check=True)
        psnr = [float(re.search(r"psnr_avg:(\S+)", l).group(1).replace("inf", "99")) for l in open(log)]
    # Walk back from the end while the picture still matches the last frame.
    cut = len(psnr)
    floor = int((speech_end + BREATH) * fps)
    while cut - 1 > floor and psnr[cut - 2] >= SETTLED:
        cut -= 1
    seconds = cut / fps
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", src, "-t", f"{seconds:.3f}",
                    "-c:v", "libx264", "-preset", "slow", "-crf", "21", "-pix_fmt", "yuv420p",
                    "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart", out], check=True)
    print(f"{out}: speech ends {speech_end:.2f}s, cut at {seconds:.2f}s of {len(psnr) / fps:.2f}s, "
          f"{os.path.getsize(src) // 1024} -> {os.path.getsize(out) // 1024} KB")

if __name__ == "__main__":
    main()
