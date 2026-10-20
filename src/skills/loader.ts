import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename } from 'pathe';

import { ValidationError } from '@/core/errors/index.js';
import type { ResolvedArtifact } from '@/core/types/resolution.js';
import type { LoadedSkill } from '@/core/types/skill.js';

import {
  emitSkillAuditEvent,
  getSharedSkillAuditBuffer,
  type SkillAuditBuffer,
} from './audit-events.js';
import { SkillFrontmatterParser, toLoadedSkill } from './frontmatter-parser.js';

export class SkillLoader {
  private readonly parser = new SkillFrontmatterParser();

  constructor(private readonly auditBuffer: SkillAuditBuffer = getSharedSkillAuditBuffer()) {}

  async load(artifacts: ResolvedArtifact[], projectRoot?: string): Promise<LoadedSkill[]> {
    const skillArtifacts = artifacts.filter((artifact) =>
      basename(artifact.path).endsWith('SKILL.md'),
    );
    const loaded = await Promise.all(
      skillArtifacts.map(async (artifact) => {
        const content = await readFile(artifact.path, 'utf8');
        try {
          return toLoadedSkill(artifact.path, this.parser.parse(content));
        } catch (error) {
          if (error instanceof ValidationError) {
            emitSkillAuditEvent(
              {
                ts: new Date().toISOString(),
                type: 'skill.load_failed',
                path: artifact.path,
                validation_error_code: error.subCode ?? error.code,
                message: error.message,
                skill_id: null,
                content_hash: createHash('sha256').update(content).digest('hex'),
              },
              projectRoot,
              this.auditBuffer,
            );
            return null;
          }
          throw error;
        }
      }),
    );

    return loaded
      .filter((skill): skill is LoadedSkill => skill !== null)
      .sort(
        (left, right) => left.name.localeCompare(right.name) || left.file.localeCompare(right.file),
      );
  }
}
