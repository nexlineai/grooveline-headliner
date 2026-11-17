#!/usr/bin/env bash
# Makes the spoken clips for the story scenes: one clip per line, the character says the line in
# their cast voice and the lips match. Every clip starts and ends on the scene's still picture,
# so the lines of a scene follow each other without a jump.
#
#   tools/art/story-lines.sh OUTDIR [line-id ...]     (no ids = all lines; each one is a paid clip)
#
# After a run, check the words:  ffmpeg -i X.mp4 -ac 1 -ar 16000 x.wav && voxtype transcribe x.wav
# then copy the good clips to App/Story/ as <line-id>.mp4.
set -euo pipefail
cd "$(dirname "$0")/../.."
out=$1; shift
mkdir -p "$out"

NUNO_WHO='The big bald security man leaning on the flight case looks at the viewer and says, with the voice from <AUDIO_0>, low, calm and slow:'
NUNO_REST='His lips form exactly these words. He says only this one line, then closes his mouth and is still again. Far behind him the lasers sweep slowly over the festival crowd. Sound: only his voice. No music.'
LIA_WHO='The woman behind the counter looks at the viewer and says, with the voice from <AUDIO_0>, dry, warm and unhurried:'
LIA_REST='Her lips form exactly these words. She says only this one line, then closes her mouth and is still again with a small smile. She keeps holding the blank white record sleeve. Rain runs down the window. The yellow tram outside is parked and does not move. Sound: only her voice. No music.'

line() { # id picture voice seconds prompt
  local id=$1 picture=$2 voice=$3 seconds=$4 prompt=$5
  if [ $# -gt 5 ]; then :; fi
  tools/art/animate.py "App/Story/$picture.jpg" "$out/$id.mp4" "$prompt" \
    --seconds "$seconds" --resolution 720p --voice "$voice" --return
}

want() { [ ${#ids[@]} -eq 0 ] || [[ " ${ids[*]} " == *" $1 "* ]]; }
ids=("$@")

want cold-open-01 && line cold-open-01 scene-backstage zagan 6 "$NUNO_WHO \"Sixty thousand people out there. They have been waiting for you all day.\" He tips his head slightly towards the crowd behind him as he speaks. $NUNO_REST" &
want cold-open-02 && line cold-open-02 scene-backstage zagan 6 "$NUNO_WHO \"Your bag. I counted them twice. They're all there.\" He pats the metal flight case once with his ringed hand. $NUNO_REST" &
want cold-open-03 && line cold-open-03 scene-backstage zagan 4 "$NUNO_WHO \"Even the one with no name on it.\" One corner of his mouth lifts for a moment. $NUNO_REST" &
want cold-open-04 && line cold-open-04 scene-backstage zagan 4 "$NUNO_WHO \"Go on. You know why.\" He gives one small nod. $NUNO_REST" &
want white-label-01 && line white-label-01 scene-shop-lia ara 6 "$LIA_WHO \"You've been at that listening station for an hour. I close in ten minutes.\" $LIA_REST" &
want white-label-02 && line white-label-02 scene-shop-lia ara 7 "$LIA_WHO \"So you mix. On a laptop. With the sync button. Mm.\" She raises one eyebrow, amused, and pauses between the short sentences. $LIA_REST" &
want white-label-03 && line white-label-03 scene-shop-lia ara 5 "$LIA_WHO \"Sync is training wheels, kid. One day you take them off.\" $LIA_REST" &
want white-label-04 && line white-label-04 scene-shop-lia ara 6 "$LIA_WHO \"Here. White label. No name, no artist, nothing.\" She pushes the white sleeve a little towards the viewer. $LIA_REST" &
want white-label-05 && line white-label-05 scene-shop-lia ara 4 "$LIA_WHO \"Play it when you know why.\" She says it quietly and seriously. $LIA_REST" &
wait

# Chapter 1 (17 Nov 2026) was made with Gemini Omni through OpenRouter (tools/art/animate_or.py,
# --model google/gemini-omni-1.2-flash --seconds 7 --return, 16:9 pictures from imagine.py).
# The voice comes from the model, so every clip of a character uses the same description:
#   DANI: "a seventeen-year-old boy's voice, cocky and teasing, lazy drawl"
#   MIRA: "a seventeen-year-old girl's voice, bright, proud and theatrical"
# Tó never speaks on camera: his lines are tools/voice/say.sh with the voice helios.
