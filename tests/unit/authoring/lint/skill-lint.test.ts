import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  formatSkillLintJson,
  lintSkillFolder,
  skillLintExitCode,
  SkillLintUsageError,
  type SkillLintFinding,
} from '@/authoring/lint/skill-lint.js';
import { createSkillCommand } from '@/cli/commands/skill.js';

const NAME = 'drafting-notes';
const DESCRIPTION =
  'Drafts release notes from merged pull requests. Use when the user asks for release notes.';
const BODY = [
  '# Drafting notes',
  '',
  '1. Read the merged pull requests.',
  '2. Group them by area.',
  '',
  'Read references/guide.md when a pull request has no label.',
  '',
  '## Gotchas',
  '',
  'Squash merges hide the original commits.',
  '',
].join('\n');

const roots: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

interface SkillSpec {
  name?: string;
  folder?: string;
  frontmatter?: string;
  body?: string;
  files?: Record<string, string>;
  projectFiles?: Record<string, string>;
}

function write(root: string, rel: string, content: string): void {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), content);
}

function skill(spec: SkillSpec = {}): { root: string; folder: string } {
  const root = mkdtempSync(join(tmpdir(), 'paqad-skill-lint-'));
  roots.push(root);
  const folderName = spec.folder ?? spec.name ?? NAME;
  const folder = join(root, '.claude/skills', folderName);
  const frontmatter =
    spec.frontmatter ?? `name: ${spec.name ?? NAME}\ndescription: ${DESCRIPTION}\n`;
  write(folder, 'SKILL.md', `---\n${frontmatter}---\n${spec.body ?? BODY}`);
  const files = spec.files ?? { 'references/guide.md': '# Guide\n\nLabel by area.\n' };
  for (const [rel, content] of Object.entries(files)) write(folder, rel, content);
  for (const [rel, content] of Object.entries(spec.projectFiles ?? {})) write(root, rel, content);
  return { root, folder };
}

function lint(spec: SkillSpec = {}, claudeCode = true) {
  const { root, folder } = skill(spec);
  return lintSkillFolder(folder, { projectRoot: root, claudeCode });
}

function rules(findings: readonly SkillLintFinding[], rule: string): SkillLintFinding[] {
  return findings.filter((finding) => finding.rule === rule);
}

describe('a clean skill', () => {
  it('has no findings and exits 0', () => {
    const result = lint();
    expect(result.findings).toEqual([]);
    expect(result).toMatchObject({ skill: NAME, blocking: 0, warnings: 0 });
    expect(skillLintExitCode(result)).toBe(0);
  });
});

describe('AC-2, AC-3: findings shape and determinism', () => {
  it('AC-2: one SK-012 with file and line and two SK-006 for unknown keys', () => {
    const result = lint({
      frontmatter: `name: ${NAME}\ndescription: ${DESCRIPTION}\nfoo: 1\nbar: 2\n`,
      body: `${BODY}\nAlways follow best practices here.\n`,
    });
    const sk012 = rules(result.findings, 'SK-012');
    expect(sk012).toEqual([
      {
        rule: 'SK-012',
        severity: 'block',
        file: 'SKILL.md',
        line: 18,
        message: 'Generic phrase "follow best practices". Say what it means here.',
      },
    ]);
    expect(
      rules(result.findings, 'SK-006').map((finding) => [finding.line, finding.severity]),
    ).toEqual([
      [4, 'block'],
      [5, 'block'],
    ]);
    expect(skillLintExitCode(result)).toBe(1);
  });

  it('AC-3: two runs give byte-identical JSON, sorted by file, line, then rule', () => {
    const { root, folder } = skill({
      body: `${BODY}\nYou MUST leverage it \u2014 as needed.\n`,
      files: {
        'references/guide.md': '# Guide\n\nUtilize it.\n',
        'references/extra.md': 'x\n',
      },
    });
    const first = formatSkillLintJson(lintSkillFolder(folder, { projectRoot: root }));
    const second = formatSkillLintJson(lintSkillFolder(folder, { projectRoot: root }));
    expect(second).toBe(first);
    const findings = (JSON.parse(first) as { findings: SkillLintFinding[] }).findings;
    const keys = findings.map(
      (finding) => `${finding.file}|${String(finding.line).padStart(4, '0')}|${finding.rule}`,
    );
    expect(keys).toEqual([...keys].sort());
  });

  it('NFR-4: CRLF and LF files give the same findings', () => {
    const body = `${BODY}\nFollow best practices.\n`;
    const lf = lint({ body });
    const crlf = lint({ body: body.replace(/\n/g, '\r\n') });
    expect(crlf.findings).toEqual(lf.findings);
  });
});

describe('name rules (SK-001 to SK-004)', () => {
  it('AC-23: pdf-helper warns SK-003 naming helper', () => {
    const result = lint({ name: 'pdf-helper' });
    expect(rules(result.findings, 'SK-003')).toHaveLength(1);
    expect(rules(result.findings, 'SK-003')[0]!.message).toContain('"helper"');
    expect(rules(result.findings, 'SK-003')[0]!.severity).toBe('warn');
  });

  it('blocks a YAML file in the folder that does not parse, naming the line', () => {
    const result = lint({
      files: {
        'references/guide.md': '# Guide\n\nLabel by area.\n',
        'agents/openai.yaml':
          'interface:\n  display_name: Notes\n  short_description: Writes notes for the\n    spec pipeline: findings plus questions.\n',
      },
    });
    expect(rules(result.findings, 'SK-001')).toMatchObject([
      { file: 'agents/openai.yaml', line: 3, severity: 'block' },
    ]);
  });

  it('accepts the same text as a folded block', () => {
    const result = lint({
      files: {
        'references/guide.md': '# Guide\n\nLabel by area.\n',
        'agents/openai.yaml':
          'interface:\n  short_description: >-\n    Writes notes for the spec pipeline: findings plus questions.\n',
      },
    });
    expect(rules(result.findings, 'SK-001')).toEqual([]);
  });

  it('AC-23: claude-tools blocks SK-002', () => {
    const result = lint({ name: 'claude-tools' });
    expect(rules(result.findings, 'SK-002')).toMatchObject([{ severity: 'block' }]);
  });

  it('AC-23: a name that differs from its folder blocks SK-001', () => {
    const result = lint({ name: 'drafting-notes', folder: 'drafting-docs' });
    expect(rules(result.findings, 'SK-001')).toMatchObject([
      {
        severity: 'block',
        message: 'The name "drafting-notes" differs from the folder "drafting-docs".',
      },
    ]);
  });

  it('AC-23: a noun-phrase name warns SK-004', () => {
    const result = lint({ name: 'release-notes' });
    expect(rules(result.findings, 'SK-004')).toMatchObject([{ severity: 'warn' }]);
    expect(rules(lint().findings, 'SK-004')).toEqual([]);
  });

  it('blocks a missing, overlong or malformed name', () => {
    expect(
      rules(lint({ frontmatter: `description: ${DESCRIPTION}\n` }).findings, 'SK-001'),
    ).not.toEqual([]);
    const long = `drafting-${'a'.repeat(60)}`;
    expect(
      rules(lint({ name: long }).findings, 'SK-001').some((finding) =>
        finding.message.includes('64'),
      ),
    ).toBe(true);
    const doubled = lint({ name: 'drafting--notes' });
    expect(
      rules(doubled.findings, 'SK-001').some((finding) =>
        finding.message.includes('single hyphens'),
      ),
    ).toBe(true);
  });

  it('blocks unreadable frontmatter as SK-001', () => {
    const result = lint({ frontmatter: 'name: [unclosed\n' });
    expect(rules(result.findings, 'SK-001')[0]!.message).toContain('could not be read');
  });
});

describe('description rules (SK-005)', () => {
  it('AC-52: 1023 and 1024 code points pass, 1025 fails', () => {
    const base = 'Drafts notes. Use when asked. ';
    for (const [length, blocked] of [
      [1023, false],
      [1024, false],
      [1025, true],
    ] as const) {
      const description = base + 'a'.repeat(length - base.length);
      const result = lint({ frontmatter: `name: ${NAME}\ndescription: "${description}"\n` });
      expect(rules(result.findings, 'SK-005').length > 0).toBe(blocked);
    }
  });

  it('blocks angle brackets, a missing when clause and a missing description', () => {
    const angle = lint({
      frontmatter: `name: ${NAME}\ndescription: "Drafts <notes>. Use when asked."\n`,
    });
    expect(rules(angle.findings, 'SK-005')[0]!.message).toContain('"<" or ">"');
    const noWhen = lint({ frontmatter: `name: ${NAME}\ndescription: Drafts notes.\n` });
    expect(rules(noWhen.findings, 'SK-005')[0]!.message).toContain('"when" clause');
    const missing = lint({ frontmatter: `name: ${NAME}\n` });
    expect(rules(missing.findings, 'SK-005')[0]!.message).toContain('missing');
  });
});

describe('frontmatter keys (SK-006)', () => {
  it('allows Claude Code fields only on Claude Code', () => {
    const frontmatter = `name: ${NAME}\ndescription: ${DESCRIPTION}\nwhen_to_use: always\n`;
    expect(rules(lint({ frontmatter }, true).findings, 'SK-006')).toEqual([]);
    expect(rules(lint({ frontmatter }, false).findings, 'SK-006')).toMatchObject([{ line: 4 }]);
  });
});

describe('folder rules (SK-007 to SK-009)', () => {
  it('SK-007: blocks a second SKILL.md', () => {
    const result = lint({
      files: { 'references/guide.md': 'x\n', 'nested/SKILL.md': '---\nname: x\n---\n' },
    });
    expect(rules(result.findings, 'SK-007')).toMatchObject([{ file: 'nested/SKILL.md' }]);
  });

  it('SK-008: blocks a body over 500 lines or over the token limit', () => {
    const long = `${BODY}${'line\n'.repeat(500)}`;
    expect(rules(lint({ body: long }).findings, 'SK-008')[0]!.message).toContain('lines');
    const { root, folder } = skill();
    const tight = lintSkillFolder(folder, { projectRoot: root, bodyMaxTokens: 10 });
    expect(rules(tight.findings, 'SK-008')[0]!.message).toContain('tokens');
  });

  it('SK-009: blocks an uncited reference, a missing cite and a two-level chain', () => {
    const result = lint({
      body: `${BODY}\nSee references/missing.md for more.\n`,
      files: {
        'references/guide.md': 'Then read references/deeper.md.\n',
        'references/deeper.md': 'x\n',
        'references/orphan.md': 'x\n',
      },
    });
    const messages = rules(result.findings, 'SK-009').map(
      (finding) => `${finding.file}: ${finding.message}`,
    );
    expect(messages).toEqual([
      'SKILL.md: The cited file references/missing.md does not exist.',
      'references/deeper.md: references/deeper.md is never cited from SKILL.md.',
      'references/guide.md: references/guide.md points to references/deeper.md; references stay one level deep from SKILL.md.',
      'references/orphan.md: references/orphan.md is never cited from SKILL.md.',
    ]);
  });
});

describe('scripts (SK-010) and inline dependencies (SK-019)', () => {
  const TEST = { 'tests/skills/drafting-notes/extract.test.ts': 'it("help", () => {});\n' };

  it('AC-4: blocks a script that calls input() or reads stdin with read', () => {
    const python = lint({
      files: {
        'references/guide.md': 'x\n',
        'scripts/extract.py': '"""--help"""\nname = input("name? ")\n',
      },
      projectFiles: TEST,
    });
    expect(rules(python.findings, 'SK-010')).toMatchObject([
      { file: 'scripts/extract.py', line: 2 },
    ]);
    const shell = lint({
      files: { 'references/guide.md': 'x\n', 'scripts/extract.sh': '# --help\nread name\n' },
      projectFiles: TEST,
    });
    expect(rules(shell.findings, 'SK-010')).toMatchObject([{ line: 2 }]);
  });

  it('AC-26: blocks a script with no test file, naming it, and passes once a test exists', () => {
    const files = { 'references/guide.md': 'x\n', 'scripts/extract.ts': '// --help\n' };
    const missing = lint({ files });
    expect(rules(missing.findings, 'SK-010')).toEqual([
      expect.objectContaining({
        file: 'scripts/extract.ts',
        message: 'The script scripts/extract.ts has no test file under the tests directory.',
      }),
    ]);
    expect(rules(lint({ files, projectFiles: TEST }).findings, 'SK-010')).toEqual([]);
    const laravel = lint({
      files,
      projectFiles: { 'tests/Feature/Skills/DraftingNotes/ExtractTest.php': '<?php\n' },
    });
    expect(rules(laravel.findings, 'SK-010')).toEqual([]);
  });

  it('blocks a script without --help', () => {
    const result = lint({
      files: { 'references/guide.md': 'x\n', 'scripts/extract.ts': 'export {};\n' },
      projectFiles: TEST,
    });
    expect(rules(result.findings, 'SK-010')[0]!.message).toContain('--help');
  });

  it('SK-019: warns on an unpinned inline dependency and accepts a pinned one', () => {
    const script = [
      '# /// script',
      '# dependencies = [',
      '#   "requests",',
      '#   "rich==13.7.1",',
      '# ]',
      '# ///',
      'import requests  # --help',
      '',
    ].join('\n');
    const result = lint({
      files: {
        'references/guide.md': 'x\n',
        'scripts/extract.py': script,
        'scripts/fetch.ts':
          '// --help\nimport x from "npm:chalk";\nimport y from "npm:zod@3.23.8";\n',
      },
      projectFiles: {
        ...TEST,
        'tests/skills/drafting-notes/fetch.test.ts': 'x\n',
      },
    });
    expect(
      rules(result.findings, 'SK-019').map((finding) => [
        finding.file,
        finding.line,
        finding.severity,
      ]),
    ).toEqual([
      ['scripts/extract.py', 3, 'warn'],
      ['scripts/fetch.ts', 2, 'warn'],
    ]);
  });
});

describe('secrets (SK-011)', () => {
  it('AC-65: reports the redacted fingerprint and never the key value', () => {
    const key = 'AKIAABCDEFGHIJKLMNOP';
    const { root, folder } = skill({
      files: { 'references/guide.md': `Use ${key} to sign.\n` },
      projectFiles: { 'tests/skills/drafting-notes/fixtures/in.txt': `token: ${key}\n` },
    });
    const result = lintSkillFolder(folder, { projectRoot: root });
    const json = formatSkillLintJson(result);
    const sk011 = rules(result.findings, 'SK-011');
    expect(sk011.map((finding) => finding.file)).toEqual([
      'references/guide.md',
      'tests/skills/drafting-notes/fixtures/in.txt',
    ]);
    expect(sk011[0]!.fingerprint).toMatch(/^[0-9a-f]{12}$/);
    expect(sk011[0]!.message).toContain(sk011[0]!.fingerprint!);
    expect(json).not.toContain(key);
  });

  it('skips binary files (a NUL byte in the first 8000 bytes)', () => {
    const result = lint({
      files: { 'references/guide.md': 'x\n', 'assets/blob.bin': `\u0000AKIAABCDEFGHIJKLMNOP` },
    });
    expect(rules(result.findings, 'SK-011')).toEqual([]);
  });
});

describe('prose rules (SK-012 to SK-018)', () => {
  it('SK-013: blocks shouted words', () => {
    expect(rules(lint({ body: `${BODY}\nNEVER skip this.\n` }).findings, 'SK-013')).toHaveLength(1);
    expect(rules(lint({ body: `${BODY}\nNever skip this.\n` }).findings, 'SK-013')).toEqual([]);
  });

  it('SK-014: blocks an options list with no default and accepts one with a default', () => {
    const list = '\nYou can pick:\n- a\n- b\n- c\n';
    expect(rules(lint({ body: `${BODY}${list}` }).findings, 'SK-014')).toHaveLength(1);
    expect(rules(lint({ body: `${BODY}${list}Default: a.\n` }).findings, 'SK-014')).toEqual([]);
    expect(rules(lint({ body: `${BODY}\nYou can pick:\n- a\n- b\n` }).findings, 'SK-014')).toEqual(
      [],
    );
  });

  it('SK-015: blocks time-sensitive wording without a year', () => {
    expect(
      rules(lint({ body: `${BODY}\nUse the latest version.\n` }).findings, 'SK-015'),
    ).toHaveLength(1);
    expect(
      rules(lint({ body: `${BODY}\nUse the latest version as of 2026.\n` }).findings, 'SK-015'),
    ).toEqual([]);
  });

  it('AC-24: blocks an em dash in any file with file and line', () => {
    const result = lint({
      files: { 'references/guide.md': 'one\ntwo \u2014 three\n', 'assets/t.txt': '\u2014\n' },
    });
    expect(rules(result.findings, 'SK-016').map((finding) => [finding.file, finding.line])).toEqual(
      [
        ['assets/t.txt', 1],
        ['references/guide.md', 2],
      ],
    );
  });

  it('SK-017: blocks dates, placeholders and counters, but not a verification line', () => {
    const body = `${BODY}\nRan on 2026-10-31.\nInsert {{now}} here.\nSee run #3.\n`;
    expect(rules(lint({ body }).findings, 'SK-017').map((finding) => finding.line)).toEqual([
      16, 17, 18,
    ]);
    const verified = lint({ files: { 'references/guide.md': 'human-verified: 2026-10-31\n' } });
    expect(rules(verified.findings, 'SK-017')).toEqual([]);
    const frontmatterDate = lint({
      frontmatter: `name: ${NAME}\ndescription: ${DESCRIPTION}\nversion: 2026-10-31\n`,
    });
    expect(rules(frontmatterDate.findings, 'SK-017')).toEqual([]);
  });

  it('SK-018: blocks a long reference with no table of contents', () => {
    const long = `${'line\n'.repeat(101)}`;
    expect(rules(lint({ files: { 'references/guide.md': long } }).findings, 'SK-018')).toHaveLength(
      1,
    );
    const withToc = `## Contents\n- [A](#a)\n${long}`;
    expect(rules(lint({ files: { 'references/guide.md': withToc } }).findings, 'SK-018')).toEqual(
      [],
    );
  });
});

describe('usage errors', () => {
  it('refuses a missing folder or a folder with no SKILL.md', () => {
    const { root } = skill();
    expect(() => lintSkillFolder(join(root, 'nope'), { projectRoot: root })).toThrow(
      SkillLintUsageError,
    );
    mkdirSync(join(root, 'empty'));
    expect(() => lintSkillFolder(join(root, 'empty'), { projectRoot: root })).toThrow(
      /no SKILL.md/,
    );
  });
});

describe('AC-64: speed', () => {
  it('lints a generated 500-line skill with references and scripts within 10 s', () => {
    const lines = Array.from({ length: 480 }, (_, i) => `${i + 1}. Step ${i + 1} groups one area.`);
    const files: Record<string, string> = {
      'references/guide.md': `## Contents\n- [A](#a)\n${'Label by area.\n'.repeat(400)}`,
    };
    for (let i = 0; i < 10; i += 1)
      files[`scripts/step-${i}.ts`] = `// --help\n${'export {};\n'.repeat(200)}`;
    const started = performance.now();
    const result = lint({ body: `${BODY}${lines.join('\n')}\n`, files });
    expect(performance.now() - started).toBeLessThan(10_000);
    expect(result.skill).toBe(NAME);
  });
});

describe('paqad-ai skill lint', () => {
  async function run(...args: string[]): Promise<{ out: string; errors: string[] }> {
    let out = '';
    const errors: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      out += String(chunk);
      return true;
    });
    vi.spyOn(console, 'log').mockImplementation((line: string) => {
      out += `${line}\n`;
    });
    vi.spyOn(console, 'error').mockImplementation((line: string) => {
      errors.push(line);
    });
    await createSkillCommand().parseAsync(['lint', ...args], { from: 'user' });
    return { out, errors };
  }

  it('exits 0 on a clean skill and prints the summary line', async () => {
    const { root, folder } = skill();
    const { out } = await run(folder, '--project-root', root);
    expect(process.exitCode).toBe(0);
    expect(out).toContain('drafting-notes: no blocking findings');
  });

  it('exits 1 with a blocking finding and prints JSON with --json', async () => {
    const { root, folder } = skill({ body: `${BODY}\nFollow best practices.\n` });
    const { out } = await run(folder, '--json', '--project-root', root);
    expect(process.exitCode).toBe(1);
    expect(JSON.parse(out)).toMatchObject({ skill: NAME, blocking: 1 });
  });

  it('exits 2 on a usage error', async () => {
    const { root } = skill();
    const { errors } = await run(join(root, 'nope'), '--project-root', root);
    expect(process.exitCode).toBe(2);
    expect(errors.join('\n')).toContain('is not a folder');
  });
});

describe('paqad runtime skills', () => {
  it("allows the paqad runtime loader's documented fields only for a runtime skill in the paqad repo", () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-skill-lint-runtime-'));
    roots.push(root);
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'paqad-ai' }));
    const frontmatter = `---\nname: ${NAME}\ndescription: ${DESCRIPTION}\nmodel_tier: fast\ncacheable: false\n---\n${BODY}`;
    for (const base of ['runtime/base/skills', '.claude/skills']) {
      write(join(root, base, NAME), 'SKILL.md', frontmatter);
      write(join(root, base, NAME), 'references/guide.md', 'guide\n');
    }
    const runtime = lintSkillFolder(join(root, 'runtime/base/skills', NAME), { projectRoot: root });
    expect(rules(runtime.findings, 'SK-006')).toEqual([]);
    const host = lintSkillFolder(join(root, '.claude/skills', NAME), { projectRoot: root });
    expect(rules(host.findings, 'SK-006').map((finding) => finding.message)).toEqual([
      'The frontmatter key "model_tier" is not a documented skill field.',
      'The frontmatter key "cacheable" is not a documented skill field.',
    ]);
  });
});
