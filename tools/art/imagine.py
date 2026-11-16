#!/usr/bin/env python3
"""Generate one illustration with xAI's image model and save it as a JPEG.

  tools/art/imagine.py OUT.jpg "what to draw" [--aspect 16:9] [--no-style]

The key is read from the GNOME Keyring (service xai, account claude-voice); it is never
written anywhere. The house style below is appended to every prompt so all art matches.
Runs on Omarchy only. Each call is paid from the xAI account.
"""
import argparse, base64, json, subprocess, sys, urllib.request

STYLE = (
    "Stylised graphic-novel illustration for a video game, bold confident ink outlines, flat cel "
    "shading with two-tone shadows, deep navy night palette, sodium-orange street light, magenta "
    "and teal neon rim light, glossy highlights on chrome and vinyl, slightly elongated "
    "proportions, strong readable silhouette, 1990s rave flyer energy meets modern animation. "
    "No text, no lettering, no logos, no watermark."
)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    ap.add_argument("prompt")
    ap.add_argument("--aspect")
    ap.add_argument("--no-style", action="store_true")
    ap.add_argument("--model", default="grok-imagine-image-2.0")
    a = ap.parse_args()
    key = subprocess.run(["secret-tool", "lookup", "service", "xai", "account", "claude-voice"],
                         capture_output=True, text=True).stdout.strip()
    if not key:
        sys.exit("no xAI key in the keyring")
    body = {"model": a.model, "prompt": a.prompt if a.no_style else f"{a.prompt} {STYLE}",
            "n": 1, "response_format": "b64_json"}
    if a.aspect:
        body["aspect_ratio"] = a.aspect
    req = urllib.request.Request("https://api.x.ai/v1/images/generations", json.dumps(body).encode(),
                                 {"Authorization": f"Bearer {key}", "Content-Type": "application/json",
                                  "User-Agent": "grooveline-headliner-art/1"})
    try:
        d = json.load(urllib.request.urlopen(req, timeout=240))
    except urllib.error.HTTPError as e:
        sys.exit(f"{a.out}: http {e.code} {e.read()[:300].decode(errors='replace')}")
    open(a.out, "wb").write(base64.b64decode(d["data"][0]["b64_json"]))
    ticks = d.get("usage", {}).get("cost_in_usd_ticks")
    print(f"{a.out}: ok" + (f" ({ticks} cost ticks)" if ticks else ""))

if __name__ == "__main__":
    main()
