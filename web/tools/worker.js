// grooveline.org/headliner/ (the Worker wrangler deploys). The code is tools/app.js; the two tables
// below are made by tools/build.ts into dist/ (media path -> bytes for byte ranges, and the paths
// of the paid chapters' media) and bundled by wrangler. Tests load app.js directly.
import SIZES from "../dist/sizes.json";
import GATED from "../dist/gated.json";
import { createWorker } from "./app.js";

export default createWorker(SIZES, GATED);
