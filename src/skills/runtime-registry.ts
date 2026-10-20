import { SkillRegistrationError } from '@/core/errors/skill-registration-error.js';
import type { LoadedSkill, RuntimeSkillListEntry } from '@/core/types/skill.js';

import { SkillFrontmatterParser, toLoadedSkill } from './frontmatter-parser.js';

const RUNTIME_PREFIX = 'runtime:';

function runtimeIdFor(name: string): string {
  return `${RUNTIME_PREFIX}${name}`;
}

export class RuntimeSkillRegistry {
  private readonly builtIns: readonly LoadedSkill[];
  private readonly builtInNames: ReadonlySet<string>;
  private readonly runtime = new Map<string, LoadedSkill>();
  private readonly parser = new SkillFrontmatterParser();

  constructor(builtIns: readonly LoadedSkill[]) {
    this.builtIns = [...builtIns];
    this.builtInNames = new Set(this.builtIns.map((skill) => skill.name));
  }

  register(content: string, sourceLabel?: string): LoadedSkill {
    let skill: LoadedSkill;
    try {
      const parsed = this.parser.parse(content);
      skill = toLoadedSkill(`${RUNTIME_PREFIX}${sourceLabel ?? parsed.frontmatter.name}`, parsed);
    } catch (cause) {
      throw new SkillRegistrationError(
        `Skill registration refused: ${cause instanceof Error ? cause.message : 'malformed content'}`,
        { kind: 'malformed', cause },
      );
    }

    const name = skill.name;
    const runtimeId = runtimeIdFor(name);

    if (this.builtInNames.has(name)) {
      throw new SkillRegistrationError(
        `Skill "${name}" collides with a built-in skill; the built-in remains the default match.`,
        { kind: 'duplicate', builtInId: name, runtimeId },
      );
    }

    if (this.runtime.has(runtimeId)) {
      throw new SkillRegistrationError(`A runtime skill "${name}" is already registered.`, {
        kind: 'duplicate',
        runtimeId,
      });
    }

    this.runtime.set(runtimeId, skill);
    return skill;
  }

  remove(runtimeId: string): void {
    if (this.runtime.delete(runtimeId)) {
      return;
    }

    if (this.builtInNames.has(runtimeId)) {
      throw new SkillRegistrationError(`Cannot remove built-in skill "${runtimeId}".`, {
        kind: 'built-in-protected',
        builtInId: runtimeId,
      });
    }

    throw new SkillRegistrationError(`No runtime skill registered under "${runtimeId}".`, {
      kind: 'not-found',
      runtimeId,
    });
  }

  snapshot(): readonly RuntimeSkillListEntry[] {
    const builtIns = [...this.builtIns]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map<RuntimeSkillListEntry>((skill) => ({ ...skill, id: skill.name, source: 'built-in' }));

    const runtime = [...this.runtime.entries()]
      .sort(([, a], [, b]) => a.name.localeCompare(b.name))
      .map<RuntimeSkillListEntry>(([id, skill]) => ({ ...skill, id, source: 'runtime' }));

    return Object.freeze([...builtIns, ...runtime]);
  }
}
