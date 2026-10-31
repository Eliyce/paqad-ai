import YAML from 'yaml';

import { splitSkillFrontmatter } from '@/skills/frontmatter-parser.js';

import { listFolderFiles, regularFiles } from '../hash.js';
import { OPEN_SPEC_SKILL_FIELDS } from '../lint/fields.js';
import { AuthoringRefusal, type SkillWorkspace } from '../workspace.js';
import { quickValidateSkill, type QuickValidateResult } from './quick-validate.js';

export const PORTABLE_DIR = 'portable';

export function portableFrontmatter(data: Record<string, unknown>): Record<string, unknown> {
  const portable: Record<string, unknown> = {};
  const moved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (OPEN_SPEC_SKILL_FIELDS.includes(key)) portable[key] = value;
    else moved[key] = value;
  }
  if (Object.keys(moved).length > 0) {
    const existing =
      typeof portable.metadata === 'object' &&
      portable.metadata !== null &&
      !Array.isArray(portable.metadata)
        ? (portable.metadata as Record<string, unknown>)
        : {};
    const metadata: Record<string, unknown> = { ...existing };
    for (const [key, value] of Object.entries(moved)) {
      metadata[key] = typeof value === 'string' ? value : JSON.stringify(value);
    }
    portable.metadata = metadata;
  }
  return portable;
}

export function portableSkillText(skillText: string): string {
  const split = splitSkillFrontmatter(skillText);
  if (!split.ok)
    throw new AuthoringRefusal(`the draft SKILL.md frontmatter can't be read: ${split.message}`);
  return `---\n${YAML.stringify(portableFrontmatter(split.data)).trimEnd()}\n---\n${split.body}`;
}

export interface PortableResult {
  path: string;
  validation: QuickValidateResult;
}

export function buildPortableSkill(
  workspace: SkillWorkspace,
  sourceFolder: string,
  input: { unverified: boolean; allowedRiskyScripts: readonly string[] },
): PortableResult {
  if (input.unverified) {
    throw new AuthoringRefusal(
      `${workspace.name} is labelled unverified, so it can't leave this project as a portable copy.`,
    );
  }
  if (input.allowedRiskyScripts.length > 0) {
    throw new AuthoringRefusal(
      `${workspace.name} holds an allowed risky script (${input.allowedRiskyScripts.join(', ')}), so it can't leave this project as a portable copy.`,
    );
  }
  const target = `${PORTABLE_DIR}/${workspace.name}`;
  workspace.remove(PORTABLE_DIR);
  for (const file of regularFiles(listFolderFiles(sourceFolder))) {
    const text = file.bytes.toString('utf8');
    workspace.write(
      `${target}/${file.rel}`,
      file.rel === 'SKILL.md' ? portableSkillText(text) : text,
    );
  }
  const validation = quickValidateSkill(workspace.path(target));
  return { path: workspace.relPath(target), validation };
}
