export function trimLeadingChar(value: string, char: string): string {
  let start = 0;
  while (start < value.length && value[start] === char) start += 1;
  return start === 0 ? value : value.slice(start);
}

export function trimTrailingChar(value: string, char: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === char) end -= 1;
  return end === value.length ? value : value.slice(0, end);
}

export function trimChar(value: string, char: string): string {
  return trimTrailingChar(trimLeadingChar(value, char), char);
}

export function slugifyAscii(value: string): string {
  return trimChar(value.toLowerCase().replace(/[^a-z0-9]+/g, '-'), '-');
}
