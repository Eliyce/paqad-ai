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

  it('puts the enablement check first — before any load step', () => {
    const doc = buildAgentBootstrapDocument();
    const enablement = doc.indexOf('## 1. Enablement check');
    const load = doc.indexOf('## 2. Load the project contract');
    const sentinel = doc.indexOf('## 3. Confirm the load');
    expect(enablement).toBeGreaterThan(-1);
    expect(load).toBeGreaterThan(enablement);
    expect(sentinel).toBeGreaterThan(load);
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
