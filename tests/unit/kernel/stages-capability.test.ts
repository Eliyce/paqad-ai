import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runCapabilityGate } from '@/kernel/gate.js';
import { endStage, openStageEvidence, startStage } from '@/stage-evidence/index.js';

// Block-forward (RCA fix B): the stages capability refuses a code edit at the
// pre-mutation seam until planning + specification carry a start+end pair in the
// ledger. Driven through the real kernel gate (runCapabilityGate), no mocks. The
// project has no rule-script map, so only the stages capability contributes.
describe('stages capability — block-forward at pre-mutation', () => {
  let root: string;
  const SES = 'ses_bf';

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-stages-cap-'));
    mkdirSync(join(root, '.paqad'), { recursive: true });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  /** Record a full start+end pair for each stage, in order, under the shared session. */
  function record(stages: string[]): void {
    const { ordinal } = openStageEvidence(root, { sessionId: SES, adapter: 'claude-code' });
    for (const stage of stages) {
      startStage(root, stage, { sessionId: SES, ordinal, adapter: 'claude-code' });
      endStage(root, stage, {}, { sessionId: SES, ordinal, adapter: 'claude-code' });
    }
  }

  function policy(body: string): void {
    mkdirSync(join(root, '.paqad/configs'), { recursive: true });
    writeFileSync(join(root, '.paqad/configs/.config.policy'), body);
  }

  it('BLOCKS the first edit (no change opened) asking for planning, strict by default', async () => {
    const result = await runCapabilityGate({ projectRoot: root, seam: 'pre-mutation' });
    expect(result.block).toBe(true);
    expect(result.summary).toContain('planning');
    expect(result.summary).toContain('Needs your attention');
  });

  it('BLOCKS on specification when planning is recorded but specification is not', async () => {
    record(['planning']); // planning start+end, nothing else
    const result = await runCapabilityGate({ projectRoot: root, seam: 'pre-mutation' });
    expect(result.block).toBe(true);
    expect(result.summary).toContain('specification');
  });

  it('ALLOWS the edit once planning + specification both have a start+end pair', async () => {
    record(['planning', 'specification']);
    const result = await runCapabilityGate({ projectRoot: root, seam: 'pre-mutation' });
    expect(result.block).toBe(false);
    expect(result.summary).toBe('');
  });

  it('does NOT block a planning stage that started but never ended (no pair yet)', async () => {
    const { ordinal } = openStageEvidence(root, { sessionId: SES, adapter: 'claude-code' });
    startStage(root, 'planning', { sessionId: SES, ordinal, adapter: 'claude-code' });
    const result = await runCapabilityGate({ projectRoot: root, seam: 'pre-mutation' });
    expect(result.block).toBe(true);
    expect(result.summary).toContain('planning');
  });

  it('WARN mode surfaces the missing stage but does not block', async () => {
    policy('stages_mode=warn\n');
    const result = await runCapabilityGate({ projectRoot: root, seam: 'pre-mutation' });
    expect(result.block).toBe(false);
    expect(result.summary).toContain('Heads up');
    expect(result.summary).toContain('planning');
  });

  it('OFF mode is a clean no-op', async () => {
    policy('stages_mode=off\n');
    const result = await runCapabilityGate({ projectRoot: root, seam: 'pre-mutation' });
    expect(result.block).toBe(false);
    expect(result.summary).toBe('');
  });

  it('no-ops at the COMPLETION seam (finalize path owns completion — no double-fire)', async () => {
    // No change opened: at pre-mutation this blocks, but at completion the stages
    // capability must stay silent so it never double-fires with finalize/verify.
    const result = await runCapabilityGate({ projectRoot: root, seam: 'completion' });
    expect(result.block).toBe(false);
    expect(result.summary).toBe('');
  });

  it('is immune to the committed-clean-tree nullifier (reads the ledger, not a git delta)', async () => {
    // There is no working tree here at all — the gate still blocks purely from the
    // ledger state, which is the structural fix vs the Stop-path changedFileCount<=0.
    const result = await runCapabilityGate({ projectRoot: root, seam: 'pre-mutation' });
    expect(result.block).toBe(true);
  });
});
