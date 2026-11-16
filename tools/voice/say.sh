#!/usr/bin/env bash
# Render one spoken line with xAI's voices:  tools/voice/say.sh OUT.m4a VOICE "text" [language]
# Voices: `curl https://api.x.ai/v1/tts/voices` (28 on 16 Nov 2026). Key from the GNOME Keyring
# (service xai, account claude-voice), passed through curl's stdin so it stays out of `ps`.
# Runs on Omarchy only. Each call is paid from the xAI account.
set -euo pipefail
out=$1 voice=$2 text=$3 lang=${4:-en}
key=$(secret-tool lookup service xai account claude-voice)
[ -n "$key" ] || { echo "no xAI key in the keyring" >&2; exit 1; }
tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT
code=$(printf 'header = "Authorization: Bearer %s"\n' "$key" |
  curl -sS -K - -m 60 -o "$tmp" -w '%{http_code}' -H 'Content-Type: application/json' \
    -d "$(jq -nc --arg t "$text" --arg v "$voice" --arg l "$lang" '{text: $t, voice_id: $v, language: $l}')" \
    https://api.x.ai/v1/tts)
if [ "$code" != 200 ] || ! ffprobe -v error "$tmp" 2>/dev/null; then
  echo "$out failed: HTTP $code: $(head -c 300 "$tmp")" >&2
  exit 1
fi
# Speech at a steady level (-16 LUFS), mono AAC: small, and it sits under the music the same every time.
ffmpeg -v error -y -i "$tmp" -af 'loudnorm=I=-16:TP=-1.5:LRA=11' -ac 1 -ar 44100 -c:a aac -b:a 64k "$out"
echo "$out ok"
