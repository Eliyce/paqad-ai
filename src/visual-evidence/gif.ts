// Overview GIF assembly (issue #551, Part E.6).
//
// Composites each CLEAN per-step screenshot under a caption bar (white background, dark-gray
// text, letterboxed ABOVE the page pixels — never over them) and encodes the frames into a
// single GIF at 2000 ms/frame. The compositing runs inside the already-open Chromium (a 2D
// canvas), so there are zero native image dependencies (no sharp, no canvas); encoding uses the
// pure-JS `gifenc`. Per-step image.png files are never touched — the caption bar exists only in
// the GIF frames.
//
// Real browser work → excluded from unit coverage; exercised by the env-gated integration test.

import { readFileSync } from 'node:fs';

import { GIFEncoder, applyPalette, quantize } from 'gifenc';

/** One frame's source: the clean screenshot on disk and its business-language caption. */
export interface GifFrameInput {
  imageAbsPath: string;
  caption: string;
}

export interface GifAssemblyOptions {
  /** Per-frame delay in ms (spec: 2000). */
  frameMs?: number;
  /** Max frames (spec: first 12). */
  maxFrames?: number;
  /** Max frame width in px; wider screenshots scale down, narrower never scale up (spec: 1280). */
  maxWidth?: number;
}

/** Caption bar geometry + style (spec: #fff bg, #333 text, 16px system-ui, 16px padding, ≥56px). */
export const CAPTION_BAR = {
  minHeight: 56,
  padding: 16,
  fontPx: 16,
  background: '#ffffff',
  color: '#333333',
} as const;

interface RgbaFrame {
  data: Uint8Array;
  width: number;
  height: number;
}

/** A Playwright Page — typed structurally so this module never imports playwright. */
export interface GifPage {
  setViewportSize(size: { width: number; height: number }): Promise<void>;
  evaluate<T>(fn: (arg: unknown) => T, arg: unknown): Promise<T>;
}

function toDataUrl(imageAbsPath: string): string {
  const bytes = readFileSync(imageAbsPath);
  return `data:image/png;base64,${bytes.toString('base64')}`;
}

/**
 * Composite one frame inside the browser and return its RGBA pixels. The image is drawn below a
 * fixed caption bar, scaled to fit `frameWidth` (never upscaled), on a white canvas of the shared
 * frame size so every GIF frame is dimension-uniform.
 */
async function renderFrame(
  page: GifPage,
  input: GifFrameInput,
  frameWidth: number,
  frameHeight: number,
): Promise<RgbaFrame> {
  const raw = await page.evaluate(
    (payloadUnknown: unknown) => {
      const payload = payloadUnknown as {
        dataUrl: string;
        caption: string;
        frameWidth: number;
        frameHeight: number;
        bar: typeof CAPTION_BAR;
      };
      return new Promise<{ data: number[]; width: number; height: number }>((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = payload.frameWidth;
          canvas.height = payload.frameHeight;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            reject(new Error('no 2d context'));
            return;
          }
          // White ground.
          ctx.fillStyle = payload.bar.background;
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          // Caption text in the top bar (never over the page pixels below it).
          ctx.fillStyle = payload.bar.color;
          ctx.font = `${payload.bar.fontPx}px system-ui, -apple-system, sans-serif`;
          ctx.textBaseline = 'middle';
          const barHeight = payload.bar.minHeight;
          ctx.fillText(
            payload.caption,
            payload.bar.padding,
            barHeight / 2,
            canvas.width - payload.bar.padding * 2,
          );
          // Image scaled to the frame width (never upscaled), drawn BELOW the bar.
          const scale = Math.min(1, payload.frameWidth / img.naturalWidth);
          const drawW = Math.round(img.naturalWidth * scale);
          const drawH = Math.round(img.naturalHeight * scale);
          ctx.drawImage(img, 0, barHeight, drawW, drawH);
          const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
          resolve({ data: Array.from(pixels.data), width: canvas.width, height: canvas.height });
        };
        img.onerror = () => reject(new Error('image failed to load'));
        img.src = payload.dataUrl;
      });
    },
    { dataUrl: toDataUrl(input.imageAbsPath), caption: input.caption, frameWidth, frameHeight, bar: CAPTION_BAR },
  );
  return { data: Uint8Array.from(raw.data), width: raw.width, height: raw.height };
}

/** Read one image's natural dimensions inside the browser. */
async function naturalSize(page: GifPage, imageAbsPath: string): Promise<{ w: number; h: number }> {
  return page.evaluate(
    (dataUrlUnknown: unknown) =>
      new Promise<{ w: number; h: number }>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
        img.onerror = () => reject(new Error('image failed to load'));
        img.src = dataUrlUnknown as string;
      }),
    toDataUrl(imageAbsPath),
  );
}

/**
 * Assemble the overview GIF from the captured steps. Returns the GIF bytes, or `null` when there
 * is nothing to encode. Frames are dimension-uniform (a white canvas sized to the widest capped
 * image plus the caption bar), so the GIF plays cleanly.
 */
export async function assembleOverviewGif(
  page: GifPage,
  frames: GifFrameInput[],
  options: GifAssemblyOptions = {},
): Promise<Buffer | null> {
  const frameMs = options.frameMs ?? 2000;
  const maxFrames = options.maxFrames ?? 12;
  const maxWidth = options.maxWidth ?? 1280;
  const selected = frames.slice(0, maxFrames);
  if (selected.length === 0) {
    return null;
  }

  // First pass: measure, so every frame shares one canvas size.
  const sizes = [];
  for (const frame of selected) {
    sizes.push(await naturalSize(page, frame.imageAbsPath));
  }
  const frameWidth = Math.min(maxWidth, Math.max(...sizes.map((s) => s.w)));
  const maxScaledHeight = Math.max(
    ...sizes.map((s) => Math.round(s.h * Math.min(1, frameWidth / s.w))),
  );
  const frameHeight = CAPTION_BAR.minHeight + maxScaledHeight;
  await page.setViewportSize({ width: frameWidth, height: frameHeight });

  const encoder = GIFEncoder();
  for (const frame of selected) {
    const { data, width, height } = await renderFrame(page, frame, frameWidth, frameHeight);
    const palette = quantize(data, 256);
    const index = applyPalette(data, palette);
    encoder.writeFrame(index, width, height, { palette, delay: frameMs });
  }
  encoder.finish();
  return Buffer.from(encoder.bytes());
}
