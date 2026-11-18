# Web-only story clips

Made 18 Nov 2026 for the web version only (the iPhone's `App/Story/scenes.json` is untouched);
`web/content/story-web.json` swaps these clips in for the voice-over lines of the same scene.
When the iPhone should have them too: move the files to `App/Story/`, add `"clip"` to the three
lines in `scenes.json` (and drop their `voice`), and delete the entries from `story-web.json`.

## meridian-end-01 .. 03: Lia after MERIDIAN (her mouth did not move: voice-over over a still)
Grok `animate.py --voice ara --resolution 720p --return` on `App/Story/scene-shop-lia.jpg`, the same
voice and prompt frame as her shop scene (`white-label-01..05`, `tools/art/story-lines.sh`: `LIA_WHO`
+ line + `LIA_REST`). Cost $2.16 for the three (6 s, 5 s, 4 s). Words checked with `voxtype transcribe`.

- 01 (6 s): "Sixty thousand people. And the last record had no name on it." She says it slowly, with quiet wonder.
- 02 (5 s): "They didn't dance for a name. They danced for the record."
- 03 (4 s): "Now you know why." She says it quietly, with a warm smile.
