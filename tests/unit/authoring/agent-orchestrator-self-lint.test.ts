import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { listFolderFiles } from '@/authoring/hash.js';
import { lintAgentInProject } from '@/authoring/lint/agent-lint.js';
import { lintSkillFolder } from '@/authoring/lint/skill-lint.js';

const REPO = process.cwd();
const SKILL_DIR = join(REPO, 'runtime/base/skills/agent-orchestrator');
const PERSONA = join(REPO, 'runtime/base/agents/agent-orchestrator.md');

describe('the agent-orchestrator runtime skill and persona', () => {
  it('the skill passes its own lint with zero blocking findings', () => {
    const result = lintSkillFolder(SKILL_DIR, { projectRoot: REPO });
    expect(result.findings.filter((finding) => finding.severity === 'block')).toEqual([]);
  });

  it('the persona passes the agent lint with zero blocking findings', () => {
    const result = lintAgentInProject(REPO, PERSONA);
    expect(result.findings.filter((finding) => finding.severity === 'block')).toEqual([]);
  });

  it('holds no em dash in any file, cites every reference and drives every stage verb', () => {
    const skill = readFileSync(join(SKILL_DIR, 'SKILL.md'), 'utf8');
    for (const file of listFolderFiles(SKILL_DIR)) {
      expect(file.bytes.toString('utf8'), file.rel).not.toContain(String.fromCodePoint(0x2014));
      if (file.rel !== 'SKILL.md') expect(skill, file.rel).toContain(file.rel);
    }
    for (const verb of [
      'justify',
      'intake',
      'evidence',
      'draft',
      'test',
      'eval plan',
      'delegation plan',
      'release',
    ]) {
      expect(skill).toContain(`paqad-ai agent ${verb}`);
    }
    expect(skill).toContain('runtime/base/authoring/never-write.yaml');
  });
});
