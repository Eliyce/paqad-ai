import { describe, expect, it } from 'vitest';

import { SkillRegistrationError } from '@/core/errors/index.js';
import type { LoadedSkill } from '@/core/types/skill.js';
import { SkillFrontmatterParser, toLoadedSkill } from '@/skills/frontmatter-parser.js';
import { RuntimeSkillRegistry } from '@/skills/runtime-registry.js';
import { WorkflowRouterService } from '@/pipeline/workflow-router.js';

const parser = new SkillFrontmatterParser();

interface SkillOptions {
  description?: string;
  tools?: string[];
  routing?: { priority: number; pattern: string; target: string };
}

function skillMd(name: string, options: SkillOptions = {}): string {
  const tools = options.tools ? `tools: [${options.tools.join(', ')}]\n` : '';
  const routing = options.routing
    ? `request_routing:\n  - priority: ${options.routing.priority}\n    patterns:\n      - "${options.routing.pattern}"\n    target_workflow: ${options.routing.target}\n`
    : '';
  return `---
name: ${name}
description: ${options.description ?? `Test skill ${name}`}
model_tier: fast
triggers:
  - workflow: [feature-development]
cacheable: false
cache_key_inputs: []
output_format: markdown
input_schema:
  request_text:
    type: string
    required: true
${tools}${routing}---

## Body

Test skill body for ${name}.
`;
}

function builtIn(name: string): LoadedSkill {
  return toLoadedSkill(`builtin:${name}`, parser.parse(skillMd(name)));
}

describe('RuntimeSkillRegistry', () => {
  it('registers a skill and includes it in the snapshot alongside built-ins', () => {
    const registry = new RuntimeSkillRegistry([builtIn('alpha')]);
    const registered = registry.register(skillMd('editor-skill'));

    expect(registered.name).toBe('editor-skill');
    const snapshot = registry.snapshot();
    const ids = snapshot.map((entry) => entry.id);
    expect(ids).toContain('alpha');
    expect(ids).toContain('runtime:editor-skill');
    expect(snapshot.find((entry) => entry.id === 'runtime:editor-skill')?.source).toBe('runtime');
    expect(snapshot.find((entry) => entry.id === 'alpha')?.source).toBe('built-in');
  });

  it('isolates a snapshot taken before a later registration', () => {
    const registry = new RuntimeSkillRegistry([]);
    const before = registry.snapshot();
    registry.register(skillMd('late-skill'));
    const after = registry.snapshot();

    expect(before.some((entry) => entry.name === 'late-skill')).toBe(false);
    expect(after.some((entry) => entry.name === 'late-skill')).toBe(true);
  });

  it('refuses a collision with a built-in, naming both identifiers', () => {
    const registry = new RuntimeSkillRegistry([builtIn('spec-diff')]);
    try {
      registry.register(skillMd('spec-diff'));
      expect.unreachable('expected a duplicate SkillRegistrationError');
    } catch (error) {
      expect(error).toBeInstanceOf(SkillRegistrationError);
      const registrationError = error as SkillRegistrationError;
      expect(registrationError.kind).toBe('duplicate');
      expect(registrationError.builtInId).toBe('spec-diff');
      expect(registrationError.runtimeId).toBe('runtime:spec-diff');
    }
    expect(registry.snapshot().some((entry) => entry.source === 'runtime')).toBe(false);
  });

  it('refuses a duplicate runtime registration', () => {
    const registry = new RuntimeSkillRegistry([]);
    registry.register(skillMd('dup'));
    expect(() => registry.register(skillMd('dup'))).toThrowError(SkillRegistrationError);
  });

  it('removes a runtime skill without affecting built-ins', () => {
    const registry = new RuntimeSkillRegistry([builtIn('alpha')]);
    registry.register(skillMd('temp'));
    registry.remove('runtime:temp');

    const snapshot = registry.snapshot();
    expect(snapshot.some((entry) => entry.name === 'temp')).toBe(false);
    expect(snapshot.some((entry) => entry.id === 'alpha')).toBe(true);
  });

  it('refuses to remove a built-in identifier', () => {
    const registry = new RuntimeSkillRegistry([builtIn('alpha')]);
    try {
      registry.remove('alpha');
      expect.unreachable('expected a built-in-protected SkillRegistrationError');
    } catch (error) {
      expect(error).toBeInstanceOf(SkillRegistrationError);
      expect((error as SkillRegistrationError).kind).toBe('built-in-protected');
    }
  });

  it('refuses to remove an unknown runtime identifier', () => {
    const registry = new RuntimeSkillRegistry([]);
    try {
      registry.remove('runtime:missing');
      expect.unreachable('expected a not-found SkillRegistrationError');
    } catch (error) {
      expect((error as SkillRegistrationError).kind).toBe('not-found');
    }
  });

  it('refuses malformed content without changing the existing set', () => {
    const registry = new RuntimeSkillRegistry([]);
    registry.register(skillMd('valid'));
    const before = registry.snapshot().length;

    try {
      registry.register('this is not a skill document');
      expect.unreachable('expected a malformed SkillRegistrationError');
    } catch (error) {
      expect((error as SkillRegistrationError).kind).toBe('malformed');
    }
    expect(registry.snapshot()).toHaveLength(before);
  });

  it('accepts two concurrent non-colliding registrations', () => {
    const registry = new RuntimeSkillRegistry([]);
    registry.register(skillMd('one'));
    registry.register(skillMd('two'));
    const names = registry.snapshot().map((entry) => entry.name);
    expect(names).toContain('one');
    expect(names).toContain('two');
  });

  it('leaves no orphaned entries after rapid register/remove/re-register', () => {
    const registry = new RuntimeSkillRegistry([]);
    for (let i = 0; i < 5; i += 1) {
      registry.register(skillMd('loop'));
      registry.remove('runtime:loop');
    }
    registry.register(skillMd('loop'));

    const matches = registry.snapshot().filter((entry) => entry.name === 'loop');
    expect(matches).toHaveLength(1);
  });

  it('accepts a skill whose trigger references an unknown tool', () => {
    const registry = new RuntimeSkillRegistry([]);
    const registered = registry.register(skillMd('uses-unknown', { tools: ['nonexistent-tool'] }));
    expect(registered.tools).toContain('nonexistent-tool');
    expect(registry.snapshot().some((entry) => entry.name === 'uses-unknown')).toBe(true);
  });
});

describe('WorkflowRouterService with a runtime registry', () => {
  it('routes to a runtime-registered routing skill', async () => {
    const registry = new RuntimeSkillRegistry([]);
    registry.register(
      skillMd('runtime-router-skill', {
        routing: {
          priority: 999,
          pattern: 'qqzz unique runtime route',
          target: 'documentation-update',
        },
      }),
    );

    const service = new WorkflowRouterService({ runtimeRegistry: registry });
    const result = await service.resolve('please qqzz unique runtime route now');

    expect(result.workflow_source).toBe('routing-skill');
    expect(result.matched_rule).toBe('qqzz unique runtime route');
  });

  it('behaves identically without a registry (no match for the runtime phrase)', async () => {
    const service = new WorkflowRouterService();
    const result = await service.resolve('please qqzz unique runtime route now');
    expect(result.workflow_source).not.toBe('routing-skill');
  });
});
