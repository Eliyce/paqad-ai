import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  hashFolder,
  listFolderFiles,
  withDescription,
  withoutDescription,
} from '@/authoring/hash.js';
import {
  compileNeverWritePattern,
  loadNeverWriteList,
  NeverWriteListError,
  PROJECT_NEVER_WRITE_PATH,
} from '@/authoring/lint/never-write.js';
import { portableFrontmatter, portableSkillText } from '@/authoring/package/portable.js';
import { quickValidateSkill } from '@/authoring/package/quick-validate.js';
import { instructionBlocks, parseTrace } from '@/authoring/stages/draft.js';
import { parseIntake, raiseIntakeGap, runIntake } from '@/authoring/stages/intake.js';
import { runJustify } from '@/authoring/stages/justify.js';
import { renderGateMarkdown, SkillWorkspace } from '@/authoring/workspace.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'paqad-skill-helpers-'));
  mkdirSync(join(root, '.paqad'), { recursive: true });
  mkdirSync(join(root, 'home'));
  vi.stubEnv('HOME', join(root, 'home'));
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

function write(rel: string, text: string): string {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text);
  return join(root, rel);
}

function validate(frontmatter: string | null): string {
  write(
    's/SKILL.md',
    frontmatter === null ? '# no frontmatter\n' : `---\n${frontmatter}---\n# x\n`,
  );
  return quickValidateSkill(join(root, 's')).message;
}

describe('quick-validate', () => {
  it('names every refusal the Python original gives', () => {
    expect(quickValidateSkill(join(root, 'missing')).message).toBe('SKILL.md not found');
    expect(validate(null)).toBe('No YAML frontmatter found');
    expect(validate('name: [unclosed\n')).not.toBe('Skill is valid!');
    expect(validate('description: d\n')).toBe("Missing 'name' in frontmatter");
    expect(validate('name: s\n')).toBe("Missing 'description' in frontmatter");
    expect(validate('name: 3\ndescription: d\n')).toBe('Name must be a string, got number');
    expect(validate('name: Bad_Name\ndescription: d\n')).toContain('should be kebab-case');
    expect(validate('name: -bad\ndescription: d\n')).toContain('cannot start/end with hyphen');
    expect(validate(`name: ${'a'.repeat(65)}\ndescription: d\n`)).toContain('Name is too long');
    expect(validate("name: ''\ndescription: d\n")).toBe('Skill is valid!');
    expect(validate('name: s\ndescription: 3\n')).toBe('Description must be a string, got number');
    expect(validate('name: s\ndescription: d\ncompatibility: 3\n')).toBe(
      'Compatibility must be a string, got number',
    );
    expect(validate(`name: s\ndescription: d\ncompatibility: ${'c'.repeat(501)}\n`)).toContain(
      'Compatibility is too long',
    );
    expect(validate('name: s\ndescription: d\ncompatibility: node 20\n')).toBe('Skill is valid!');
  });
});

describe('the portable copy', () => {
  it('merges moved fields into an existing metadata map and ignores a non-map one', () => {
    expect(
      portableFrontmatter({ name: 's', description: 'd', metadata: { owner: 'x' }, model: 'm' }),
    ).toEqual({ name: 's', description: 'd', metadata: { owner: 'x', model: 'm' } });
    expect(portableFrontmatter({ name: 's', metadata: ['x'], hooks: { a: 1 } })).toEqual({
      name: 's',
      metadata: { hooks: '{"a":1}' },
    });
  });

  it('refuses a draft whose frontmatter cannot be read', () => {
    expect(() => portableSkillText('---\nname: [x\n---\nbody')).toThrow("can't be read");
  });
});

describe('the never-write list', () => {
  it('refuses an unreadable, empty or malformed project list and accepts one without phrases', () => {
    mkdirSync(join(root, PROJECT_NEVER_WRITE_PATH), { recursive: true });
    expect(() => loadNeverWriteList(root)).toThrow(NeverWriteListError);
    rmSync(join(root, PROJECT_NEVER_WRITE_PATH), { recursive: true });
    write(PROJECT_NEVER_WRITE_PATH, '');
    expect(() => loadNeverWriteList(root)).toThrow('needs schema_version "1"');
    write(PROJECT_NEVER_WRITE_PATH, 'schema_version: "1"\n');
    expect(loadNeverWriteList(root).phrases.length).toBeGreaterThan(0);
    write(PROJECT_NEVER_WRITE_PATH, 'schema_version: "1"\nphrases: [: bad\n');
    expect(() => loadNeverWriteList(root)).toThrow('is not valid YAML');
  });

  it('orders equal-length phrases alphabetically in the pattern', () => {
    expect(compileNeverWritePattern(['bb', 'aa']).source).toContain('aa|bb');
  });
});

describe('folder hashing and the description helpers', () => {
  it('sorts names, filters with include, and leaves text without frontmatter alone', () => {
    write('f/b.md', 'b');
    write('f/a.md', 'a');
    write('f/a.md.bak', 'c');
    expect(listFolderFiles(join(root, 'f')).map((file) => file.rel)).toEqual([
      'a.md',
      'a.md.bak',
      'b.md',
    ]);
    expect(hashFolder(join(root, 'f'), (rel) => rel.endsWith('.md'))).not.toBe(
      hashFolder(join(root, 'f')),
    );
    expect(withoutDescription('no frontmatter')).toBe('no frontmatter');
    expect(withoutDescription('---\nname: x\n')).toBe('---\nname: x\n');
    expect(withDescription('no frontmatter', 'd')).toBe('no frontmatter');
    expect(withDescription('---\nname: x\n', 'd')).toBe('---\nname: x\n');
  });

  it('writes a description with a newline as a JSON string', () => {
    expect(withDescription('---\nname: x\n---\n', 'line one\nline two').split('\n')[2]).toBe(
      'description: "line one\\nline two"',
    );
  });
});

describe('draft blocks and traces', () => {
  it('reads blocks from a file with no frontmatter or an unclosed one', () => {
    expect(instructionBlocks('# One\ntext\n## Two\n').map((block) => block.heading)).toEqual([
      'One',
      'Two',
    ]);
    expect(instructionBlocks('---\nname: x\n# Head\n').map((block) => block.heading)).toEqual([
      'Head',
    ]);
    expect(instructionBlocks('no headings at all\n')).toEqual([]);
  });

  it('reads a trace row with no S-ID column', () => {
    expect(parseTrace('| Block | Lines |\n| --- | --- |\n| Intro | 1-2 |\n').mappings).toEqual([
      { heading: 'Intro', sources: [] },
    ]);
  });
});

describe('S0 and S1 refusals', () => {
  function workspace(): SkillWorkspace {
    return new SkillWorkspace(root, 'csv-dedupe');
  }

  it('refuses verdict rows that are not objects and a missing transcript', () => {
    const ws = workspace();
    ws.writeJson('baseline/verdicts.json', [null, 1, 2]);
    expect(() => runJustify(ws)).toThrow('entry 1 is missing run, passed, note.');
    ws.writeJson(
      'baseline/verdicts.json',
      [1, 2, 3].map((run) => ({ run, passed: false, note: 'x' })),
    );
    expect(() => runJustify(ws)).toThrow('baseline/run-1.md is missing.');
  });

  it('refuses an exclusion without its detail, and skips S0 in improve mode', () => {
    const ws = workspace();
    expect(() => runJustify(ws, { exclusion: 'documented' })).toThrow('--documented-in');
    expect(() => runJustify(ws, { exclusion: 'enforceable' })).toThrow('--enforce-with');
    ws.writeJson('mode.json', { entry: 'improve', source: '.claude/skills/csv-dedupe' });
    expect(runJustify(ws).lines[0]).toContain('S0 is skipped');
  });

  it('refuses intake YAML that is not a map and an unknown verifiability', () => {
    expect(parseIntake('- a list\n')).toEqual({});
    expect(() => parseIntake('a: [unclosed\n')).toThrow('intake.yaml is not valid YAML');
    const ws = workspace();
    ws.write('justification.md', renderGateMarkdown({ gate: 'passed' }, 'x'));
    expect(() =>
      runIntake(
        ws,
        'purpose: p\ntriggers: [t]\noutput_format: o\nverifiability: maybe\nskill_class: workflow\nscope: { in: [a] }\ndependencies: [none]\n',
      ),
    ).toThrow('verifiability must be objective or subjective');
  });

  it('refuses an intake gap for an unknown field, a wrong option count or an unoffered recommendation', () => {
    const ws = workspace();
    ws.write('justification.md', renderGateMarkdown({ gate: 'passed' }, 'x'));
    const gap = (field: string, options: string[], recommend: string) =>
      raiseIntakeGap(ws, { field, question: 'q?', options, recommend });
    expect(() => gap('colour', ['a', 'b'], 'a')).toThrow();
    expect(() => gap('purpose', ['a'], 'a')).toThrow();
    expect(() => gap('purpose', ['a', 'b'], 'c')).toThrow();
  });
});
