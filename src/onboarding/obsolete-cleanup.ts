import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import { sha256, stripRuleMarker } from '@/rule-scripts/rule-id.js';

import { MANAGED_HEADER } from './decision-pause-contract-writer.js';

const OBSOLETE_MANAGED_DOCS: readonly string[] = [
  PATHS.DECISION_PAUSE_CONTRACT,
  PATHS.NARRATION_CONTRACT,
];

export interface ObsoleteWorkflowRule {
  path: string;
  skill: string;
  job: string;
  shippedHashes: readonly string[];
}

export const OBSOLETE_WORKFLOW_RULES: readonly ObsoleteWorkflowRule[] = [
  {
    path: 'security/pentest.md',
    skill: 'pentest',
    job: 'pentests',
    shippedHashes: ['759462f321c63e9c4794b05d6b06a6075c5b10b7ff0aec56d1fca33f57fa19d5'],
  },
  {
    path: 'coding/site-map.md',
    skill: 'site-map',
    job: 'site maps',
    shippedHashes: [
      '0173ed5a2557273021a8979160bea306e2f85207fabf703f3e2c0b5e5c2d5e6a',
      '3493199c3e1c50daf2f1e7cde8325fc5ce41ece20d2ea6912747c8c3d66ea2cf',
      '5013379c70fe6adb2f29f3bf42c2dfc422884a1ceeaef4920587b619725c915a',
      'b5897cf9d1553889b1c449039033df110ad33b8f9469ad1bec299efdd15307a3',
      'e0a2e6aa8242959ea28a6507a4483dc9f81642b04059854d2ecb3ff954910d83',
    ],
  },
  {
    path: 'coding/site-map-retest.md',
    skill: 'site-map',
    job: 'site map retests',
    shippedHashes: [
      'ae0c8186b66f077fc3fa4535dacc44b32fd82c31275b402ec6a5f206280c0f0c',
      'e1c0f0205f598b58a44b48dc88a76d36ce10358e59d77808ced00e282c9c061e',
    ],
  },
  {
    path: 'coding/design-test.md',
    skill: 'design-test',
    job: 'design tests',
    shippedHashes: [
      '8eb387c8cdbc1e6524ed9d66d485f2b069914ee18bed39c662f73ee2109e9921',
      'edc8a1f43a04da6aa7f22abf61b021d97a9edd0e7acdcad11b6ed46c66d5f809',
    ],
  },
  {
    path: 'coding/design-retest.md',
    skill: 'design-test',
    job: 'design retests',
    shippedHashes: ['622161f0a9ab7f398b469797c4f26b9ed348b1fdd4e1f62c329de3a6f60f9529'],
  },
  {
    path: 'coding/codebase-health.md',
    skill: 'codebase-health',
    job: 'codebase health checks',
    shippedHashes: ['6bf818da926f07c4de1f967792dce6faa1523305d2080a68b88b04af3adb201d'],
  },
  {
    path: 'coding/health-retest.md',
    skill: 'codebase-health',
    job: 'health retests',
    shippedHashes: ['b73e6d84df7bbb488433ba5011938925b83ba4d63c5a74688d81f98644c7527f'],
  },
];

export function normalizedRuleHash(content: string): string {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  return sha256(lines.map((line) => stripRuleMarker(line).text).join('\n'));
}

export function removeObsoleteContractDocs(projectRoot: string): string[] {
  const removed: string[] = [];
  for (const relativePath of OBSOLETE_MANAGED_DOCS) {
    const path = join(projectRoot, relativePath);
    let content: string;
    try {
      content = readFileSync(path, 'utf8');
    } catch {
      continue;
    }
    if (!content.startsWith(MANAGED_HEADER)) {
      continue;
    }
    rmSync(path, { force: true });
    removed.push(relativePath);
  }
  return removed;
}

function cleanObsoleteWorkflowRule(projectRoot: string, rule: ObsoleteWorkflowRule): string | null {
  const shown = `${PATHS.RULES_DIR}/${rule.path}`;
  const path = join(projectRoot, PATHS.RULES_DIR, rule.path);
  try {
    if (!rule.shippedHashes.includes(normalizedRuleHash(readFileSync(path, 'utf8')))) {
      return `Kept ${shown} because it was edited. paqad now runs ${rule.job} from its own skill, so you can delete this file.`;
    }
    rmSync(path);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return null;
    return `Couldn't remove ${shown} (${code ?? 'unknown error'}); the next update tries again. paqad now runs ${rule.job} from its own skill.`;
  }
  return `Removed ${shown}; paqad now runs ${rule.job} from its own ${rule.skill} skill.`;
}

export function removeObsoleteWorkflowRules(projectRoot: string): string[] {
  return OBSOLETE_WORKFLOW_RULES.flatMap((rule) => {
    const line = cleanObsoleteWorkflowRule(projectRoot, rule);
    return line === null ? [] : [line];
  });
}
