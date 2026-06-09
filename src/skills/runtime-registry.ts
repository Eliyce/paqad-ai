import { SkillRegistrationError } from '@/core/errors/skill-registration-error.js';
import type { LoadedSkill, RuntimeSkillListEntry } from '@/core/types/skill.js';

import { SkillFrontmatterParser, toLoadedSkill } from './frontmatter-parser.js';

const RUNTIME_PREFIX = 'runtime:';

function runtimeIdFor(name: string): string {
  return `${RUNTIME_PREFIX}${name}`;
}

/**
 * In-memory registry of skills registered at runtime (e.g. from an in-app skill
 * editor or a marketplace install) without restarting the agent process. The
 * store is ephemeral — entries are lost on restart, matching the ticket's
 * "without restarting" intent.
 *
 * Built-in skills are passed at construction and never mutated. A runtime entry
 * whose name collides with a built-in is refused so the built-in remains the
 * default match; the runtime entry would otherwise live under a `runtime:<name>`
 * namespaced identifier.
 *
 * Snapshot isolation: {@link register} validates and stores in a single
 * synchronous turn with no `await` between parse and `Map.set`, and
 * {@link snapshot} returns a freshly composed array each call. A caller that
 * captured a snapshot before a later `register()` therefore sees a stable set.
 */
export class RuntimeSkillRegistry {
  private readonly builtIns: readonly LoadedSkill[];
  private readonly builtInNames: ReadonlySet<string>;
  private readonly runtime = new Map<string, LoadedSkill>();
  private readonly parser = new SkillFrontmatterParser();

  constructor(builtIns: readonly LoadedSkill[]) {
    this.builtIns = [...builtIns];
    this.builtInNames = new Set(this.builtIns.map((skill) => skill.name));
  }

  /**
   * Parses and registers a SKILL.md markdown string. Returns the stored
   * {@link LoadedSkill}. Throws {@link SkillRegistrationError} with
   * `kind: 'malformed'` on a parse failure, or `kind: 'duplicate'` when the
   * name collides with a built-in (carrying both ids) or an existing runtime
   * entry. Validation and storage happen synchronously with no async gap.
   */
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

  /**
   * Removes a runtime-registered skill by its `runtime:<name>` identifier.
   * Throws {@link SkillRegistrationError} with `kind: 'built-in-protected'` when
   * the identifier names a built-in, or `kind: 'not-found'` when no runtime
   * entry matches.
   */
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

  /**
   * Returns an immutable, freshly composed listing of built-ins (first, sorted
   * by name) followed by runtime entries (sorted by name), each tagged with its
   * `id` and `source`.
   */
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
