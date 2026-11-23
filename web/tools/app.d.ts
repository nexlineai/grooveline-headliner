// Types for the tests (tools/app.js is plain JavaScript, bundled by wrangler).
export interface WorkerEnv { [key: string]: unknown }
export interface WorkerCtx { waitUntil(p: Promise<unknown>): void }
export function createWorker(sizes: object, gated: string[]): { fetch(request: Request, env: WorkerEnv, ctx: WorkerCtx): Promise<Response> };
