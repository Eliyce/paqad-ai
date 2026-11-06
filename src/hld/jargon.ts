export interface JargonWord {
  word: string;
  plain: string;
}

export const JARGON: readonly JargonWord[] = [
  { word: 'API', plain: 'connection to another system' },
  { word: 'endpoint', plain: 'address' },
  { word: 'schema', plain: 'data layout' },
  { word: 'migration', plain: 'data move' },
  { word: 'refactor', plain: 'tidy-up' },
  { word: 'repository', plain: 'project' },
  { word: 'component', plain: 'part' },
  { word: 'hook', plain: 'automatic step' },
  { word: 'payload', plain: 'data sent' },
  { word: 'middleware', plain: 'in-between step' },
  { word: 'cache', plain: 'saved copy' },
  { word: 'query', plain: 'lookup' },
  { word: 'deploy', plain: 'release' },
  { word: 'PR', plain: 'change for review' },
  { word: 'commit', plain: 'saved change' },
  { word: 'branch', plain: 'working copy' },
];

const PATTERNS = JARGON.map((entry) => ({
  entry,
  pattern: new RegExp(`(?<![\\w-])${entry.word}(?:s|es)?(?![\\w-])`, 'giu'),
}));

export function findJargon(text: string): Array<{ found: string; entry: JargonWord }> {
  const hits: Array<{ found: string; entry: JargonWord }> = [];
  for (const { entry, pattern } of PATTERNS) {
    for (const match of text.matchAll(pattern)) hits.push({ found: match[0], entry });
  }
  return hits;
}
