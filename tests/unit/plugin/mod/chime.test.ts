import { describe, expect, it } from 'vitest';

import { chimeBase64, chimeWav, toBase64 } from '../../../../runtime/claude-plugin/mod/chime.ts';

describe('the verdict chime', () => {
  it('is a short mono WAV clip', () => {
    const wav = chimeWav();
    const view = new DataView(wav.buffer);
    const text = (offset: number) => String.fromCharCode(...wav.slice(offset, offset + 4));
    expect(text(0)).toBe('RIFF');
    expect(text(8)).toBe('WAVE');
    expect(text(36)).toBe('data');
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(8000);
    expect(view.getUint32(40, true)).toBe(wav.length - 44);
    expect((wav.length - 44) / 8000).toBeCloseTo(0.34, 2);
  });

  it('encodes as base64 the same way Node does', () => {
    for (const bytes of [[], [1], [1, 2], [1, 2, 3], [255, 0, 128, 64]]) {
      const data = Uint8Array.from(bytes);
      expect(toBase64(data)).toBe(Buffer.from(data).toString('base64'));
    }
  });

  it('is written as base64 bytes of the WAV clip', () => {
    const base64 = chimeBase64();
    expect(base64).toBe(toBase64(chimeWav()));
    const bytes = Buffer.from(base64, 'base64');
    expect(bytes.subarray(0, 4).toString('latin1')).toBe('RIFF');
    expect(bytes.subarray(8, 12).toString('latin1')).toBe('WAVE');
    expect(bytes.equals(Buffer.from(chimeWav()))).toBe(true);
  });
});
