import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createSpecCommand } from '@/cli/commands/spec.js';
import { PATHS } from '@/core/constants/paths.js';
import { currentFeature, openFeatureChange } from '@/feature-evidence/stage-ledger.js';
import { renderDefaultGitWorkflowFile } from '@/git-workflow/defaults.js';
import { freezeNudge } from '@/hld/applies.js';
import { FREEZE_NEXT_LINE, FREEZE_NEXT_V2_LINE } from '@/hld/copy.js';
import { emptyHldRecord, writeHld } from '@/hld/store.js';

import { pinSpecPipelineOff } from '../../shared/spec-pipeline-off.js';

const SES = 'ses_freeze_hld';
const SPEC = [
  '# Widget spec',
  '',
  '## Functional requirements',
  '- FR-1: The widget renders a greeting.',
  '',
  '## Acceptance criteria',
  '- AC-1: given a name, when rendered, then it greets the name. (proof: automated)',
  '',
  '## Invariants',
  '- INV-1: The widget never throws on empty input.',
  '',
].join('\n');

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'paqad-freeze-hld-'));
  mkdirSync(join(root, '.paqad'), { recursive: true });
  pinSpecPipelineOff(root);
});

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
  rmSync(root, { recursive: true, force: true });
});

function signOff(text: string | null): void {
  const path = join(root, PATHS.GIT_WORKFLOW_DIR, 'design-sign-off.yaml');
  mkdirSync(join(root, PATHS.GIT_WORKFLOW_DIR), { recursive: true });
  if (text !== null) writeFileSync(path, text);
}

async function freeze(lane: 'fast' | 'graduated' | 'full'): Promise<string[]> {
  openFeatureChange(root, SES, {
    adapter: 'claude-code',
    title: 'Widget',
    ulid: '01JABCDEFGHJKMNPQRSTVWXYZ0',
    lane,
  });
  const path = join(root, 'spec.md');
  writeFileSync(path, SPEC);
  const out: string[] = [];
  vi.spyOn(console, 'log').mockImplementation((line: string) => out.push(String(line)));
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  await createSpecCommand().parseAsync(
    [
      'freeze',
      path,
      '--signed-off-by',
      'alice',
      '--confirm-invariants',
      '--session',
      SES,
      '--project-root',
      root,
    ],
    { from: 'user' },
  );
  return out.map((line) => line.replace(/"spec_hash":"[^"]+"/u, '').replace(/frozen_at[^,]*/u, ''));
}

const enabled = () =>
  renderDefaultGitWorkflowFile('design-sign-off.yaml').replace('enabled: false', 'enabled: true');

describe('spec freeze and design sign-off', () => {
  it('AC-6: enabled and the lane listed prints the design next line', async () => {
    signOff(enabled());
    const out = await freeze('full');
    expect(out).toContain(FREEZE_NEXT_LINE);
    expect(FREEZE_NEXT_LINE).toBe(
      '> - 🟡 next: write the high-level design. Run paqad-ai hld brief.',
    );
  });

  it('AC-6: a re-freeze after a change request asks for the design again as v2', () => {
    signOff(enabled());
    openFeatureChange(root, SES, { adapter: 'claude-code', title: 'Widget', lane: 'full' });
    const dir = currentFeature(root, SES)!;
    expect(freezeNudge(root, SES, dir)).toBe(FREEZE_NEXT_LINE);
    writeHld(root, dir, { ...emptyHldRecord('PQD-1'), state: 'changes_requested' });
    expect(freezeNudge(root, SES, dir)).toBe(FREEZE_NEXT_V2_LINE);
  });

  it('AC-6: the fast lane or a lane not listed leaves the freeze output unchanged', async () => {
    signOff(enabled());
    expect(await freeze('fast')).not.toContain(FREEZE_NEXT_LINE);
    rmSync(join(root, PATHS.FEATURE_EVIDENCE_DIR), { recursive: true, force: true });
    signOff(enabled().replace('lanes: [graduated, full]', 'lanes: [full]'));
    expect(await freeze('graduated')).not.toContain(FREEZE_NEXT_LINE);
  });

  it('AC-1: the default file and no file give the same freeze output', async () => {
    signOff(null);
    const absent = await freeze('full');
    rmSync(join(root, PATHS.FEATURE_EVIDENCE_DIR), { recursive: true, force: true });
    vi.restoreAllMocks();
    signOff(renderDefaultGitWorkflowFile('design-sign-off.yaml'));
    const present = await freeze('full');
    expect(present).toEqual(absent);
    expect(present).not.toContain(FREEZE_NEXT_LINE);
  });
});
