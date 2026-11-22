#!/usr/bin/env bash
# Re-encodes App/Art/*.mp4 (room loops) and App/Story/*.mp4 (story clips) to cut ~60 MB
# from both the iOS bundle and the web app while keeping H.264 High yuv420p + AAC compatibility.
#
#   tools/compress-video.sh             dry run (prints planned targets & current totals)
#   tools/compress-video.sh --apply     re-encode in place (atomic replace after ffprobe check)
set -euo pipefail

cd "$(dirname "$0")/.."
APPLY=0
if [[ "${1:-}" == "--apply" ]]; then APPLY=1; fi

command -v ffmpeg >/dev/null || { echo "ffmpeg not found" >&2; exit 1; }
command -v ffprobe >/dev/null || { echo "ffprobe not found" >&2; exit 1; }

ROOM_CRF="${ROOM_CRF:-27}"
STORY_CRF="${STORY_CRF:-26}"
PRESET="${PRESET:-slow}"

reencode() {
  local src=$1 mode=$2
  local before after tmp w0 h0 w1 h1 d0 d1
  before=$(stat -c%s "$src")
  if [[ "$APPLY" -eq 0 ]]; then
    printf "  [dry-run] %-44s (%6.2f MiB, %s)\n" "$src" "$(awk "BEGIN{print $before/1048576}")" "$mode"
    return 0
  fi

  tmp="${src}.tmp.mp4"
  rm -f "$tmp"
  read -r w0 h0 d0 < <(ffprobe -v error -select_streams v:0 -show_entries stream=width,height -show_entries format=duration -of default=nw=1:nk=1 "$src" | tr '\n' ' ')

  if [[ "$mode" == "room" ]]; then
    ffmpeg -hide_banner -loglevel error -y -i "$src" \
      -an -c:v libx264 -profile:v high -preset "$PRESET" -crf "$ROOM_CRF" \
      -pix_fmt yuv420p -tag:v avc1 -movflags +faststart "$tmp"
  else
    ffmpeg -hide_banner -loglevel error -y -i "$src" \
      -c:v libx264 -profile:v high -preset "$PRESET" -crf "$STORY_CRF" \
      -pix_fmt yuv420p -tag:v avc1 -c:a aac -b:a 96k -movflags +faststart "$tmp"
  fi

  read -r w1 h1 d1 < <(ffprobe -v error -select_streams v:0 -show_entries stream=width,height -show_entries format=duration -of default=nw=1:nk=1 "$tmp" | tr '\n' ' ')
  if [[ "$w0" != "$w1" || "$h0" != "$h1" ]]; then
    rm -f "$tmp"
    echo "ERROR: dimension mismatch on $src ($w0 x $h0 -> $w1 x $h1)" >&2
    exit 1
  fi
  awk -v a="$d0" -v b="$d1" 'BEGIN{diff=a-b; if(diff<0) diff=-diff; if(diff>0.15) exit 1}' || {
    rm -f "$tmp"
    echo "ERROR: duration drift on $src ($d0 -> $d1)" >&2
    exit 1
  }

  after=$(stat -c%s "$tmp")
  if (( after < before )); then
    mv -f "$tmp" "$src"
    printf "  %-44s %6.2f -> %6.2f MiB (%2d%%)\n" "$src" \
      "$(awk "BEGIN{print $before/1048576}")" "$(awk "BEGIN{print $after/1048576}")" "$(( after * 100 / before ))"
  else
    rm -f "$tmp"
    printf "  %-44s kept original (%6.2f MiB; re-encode not smaller)\n" "$src" "$(awk "BEGIN{print $before/1048576}")"
  fi
}

echo "Rooms (App/Art/*.mp4, CRF $ROOM_CRF, muted H.264 High yuv420p):"
for f in App/Art/*.mp4; do reencode "$f" room; done

echo "Story clips (App/Story/*.mp4, CRF $STORY_CRF, H.264 High yuv420p + 96k AAC):"
for f in App/Story/*.mp4; do reencode "$f" story; done
