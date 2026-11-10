import { replaceMarkerBlock } from '@/core/text/marker-block.js';

export function managedBlockMarkers(name: string): { begin: string; end: string } {
  return {
    begin: `<!-- paqad:stack:${name}:start -->`,
    end: `<!-- paqad:stack:${name}:end -->`,
  };
}

export function upsertManagedBlock(existing: string, name: string, body: string): string {
  const eol = existing.includes('\r\n') ? '\r\n' : '\n';
  const { begin, end } = managedBlockMarkers(name);
  const block = [begin, ...body.split('\n'), end].join(eol);
  const replaced = replaceMarkerBlock(existing, begin, end, block);
  if (replaced !== null) {
    return replaced;
  }
  if (existing.length === 0) {
    return `${block}${eol}`;
  }
  const separator = existing.endsWith('\n') ? eol : `${eol}${eol}`;
  return `${existing}${separator}${block}${eol}`;
}

export function escapeDocText(value: string): string {
  return value
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\|/g, '\\|');
}
