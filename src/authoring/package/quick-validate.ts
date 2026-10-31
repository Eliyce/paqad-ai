import { join } from 'node:path';

import { splitSkillFrontmatter } from '@/skills/frontmatter-parser.js';

import { readTextIfPresent } from '../fs-io.js';

export const QUICK_VALIDATE_ALLOWED_KEYS: readonly string[] = [
  'name',
  'description',
  'license',
  'allowed-tools',
  'metadata',
  'compatibility',
];

export const QUICK_VALIDATE_LIMITS = { name: 64, description: 1024, compatibility: 500 } as const;

export interface QuickValidateResult {
  valid: boolean;
  message: string;
  exitCode: 0 | 1;
}

function result(valid: boolean, message: string): QuickValidateResult {
  return { valid, message, exitCode: valid ? 0 : 1 };
}

export function quickValidateSkill(folder: string): QuickValidateResult {
  const content = readTextIfPresent(join(folder, 'SKILL.md'));
  if (content === null) return result(false, 'SKILL.md not found');
  if (!content.startsWith('---')) return result(false, 'No YAML frontmatter found');
  const split = splitSkillFrontmatter(content);
  if (!split.ok) return result(false, split.message);
  const data = split.data;
  const unexpected = Object.keys(data)
    .filter((key) => !QUICK_VALIDATE_ALLOWED_KEYS.includes(key))
    .sort();
  if (unexpected.length > 0) {
    return result(
      false,
      `Unexpected key(s) in SKILL.md frontmatter: ${unexpected.join(', ')}. Allowed properties are: ${[...QUICK_VALIDATE_ALLOWED_KEYS].sort().join(', ')}`,
    );
  }
  if (!('name' in data)) return result(false, "Missing 'name' in frontmatter");
  if (!('description' in data)) return result(false, "Missing 'description' in frontmatter");
  const name = data.name;
  if (typeof name !== 'string') return result(false, `Name must be a string, got ${typeof name}`);
  const trimmed = name.trim();
  if (trimmed !== '') {
    if (!/^[a-z0-9-]+$/u.test(trimmed)) {
      return result(
        false,
        `Name '${trimmed}' should be kebab-case (lowercase letters, digits, and hyphens only)`,
      );
    }
    if (trimmed.startsWith('-') || trimmed.endsWith('-') || trimmed.includes('--')) {
      return result(
        false,
        `Name '${trimmed}' cannot start/end with hyphen or contain consecutive hyphens`,
      );
    }
    if (trimmed.length > QUICK_VALIDATE_LIMITS.name) {
      return result(
        false,
        `Name is too long (${trimmed.length} characters). Maximum is ${QUICK_VALIDATE_LIMITS.name} characters.`,
      );
    }
  }
  const description = data.description;
  if (typeof description !== 'string') {
    return result(false, `Description must be a string, got ${typeof description}`);
  }
  const text = description.trim();
  if (text.includes('<') || text.includes('>')) {
    return result(false, 'Description cannot contain angle brackets (< or >)');
  }
  if ([...text].length > QUICK_VALIDATE_LIMITS.description) {
    return result(
      false,
      `Description is too long (${[...text].length} characters). Maximum is ${QUICK_VALIDATE_LIMITS.description} characters.`,
    );
  }
  const compatibility = data.compatibility;
  if (compatibility !== undefined && compatibility !== null && compatibility !== '') {
    if (typeof compatibility !== 'string') {
      return result(false, `Compatibility must be a string, got ${typeof compatibility}`);
    }
    if (compatibility.length > QUICK_VALIDATE_LIMITS.compatibility) {
      return result(
        false,
        `Compatibility is too long (${compatibility.length} characters). Maximum is ${QUICK_VALIDATE_LIMITS.compatibility} characters.`,
      );
    }
  }
  return result(true, 'Skill is valid!');
}
