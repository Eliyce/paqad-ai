// Minimal ambient types for `gifenc` (issue #551) — the package ships no declarations.
// Only the surface this repo uses is declared.
declare module 'gifenc' {
  export interface GifEncoderFrameOptions {
    palette?: number[][];
    delay?: number;
    transparent?: boolean;
    dispose?: number;
    first?: boolean;
    repeat?: number;
  }

  export interface GifEncoderInstance {
    writeFrame(
      index: Uint8Array | Uint8ClampedArray,
      width: number,
      height: number,
      options?: GifEncoderFrameOptions,
    ): void;
    finish(): void;
    bytes(): Uint8Array;
    reset(): void;
  }

  export function GIFEncoder(options?: { auto?: boolean; initialCapacity?: number }): GifEncoderInstance;

  export function quantize(
    rgba: Uint8Array | Uint8ClampedArray,
    maxColors: number,
    options?: { format?: string; oneBitAlpha?: boolean | number; clearAlpha?: boolean },
  ): number[][];

  export function applyPalette(
    rgba: Uint8Array | Uint8ClampedArray,
    palette: number[][],
    format?: string,
  ): Uint8Array;

  // gifenc ships as CommonJS; Node ESM interop requires the default import.
  const gifenc: {
    GIFEncoder: typeof GIFEncoder;
    quantize: typeof quantize;
    applyPalette: typeof applyPalette;
  };
  export default gifenc;
}
