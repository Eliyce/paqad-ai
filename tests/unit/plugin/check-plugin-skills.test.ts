import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import {
  ALLOWED_KEYS,
  checkPluginSkills,
  DEFAULT_SKILL_ROOTS,
  HOST_LABELS,
} from '../../../scripts/check-plugin-skills.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const CHAT = HOST_LABELS[0]!;
const CLAUDE_CODE = HOST_LABELS[1]!;
const dirs: string[] = [];

type Finding = { file: string; message: string };

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function write(root: string, rel: string, text: string): void {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text);
}

function skill(frontMatter: string, body = '# A skill\n\nDoes a thing.\n'): string {
  return `---\n${frontMatter}\n---\n\n${body}`;
}

function labelled(description: string, compatibility: string, extra = ''): string {
  return skill(
    `name: fixture\ndescription: ${JSON.stringify(description)}\ncompatibility: ${JSON.stringify(compatibility)}${extra}`,
  );
}

function check(skillMd: string | null, setup?: (root: string) => void): Finding[] {
  const root = tempDir('paqad-skill-check-');
  if (skillMd !== null) write(root, 'skills/fixture/SKILL.md', skillMd);
  else mkdirSync(join(root, 'skills', 'fixture'), { recursive: true });
  setup?.(root);
  return checkPluginSkills({ skillRoots: ['skills'], pluginRoot: root }) as Finding[];
}

function messages(findings: Finding[]): string[] {
  return findings.map((finding) => `${finding.file}: ${finding.message}`);
}

describe('checkPluginSkills', () => {
  it('AC-9: a skill using all six allowed keys passes', () => {
    expect(ALLOWED_KEYS).toEqual([
      'name',
      'description',
      'license',
      'compatibility',
      'metadata',
      'allowed-tools',
    ]);
    const all = skill(
      [
        'name: fixture',
        `description: ${JSON.stringify(`${CHAT.prefix}Answers a question.`)}`,
        'license: MIT',
        `compatibility: ${JSON.stringify(CHAT.compatibility)}`,
        'metadata:',
        '  owner: eliyce',
        'allowed-tools: Read Grep',
      ].join('\n'),
    );
    expect(check(all)).toEqual([]);
    expect(check(labelled(`${CLAUDE_CODE.prefix}Sets up.`, CLAUDE_CODE.compatibility))).toEqual([]);
  });

  it('AC-9: an argument-hint key fails naming the file and the key', () => {
    const findings = check(
      labelled(`${CHAT.prefix}Answers.`, CHAT.compatibility, '\nargument-hint: "[question]"'),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.file).toBe('skills/fixture/SKILL.md');
    expect(findings[0]!.message).toContain('"argument-hint"');
    expect(findings[0]!.message).toContain('is not allowed');
  });

  it.each([
    ['no prefix', 'Answers a question.'],
    ['the prefix in the wrong case', 'chat and claude code: Answers a question.'],
    ['the prefix without its trailing space', 'Chat and Claude Code:Answers a question.'],
    ['the Claude Code prefix in the wrong case', 'claude code: Sets up.'],
  ])('AC-9: a description with %s fails', (_label, description) => {
    expect(messages(check(labelled(description, CHAT.compatibility)))).toEqual([
      'skills/fixture/SKILL.md: description must start with exactly "Chat and Claude Code: " or "Claude Code: "',
    ]);
  });

  it('AC-9: a description with no value fails on the prefix', () => {
    expect(messages(check(skill('name: fixture')))).toEqual([
      'skills/fixture/SKILL.md: description must start with exactly "Chat and Claude Code: " or "Claude Code: "',
    ]);
  });

  it.each([
    ['Claude Code with the chat value', CLAUDE_CODE.prefix, CHAT.compatibility, CLAUDE_CODE],
    ['the chat prefix with the Claude Code value', CHAT.prefix, CLAUDE_CODE.compatibility, CHAT],
    ['a value one character off', CHAT.prefix, `${CHAT.compatibility}.`, CHAT],
    ['no compatibility value', CHAT.prefix, null, CHAT],
  ])('AC-9: %s fails on compatibility', (_label, prefix, compatibility, expected) => {
    const md =
      compatibility === null
        ? skill(`name: fixture\ndescription: ${JSON.stringify(`${prefix}Does it.`)}`)
        : labelled(`${prefix}Does it.`, compatibility);
    expect(messages(check(md))).toEqual([
      `skills/fixture/SKILL.md: compatibility must be "${expected.compatibility}" for a description starting "${expected.prefix}"`,
    ]);
  });

  it('AC-9: unparseable front matter fails', () => {
    const [finding] = check(skill('name: fixture\ndescription: "unclosed\n  bad: [1, 2'));
    expect(finding!.file).toBe('skills/fixture/SKILL.md');
    expect(finding!.message).toMatch(/^front matter does not parse as YAML/);
    expect(messages(check(skill('- a\n- b')))).toEqual([
      'skills/fixture/SKILL.md: front matter is not a key and value mapping',
    ]);
  });

  it.each([
    ['no fence at all', '# A skill\n\nNo front matter.\n'],
    ['an opening fence that is never closed', '---\nname: fixture\n\n# A skill\n'],
    ['a closing fence glued to text', '---\nname: fixture\n---trailing\n'],
  ])('AC-9: missing front matter with %s fails', (_label, text) => {
    expect(messages(check(text))).toEqual([
      'skills/fixture/SKILL.md: front matter is missing; open the file with --- and close it with ---',
    ]);
  });

  it('reads CRLF front matter and reports a skill folder with no SKILL.md', () => {
    const crlf = labelled(`${CHAT.prefix}Answers.`, CHAT.compatibility).replace(/\n/g, '\r\n');
    expect(check(crlf)).toEqual([]);
    expect(messages(check(null))).toEqual(['skills/fixture/SKILL.md: SKILL.md is missing']);
    const root = tempDir('paqad-skill-check-');
    expect(
      messages(checkPluginSkills({ skillRoots: ['nowhere'], pluginRoot: root }) as Finding[]),
    ).toEqual(['nowhere: skills folder is missing']);
  });

  it('AC-9 AC-31: a bin/ folder at the plugin root fails', () => {
    const findings = check(labelled(`${CHAT.prefix}Answers.`, CHAT.compatibility), (root) =>
      write(root, 'bin/paqad', '#!/bin/sh\n'),
    );
    expect(messages(findings)).toEqual([
      'bin: the plugin root must not have a bin/ folder; keep the launcher under runtime/claude-plugin/bin/',
    ]);
  });

  it('AC-31: every package.json bin entry must sit under dist/ or runtime/claude-plugin/bin/', () => {
    const ok = labelled(`${CHAT.prefix}Answers.`, CHAT.compatibility);
    const withBin = (bin: unknown) => (root: string) =>
      write(root, 'package.json', JSON.stringify({ name: 'x', bin }));
    expect(
      check(ok, withBin({ a: './dist/cli/index.js', b: 'runtime/claude-plugin/bin/p' })),
    ).toEqual([]);
    expect(messages(check(ok, withBin({ tool: './bin/tool.js' })))).toEqual([
      'package.json: bin "tool" points at ./bin/tool.js; keep it under dist/ or runtime/claude-plugin/bin/',
    ]);
    expect(messages(check(ok, withBin('scripts/run.js')))).toEqual([
      'package.json: bin "bin" points at scripts/run.js; keep it under dist/ or runtime/claude-plugin/bin/',
    ]);
  });
});

describe('the real repository', () => {
  it('AC-11 AC-31: the plugin skills and the discovery source pass with no finding', () => {
    expect(DEFAULT_SKILL_ROOTS).toEqual([
      'runtime/claude-plugin/skills',
      'plugins/discovery/skills',
    ]);
    expect(checkPluginSkills({ skillRoots: DEFAULT_SKILL_ROOTS, pluginRoot: repoRoot })).toEqual(
      [],
    );
  });

  it('AC-11: discovery skills carry the chat label and onboard, join and dashboard the Claude Code label', () => {
    const runtimeSkills = join(repoRoot, 'runtime', 'claude-plugin', 'skills');
    const sourceSkills = join(repoRoot, 'plugins', 'discovery', 'skills');
    const discovery = readdirSync(runtimeSkills).filter(
      (name) => !['onboard', 'join', 'dashboard'].includes(name),
    );
    expect(discovery).toHaveLength(14);
    expect(readdirSync(sourceSkills)).toHaveLength(14);
    for (const path of [
      ...discovery.map((name) => join(runtimeSkills, name, 'SKILL.md')),
      ...readdirSync(sourceSkills).map((name) => join(sourceSkills, name, 'SKILL.md')),
    ]) {
      const text = readFileSync(path, 'utf8');
      expect(text, path).toContain(`description: "${CHAT.prefix}`);
      expect(text, path).toContain(`compatibility: ${JSON.stringify(CHAT.compatibility)}`);
    }
    for (const name of ['onboard', 'join', 'dashboard']) {
      const text = readFileSync(join(runtimeSkills, name, 'SKILL.md'), 'utf8');
      expect(text, name).toMatch(new RegExp(`^description: ['"]${CLAUDE_CODE.prefix}`, 'm'));
      expect(text, name).toContain(CLAUDE_CODE.compatibility);
    }
  });
});

describe('scripts/validate-plugin.mjs', () => {
  it('AC-10: fails on a skill finding before it looks for the claude CLI', () => {
    const root = tempDir('paqad-validate-');
    for (const script of [
      'validate-plugin.mjs',
      'check-plugin-skills.mjs',
      'assemble-plugin.mjs',
    ]) {
      mkdirSync(join(root, 'scripts'), { recursive: true });
      copyFileSync(join(repoRoot, 'scripts', script), join(root, 'scripts', script));
    }
    symlinkSync(join(repoRoot, 'node_modules'), join(root, 'node_modules'), 'junction');
    write(root, 'package.json', JSON.stringify({ name: 'fixture', type: 'module' }));
    write(
      root,
      'runtime/claude-plugin/skills/fixture/SKILL.md',
      labelled(`${CHAT.prefix}Answers.`, CHAT.compatibility, '\nargument-hint: "[q]"'),
    );
    write(
      root,
      'plugins/discovery/skills/fixture/SKILL.md',
      labelled(`${CHAT.prefix}Answers.`, CHAT.compatibility),
    );
    const emptyPath = tempDir('paqad-no-claude-');
    const result = spawnSync(process.execPath, [join(root, 'scripts', 'validate-plugin.mjs')], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, PATH: emptyPath, Path: emptyPath },
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      '[paqad] plugin skill check: runtime/claude-plugin/skills/fixture/SKILL.md: front-matter key "argument-hint" is not allowed',
    );
    expect(result.stdout).not.toContain('claude CLI not found');
  });
});
