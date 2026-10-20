export const CHIME_MIME = 'audio/wav';

const RATE = 8000;
const NOTES: ReadonlyArray<{ hz: number; seconds: number }> = [
  { hz: 880, seconds: 0.12 },
  { hz: 1320, seconds: 0.22 },
];

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function toBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    out += ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]!;
    out += b === undefined ? '=' : ALPHABET[(n >> 6) & 63]!;
    out += c === undefined ? '=' : ALPHABET[n & 63]!;
  }
  return out;
}

function samples(): Uint8Array {
  const out: number[] = [];
  for (const note of NOTES) {
    const count = Math.round(RATE * note.seconds);
    for (let i = 0; i < count; i += 1) {
      const fade = 1 - i / count;
      const wave = Math.sin((2 * Math.PI * note.hz * i) / RATE);
      out.push(Math.round(128 + 80 * fade * wave));
    }
  }
  return Uint8Array.from(out);
}

export function chimeWav(): Uint8Array {
  const data = samples();
  const bytes = new Uint8Array(44 + data.length);
  const view = new DataView(bytes.buffer);
  const text = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) bytes[offset + i] = value.charCodeAt(i);
  };
  text(0, 'RIFF');
  view.setUint32(4, 36 + data.length, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, RATE, true);
  view.setUint32(28, RATE, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  text(36, 'data');
  view.setUint32(40, data.length, true);
  bytes.set(data, 44);
  return bytes;
}

export function chimeClip(): { base64: string; mime: string } {
  return { base64: toBase64(chimeWav()), mime: CHIME_MIME };
}
