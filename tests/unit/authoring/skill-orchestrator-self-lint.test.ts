import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { listFolderFiles } from '@/authoring/hash.js';
import { lintSkillFolder } from '@/authoring/lint/skill-lint.js';

const REPO = process.cwd();
const SKILL_DIR = join(REPO, 'runtime/base/skills/skill-orchestrator');

describe('the skill-orchestrator runtime skill', () => {
  it('AC-33: passes its own lint with zero blocking findings', () => {
    const result = lintSkillFolder(SKILL_DIR, { projectRoot: REPO });
    expect(result.findings.filter((finding) => finding.severity === 'block')).toEqual([]);
  });

  it('AC-24: holds no em dash in any file', () => {
    for (const file of listFolderFiles(SKILL_DIR)) {
      expect(file.bytes.toString('utf8'), file.rel).not.toContain(String.fromCodePoint(0x2014));
    }
  });

  it('FR-23: points at the shared never-write list', () => {
    expect(readFileSync(join(SKILL_DIR, 'SKILL.md'), 'utf8')).toContain(
      'runtime/base/authoring/never-write.yaml',
    );
  });

  it('FR-61: carries the Apache 2.0 notice for the adapted briefs and a line in the repository NOTICE', () => {
    expect(readFileSync(join(SKILL_DIR, 'references/agents/NOTICE'), 'utf8')).toContain(
      'Apache License, Version 2.0',
    );
    const notice = readFileSync(join(REPO, 'NOTICE'), 'utf8');
    expect(notice).toContain('src/authoring/eval/aggregate.ts');
    expect(notice).toContain('src/authoring/package/quick-validate.ts');
    expect(notice).toContain('references/agents/grader.md');
  });
});
