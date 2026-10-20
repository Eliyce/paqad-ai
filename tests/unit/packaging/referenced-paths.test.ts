import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import fg from 'fast-glob';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createProgram } from '@/cli/program.js';
import { runCapabilityGate } from '@/kernel/gate.js';

const REPO_ROOT = resolve(__dirname, '../../..');

const PATH = String.raw`(?:\.{1,2}\/)*((?:[A-Za-z0-9._-]+\/)+[A-Za-z0-9._-]+\.(?:ts|mjs|cjs|js|sh))(?![\w.])`;

const RUN_CONTEXTS = [
  new RegExp(String.raw`(?:npx\s+tsx|npx|node|bash|tsx|\bsh)\s+(?:[A-Z_]+=\S*\s+)*${PATH}`, 'g'),
  new RegExp(String.raw`\brun\s+\x60(?:[A-Z_]+=\S*\s+)*${PATH}`, 'g'),
];

const CLI_VERB = /\bpaqad-ai\s+([a-z][a-z-]+)/g;

function pathTokens(text: string): string[] {
  const out: string[] = [];
  for (const pattern of RUN_CONTEXTS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      out.push(match[1]);
    }
  }
  return out;
}

function cliVerbs(text: string): string[] {
  const out: string[] = [];
  CLI_VERB.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CLI_VERB.exec(text)) !== null) {
    out.push(match[1]);
  }
  return out;
}

function brokenReference(token: string, baseDir?: string): string | null {
  if (token.startsWith('.paqad/') || token.startsWith('docs/')) {
    return null;
  }
  if (token.startsWith('runtime/')) {
    return existsSync(join(REPO_ROOT, token)) ? null : token;
  }
  if (token.startsWith('dist/')) {
    const src = token.replace(/^dist\//, 'src/').replace(/\.(m?js|cjs)$/, '.ts');
    return existsSync(join(REPO_ROOT, src)) || existsSync(join(REPO_ROOT, token)) ? null : token;
  }
  if (token.startsWith('src/')) {
    return existsSync(join(REPO_ROOT, token)) ? null : token;
  }
  if (baseDir && existsSync(join(baseDir, token))) {
    return null;
  }
  return token;
}

function stripHtmlComments(text: string): string {
  return text.replace(/<!--[\s\S]*?-->/g, '');
}

describe('the guardrail itself catches the historical unshipped-path shapes', () => {
  it('flags the old gate-message remediation (npx tsx scripts/se-mark.ts)', () => {
    const oldMessage =
      'Mark it: `SE_SESSION= npx tsx scripts/se-mark.ts start planning` then `… end planning`.';
    const broken = pathTokens(oldMessage).map((token) => brokenReference(token));
    expect(broken).toContain('scripts/se-mark.ts');
  });

  it('flags the old bootstrap remediation (run `scripts/se-mark.ts …`)', () => {
    const oldBootstrap =
      'or run `scripts/se-mark.ts start <stage>` / `end <stage>` for an immediate mark';
    const broken = pathTokens(oldBootstrap).map((token) => brokenReference(token));
    expect(broken).toContain('scripts/se-mark.ts');
  });
});

describe('packaging truth — user-facing remediation surfaces', () => {
  const registeredVerbs = new Set(createProgram().commands.map((command) => command.name()));

  function expectSurfaceIsHonest(surface: string, rawText: string, baseDir?: string): void {
    const text = stripHtmlComments(rawText);
    const broken = pathTokens(text)
      .map((token) => brokenReference(token, baseDir))
      .filter((token): token is string => token !== null);
    expect(broken, `${surface} references paths that ship nowhere: ${broken.join(', ')}`).toEqual(
      [],
    );

    const unknownVerbs = cliVerbs(text).filter((verb) => !registeredVerbs.has(verb));
    expect(
      unknownVerbs,
      `${surface} names paqad-ai verbs that do not exist: ${unknownVerbs.join(', ')}`,
    ).toEqual([]);
  }

  describe('the live stages block message', () => {
    let root: string;
    beforeEach(() => {
      root = mkdtempSync(join(tmpdir(), 'paqad-pkg-truth-'));
      mkdirSync(join(root, '.paqad'), { recursive: true });
    });
    afterEach(() => rmSync(root, { recursive: true, force: true }));

    it('names only remediations that exist for an onboarded project', async () => {
      const result = await runCapabilityGate({ projectRoot: root, seam: 'pre-mutation' });
      expect(result.block).toBe(true);
      expectSurfaceIsHonest('stages block message', result.summary);
    });
  });

  it('the shipped framework bootstrap gate is honest', () => {
    const bootstrap = readFileSync(join(REPO_ROOT, 'runtime/AGENT-BOOTSTRAP.md'), 'utf8');
    expectSurfaceIsHonest('runtime/AGENT-BOOTSTRAP.md', bootstrap);
  });

  it('the shipped framework router is honest', () => {
    const router = readFileSync(join(REPO_ROOT, 'runtime/AGENT-ROUTER.md'), 'utf8');
    expectSurfaceIsHonest('runtime/AGENT-ROUTER.md', router);
  });

  it('every shipped skill doc is honest', () => {
    const docs = fg.sync(
      ['runtime/base/skills/**/SKILL.md', 'runtime/base/skills/**/references/**/*.md'],
      { cwd: REPO_ROOT },
    );
    expect(docs.length).toBeGreaterThan(0);
    for (const doc of docs) {
      const skillRoot = doc.replace(/(runtime\/base\/skills\/[^/]+)\/.*$/, '$1');
      expectSurfaceIsHonest(
        doc,
        readFileSync(join(REPO_ROOT, doc), 'utf8'),
        join(REPO_ROOT, skillRoot),
      );
    }
  });
});
