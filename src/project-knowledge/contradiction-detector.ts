import type { Contradiction } from './types.js';
import type { EvidenceFile } from './evidence-retriever.js';

// Patterns that extract a (key, value) claim from file content
const CLAIM_PATTERNS: Array<{ key: string; regex: RegExp }> = [
  { key: 'node-engine', regex: /["']node["']\s*:\s*["']([^"']+)["']/gi },
  { key: 'package-version', regex: /"version"\s*:\s*"([^"]+)"/gi },
  { key: 'pnpm-version', regex: /["']pnpm["']\s*:\s*["']([^"']+)["']/gi },
];

interface Claim {
  key: string;
  value: string;
  filePath: string;
  source_class: string;
}

function extractClaims(file: EvidenceFile): Claim[] {
  const claims: Claim[] = [];
  for (const { key, regex } of CLAIM_PATTERNS) {
    const pattern = new RegExp(regex.source, regex.flags);
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(file.excerpt)) !== null) {
      claims.push({ key, value: match[1], filePath: file.path, source_class: file.source_class });
    }
  }
  return claims;
}

export class ContradictionDetector {
  detect(files: EvidenceFile[]): Contradiction[] {
    if (files.length < 2) return [];

    const allClaims: Claim[] = files.flatMap(extractClaims);
    const contradictions: Contradiction[] = [];
    const seen = new Set<string>();

    for (let i = 0; i < allClaims.length; i++) {
      for (let j = i + 1; j < allClaims.length; j++) {
        const a = allClaims[i];
        const b = allClaims[j];
        if (a.key !== b.key) continue;
        if (a.filePath === b.filePath) continue;
        if (a.value === b.value) continue;

        const pairKey = [a.filePath, b.filePath, a.key].sort().join('|');
        if (seen.has(pairKey)) continue;
        seen.add(pairKey);

        contradictions.push({
          source_a: a.filePath,
          source_b: b.filePath,
          description: `"${a.key}" is "${a.value}" in ${a.filePath} but "${b.value}" in ${b.filePath}`,
        });
      }
    }

    return contradictions;
  }
}
