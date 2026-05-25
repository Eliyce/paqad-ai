export function buildDecisionPauseContractSection(): string {
  return [
    '## Decision Pause Contract',
    '',
    'Before implementing any choice that falls into one of these categories, write a Decision Packet to `.paqad/decisions/pending/D-{N}.json` and stop work. Do not continue until `.paqad/decisions/resolved/D-{N}.json` exists.',
  ].join('\n');
}

export function normalizeProviderEntryContract(content: string): string {
  return content.replace(/\r\n/g, '\n').trim();
}

export function extractDecisionPauseContractSection(content: string): string | null {
  const normalized = normalizeProviderEntryContract(content);
  const marker = '## Decision Pause Contract';
  const start = normalized.indexOf(marker);

  if (start === -1) {
    return null;
  }

  const endMarker = '\n\nAdapter:\n';
  const end = normalized.indexOf(endMarker, start);
  return end === -1 ? normalized.slice(start).trim() : normalized.slice(start, end).trim();
}
