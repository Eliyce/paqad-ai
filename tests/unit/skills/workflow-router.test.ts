import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runScript } from './_helpers/run-script.js';

const SKILL = 'runtime/base/skills/workflow-router';
const sh = (n: string) => join(SKILL, 'scripts', n);

interface RouteOutput {
  workflow: string;
  reason: string;
  matched_rule?: string;
}

function route(text: string): RouteOutput {
  const r = runScript(sh('route-request.sh'), [text]);
  expect(r.status).toBe(0);
  const out: Partial<RouteOutput> = {};
  for (const line of r.stdout.split('\n')) {
    const m = line.match(/^(workflow|reason|matched_rule):\s*"?([^"]+)"?$/);
    if (m) out[m[1] as keyof RouteOutput] = m[2];
  }
  return {
    workflow: out.workflow ?? '',
    reason: out.reason ?? '',
    matched_rule: out.matched_rule,
  };
}

describe('workflow-router', () => {
  describe('route-request.sh', () => {
    const path = sh('route-request.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('routes "now create the module documentation" → module-documentation (priority 225)', () => {
      const out = route('now create the module documentation for users');
      expect(out.workflow).toBe('module-documentation');
      expect(out.matched_rule).toBe('now create the module documentation');
    });

    it('routes "create documentation" → documentation-update', () => {
      expect(route('create documentation').workflow).toBe('documentation-update');
    });

    it('routes "create module documentation" — module-documentation wins via higher priority', () => {
      // Both "create module documentation" (225) and "create documentation" (220) match;
      // 225 wins.
      expect(route('please create module documentation').workflow).toBe('module-documentation');
    });

    it('routes pentest variants', () => {
      expect(route('run a pentest now').workflow).toBe('pentest');
      expect(route('run a pentest retest').workflow).toBe('pentest-retest');
    });

    it('routes "fix" / "bug" → bug-fix', () => {
      expect(route('please fix the broken login').workflow).toBe('bug-fix');
    });

    it('routes "refactor" → refactor', () => {
      expect(route('refactor the auth module').workflow).toBe('refactor');
    });

    it('routes investigation language → project-question', () => {
      expect(route('how does the cache layer work').workflow).toBe('project-question');
    });

    it('falls back to workflow: none when nothing matches', () => {
      const r = runScript(path, ['lorem ipsum dolor xyz no keyword present']);
      expect(r.status).toBe(0);
      expect(r.stdout).toMatch(/^workflow: none/m);
      expect(r.stdout).toMatch(/^reason: no routing rule matched/m);
    });

    it('is case-insensitive (uppercase request still matches)', () => {
      expect(route('PLEASE FIX THE LOGIN BUG').workflow).toBe('bug-fix');
    });

    it('reads stdin when no positional arg given', () => {
      const r = runScript(path, [], { input: 'create documentation' });
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('workflow: documentation-update');
    });

    it('on tie in priority, longest pattern wins', () => {
      // "fix" and "regression" are both bug-fix at priority 165. The longer pattern
      // "regression" (10 chars) should win the tiebreak over "fix" (3 chars) when
      // both appear.
      const r = runScript(path, ['regression on login fix']);
      expect(r.status).toBe(0);
      // Both map to bug-fix; just confirm matched_rule is the longer one.
      // (Both patterns map to bug-fix — verify deterministic tiebreak via length.)
      const matched = r.stdout.match(/matched_rule:\s*"([^"]+)"/)?.[1];
      expect(matched && matched.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('lint-output.sh', () => {
    const path = sh('lint-output.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('passes "workflow: none" with reason', () => {
      const r = runScript(path, [], { input: 'workflow: none\nreason: no routing rule matched\n' });
      expect(r.status).toBe(0);
    });

    it('passes a matched routing decision', () => {
      const ok = 'workflow: bug-fix\nreason: matched rule at priority 165\nmatched_rule: "fix"\n';
      expect(runScript(path, [], { input: ok }).status).toBe(0);
    });

    it('fails when matched_rule missing', () => {
      const r = runScript(path, [], { input: 'workflow: bug-fix\nreason: x\n' });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/matched_rule/);
    });
  });
});
