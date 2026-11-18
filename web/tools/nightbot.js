// A DJ for tests: run in the page during a night. Plays the left record, brings the right one in
// on the phrase (SYNC holds the tempo), blends for eight bars with one bassline, takes the left
// one out. One clean mix; then it lets the right record play.
window.__nb && clearInterval(window.__nb);
window.__nbState = { phase: 0, at: 0 };
window.__nb = setInterval(() => {
  const N = booth.night, d = engine.decks, st = window.__nbState;
  if (!N || N.stars !== null) return;
  const t = performance.now() / 1000;
  const into = ((d[0].beat % 32) + 32) % 32;
  switch (st.phase) {
    case 0: d[0].motorOn = true; st.phase = 1; st.at = t; break;
    case 1: // after a while, the next record on the phrase, fader down
      if (t - st.at > 8 && into > 31.93) { booth.sync[1] = true; d[1].motorOn = true; st.phase = 2; st.at = t; }
      break;
    case 2: // its low out, fader up
      if (t - st.at > 1) { booth.setEQ(1, 0, 0); booth.channel[1] = 0.85; booth.applyMix(); st.phase = 3; st.at = t; }
      break;
    case 3: // the bass swap on the next phrase, then the old record out
      if (t - st.at > 4 && into < 0.3) { booth.setEQ(0, 0, 0); booth.setEQ(1, 0, 0.5); st.phase = 4; st.at = t; }
      break;
    case 4:
      if (t - st.at > 4) { booth.channel[0] = 0; booth.applyMix(); d[0].motorOn = false; st.phase = 5; }
      break;
  }
}, 2);
