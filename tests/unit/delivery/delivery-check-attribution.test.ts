import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { ResolvedDeliveryPolicy } from '@/core/types/delivery-policy.js';
import {
  evaluateDelivery,
  formatDeliverySummary,
  runDeliveryCapability,
  type CommandRun,
  type CommandRunner,
} from '@/delivery/delivery-check.js';
import { defaultDeliveryPolicy } from '@/pipeline/delivery-policy.js';

const CLAUDE_TRAILER = 'Co-Authored-By: Claude <noreply@anthropic.com>';
const CURSOR_TRAILER = 'Co-authored-by: Cursor <cursoragent@cursor.com>';

function makeProject(files: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-attr-delivery-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, content);
  }
  return root;
}

function policy(): ResolvedDeliveryPolicy {
  const base = defaultDeliveryPolicy();
  return {
    enabled: true,
    process: { ...base.process, branch: { ...base.process.branch, base: 'main' } },
  };
}

/**
 * A runner that answers the four calls evaluateDelivery makes: current branch, HEAD sha,
 * the branch's commit messages, and `gh pr view`.
 */
function runner(over: { branch?: string; log?: string; prBody?: string | null }): CommandRunner {
  return async (command, args): Promise<CommandRun> => {
    if (command === 'git' && args.includes('--abbrev-ref')) {
      return { stdout: over.branch ?? 'feat/thing', exitCode: 0 };
    }
    if (command === 'git' && args.includes('log')) {
      return { stdout: over.log ?? '', exitCode: 0 };
    }
    if (command === 'git') {
      return { stdout: 'abc123', exitCode: 0 };
    }
    if (over.prBody === null || over.prBody === undefined) {
      return { stdout: '', exitCode: 1 }; // gh absent / no PR yet
    }
    return { stdout: JSON.stringify({ number: 7, body: over.prBody }), exitCode: 0 };
  };
}

function attributionFindings(result: { findings: { code: string; message: string }[] }) {
  return result.findings.filter((finding) => finding.code === 'ai-attribution');
}

describe('delivery backstop — AI attribution (issue #538)', () => {
  // AC-9
  it('warns when a vendor trailer is on the branch commits', async () => {
    const result = await evaluateDelivery({
      projectRoot: makeProject(),
      policy: policy(),
      run: runner({ log: `feat: thing\n\n${CLAUDE_TRAILER}\n` }),
    });
    const findings = attributionFindings(result);
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('Claude Code');
    expect(findings[0].message).toContain('your commits');
  });

  // AC-9 — the remediation is the useful half, especially for a vendor paqad cannot configure.
  it('hands back the vendor-specific fix for a vendor paqad does not configure', async () => {
    const result = await evaluateDelivery({
      projectRoot: makeProject(),
      policy: policy(),
      run: runner({ log: `feat: thing\n\n${CURSOR_TRAILER}\n` }),
    });
    expect(attributionFindings(result)[0].message).toContain('~/.cursor/cli-config.json');
  });

  it('warns when the trailer is only in the PR body', async () => {
    const result = await evaluateDelivery({
      projectRoot: makeProject(),
      policy: policy(),
      run: runner({ log: 'feat: clean commit\n', prBody: `## Summary\n\n${CLAUDE_TRAILER}` }),
    });
    expect(attributionFindings(result)[0].message).toContain('the PR body');
  });

  it('says so when the trailer is in both places', async () => {
    const result = await evaluateDelivery({
      projectRoot: makeProject(),
      policy: policy(),
      run: runner({ log: CLAUDE_TRAILER, prBody: CLAUDE_TRAILER }),
    });
    expect(attributionFindings(result)[0].message).toContain('your commits and the PR body');
  });

  it('reports one finding per vendor when a squashed branch carries several', async () => {
    const result = await evaluateDelivery({
      projectRoot: makeProject(),
      policy: policy(),
      run: runner({ log: `${CLAUDE_TRAILER}\n${CURSOR_TRAILER}\n` }),
    });
    expect(attributionFindings(result)).toHaveLength(2);
  });

  // AC-10
  it('says nothing when the branch and PR body are clean', async () => {
    const result = await evaluateDelivery({
      projectRoot: makeProject(),
      policy: policy(),
      run: runner({ log: 'feat(#1): a clean commit\n', prBody: '## Summary\n\nAll good.' }),
    });
    expect(attributionFindings(result)).toEqual([]);
  });

  // AC-8 / INV-2 — the footer paqad itself writes into every PR body must never trip this.
  it("never trips on paqad's own delivery footer in the PR body", async () => {
    const result = await evaluateDelivery({
      projectRoot: makeProject(),
      policy: policy(),
      run: runner({
        log: 'feat: thing\n',
        prBody: '## Summary\n\n🤖 Generated with paqad-ai delivery',
      }),
    });
    expect(attributionFindings(result)).toEqual([]);
  });

  // AC-12
  it('scans nothing when the policy says keep', async () => {
    const root = makeProject({ '.paqad/configs/.config.policy': 'ai_attribution=keep' });
    const result = await evaluateDelivery({
      projectRoot: root,
      policy: policy(),
      run: runner({ log: `feat: thing\n\n${CLAUDE_TRAILER}\n` }),
    });
    expect(attributionFindings(result)).toEqual([]);
  });

  it('scans the last commit when the developer is sitting on the base branch', async () => {
    const result = await evaluateDelivery({
      projectRoot: makeProject(),
      policy: policy(),
      run: runner({ branch: 'main', log: `chore: oops\n\n${CLAUDE_TRAILER}\n` }),
    });
    expect(attributionFindings(result)).toHaveLength(1);
  });

  it('stays quiet rather than warning about git when the log call fails', async () => {
    const run: CommandRunner = async (command, args) => {
      if (command === 'git' && args.includes('--abbrev-ref')) {
        return { stdout: 'feat/thing', exitCode: 0 };
      }
      if (command === 'git' && args.includes('log')) {
        return { stdout: 'garbage on stderr', exitCode: 128 };
      }
      return { stdout: '', exitCode: 1 };
    };
    const result = await evaluateDelivery({ projectRoot: makeProject(), policy: policy(), run });
    expect(attributionFindings(result)).toEqual([]);
  });

  it('renders through the existing warn block', () => {
    const summary = formatDeliverySummary({
      ran: true,
      branch: 'feat/thing',
      commit: 'abc123',
      ghAvailable: false,
      findings: [
        { code: 'ai-attribution', message: 'Claude Code attribution is on your commits.' },
      ],
    });
    expect(summary).toContain('▸ paqad');
    expect(summary).toContain('🟡');
    expect(summary).toContain('Claude Code attribution');
  });

  // AC-11 / INV-3 — the whole check is advisory. It must never hold up a change.
  it('never blocks', async () => {
    const outcome = await runDeliveryCapability(
      makeProject(),
      'completion',
      runner({ log: `feat: thing\n\n${CLAUDE_TRAILER}\n` }),
    );
    expect(outcome.ran).toBe(true);
    expect(outcome.blocking).toBe(false);
    expect(outcome.summary).toContain('Claude Code');
  });
});
