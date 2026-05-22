import { readFile } from 'node:fs/promises';
import { basename } from 'pathe';

import type { ResolvedArtifact } from '@/core/types/resolution.js';
import type { LoadedSkill } from '@/core/types/skill.js';

import { SkillFrontmatterParser, toLoadedSkill } from './frontmatter-parser.js';

export class SkillLoader {
  private readonly parser = new SkillFrontmatterParser();

  async load(artifacts: ResolvedArtifact[]): Promise<LoadedSkill[]> {
    const skillArtifacts = artifacts.filter((artifact) =>
      basename(artifact.path).endsWith('SKILL.md'),
    );
    const skills = await Promise.all(
      skillArtifacts.map(async (artifact) => {
        const content = await readFile(artifact.path, 'utf8');
        return toLoadedSkill(artifact.path, this.parser.parse(content));
      }),
    );

    return skills.sort(
      (left, right) => left.name.localeCompare(right.name) || left.file.localeCompare(right.file),
    );
  }
}
