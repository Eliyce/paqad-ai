import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import { currentFeature } from '@/feature-evidence/stage-ledger.js';
import { renderDefaultGitWorkflowFile } from '@/git-workflow/defaults.js';
import { GATE_NO_DESIGN_LINE } from '@/hld/copy.js';
import { emptyHldRecord, writeHld, type HldState } from '@/hld/store.js';
import { runCapabilityGate } from '@/kernel/gate.js';
import { endStage, openStageEvidence, startStage, type StageLane } from '@/stage-evidence/index.js';

const SES = 'ses_hld_gate';
const REF = ['PQD', '123'].join('-');
let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'paqad-hld-gate-'));
  mkdirSync(join(root, '.paqad/artifacts'), { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function openWithStages(lane: StageLane): string {
  const { ordinal } = openStageEvidence(root, { sessionId: SES, adapter: 'claude-code', lane });
  for (const stage of ['planning', 'specification'] as const) {
    startStage(root, stage, { sessionId: SES, ordinal, adapter: 'claude-code' });
    const rel = `.paqad/artifacts/${stage}.md`;
    writeFileSync(join(root, rel), `# ${stage}\n`);
    endStage(
      root,
      stage,
      { artifactPaths: [rel] },
      { sessionId: SES, ordinal, adapter: 'claude-code' },
    );
  }
  return currentFeature(root, SES)!;
}

function signOff(edit: (text: string) => string = (text) => text): void {
  mkdirSync(join(root, PATHS.GIT_WORKFLOW_DIR), { recursive: true });
  writeFileSync(
    join(root, PATHS.GIT_WORKFLOW_DIR, 'design-sign-off.yaml'),
    edit(renderDefaultGitWorkflowFile('design-sign-off.yaml')),
  );
}

const on = (text: string) => text.replace('enabled: false', 'enabled: true');

function record(dir: string, state: HldState): void {
  writeHld(root, dir, { ...emptyHldRecord(REF), state });
}

const gate = () =>
  runCapabilityGate({
    projectRoot: root,
    seam: 'pre-mutation',
    payload: { targetPath: join(root, 'src/feature.ts'), sessionId: SES },
  });

describe('design sign-off gate', () => {
  it('AC-1: the default file and no file give the same open verdict', async () => {
    openWithStages('full');
    const absent = await gate();
    signOff();
    const present = await gate();
    expect(present).toEqual(absent);
    expect(present.block).toBe(false);
  });

  it.each([['missing'], ['awaiting_sign_off'], ['changes_requested']] as const)(
    'AC-45: hld.json %s blocks the first source edit',
    async (state) => {
      const dir = openWithStages('full');
      signOff(on);
      if (state !== 'missing') record(dir, state);
      const result = await gate();
      expect(result.block).toBe(true);
    },
  );

  it.each([['approved'], ['skipped'], ['not_posted']] as const)(
    'AC-45: hld.json %s lets the edit through',
    async (state) => {
      const dir = openWithStages('full');
      signOff(on);
      record(dir, state);
      expect((await gate()).block).toBe(false);
    },
  );

  it('AC-45: a lane not listed or wait_for_approval false is a no-op', async () => {
    openWithStages('graduated');
    signOff((text) => on(text).replace('lanes: [graduated, full]', 'lanes: [full]'));
    expect((await gate()).block).toBe(false);
    signOff((text) => on(text).replace('wait_for_approval: true', 'wait_for_approval: false'));
    expect((await gate()).block).toBe(false);
  });

  it('AC-46: the block reason names check-approval and skip, or says to write the design first', async () => {
    const dir = openWithStages('full');
    signOff(on);
    expect((await gate()).summary).toBe(GATE_NO_DESIGN_LINE);
    expect(GATE_NO_DESIGN_LINE).toContain('Write it and record it first');
    record(dir, 'awaiting_sign_off');
    expect((await gate()).summary).toBe(
      `The high-level design for ${REF} is waiting for sign-off. Check for an answer with paqad-ai hld check-approval, or skip with paqad-ai hld skip --reason "<why>".`,
    );
  });

  it('AC-19: a direct write to hld.json or hld.md is blocked and names the hld verb', async () => {
    const dir = openWithStages('full');
    for (const file of ['hld.json', 'hld.md']) {
      const result = await runCapabilityGate({
        projectRoot: root,
        seam: 'pre-mutation',
        payload: {
          toolName: 'Write',
          targetPath: join(root, PATHS.FEATURE_EVIDENCE_DIR, dir, file),
          sessionId: SES,
        },
      });
      expect(result.block).toBe(true);
      expect(result.summary).toContain('`paqad-ai hld');
    }
  });
});
