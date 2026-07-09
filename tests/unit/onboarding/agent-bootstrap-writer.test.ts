import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildAgentBootstrapDocument } from '@/onboarding/agent-bootstrap-writer.js';
import { buildDecisionPauseContractBody } from '@/onboarding/decision-pause-contract-writer.js';
import { buildNarrationContractBody } from '@/onboarding/narration-contract-writer.js';
import { DECISION_PAUSE_UI_NOTES } from '@/adapters/shared/decision-pause-ui-shim.js';

// The committed install asset. It ships under runtime/ and is reached via the
// ~/.paqad-ai/current symlink — this golden test keeps it byte-identical to the
// builder. Regenerate with: pnpm vitest run agent-bootstrap-writer -u
const COMMITTED_BOOTSTRAP = resolve(process.cwd(), 'runtime/AGENT-BOOTSTRAP.md');

describe('agent bootstrap document', () => {
  it('matches the committed runtime/AGENT-BOOTSTRAP.md (golden)', async () => {
    await expect(buildAgentBootstrapDocument()).toMatchFileSnapshot(COMMITTED_BOOTSTRAP);
  });

  it('orders the steps: enablement → route → load → sentinel (#336)', () => {
    const doc = buildAgentBootstrapDocument();
    const enablement = doc.indexOf('## 1. Enablement check');
    const route = doc.indexOf('## 2. Route first');
    const load = doc.indexOf('## 3. Load only what the routed workflow needs');
    const sentinel = doc.indexOf('## 4. Confirm the load');
    expect(enablement).toBeGreaterThan(-1);
    expect(route).toBeGreaterThan(enablement);
    expect(load).toBeGreaterThan(route);
    expect(sentinel).toBeGreaterThan(load);
  });

  it('routes first: names the 9 workflows and the read-first / ask-if-torn rules (#336)', () => {
    const doc = buildAgentBootstrapDocument();
    const route = doc.slice(
      doc.indexOf('## 2. Route first'),
      doc.indexOf('## 3. Load only what the routed workflow needs'),
    );
    for (const workflow of [
      'feature-development',
      'project-question',
      'documentation-update',
      'module-documentation',
      'pentest',
      'design-test',
      'rules-analyze',
      'root-cause-analysis',
      'no workflow',
    ]) {
      expect(route).toContain(workflow);
    }
    expect(route).toContain('Any code change is feature-development');
    expect(route).toMatch(/read or fetch it first/i);
    expect(route).toContain('AskUserQuestion');
    // Per-message + pause/resume, never reset.
    expect(route).toContain('Switching pauses');
    expect(route).toContain('New work is not a resume');
  });

  it('encodes the exact enablement precedence + token set (no new read surface)', () => {
    const doc = buildAgentBootstrapDocument();
    // Hard override first, then the layered paqad_enable surfaces, default ON.
    expect(doc).toContain('PAQAD_DISABLED');
    expect(doc).toContain('PAQAD_ENABLE');
    expect(doc).toContain('`.paqad/.config`');
    expect(doc).toContain('`.paqad/configs/.config.app`');
    expect(doc).toContain('⇒ ON');
    // The falsy token set must match framework-config.ts FALSY = {0,false,no,off}.
    expect(doc).toContain('`false`, `0`, `no`, or `off`');
  });

  it('tells a disabled session to load nothing and behave as a normal assistant', () => {
    const doc = buildAgentBootstrapDocument();
    expect(doc).toMatch(/If paqad resolves to OFF:[\s\S]*Load no `docs\/instructions`/);
    expect(doc).toMatch(/no `docs\/modules`/);
    expect(doc).toMatch(/act as a normal assistant/);
  });

  it('always-loads stack/design-system/workflows but gates rules to feature-development (#336)', () => {
    // Regression guard: stack, design-system, and the feature-development +
    // delivery-policy workflows stay in the always-load contract. Rules move OUT
    // of the unconditional load — they load only on the feature-development route
    // (issue #336) — but the section must still name the artifact-first mechanism.
    const doc = buildAgentBootstrapDocument();
    const loadSection = doc.slice(
      doc.indexOf('## 3. Load only what the routed workflow needs'),
      doc.indexOf('### Workflow handling'),
    );
    expect(loadSection).toContain('`docs/instructions/stack`');
    expect(loadSection).toContain('`docs/instructions/design-system`');
    expect(loadSection).toContain('`docs/instructions/workflows`');
    // Rules are present but explicitly feature-development-only, not unconditional.
    expect(loadSection).toContain('Rules load only for `feature-development`');
    expect(loadSection).toContain('`docs/instructions/rules`');
    expect(loadSection).toContain('run **no** rule-scripts');
  });

  it('preserves the workflow-handling trigger (create documentation / feature workflows)', () => {
    // Relocated verbatim from the entry-file templates (issue #229). Without this,
    // an enabled agent would stop treating `create documentation` as a Paqad
    // workflow and would ask for a document type instead.
    const doc = buildAgentBootstrapDocument();
    expect(doc).toContain('### Workflow handling');
    expect(doc).toContain('`create documentation`');
    expect(doc).toContain(
      'Do not ask the user to choose a document type when a Paqad workflow already matches the request.',
    );
  });

  it('carries the FULL narration contract inline', () => {
    const doc = buildAgentBootstrapDocument();
    expect(doc).toContain(buildNarrationContractBody());
    expect(doc).toContain('# paqad narration contract');
    expect(doc).toContain('## Plain-English translations');
  });

  it('carries the FULL decision-pause contract inline, incl. the per-adapter table', () => {
    const doc = buildAgentBootstrapDocument();
    expect(doc).toContain(buildDecisionPauseContractBody());
    expect(doc).toContain('# Decision Pause Contract');
    expect(doc).toContain('## Per-adapter UI');
  });

  it('keeps the Claude tray instruction (AskUserQuestion row) reachable', () => {
    const doc = buildAgentBootstrapDocument();
    // This row is what tells Claude Code to surface a pause via the tray.
    expect(doc).toContain(DECISION_PAUSE_UI_NOTES['claude-code']);
    expect(DECISION_PAUSE_UI_NOTES['claude-code']).toContain('AskUserQuestion');
    expect(doc).toContain('Adapter:');
  });
});
