#!/usr/bin/env python3
"""Turn one of our illustrations into a short moving clip with xAI's video model.

  tools/art/animate.py IN.jpg OUT.mp4 "what moves" [--seconds 5] [--resolution 720p]
                       [--voice VOICE_ID] [--return] [--silent] [--loop]

--voice   the character speaks in that voice (same names as tools/voice/say.sh). Write the line in
          the prompt in double quotes and name the voice as <AUDIO_0>. The model makes the speech
          and the lips together, so they match; a separate voice file never will.
--return  the clip also ENDS on the picture it started from. Clips of one scene then follow each
          other without a jump, and a clip made this way repeats cleanly.
--silent  no sound track (for background loops).
--loop    also writes OUT-loop.mp4: forwards then backwards. Only for things that look right in
          reverse (dancing does, a tram or a talking mouth does not). Prefer --return.

Sound, when kept, is levelled to -16 LUFS like the voice lines.
The key is read from the GNOME Keyring (service xai, account claude-voice). Runs on Omarchy only.
A 5 second 720p clip costs about eighteen times one picture.
"""
import argparse, base64, json, os, subprocess, sys, time, urllib.request

API = "https://api.x.ai/v1/videos"
KEEP = " Camera locked, no zoom, no cut. Same illustration style, same colours, same lighting, nothing new appears."

def call(url, key, body=None):
    req = urllib.request.Request(url, json.dumps(body).encode() if body else None,
                                 {"Authorization": f"Bearer {key}", "Content-Type": "application/json",
                                  "User-Agent": "grooveline-headliner-art/1"})
    try:
        return json.load(urllib.request.urlopen(req, timeout=120))
    except urllib.error.HTTPError as e:
        sys.exit(f"http {e.code} {e.read()[:600].decode(errors='replace')}")

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("image"); ap.add_argument("out"); ap.add_argument("prompt")
    ap.add_argument("--seconds", type=int, default=5)
    ap.add_argument("--resolution")
    ap.add_argument("--model", default="grok-imagine-video-1.5")
    ap.add_argument("--voice")
    ap.add_argument("--return", dest="back", action="store_true")
    ap.add_argument("--silent", action="store_true")
    ap.add_argument("--loop", action="store_true")
    a = ap.parse_args()
    key = subprocess.run(["secret-tool", "lookup", "service", "xai", "account", "claude-voice"],
                         capture_output=True, text=True).stdout.strip()
    if not key:
        sys.exit("no xAI key in the keyring")
    picture = {"url": "data:image/jpeg;base64," + base64.b64encode(open(a.image, "rb").read()).decode()}
    body = {"model": a.model, "prompt": a.prompt + KEEP, "duration": a.seconds, "image": picture}
    if a.resolution:
        body["resolution"] = a.resolution
    if a.voice:
        body["reference_audios"] = [{"voice_id": a.voice}]
    if a.back:
        body["last_frame"] = picture
    if a.silent:
        body["generate_audio"] = False
    # A started job is paid for. Its id is kept next to the output until the clip is saved, so a
    # run that dies while waiting picks the same job up again instead of buying a second one.
    ticket = a.out + ".job"
    if os.path.exists(ticket):
        job = open(ticket).read().strip()
    else:
        job = call(API + "/generations", key, body)["request_id"]
        open(ticket, "w").write(job)
    while True:
        time.sleep(6)
        d = call(f"{API}/{job}", key)
        if d.get("status") == "done":
            break
        if d.get("status") not in ("pending", "processing", "queued", "in_progress"):
            sys.exit(f"{a.out}: {json.dumps(d)[:600]}")
    raw = a.out + ".raw.mp4"
    urllib.request.urlretrieve(d["video"]["url"], raw)
    has_sound = "audio" in subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=codec_type",
                                           "-of", "csv=p=0", raw], capture_output=True, text=True).stdout
    if has_sound and not a.silent:
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", raw, "-c:v", "copy",
                        "-af", "loudnorm=I=-16:TP=-1.5:LRA=11", "-ar", "44100", "-c:a", "aac", "-b:a", "96k",
                        "-movflags", "+faststart", a.out], check=True)
    else:
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", raw, "-c:v", "copy", "-an",
                        "-movflags", "+faststart", a.out], check=True)
    os.remove(raw)
    os.remove(ticket)
    print(f"{a.out}: ok ({d.get('usage', {}).get('cost_in_usd_ticks')} cost ticks)")
    if a.loop:
        loop = a.out.rsplit(".", 1)[0] + "-loop.mp4"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", a.out, "-filter_complex",
                        "[0:v]split[a][b];[b]reverse[r];[a][r]concat=n=2:v=1:a=0", "-an",
                        "-c:v", "libx264", "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart", loop], check=True)
        print(f"{loop}: ok")

if __name__ == "__main__":
    main()
