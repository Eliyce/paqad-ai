import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import fg from 'fast-glob';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createProgram } from '@/cli/program.js';
import { runCapabilityGate } from '@/kernel/gate.js';

// Packaging truth (issue #307). The stages gate used to tell every onboarded
// project to run `scripts/se-mark.ts` — a file that only ever existed in this dev
// repo: not in the npm `files` allowlist, not seeded at onboarding. Agents followed
// the message verbatim into a dead end, and the advertised same-turn unblock was
// impossible. This suite pins the invariant that would have caught it: every
// runnable path or CLI verb named by a user-facing remediation surface must
// actually resolve on the machine of the user reading it.
//
// Surfaces checked:
//   1. The LIVE block message the stages gate emits (rendered via the real kernel).
//   2. The shipped framework bootstrap (runtime/AGENT-BOOTSTRAP.md — generated).
//   3. The shipped skills' docs (runtime/base/skills/**/*.md).
//
// Resolution rules: `runtime/**` and `dist/**` ship with the package (`dist` is
// checked against its `src` source so the suite is build-independent); `.paqad/**`
// and `docs/**` are created in the project by onboarding; anything else
// repo-relative (like `scripts/…`) ships nowhere and is a broken promise.

const REPO_ROOT = resolve(__dirname, '../../..');

/** A path token: something/with/slashes.ext (not part of a longer token). */
const PATH = String.raw`(?:\.{1,2}\/)*((?:[A-Za-z0-9._-]+\/)+[A-Za-z0-9._-]+\.(?:ts|mjs|cjs|js|sh))(?![\w.])`;

/** Paths in a RUN context — a runner command (with optional VAR= prefixes), or a
 *  "run `path …`" instruction. Prose and payload examples don't match; a path the
 *  reader is told to execute does. Both #307 surfaces match these shapes. */
const RUN_CONTEXTS = [
  new RegExp(String.raw`(?:npx\s+tsx|npx|node|bash|tsx|\bsh)\s+(?:[A-Z_]+=\S*\s+)*${PATH}`, 'g'),
  new RegExp(String.raw`\brun\s+\x60(?:[A-Z_]+=\S*\s+)*${PATH}`, 'g'),
];

/** `paqad-ai <verb>` mentions (optionally via npx). */
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

/** Where a referenced path must exist for the reader of the message. `baseDir`
 *  is the directory of the doc making the reference — a skill doc may name its
 *  own bundled scripts relative to itself (they ship inside `runtime/`). */
function brokenReference(token: string, baseDir?: string): string | null {
  if (token.startsWith('.paqad/') || token.startsWith('docs/')) {
    return null; // project-side artifacts, created by onboarding / at runtime
  }
  if (token.startsWith('runtime/')) {
    return existsSync(join(REPO_ROOT, token)) ? null : token;
  }
  if (token.startsWith('dist/')) {
    // Build-independent: a dist artifact must have a src source.
    const src = token.replace(/^dist\//, 'src/').replace(/\.(m?js|cjs)$/, '.ts');
    return existsSync(join(REPO_ROOT, src)) || existsSync(join(REPO_ROOT, token)) ? null : token;
  }
  if (token.startsWith('src/')) {
    // Provenance pointer ("the writer lives in src/…") — fine for the repo
    // reader, but it must not go stale.
    return existsSync(join(REPO_ROOT, token)) ? null : token;
  }
  if (baseDir && existsSync(join(baseDir, token))) {
    return null; // bundled next to the doc that names it — ships with the package
  }
  // Anything else repo-relative (scripts/…, tools/…) is not in the npm `files`
  // allowlist and not seeded into projects: referencing it is the #307 bug class.
  return token;
}

/** Markdown HTML comments are maintainer notes, invisible to the rendered reader. */
function stripHtmlComments(text: string): string {
  return text.replace(/<!--[\s\S]*?-->/g, '');
}

describe('the guardrail itself catches the historical #307 shapes', () => {
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

describe('packaging truth — user-facing remediation surfaces (issue #307)', () => {
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
      expect(result.block).toBe(true); // sanity: we are checking the real message
      expectSurfaceIsHonest('stages block message', result.summary);
    });
  });

  it('the shipped framework bootstrap is honest', () => {
    const bootstrap = readFileSync(join(REPO_ROOT, 'runtime/AGENT-BOOTSTRAP.md'), 'utf8');
    expectSurfaceIsHonest('runtime/AGENT-BOOTSTRAP.md', bootstrap);
  });

  it('every shipped skill doc is honest', () => {
    // SKILL.md + references are instructions an agent follows; `assets/` are
    // output templates full of placeholder examples, not remediation surfaces.
    const docs = fg.sync(
      ['runtime/base/skills/**/SKILL.md', 'runtime/base/skills/**/references/**/*.md'],
      { cwd: REPO_ROOT },
    );
    expect(docs.length).toBeGreaterThan(0);
    for (const doc of docs) {
      // A skill may reference its own bundled scripts relative to the skill dir
      // (SKILL.md) — resolve against the skill root, not the reference subdir.
      const skillRoot = doc.replace(/(runtime\/base\/skills\/[^/]+)\/.*$/, '$1');
      expectSurfaceIsHonest(
        doc,
        readFileSync(join(REPO_ROOT, doc), 'utf8'),
        join(REPO_ROOT, skillRoot),
      );
    }
  });
});
