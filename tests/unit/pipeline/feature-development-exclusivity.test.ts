import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { runCapabilityGate } from '@/kernel/gate.js';
import { compositionForRoute } from '@/pipeline/session-route.js';
import {
  ROUTED_WORKFLOWS,
  isFeatureDevelopmentRoute,
  type RoutedWorkflow,
} from '@/pipeline/routed-workflow.js';
import { runDecisionSelfArm } from '@/planning/decision-selfarm.js';
import { writeWorkflowState } from '@/pipeline/workflow-state.js';
import { resolveSessionId } from '@/rag-ledger/session.js';
import { assembleMap, scanAndEmbedIds } from '@/rule-scripts/analyzer.js';
import { applyRuleScriptMap } from '@/rule-scripts/apply.js';
import { upsertScriptEntry } from '@/rule-scripts/mutate.js';

// Issue #345 G6 — one exclusivity table proving that NONE of the four feature-development
// obligations fires on ANY other routed workflow: no rule slice, no module-doc retrieval
// enforcement, no rule-scripts, and no decision-pause self-arm. Every obligation is
// feature-development-only; this asserts that across all 8 non-feature-development outcomes.

const NON_FEATURE_DEV: RoutedWorkflow[] = ROUTED_WORKFLOWS.filter(
  (w) => w !== 'feature-development',
);

const roots: string[] = [];

function write(path: string, body: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body, 'utf8');
}

const SCRIPT = `// @paqad-rule-script
// rule_id: __RID__
// source: docs/instructions/rules/coding/q.md
// kind: deterministic
// scope: changed-files
// runtime: node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const { projectRoot, files } = JSON.parse(readFileSync(0, 'utf8'));
const findings = [];
for (const f of files) {
  const t = readFileSync(join(projectRoot, f), 'utf8');
  if (/\\bdebugger\\b/.test(t)) findings.push({ file: f, line: 1, message: 'debugger statement', severity: 'blocker' });
}
process.stdout.write(JSON.stringify({ rule_id: '__RID__', kind: 'deterministic', findings }));
`;

/** A project with a REAL armed rule-script and a violating file — so a route that would run
 *  rule-scripts WOULD block. Any route that does not block proves rule-scripts stayed off. */
function armedProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-exclusivity-'));
  roots.push(root);
  write(join(root, 'docs/instructions/rules/coding/q.md'), '- No debugger statements.\n');
  const scan = scanAndEmbedIds(root);
  const ruleId = scan.inventory[0].id;
  const scriptRel = '.paqad/scripts/rules/coding/q/001-no-debugger.mjs';
  write(join(root, scriptRel), SCRIPT.replaceAll('__RID__', ruleId));
  let map = assembleMap(
    scan.inventory,
    new Map([[ruleId, { id: ruleId, verifiability: { kind: 'deterministic' }, enforced_by: [] }]]),
    scan.rule_files_hash,
    null,
  );
  map = upsertScriptEntry(map, ruleId, {
    path: scriptRel,
    kind: 'deterministic',
    runtime: 'node',
    scope: 'changed-files',
    last_validated_at: '2026-05-29T00:00:00Z',
    fixtures_passed: true,
  });
  applyRuleScriptMap({
    projectRoot: root,
    map,
    via: 'test',
    event: { action: 'generate', rule_ids: [ruleId] },
  });
  write(join(root, '.paqad/configs/.config.policy'), 'rule_compliance=strict\nstages_mode=off\n');
  write(join(root, 'src/app.ts'), 'debugger;\n');
  return root;
}

const FORK = JSON.stringify({
  message: { role: 'user', content: 'Should I reuse the existing helper or create a new one?' },
});

afterEach(() => {
  while (roots.length > 0) {
    rmSync(roots.pop()!, { recursive: true, force: true });
  }
});

describe('feature-development exclusivity (#345 G6)', () => {
  it('feature-development is the ONLY route flagged for the heavy path', () => {
    expect(isFeatureDevelopmentRoute('feature-development')).toBe(true);
    expect(compositionForRoute({ workflow: 'feature-development', query: '' }).loadRules).toBe(
      true,
    );
    for (const workflow of NON_FEATURE_DEV) {
      expect(isFeatureDevelopmentRoute(workflow)).toBe(false);
    }
  });

  it.each(NON_FEATURE_DEV)(
    '%s composes NO rule slice (no rules, no module-doc enforcement)',
    (workflow) => {
      expect(compositionForRoute({ workflow, query: '' }).loadRules).toBe(false);
    },
  );

  it.each(NON_FEATURE_DEV)(
    '%s runs NO rule-scripts at the completion (checks) seam',
    async (workflow) => {
      const root = armedProject();
      const session = `sess-${workflow}`;
      writeWorkflowState(root, resolveSessionId(root, session), {
        active: { workflow },
        paused: [],
      });
      const result = await runCapabilityGate({
        projectRoot: root,
        seam: 'completion',
        payload: { sessionId: session },
      });
      // The armed script would block on the debugger violation IF rule-scripts ran.
      expect(result.block).toBe(false);
      expect(result.summary).toBe('');
    },
  );

  it.each(NON_FEATURE_DEV)('%s arms NO decision-pause self-arm by default', (workflow) => {
    const root = armedProject();
    const session = `sess-${workflow}`;
    writeWorkflowState(root, resolveSessionId(root, session), {
      active: { workflow },
      paused: [],
    });
    const out = runDecisionSelfArm({
      projectRoot: root,
      seam: 'pre-mutation',
      env: {}, // no opt-in — only feature-development would arm by default
      payload: { transcriptPath: '/t.jsonl', sessionId: session, targetPath: 'src/a.ts' },
      readTranscript: () => FORK,
    });
    expect(out.ran).toBe(false);
  });
});
