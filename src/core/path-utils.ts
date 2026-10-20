import { sep } from 'node:path';

export function toPosixPath(path: string): string {
  return path.split(sep).join('/');
}

export function stripTrailingChars(value: string, chars: string): string {
  let end = value.length;
  while (end > 0 && chars.includes(value[end - 1]!)) {
    end -= 1;
  }
  return end === value.length ? value : value.slice(0, end);
}

export function trimEdgeChars(value: string, chars: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && chars.includes(value[start]!)) {
    start += 1;
  }
  while (end > start && chars.includes(value[end - 1]!)) {
    end -= 1;
  }
  return start === 0 && end === value.length ? value : value.slice(start, end);
}
