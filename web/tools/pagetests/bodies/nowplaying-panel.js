// The wiring of "what the booth is playing" into the Worker: a show that is sending for a booking, a user's track on deck A that the room hears, and the page POSTs it to /me/now-playing.
// (No server: GoLive is put into the sending state by hand and the Worker's answer is a stand-in; the real send path is in golive-local.sh.)
const T = (...a) => console.log("T", a.map((x) => typeof x === "number" ? +x.toFixed(2) : x).join(" "));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (name, cond, extra = "") => T(cond ? "PASS" : "FAIL", name, extra);
const b64 = (o) => btoa(JSON.stringify(o));
const jwt = (p) => `${b64({ alg: "HS256", typ: "JWT" })}.${b64(p)}.sig`;
(async () => {
  const [A, B] = engine.decks;
  for (let i = 0; i < 100 && !(A.isLoaded && B.isLoaded); i++) await sleep(100);
  await sleep(2000);
  const posts = [];
  headliner.streamTest.fetchFn = async (url, init) => {
    if (init && init.method === "POST" && url.endsWith("/me/now-playing")) { posts.push({ url, auth: init.headers.Authorization, body: JSON.parse(init.body) }); return new Response("{}", { status: 200 }); }
    return new Response(JSON.stringify({ now: new Date().toISOString(), slot: null, ingest: null }), { status: 200 });
  };
  localStorage.setItem("gl_token", jwt({ sub: "u1", dj_name: "Zé", exp: Date.now() + 3600e3 }));
  // deck A on air with a library track that has tags
  booth.channel[0] = 0.9; booth.channel[1] = 0; booth.cross = 0; booth.applyMix(); engine.roomVolume = 0.75;
  A.motorOn = true; A.seek(12);
  userOnDeck[0] = { key: "1:a.mp3", title: "Saturday Job", artist: "Sol Poente", name: "a.mp3", path: ["a.mp3"] };
  await sleep(3500);
  ok("not sending (no show running): nothing is posted, even with a track on the air", posts.length === 0, `posts ${posts.length}`);

  // the show is sending for a booking (put into the state by hand; no publisher)
  goLive.slot = { id: "b-uuid-1", start: new Date(Date.now() - 60e3).toISOString(), end: new Date(Date.now() + 3600e3).toISOString(), window_start: new Date().toISOString(), phase: "on", opens_in_s: 0, description: "", stream_type: "icecast" };
  goLive.state = "onair";
  await sleep(3500);
  ok("sending for a booking: the track the room hears is posted once, with the sign-in and the booking id", posts.length === 1 && posts[0].url === "https://api.grooveline.org/me/now-playing" && /^Bearer eyJ/.test(posts[0].auth) && posts[0].body.booking_id === "b-uuid-1" && posts[0].body.title === "Saturday Job" && posts[0].body.artist === "Sol Poente", JSON.stringify(posts[0] && posts[0].body));
  await sleep(3000);
  ok("the same track is not posted again every second", posts.length === 1, `posts ${posts.length}`);

  // a track without a title tag: the file name; the other deck takes over after it has been clearly louder for 8 s
  userOnDeck[1] = { key: "1:b-mix.flac", title: "", artist: "", name: "b-mix.flac", path: ["b-mix.flac"] };
  B.motorOn = true; B.seek(12);
  booth.channel[0] = 0.6; booth.channel[1] = 1; booth.cross = 0.5; booth.applyMix();
  await sleep(3000);
  const vols = `A ${A.volume.toFixed(2)} B ${B.volume.toFixed(2)}`;
  ok("deck A is still audible and deck B is clearly louder", A.volume >= 0.12 && B.volume > A.volume * 1.25, vols);
  ok("the other deck is louder but only for 3 s: the title does not change yet", posts.length === 1, `posts ${posts.length} (${vols})`);
  await sleep(8500);
  ok("after 8 s the other deck's track is posted (no title tag: the file name without its extension)", posts.length === 2 && posts[1].body.title === "b-mix" && posts[1].body.artist === "", JSON.stringify(posts[1] && posts[1].body));

  // the show ends: nothing more is posted
  goLive.state = "later"; goLive.slot = null;
  const n = posts.length;
  await sleep(3000);
  ok("the show is over: nothing more is posted", posts.length === n, `posts ${posts.length}`);
  localStorage.removeItem("gl_token");
  T("DONE");
})().catch((e) => T("ERROR", e && e.stack || e));
