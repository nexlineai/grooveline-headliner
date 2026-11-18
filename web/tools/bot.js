// A player for tests: run in the page (`node tools/shot.ts OUT.png URL --do "run tools/bot.js; wait 90; eval ..."`).
// It reads the lesson's current goal and does what a good player would, on the beat where the
// goal asks for timing. Window `headliner` gives `engine` and `booth`. Plain JavaScript (it is
// evaluated in the page as it is).
window.__bot && clearInterval(window.__bot);
window.__bot = setInterval(() => {
  const L = booth.lesson, d = engine.decks;
  if (!L || L.goalMet || L.stars !== null) return;
  const step = L.lesson.steps[L.index], g = step.goal;
  // Back to back: the partner's deck is hers. A player never touches it.
  const hers = booth.partnerDeck;
  if (hers !== null && "deck" in g && g.deck === hers) return;
  const into = (beat, span) => ((beat % span) + span) % span;
  const mid = (r) => (r[0] + r[1]) / 2;
  const cells = (row) => {
    const page = row >= 3 ? 1 : 0;
    const tabs = document.querySelectorAll("#studio .tabs button");
    if (!tabs[page].classList.contains("on")) { tabs[page].click(); return null; }
    return document.querySelectorAll("#studio .row")[row >= 3 ? row - 3 : row].querySelectorAll(".cell");
  };
  switch (g.type) {
    case "startDeck": if (!d[g.deck].motorOn) d[g.deck].motorOn = true; break;
    case "stopDeck": if (d[g.deck].motorOn) d[g.deck].motorOn = false; break;
    case "startOnTheOne":
    case "startOnThePhrase": {
      const span = g.type === "startOnTheOne" ? 4 : 32;
      if (d[g.deck].motorOn && L.missed) d[g.deck].motorOn = false;
      else if (!d[g.deck].motorOn && into(d[g.against].beat, span) > span - 0.07) d[g.deck].motorOn = true;
      break;
    }
    case "crossfader": booth.cross = mid(g.range); booth.applyMix(); break;
    case "channelFader":
      if (!g.onThePhrase || into(d[1 - g.deck].beat, 32) < 0.5) { booth.channel[g.deck] = mid(g.range); booth.applyMix(); }
      break;
    case "eq": booth.setEQ(g.deck, g.band, mid(g.range)); break;
    case "filter": booth.setFilter(g.deck, mid(g.range)); break;
    case "syncOn": booth.sync[g.deck] = true; break;
    case "phonesReady": document.querySelector('[data-mode="split"]').click(); break;
    case "phonesCue": if (!booth.phones[g.deck]) { booth.phones[g.deck] = true; d[g.deck].cue = true; } break;
    case "cueMix": engine.cueMix = mid(g.range); break;
    case "pattern": {
      const c = cells(g.row);
      if (!c) break;
      c.forEach((cell, i) => { if (!!cell.style.background !== g.steps.includes(i)) cell.click(); });
      break;
    }
    case "studioPage": { const tab = document.querySelectorAll("#studio .tabs button")[g.page]; if (!tab.classList.contains("on")) tab.click(); break; }
    case "dubplateCut": document.querySelector("#studio .cut").click(); break;
    case "jinglePlayed":
      if (!g.onThePhrase || into(d[0].beat, 32) < 0.5) document.getElementById("jingle-button").click();
      break;
    case "hitThePost":
      if (L.postRearm) { booth.channel = [0.85, 0.85]; booth.applyMix(); break; } // after a miss: faders back up
      if (L.postAt !== null && L.postAt - performance.now() / 1000 < 0.2) { booth.channel = [0, 0]; booth.applyMix(); }
      break;
    case "bassSwap":
      if (g.from === hers) { if (booth.eq[hers][0] <= 0.1) booth.setEQ(g.to, 0, 0.5); } // when her low goes out
      else if (into(d[g.to].beat, 32) < 0.5) { booth.setEQ(g.from, 0, 0); booth.setEQ(g.to, 0, 0.5); }
      break;
    case "pickRecord":
    case "recordLoaded": {
      const id = g.type === "pickRecord" ? g.good[0] : g.id;
      if (d[g.deck].info?.id !== id && window.__loading !== id) { window.__loading = id; booth.loadRecord(g.deck, id); }
      break;
    }
    case "crossfaderCut":
      if (into(d[0].beat, 32) < 0.5) { booth.cross = 1; booth.applyMix(); }
      break;
    default: break; // listen, and goals a test drives itself
  }
}, 2);
