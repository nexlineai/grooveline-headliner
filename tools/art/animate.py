#!/usr/bin/env python3
"""Turn one of our illustrations into a short moving clip with xAI's video model.

  tools/art/animate.py IN.jpg OUT.mp4 "what moves" [--seconds 5] [--resolution 720p] [--loop]

--loop also writes OUT-loop.mp4: the clip forwards then backwards, which repeats without a jump
(the clip starts on the still picture, so every loop of a scene also starts and ends on the same frame).
The key is read from the GNOME Keyring (service xai, account claude-voice). Runs on Omarchy only.
A 5 second clip costs about ten times one picture.
"""
import argparse, base64, json, subprocess, sys, time, urllib.request

API = "https://api.x.ai/v1/videos"
KEEP = " Camera locked, no zoom, no cut. Same illustration style, same colours, same lighting, nothing new appears."

def call(url, key, body=None):
    req = urllib.request.Request(url, json.dumps(body).encode() if body else None,
                                 {"Authorization": f"Bearer {key}", "Content-Type": "application/json",
                                  "User-Agent": "grooveline-headliner-art/1"})
    try:
        return json.load(urllib.request.urlopen(req, timeout=120))
    except urllib.error.HTTPError as e:
        sys.exit(f"http {e.code} {e.read()[:400].decode(errors='replace')}")

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("image"); ap.add_argument("out"); ap.add_argument("prompt")
    ap.add_argument("--seconds", type=int, default=5)
    ap.add_argument("--resolution")
    ap.add_argument("--model", default="grok-imagine-video-1.5")
    ap.add_argument("--loop", action="store_true")
    a = ap.parse_args()
    key = subprocess.run(["secret-tool", "lookup", "service", "xai", "account", "claude-voice"],
                         capture_output=True, text=True).stdout.strip()
    if not key:
        sys.exit("no xAI key in the keyring")
    picture = base64.b64encode(open(a.image, "rb").read()).decode()
    body = {"model": a.model, "prompt": a.prompt + KEEP, "duration": a.seconds,
            "image": {"url": "data:image/jpeg;base64," + picture}}
    if a.resolution:
        body["resolution"] = a.resolution
    job = call(API + "/generations", key, body)["request_id"]
    while True:
        time.sleep(6)
        d = call(f"{API}/{job}", key)
        if d.get("status") == "done":
            break
        if d.get("status") not in ("pending", "processing", "queued", "in_progress"):
            sys.exit(f"{a.out}: {json.dumps(d)[:400]}")
    urllib.request.urlretrieve(d["video"]["url"], a.out)
    print(f"{a.out}: ok ({d.get('usage', {}).get('cost_in_usd_ticks')} cost ticks)")
    if a.loop:
        loop = a.out.rsplit(".", 1)[0] + "-loop.mp4"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", a.out, "-filter_complex",
                        "[0:v]split[a][b];[b]reverse[r];[a][r]concat=n=2:v=1:a=0", "-an",
                        "-c:v", "libx264", "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart", loop], check=True)
        print(f"{loop}: ok")

if __name__ == "__main__":
    main()
