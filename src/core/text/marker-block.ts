export function replaceMarkerBlock(
  existing: string,
  begin: string,
  end: string,
  block: string,
): string | null {
  const beginIdx = existing.indexOf(begin);
  const endIdx = existing.indexOf(end);
  if (beginIdx === -1 || endIdx <= beginIdx) {
    return null;
  }
  return `${existing.slice(0, beginIdx)}${block}${existing.slice(endIdx + end.length)}`;
}
