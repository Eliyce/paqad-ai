import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import { SkillRegistrationError } from '@/core/errors/skill-registration-error.js';
import { ValidationError } from '@/core/errors/validation-error.js';
import type { ClassificationResult } from '@/core/types/classification.js';
import type { LoadedSkill } from '@/core/types/skill.js';
import {
  DEFAULT_SKILL_AUDIT_BUFFER_CAPACITY,
  SkillAuditBuffer,
  type SkillLoadFailedEvent,
  type SkillMetadataDeprecatedEvent,
  appendSkillAuditEvent,
  clearShownSkillMetadataDeprecations,
  emitSkillAuditEvent,
  getSharedSkillAuditBuffer,
  readSkillAuditEvents,
  recordSkillMetadataDeprecation,
} from '@/skills/audit-events.js';
import { SkillCacheManager } from '@/skills/cache-manager.js';
import {
  buildSkillIndex,
  generateSkillIndex,
  writeSkillIndex,
  writeSkillIndexFromArtifacts,
} from '@/skills/index-generator.js';
import { SkillLoader } from '@/skills/loader.js';
import { selectModelForTier } from '@/skills/model-selector.js';
import { RuntimeSkillRegistry } from '@/skills/runtime-registry.js';
import { SkillTriggerEvaluator } from '@/skills/trigger-evaluator.js';

const PROFILE = {
  model_routing: { fast_model: 'fast-m', default_model: 'default-m', reasoning_model: 'deep-m' },
} as never;

function tmp(prefix = 'paqad-skills-portable-'): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function skillBody(name: string, extra = ''): string {
  return `---\nname: ${name}\ndescription: ${name} description\nmodel_tier: fast\noutput_format: markdown\ncacheable: false\ninput_schema:\n  request:\n    type: string\n    required: true\ntriggers:\n  - workflow: [feature-development]\n${extra}---\n\nBody.\n`;
}

function loadFailed(path: string): SkillLoadFailedEvent {
  return {
    ts: '2026-01-01T00:00:00.000Z',
    type: 'skill.load_failed',
    path,
    validation_error_code: 'X',
    message: 'bad',
    skill_id: null,
    content_hash: 'h',
  };
}

function deprecated(path: string, message = 'old keys'): SkillMetadataDeprecatedEvent {
  return {
    ts: '2026-01-01T00:00:00.000Z',
    type: 'skill.metadata_deprecated',
    path,
    skill: 's',
    message,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  clearShownSkillMetadataDeprecations();
});

describe('skill audit events (portable)', () => {
  it('buffer evicts past capacity, snapshots a copy, and uses the default capacity', () => {
    const buffer = new SkillAuditBuffer(2);
    buffer.add(loadFailed('a'));
    buffer.add(loadFailed('b'));
    buffer.add(loadFailed('c'));
    expect(buffer.size).toBe(2);
    expect(buffer.snapshot().map((e) => (e as SkillLoadFailedEvent).path)).toEqual(['b', 'c']);
    expect(new SkillAuditBuffer().size).toBe(0);
    expect(DEFAULT_SKILL_AUDIT_BUFFER_CAPACITY).toBe(50);
    expect(getSharedSkillAuditBuffer()).toBe(getSharedSkillAuditBuffer());
  });

  it('flush writes events and re-buffers them when the write fails', () => {
    const root = tmp();
    const buffer = new SkillAuditBuffer();
    buffer.add(loadFailed('ok'));
    buffer.flush(root);
    expect(buffer.size).toBe(0);
    expect(readSkillAuditEvents(root)).toHaveLength(1);

    const blocked = tmp();
    const logDir = join(blocked, PATHS.SKILL_AUDIT_EVENTS_LOG, '..');
    mkdirSync(join(logDir, '..'), { recursive: true });
    writeFileSync(logDir, 'not a directory');
    buffer.add(loadFailed('kept'));
    buffer.flush(blocked);
    expect(buffer.size).toBe(1);
  });

  it('emit buffers without a project root and flushes with one', () => {
    const buffer = new SkillAuditBuffer();
    emitSkillAuditEvent(loadFailed('x'), undefined, buffer);
    expect(buffer.size).toBe(1);
    const root = tmp();
    emitSkillAuditEvent(loadFailed('y'), root, buffer);
    expect(buffer.size).toBe(0);
    expect(readSkillAuditEvents(root)).toHaveLength(2);
  });

  it('read skips a missing log, blank lines, bad JSON, non-objects, and unknown types', () => {
    const root = tmp();
    expect(readSkillAuditEvents(root)).toEqual([]);
    appendSkillAuditEvent(root, loadFailed('first'));
    const path = join(root, PATHS.SKILL_AUDIT_EVENTS_LOG);
    writeFileSync(
      path,
      `${readFileSync(path, 'utf8')}\n   \n{not json\nnull\n"str"\n{"type":"other"}\n${JSON.stringify(deprecated('p'))}\n`,
    );
    const events = readSkillAuditEvents(root);
    expect(events.map((e) => e.type)).toEqual(['skill.load_failed', 'skill.metadata_deprecated']);
  });

  it('deprecation is shown once per process and once per project log', () => {
    const shown: string[] = [];
    const warn = (line: string) => shown.push(line);
    expect(recordSkillMetadataDeprecation(deprecated('a'), undefined, warn)).toBe(true);
    expect(recordSkillMetadataDeprecation(deprecated('a'), undefined, warn)).toBe(false);

    const root = tmp();
    clearShownSkillMetadataDeprecations();
    expect(recordSkillMetadataDeprecation(deprecated('b'), root, warn)).toBe(true);
    clearShownSkillMetadataDeprecations();
    expect(recordSkillMetadataDeprecation(deprecated('b'), root, warn)).toBe(false);
    appendSkillAuditEvent(root, loadFailed('c'));
    expect(recordSkillMetadataDeprecation(deprecated('c', 'other'), root, warn)).toBe(true);
    expect(shown).toEqual(['paqad: old keys', 'paqad: old keys', 'paqad: other']);
  });

  it('deprecation still warns when the log cannot be written, and defaults to stderr', () => {
    const blocked = tmp();
    const logDir = join(blocked, PATHS.SKILL_AUDIT_EVENTS_LOG, '..');
    mkdirSync(join(logDir, '..'), { recursive: true });
    writeFileSync(logDir, 'not a directory');
    const shown: string[] = [];
    expect(recordSkillMetadataDeprecation(deprecated('d'), blocked, (l) => shown.push(l))).toBe(
      true,
    );
    expect(shown).toEqual(['paqad: old keys']);

    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    expect(recordSkillMetadataDeprecation(deprecated('e'), undefined)).toBe(true);
    expect(write).toHaveBeenCalledWith('paqad: old keys\n');
  });
});

describe('SkillLoader (portable)', () => {
  it('loads valid skills sorted, ignores non-skill files, and records load failures', async () => {
    const root = tmp();
    const projectRoot = join(root, 'project');
    mkdirSync(projectRoot, { recursive: true });
    const b = join(root, 'b.SKILL.md');
    const a = join(root, 'a.SKILL.md');
    const broken = join(root, 'broken.SKILL.md');
    const other = join(root, 'notes.md');
    writeFileSync(b, skillBody('beta'));
    writeFileSync(a, skillBody('alpha'));
    writeFileSync(broken, '---\nname: broken\n---\n\nBody.\n');
    writeFileSync(other, 'not a skill');
    const buffer = new SkillAuditBuffer();
    const shown: string[] = [];
    const skills = await new SkillLoader(buffer, (l) => shown.push(l)).load(
      [b, a, broken, other].map((path) => ({ path, level: 2, source: path })) as never,
      projectRoot,
    );
    expect(skills.map((s) => s.name)).toEqual(['alpha', 'beta']);
    expect(shown.length).toBeGreaterThan(0);
    const failures = readSkillAuditEvents(projectRoot).filter(
      (e) => e.type === 'skill.load_failed',
    );
    expect(failures).toEqual([expect.objectContaining({ path: broken, skill_id: null })]);
  });

  it('buffers load failures without a project root and rethrows non-validation errors', async () => {
    const root = tmp();
    const broken = join(root, 'broken.SKILL.md');
    writeFileSync(broken, '---\nname: broken\n---\n\nBody.\n');
    const buffer = new SkillAuditBuffer();
    expect(
      await new SkillLoader(buffer).load([{ path: broken, level: 2, source: broken }] as never),
    ).toEqual([]);
    expect(buffer.size).toBe(1);

    const loader = new SkillLoader(buffer);
    const parser = (loader as unknown as { parser: { parse: () => never } }).parser;
    vi.spyOn(parser, 'parse').mockImplementation(() => {
      throw new TypeError('boom');
    });
    await expect(
      loader.load([{ path: broken, level: 2, source: broken }] as never),
    ).rejects.toThrow('boom');
  });

  it('falls back to the base error code and orders same-name skills by file', async () => {
    const root = tmp();
    const projectRoot = join(root, 'project');
    const one = join(root, 'one.SKILL.md');
    const two = join(root, 'two.SKILL.md');
    writeFileSync(one, skillBody('same'));
    writeFileSync(two, skillBody('same'));
    const skills = await new SkillLoader(new SkillAuditBuffer(), () => undefined).load(
      [two, one].map((path) => ({ path, level: 2, source: path })) as never,
    );
    expect(skills.map((s) => s.file)).toEqual([one, two]);

    const loader = new SkillLoader(new SkillAuditBuffer());
    const parser = (loader as unknown as { parser: { parse: () => never } }).parser;
    vi.spyOn(parser, 'parse').mockImplementation(() => {
      throw new ValidationError('no sub code');
    });
    expect(await loader.load([{ path: one, level: 2, source: one }] as never, projectRoot)).toEqual(
      [],
    );
    expect(readSkillAuditEvents(projectRoot)).toEqual([
      expect.objectContaining({ validation_error_code: 'VALIDATION_ERROR' }),
    ]);
  });

  it('defaults to the shared audit buffer', async () => {
    expect(await new SkillLoader().load([])).toEqual([]);
  });
});

describe('RuntimeSkillRegistry (portable)', () => {
  const builtIn = { name: 'built', file: 'built/SKILL.md' } as unknown as LoadedSkill;

  it('registers, lists, and removes runtime skills', () => {
    const other = { name: 'another', file: 'another/SKILL.md' } as unknown as LoadedSkill;
    const registry = new RuntimeSkillRegistry([builtIn, other]);
    const zeta = registry.register(skillBody('zeta'));
    const alpha = registry.register(skillBody('alpha'), 'custom-label');
    expect(zeta.file).toBe('runtime:zeta');
    expect(alpha.file).toBe('runtime:custom-label');
    expect(registry.snapshot().map((e) => [e.id, e.source])).toEqual([
      ['another', 'built-in'],
      ['built', 'built-in'],
      ['runtime:alpha', 'runtime'],
      ['runtime:zeta', 'runtime'],
    ]);
    registry.remove('runtime:zeta');
    expect(registry.snapshot()).toHaveLength(3);
  });

  it('refuses malformed, colliding, duplicate, protected, and unknown skills', () => {
    const registry = new RuntimeSkillRegistry([builtIn]);
    expect(() => registry.register('no frontmatter')).toThrow(SkillRegistrationError);
    const parser = (registry as unknown as { parser: { parse: () => never } }).parser;
    const spy = vi.spyOn(parser, 'parse').mockImplementationOnce(() => {
      throw 'not an error';
    });
    expect(() => registry.register(skillBody('x'))).toThrow('malformed content');
    spy.mockRestore();
    expect(() => registry.register(skillBody('built'))).toThrow('collides with a built-in');
    registry.register(skillBody('dup'));
    expect(() => registry.register(skillBody('dup'))).toThrow('already registered');
    expect(() => registry.remove('built')).toThrow('Cannot remove built-in');
    expect(() => registry.remove('runtime:missing')).toThrow('No runtime skill');
  });
});

describe('skill index generator (portable)', () => {
  it('builds, generates, and writes the index relative to the project', async () => {
    const root = tmp();
    const skillsDir = join(root, 'skills');
    mkdirSync(join(skillsDir, 'b'), { recursive: true });
    mkdirSync(join(skillsDir, 'a'), { recursive: true });
    writeFileSync(join(skillsDir, 'b', 'SKILL.md'), skillBody('beta'));
    writeFileSync(join(skillsDir, 'a', 'SKILL.md'), skillBody('alpha'));

    const generated = await generateSkillIndex(PROFILE, [skillsDir], root);
    expect(generated.map((e) => [e.name, e.resolved_model])).toEqual([
      ['alpha', 'fast-m'],
      ['beta', 'fast-m'],
    ]);
    expect(generated[0]?.file.replace(/\\/gu, '/')).toBe('skills/a/SKILL.md');
    expect(await buildSkillIndex(PROFILE, [])).toEqual([]);
    expect(await generateSkillIndex(PROFILE, [])).toEqual([]);

    const written = await writeSkillIndexFromArtifacts(root, PROFILE, [
      { path: join(skillsDir, 'a', 'SKILL.md'), level: 2, source: 'a' },
      { path: join(root, 'other.md'), level: 2, source: 'o' },
    ] as never);
    expect(written).toBe(PATHS.SKILL_INDEX);
    const onDisk = JSON.parse(readFileSync(join(root, PATHS.SKILL_INDEX), 'utf8')) as unknown[];
    expect(onDisk).toHaveLength(1);
    expect(await writeSkillIndex(root, [])).toBe(PATHS.SKILL_INDEX);
  });
});

describe('model selector and trigger evaluator (portable)', () => {
  it('maps every tier to its model', () => {
    expect(selectModelForTier(PROFILE, 'fast')).toBe('fast-m');
    expect(selectModelForTier(PROFILE, 'reasoning')).toBe('deep-m');
    expect(selectModelForTier(PROFILE, 'medium' as never)).toBe('default-m');
  });

  it('matches scalar and array classification dimensions', () => {
    const evaluator = new SkillTriggerEvaluator();
    const classification = {
      workflow: 'feature-development',
      affected_modules: ['billing', 'auth'],
    } as unknown as ClassificationResult;
    expect(
      evaluator.shouldLoad({ triggers: [{ workflow: ['feature-development'] }] }, classification),
    ).toBe(true);
    expect(
      evaluator.shouldLoad({ triggers: [{ affected_modules: ['auth'] }] }, classification),
    ).toBe(true);
    expect(evaluator.shouldLoad({ triggers: [{ affected_modules: ['ui'] }] }, classification)).toBe(
      false,
    );
    expect(evaluator.shouldLoad({ triggers: [] }, classification)).toBe(false);
  });
});

describe('SkillCacheManager (portable)', () => {
  it('misses, writes, hits, reports stats, and invalidates by module', async () => {
    const root = tmp('paqad-skill-cache-portable-');
    const cacheDir = join(root, 'cache');
    const input = join(root, 'billing-schema.md');
    writeFileSync(input, '# schema');
    const manager = new SkillCacheManager(cacheDir);
    expect(await manager.getStats()).toEqual({
      total_entries: 0,
      total_size_bytes: 0,
      hit_rate: 0,
    });

    const miss = await manager.checkCache('unknown-skill-name', [input]);
    expect(miss.hit).toBe(false);
    await manager.writeCache('unknown-skill-name', miss.input_hash, { ok: true }, [input]);
    writeFileSync(join(cacheDir, 'notes.txt'), 'ignored');
    const hit = await manager.checkCache('unknown-skill-name', [input]);
    expect(hit).toEqual({ hit: true, result: { ok: true }, input_hash: miss.input_hash });

    const stats = await manager.getStats();
    expect(stats.total_entries).toBe(1);
    expect(stats.hit_rate).toBe(0.5);

    expect(await manager.invalidateModule('nothing-matches')).toBe(0);
    expect(await manager.invalidateModule('billing')).toBe(1);
  });

  it('skips reads and writes for a skill that is not cacheable', async () => {
    const root = tmp('paqad-skill-cache-portable-');
    const input = join(root, 'in.md');
    writeFileSync(input, 'x');
    const manager = new SkillCacheManager(join(root, 'cache'));
    vi.spyOn(
      manager as unknown as { isCacheable: () => Promise<boolean> },
      'isCacheable',
    ).mockResolvedValue(false);
    const result = await manager.checkCache('no-cache', [input]);
    expect(result.hit).toBe(false);
    await manager.writeCache('no-cache', result.input_hash, {}, [input]);
    expect((await manager.getStats()).total_entries).toBe(0);
  });
});
