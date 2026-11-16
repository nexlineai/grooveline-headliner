#!/usr/bin/env python3
"""Same job as animate.py, through OpenRouter's video API, to try cheaper video models.

  tools/art/animate_or.py IN.jpg OUT.mp4 "what happens" --model google/veo-3.1-lite
                          [--seconds 6] [--resolution 720p] [--aspect 16:9] [--return] [--silent]

--return  the clip also ends on the picture it started from (needs a model with `last_frame`).
Models, their sizes and prices: `curl https://openrouter.ai/api/v1/videos/models`.
These models speak in a voice of their own; none takes our cast voices (checked 16 Nov 2026).
The key is read from the GNOME Keyring (service openrouter, account claude-art). Omarchy only.
A started job is paid for: its id is kept in OUT.mp4.job until the clip is saved.
"""
import argparse, base64, json, os, subprocess, sys, time, urllib.request

API = "https://openrouter.ai/api/v1/videos"
KEEP = " Camera locked, no zoom, no cut. Same illustration style, same colours, same lighting, nothing new appears."

def call(url, key, body=None, raw=False):
    req = urllib.request.Request(url, json.dumps(body).encode() if body else None,
                                 {"Authorization": f"Bearer {key}", "Content-Type": "application/json",
                                  "User-Agent": "grooveline-headliner-art/1", "X-Title": "Grooveline Headliner art"})
    try:
        data = urllib.request.urlopen(req, timeout=180).read()
    except urllib.error.HTTPError as e:
        sys.exit(f"http {e.code} {e.read()[:600].decode(errors='replace')}")
    return data if raw else json.loads(data)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("image"); ap.add_argument("out"); ap.add_argument("prompt")
    ap.add_argument("--model", required=True)
    ap.add_argument("--seconds", type=int, default=6)
    ap.add_argument("--resolution", default="720p")
    ap.add_argument("--aspect", default="16:9")
    ap.add_argument("--return", dest="back", action="store_true")
    ap.add_argument("--silent", action="store_true")
    a = ap.parse_args()
    key = subprocess.run(["secret-tool", "lookup", "service", "openrouter", "account", "claude-art"],
                         capture_output=True, text=True).stdout.strip()
    if not key:
        sys.exit("no OpenRouter key in the keyring")
    ticket = a.out + ".job"
    if os.path.exists(ticket):
        job = open(ticket).read().strip()
    else:
        url = "data:image/jpeg;base64," + base64.b64encode(open(a.image, "rb").read()).decode()
        frames = [{"type": "image_url", "image_url": {"url": url}, "frame_type": "first_frame"}]
        if a.back:
            frames.append({"type": "image_url", "image_url": {"url": url}, "frame_type": "last_frame"})
        body = {"model": a.model, "prompt": a.prompt + KEEP, "duration": a.seconds, "resolution": a.resolution,
                "aspect_ratio": a.aspect, "frame_images": frames, "generate_audio": not a.silent}
        job = call(API, key, body)["id"]
        open(ticket, "w").write(job)
    while True:
        time.sleep(8)
        d = call(f"{API}/{job}", key)
        if d.get("status") == "completed":
            break
        if d.get("status") not in ("pending", "in_progress", "queued", "processing"):
            os.remove(ticket)  # failed jobs are not billed
            sys.exit(f"{a.out}: {json.dumps(d)[:600]}")
    raw = a.out + ".raw.mp4"
    open(raw, "wb").write(call(f"{API}/{job}/content?index=0", key, raw=True))
    has_sound = "audio" in subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=codec_type",
                                           "-of", "csv=p=0", raw], capture_output=True, text=True).stdout
    if has_sound and not a.silent:
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", raw, "-c:v", "copy",
                        "-af", "loudnorm=I=-16:TP=-1.5:LRA=11", "-ar", "44100", "-c:a", "aac", "-b:a", "96k",
                        "-movflags", "+faststart", a.out], check=True)
    else:
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", raw, "-c:v", "copy", "-an", "-movflags", "+faststart", a.out], check=True)
    os.remove(raw); os.remove(ticket)
    print(f"{a.out}: ok (cost ${d.get('usage', {}).get('cost')})")

if __name__ == "__main__":
    main()
