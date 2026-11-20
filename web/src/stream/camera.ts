// The camera preview in the STREAM panel: a LOCAL picture of the DJ, made by this browser and shown by this page.
// Nothing is sent anywhere: no server call, no network, no WHIP connection. The preview is for the DJ alone (to see
// how he looks before a show); publishing the camera to the listeners is a separate, later decision (phase 2).
//
// Two rules that must never be broken here:
// 1. VIDEO ONLY. `getUserMedia({ audio: false })` always, and only the video track is kept. A camera's own
//    microphone must never become part of anything: on the radio it would replace the mixer's audio.
// 2. Every track is stopped when the preview ends: switched off, another camera, leaving LIVE, or the page closing.
//    A camera that is left on keeps its light on and holds the device away from every other program.
//
// The plain arithmetic (which camera, what to say about an error) is here and tested in `test/camera.test.ts`; the
// browser half is `CameraPreview`, which takes its DOM and its `mediaDevices` from outside so a test can drive it too.

export const CAMERA_KEY = "headliner.camera";

/** One camera the browser lists (its label is empty until the DJ has allowed the camera at least once). */
export interface CameraDevice { deviceId: string; name: string }

export interface CameraView {
  /** True while a picture is showing. */
  on: boolean;
  /** True while the browser is asking (or starting) the camera: the button is busy. */
  asking: boolean;
  /** The button's words. */
  button: string;
  /** The camera asked for (null = the browser's default). */
  deviceId: string | null;
  /** Every camera the browser lists; empty before the first allow. */
  devices: CameraDevice[];
  /** One plain sentence about what went wrong (empty: nothing to say). */
  note: string;
}

/** What `enumerateDevices` can give us, and what is all we use of it. */
export interface DeviceLike { deviceId: string; kind: string; label: string }

/** The cameras of a device list: video inputs with an id, named "Camera 1", "Camera 2" before the DJ has allowed them. */
export function cameraDevices(list: DeviceLike[]): CameraDevice[] {
  const out: CameraDevice[] = [];
  for (const d of list) {
    if (d.kind !== "videoinput" || !d.deviceId) continue;
    const name = d.label.trim();
    out.push({ deviceId: d.deviceId, name: name || `Camera ${out.length + 1}` });
  }
  return out;
}

/** The camera to ask for: the remembered one while it is still there, else the browser's default (null). */
export function pickedCamera(saved: string | null, devices: CameraDevice[]): string | null {
  if (!saved) return null;
  return devices.some((d) => d.deviceId === saved) ? saved : null;
}

/** What to ask `getUserMedia` for. Audio is false in EVERY case: a camera microphone must never reach the stream. */
export function cameraConstraints(deviceId: string | null): MediaStreamConstraints {
  return {
    video: deviceId ? { deviceId: { exact: deviceId } } : { width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false,
  };
}

/** Where a blocked camera has to be allowed, per browser family (the words the panel gives). */
const PERMISSION_HELP = "allow the camera for this page (the padlock or the camera icon in the address bar, then RELOAD)";

/** The plain words for a failed camera. Never a stack trace: what happened and what to do about it. */
export function cameraWords(e: unknown): string {
  const name = e !== null && typeof e === "object" && "name" in e ? String((e as { name: unknown }).name) : "";
  const message = e == null ? "" : e instanceof Error ? e.message : String(e);
  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
    case "SecurityError":
      return `Camera blocked: ${PERMISSION_HELP}.`;
    case "NotFoundError":
    case "DevicesNotFoundError":
    case "OverconstrainedError":
    case "ConstraintNotSatisfiedError":
      return "No camera found: nothing is plugged in, or that camera is not there any more.";
    case "NotReadableError":
    case "TrackStartError":
    case "AbortError":
      return "Camera busy: another program is using it. Close that program and try again.";
    case "NotSupportedError":
    case "TypeError":
      return "This browser cannot show a camera here: the page has to be on https or localhost.";
    default:
      return `The camera did not start (${message || "no reason given"}).`;
  }
}

/** What we need of `localStorage` (wrapped in try/catch: a blocked store must never break the panel). */
export interface StoreLike { getItem(key: string): string | null; setItem(key: string, value: string): void }

/** The camera remembered from an earlier visit, or null (a blocked or broken store says null, never an error). */
export function readSavedCamera(store: Pick<StoreLike, "getItem"> | null | undefined): string | null {
  try {
    const v = store?.getItem(CAMERA_KEY);
    return v ? v : null;
  } catch {
    return null;
  }
}

/** Remember the camera for the next visit; forgetting is `null` (stored as an empty string: the key stays ours). */
export function saveCamera(store: StoreLike | null | undefined, deviceId: string | null): void {
  try {
    store?.setItem(CAMERA_KEY, deviceId ?? "");
  } catch {
    // A blocked store (private mode, no cookies) just means the choice is not kept.
  }
}

/** The browser half of `navigator.mediaDevices` (a test hands in its own). */
export interface MediaLike {
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream>;
  enumerateDevices(): Promise<DeviceLike[]>;
}

/** The video element as far as this module cares (the real one is an `HTMLVideoElement`). */
export interface VideoLike {
  srcObject: unknown;
  play(): Promise<void>;
  pause?(): void;
}

export interface CameraDeps {
  /** The browser's mediaDevices, or null where this page can never have one (plain http on a phone, an old browser). */
  media: MediaLike | null;
  video: VideoLike;
  store?: Pick<StoreLike, "getItem" | "setItem"> | null;
  onChange(view: CameraView): void;
}

const ASKING_BUTTON = "...";

export class CameraPreview {
  private stream: MediaStream | null = null;
  private devices: CameraDevice[] = [];
  /** The camera asked for; null = the browser's default. Kept while the preview is off, so it turns on where it left off. */
  private deviceId: string | null;
  private note = "";
  private asking = false;
  /** Bumped by every start, stop and camera change: an answer for an older one is thrown away (and its tracks stopped). */
  private run = 0;
  private readonly d: CameraDeps;

  constructor(deps: CameraDeps) {
    this.d = deps;
    this.deviceId = readSavedCamera(deps.store);
    deps.onChange(this.view); // the panel shows the off state at once
  }

  /** The picture's track while the preview is on (what a show would send), else null. The track belongs to the preview: stop() ends it. */
  get track(): MediaStreamTrack | null {
    return this.stream?.getVideoTracks()[0] ?? null;
  }

  get view(): CameraView {
    const on = this.stream !== null;
    return {
      on,
      asking: this.asking,
      button: this.asking ? ASKING_BUTTON : on ? "OFF" : "ON",
      deviceId: this.deviceId,
      devices: this.devices,
      note: this.note,
    };
  }

  private set(note?: string): void {
    if (note !== undefined) this.note = note;
    this.d.onChange(this.view);
  }

  /** The list of cameras; before the first allow their names are empty, after it they are real. */
  async refreshDevices(): Promise<void> {
    if (!this.d.media) return;
    try {
      this.devices = cameraDevices(await this.d.media.enumerateDevices());
    } catch {
      this.devices = [];
    }
    // The remembered camera is gone (unplugged, another browser window took it): fall back to the default rather than
    // asking for a device that is not there. Only while the preview is off, so a running preview is never restarted here.
    if (!this.stream && this.deviceId && pickedCamera(this.deviceId, this.devices) === null) this.deviceId = null;
    this.set();
  }

  /** OFF -> ON, ON -> OFF (the button). */
  async toggle(): Promise<void> {
    if (this.stream || this.asking) await this.stop();
    else await this.start();
  }

  async start(): Promise<void> {
    const run = ++this.run;
    if (!this.d.media) { this.set("This browser cannot show a camera here: the page has to be on https or localhost."); return; }
    this.asking = true;
    this.set("");
    let stream: MediaStream;
    try {
      stream = await this.d.media.getUserMedia(cameraConstraints(this.deviceId));
    } catch (e) {
      if (run !== this.run) return;
      this.asking = false;
      // A remembered camera that has gone is worth forgetting (the next click then takes the default one).
      if (this.deviceId && (e as { name?: string } | null)?.name === "OverconstrainedError") this.deviceId = null;
      this.set(cameraWords(e));
      return;
    }
    if (run !== this.run) { stopStream(stream); return; }
    // Video only, even if a browser were to hand an audio track over: nothing but pictures leaves this module.
    for (const track of stream.getAudioTracks()) { track.stop(); stream.removeTrack(track); }
    if (stream.getVideoTracks().length === 0) { stopStream(stream); this.asking = false; this.set("No camera found: the browser gave no picture."); return; }
    this.stream = stream;
    this.asking = false;
    try { this.d.video.srcObject = stream; await this.d.video.play(); } catch { /* a blocked autoplay still shows the frame the track sends */ }
    // The names arrive with the permission, so the list is read again now (and the panel gets a select where there was none).
    try { this.devices = cameraDevices(await this.d.media.enumerateDevices()); } catch { /* the list stays as it was */ }
    if (run !== this.run) return;
    saveCamera(this.d.store, this.deviceId);
    this.set("");
  }

  /** Stop the picture and every track of it. Safe to call when nothing runs. */
  async stop(): Promise<void> {
    this.run++;
    this.asking = false;
    const stream = this.stream;
    this.stream = null;
    this.d.video.pause?.();
    this.d.video.srcObject = null;
    stopStream(stream);
    this.set("");
  }

  /** Another camera: the old one is stopped first (never two open), then the new one starts if the preview was on. */
  async choose(deviceId: string | null): Promise<void> {
    if (deviceId === this.deviceId) return;
    this.deviceId = deviceId;
    saveCamera(this.d.store, deviceId);
    const wasOn = this.stream !== null;
    await this.stop();
    if (wasOn) await this.start();
    else this.set("");
  }
}

/** Stop every track of a stream (the camera light goes out with the last one). */
export function stopStream(stream: MediaStream | null | undefined): void {
  if (!stream) return;
  for (const track of stream.getTracks()) {
    try { track.stop(); } catch { /* already ended */ }
  }
}
