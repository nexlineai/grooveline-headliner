import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  CAMERA_KEY, CameraPreview, cameraConstraints, cameraDevices, cameraWords, pickedCamera, readSavedCamera, saveCamera, stopStream,
} from "../src/stream/camera.ts";
import type { CameraView, DeviceLike, MediaLike, VideoLike } from "../src/stream/camera.ts";

/** A track as far as the module looks at one: `stop()` is what matters. */
class FakeTrack {
  kind: string;
  stopped = false;
  constructor(kind: string) { this.kind = kind; }
  stop(): void { this.stopped = true; }
}

/** A MediaStream stand-in with the five methods the module calls. */
function fakeStream(video = 1, audio = 0): MediaStream {
  const tracks: FakeTrack[] = [];
  for (let i = 0; i < video; i++) tracks.push(new FakeTrack("video"));
  for (let i = 0; i < audio; i++) tracks.push(new FakeTrack("audio"));
  const s = {
    tracks,
    getTracks: () => s.tracks,
    getVideoTracks: () => s.tracks.filter((t) => t.kind === "video"),
    getAudioTracks: () => s.tracks.filter((t) => t.kind === "audio"),
    removeTrack: (t: FakeTrack) => { s.tracks = s.tracks.filter((x) => x !== t); },
  };
  return s as unknown as MediaStream;
}

function fakeVideo(): VideoLike & { played: number; paused: number } {
  const v = {
    srcObject: null as unknown,
    played: 0,
    paused: 0,
    async play() { v.played++; },
    pause() { v.paused++; },
  };
  return v;
}

interface MediaOpts {
  devices?: DeviceLike[];
  /** What `getUserMedia` answers: a stream, an error, or a promise the test settles itself. */
  answer?: MediaStream | Error | (() => Promise<MediaStream>);
}

interface FakeMedia extends MediaLike {
  asked: MediaStreamConstraints[];
  listed: number;
  setDevices(d: DeviceLike[]): void;
}

function fakeMedia(opts: MediaOpts = {}): FakeMedia {
  const asked: MediaStreamConstraints[] = [];
  let devices = opts.devices ?? [];
  const m: FakeMedia = {
    asked,
    listed: 0,
    async getUserMedia(c: MediaStreamConstraints) {
      asked.push(c);
      const a = opts.answer;
      if (typeof a === "function") return a();
      if (a instanceof Error) throw a;
      return a ?? fakeStream();
    },
    async enumerateDevices() { m.listed++; return devices; },
    setDevices(d: DeviceLike[]) { devices = d; },
  };
  return m;
}

function makeStore(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    data,
    getItem(k: string) { return k in data ? data[k] : null; },
    setItem(k: string, v: string) { data[k] = v; },
  };
}

const VIEWS: CameraView[] = [];
const preview = (media: MediaLike | null, extra: { store?: ReturnType<typeof makeStore>; video?: VideoLike } = {}) => {
  VIEWS.length = 0;
  const video = extra.video ?? fakeVideo();
  const cam = new CameraPreview({ media, video, store: extra.store, onChange: (v) => VIEWS.push(v) });
  return { cam, video, last: (): CameraView => VIEWS[VIEWS.length - 1] };
};

const CAM_1 = { deviceId: "cam-1", kind: "videoinput", label: "FaceTime HD" };
const CAM_2 = { deviceId: "cam-2", kind: "videoinput", label: "" };
const MIC = { deviceId: "mic-1", kind: "audioinput", label: "Microphone" };

describe("the camera preview: which camera", () => {
  test("only video inputs with an id are cameras, and an empty label gets a number", () => {
    assert.deepEqual(cameraDevices([CAM_1, MIC, CAM_2, { deviceId: "", kind: "videoinput", label: "x" }]),
      [{ deviceId: "cam-1", name: "FaceTime HD" }, { deviceId: "cam-2", name: "Camera 2" }]);
    assert.deepEqual(cameraDevices([]), []);
  });
  test("the remembered camera is used only while it is still listed", () => {
    const list = cameraDevices([CAM_1, CAM_2]);
    assert.equal(pickedCamera("cam-2", list), "cam-2");
    assert.equal(pickedCamera("cam-gone", list), null);
    assert.equal(pickedCamera(null, list), null);
    assert.equal(pickedCamera("cam-1", []), null);
  });
  test("getUserMedia is asked for VIDEO ONLY, with the camera when one was chosen", () => {
    assert.deepEqual(cameraConstraints(null), { video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    assert.deepEqual(cameraConstraints("cam-2"), { video: { deviceId: { exact: "cam-2" } }, audio: false });
    for (const c of [cameraConstraints(null), cameraConstraints("x")]) assert.equal(c.audio, false);
  });
});

describe("the camera preview: plain words for what went wrong", () => {
  const err = (name: string, message = "nope") => Object.assign(new Error(message), { name });
  test("a blocked camera says where to allow it", () => {
    for (const n of ["NotAllowedError", "PermissionDeniedError", "SecurityError"]) {
      const words = cameraWords(err(n));
      assert.match(words, /blocked/i, n);
      assert.match(words, /address bar|padlock/i, n);
      assert.doesNotMatch(words, /Error|at .*camera\.ts/, n);
    }
  });
  test("no camera, camera busy, and a browser that has none: each in its own words", () => {
    assert.match(cameraWords(err("NotFoundError")), /no camera found/i);
    assert.match(cameraWords(err("OverconstrainedError")), /no camera found/i);
    assert.match(cameraWords(err("DevicesNotFoundError")), /no camera found/i);
    assert.match(cameraWords(err("NotReadableError")), /camera busy/i);
    assert.match(cameraWords(err("TrackStartError")), /camera busy/i);
    assert.match(cameraWords(err("NotSupportedError")), /https or localhost/i);
  });
  test("anything else keeps the reason but never a trace, and a thrown string still reads", () => {
    const words = cameraWords(err("WeirdError", "the driver said no"));
    assert.match(words, /the driver said no/);
    assert.doesNotMatch(words, /\n|    at /);
    assert.match(cameraWords("plain text failure"), /plain text failure/);
    assert.match(cameraWords(null), /no reason given/);
  });
});

describe("the camera preview: the remembered choice", () => {
  test("what was chosen is read back from headliner.camera, and an empty value is nothing", () => {
    const store = makeStore({ [CAMERA_KEY]: "cam-2" });
    assert.equal(readSavedCamera(store), "cam-2");
    assert.equal(readSavedCamera(makeStore()), null);
    assert.equal(readSavedCamera(makeStore({ [CAMERA_KEY]: "" })), null);
    assert.equal(readSavedCamera(null), null);
  });
  test("a store that throws (private mode, no cookies) never breaks the panel", () => {
    const bad = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
    assert.equal(readSavedCamera(bad), null);
    assert.doesNotThrow(() => saveCamera(bad, "cam-1"));
    saveCamera(null, "cam-1");
    const store = makeStore();
    saveCamera(store, "cam-2");
    assert.equal(store.data[CAMERA_KEY], "cam-2");
    saveCamera(store, null);
    assert.equal(store.data[CAMERA_KEY], "");
  });
});

describe("the camera preview: starting and stopping", () => {
  test("off by default, and the button says ON", () => {
    const { last } = preview(fakeMedia());
    assert.equal(last().on, false);
    assert.equal(last().button, "ON");
    assert.equal(last().note, "");
  });
  test("a start shows the stream, asks video-only, and the camera's names arrive only after the allow", async () => {
    const stream = fakeStream(1, 0);
    const media = fakeMedia({ answer: stream });
    media.setDevices([{ deviceId: "cam-1", kind: "videoinput", label: "" }]);
    const { cam, video, last } = preview(media);
    void cam.refreshDevices(); // the panel reads the list when it is built (names are empty before the first allow)
    await new Promise((r) => setTimeout(r, 0));
    assert.deepEqual(last().devices.map((d) => d.name), ["Camera 1"]);
    await cam.start();
    assert.equal(media.asked[0].audio, false);
    assert.equal(video.srcObject, stream);
    assert.equal(last().on, true);
    assert.equal(last().button, "OFF");
    assert.equal(last().note, "");
    // the first list was read by the caller; after the allow the real names are read again
    media.setDevices([CAM_1]);
    await cam.refreshDevices();
    assert.deepEqual(last().devices.map((d) => d.name), ["FaceTime HD"]);
  });
  test("an audio track from the camera is stopped and dropped: video only, always", async () => {
    const stream = fakeStream(1, 2) as unknown as { getAudioTracks(): FakeTrack[] };
    const audio = stream.getAudioTracks();
    const { cam } = preview(fakeMedia({ answer: stream as unknown as MediaStream }));
    await cam.start();
    for (const t of audio) assert.equal(t.stopped, true);
    // and a stream with nothing but audio is refused
    const { cam: cam2, last: last2 } = preview(fakeMedia({ answer: fakeStream(0, 1) }));
    await cam2.start();
    assert.equal(last2().on, false);
    assert.match(last2().note, /no camera found/i);
  });
  test("stopping stops every track and lets go of the picture", async () => {
    const stream = fakeStream(1, 0);
    const video = fakeVideo();
    const { cam, last } = preview(fakeMedia({ answer: stream }), { video });
    await cam.start();
    await cam.stop();
    assert.equal(video.srcObject, null);
    assert.equal(last().on, false);
    assert.equal(last().button, "ON");
    for (const t of (stream as unknown as { tracks: FakeTrack[] }).tracks) assert.equal(t.stopped, true);
    // stopping twice is harmless
    await cam.stop();
  });
  test("a refused camera says why in plain words, in the panel's note", async () => {
    for (const [name, re] of [["NotAllowedError", /blocked/i], ["NotFoundError", /no camera found/i], ["NotReadableError", /camera busy/i]] as const) {
      const { cam, last } = preview(fakeMedia({ answer: Object.assign(new Error("x"), { name }) }));
      await cam.start();
      assert.equal(last().on, false);
      assert.equal(last().button, "ON");
      assert.match(last().note, re);
    }
  });
  test("the browser without mediaDevices says so instead of throwing", async () => {
    const { cam, last } = preview(null);
    await cam.start();
    assert.equal(last().on, false);
    assert.match(last().note, /https or localhost/);
  });
  test("a second click while the browser is asking cancels: the late stream is stopped, not shown", async () => {
    let resolve: (s: MediaStream) => void = () => {};
    const late = fakeStream(1, 0);
    const media = fakeMedia({ answer: () => new Promise<MediaStream>((r) => { resolve = r; }) });
    const { cam, video, last } = preview(media);
    const starting = cam.start();
    assert.equal(last().asking, true);
    assert.equal(last().button, "...");
    await cam.toggle(); // OFF while asking
    resolve(late);
    await starting;
    assert.equal(video.srcObject, null);
    assert.equal(last().on, false);
    for (const t of (late as unknown as { tracks: FakeTrack[] }).tracks) assert.equal(t.stopped, true);
  });
});

describe("the camera preview: another camera, and one that is gone", () => {
  test("choosing another camera stops the first one and asks for the second", async () => {
    const first = fakeStream(1, 0), second = fakeStream(1, 0);
    let answer: MediaStream = first;
    const media = fakeMedia({ answer: () => Promise.resolve(answer), devices: [CAM_1, CAM_2] });
    const store = makeStore();
    const { cam, video, last } = preview(media, { store });
    await cam.start();
    answer = second;
    await cam.choose("cam-2");
    for (const t of (first as unknown as { tracks: FakeTrack[] }).tracks) assert.equal(t.stopped, true);
    assert.deepEqual(media.asked[media.asked.length - 1].video, { deviceId: { exact: "cam-2" } });
    assert.equal(video.srcObject, second);
    assert.equal(store.data[CAMERA_KEY], "cam-2");
    assert.equal(last().deviceId, "cam-2");
    assert.equal(last().on, true);
  });
  test("choosing a camera while the preview is off only remembers it", async () => {
    const media = fakeMedia({ devices: [CAM_1, CAM_2] });
    const store = makeStore();
    const { cam, last } = preview(media, { store });
    await cam.choose("cam-2");
    assert.equal(media.asked.length, 0);
    assert.equal(store.data[CAMERA_KEY], "cam-2");
    assert.equal(last().deviceId, "cam-2");
    await cam.start();
    assert.deepEqual(media.asked[0].video, { deviceId: { exact: "cam-2" } });
  });
  test("a remembered camera that is no longer listed falls back to the default, and the next start takes it", async () => {
    const store = makeStore({ [CAMERA_KEY]: "cam-gone" });
    const media = fakeMedia({ devices: [CAM_1] });
    const { cam, last } = preview(media, { store });
    await cam.refreshDevices();
    assert.equal(last().deviceId, null);
    await cam.start();
    assert.deepEqual(media.asked[0].video, { width: { ideal: 1280 }, height: { ideal: 720 } });
  });
  test("stopStream lets go of a stream that was never shown", () => {
    const s = fakeStream(1, 1);
    stopStream(s);
    for (const t of (s as unknown as { tracks: FakeTrack[] }).tracks) assert.equal(t.stopped, true);
    assert.doesNotThrow(() => stopStream(null));
  });
});
