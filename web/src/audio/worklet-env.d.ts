// The AudioWorkletGlobalScope, which TypeScript's DOM library does not describe.
declare const sampleRate: number;
declare const currentFrame: number;
declare const currentTime: number;

declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: unknown);
}

declare function registerProcessor(
  name: string,
  processorCtor: new (options: { processorOptions?: { buffer?: SharedArrayBuffer | null } }) => AudioWorkletProcessor,
): void;
