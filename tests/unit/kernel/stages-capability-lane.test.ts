import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import { runCapabilityGate } from '@/kernel/gate.js';
import { endStage, openStageEvidence, startStage, type StageLane } from '@/stage-evidence/index.js';

// Issue #324 — the pre-code gate scales the specification requirement to the lane:
// the fast lane relaxes it (planning-only), while a path mapping to a
// `sensitivity: high` module floors the lane back to full so a spec is still required.
describe('stages capability — lane-aware precondition (#324)', () => {
  let root: string;
  const SES = 'ses_lane';

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-stages-lane-'));
    mkdirSync(join(root, '.paqad'), { recursive: true });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  /** Open a change with a recorded lane, then record only `planning` (proven). */
  function openWithLaneAndPlanning(lane: StageLane): void {
    const { ordinal } = openStageEvidence(root, { sessionId: SES, adapter: 'claude-code', lane });
    startStage(root, 'planning', { sessionId: SES, ordinal, adapter: 'claude-code' });
    const rel = '.paqad/artifacts/planning.md';
    mkdirSync(join(root, '.paqad/artifacts'), { recursive: true });
    writeFileSync(join(root, rel), '# plan\n');
    endStage(
      root,
      'planning',
      { artifactPaths: [rel] },
      {
        sessionId: SES,
        ordinal,
        adapter: 'claude-code',
      },
    );
  }

  function writeSensitiveModuleMap(): void {
    mkdirSync(join(root, 'docs/instructions/rules'), { recursive: true });
    writeFileSync(
      join(root, PATHS.MODULE_MAP),
      `version: 2
modules:
  - slug: secure-core
    name: Secure Core
    sensitivity: high
    sources:
      - src/secure
`,
      'utf8',
    );
  }

  const gate = (targetPath: string) =>
    runCapabilityGate({
      projectRoot: root,
      seam: 'pre-mutation',
      payload: { targetPath: join(root, targetPath), sessionId: SES },
    });

  it('FAST lane relaxes the spec requirement — planning alone unblocks a normal edit', async () => {
    openWithLaneAndPlanning('fast');
    const result = await gate('src/feature.ts');
    expect(result.block).toBe(false);
    expect(result.summary).toBe('');
  });

  it('FULL lane still requires specification — planning alone blocks', async () => {
    openWithLaneAndPlanning('full');
    const result = await gate('src/feature.ts');
    expect(result.block).toBe(true);
    expect(result.summary).toContain('specification');
  });

  it('a null recorded lane fails safe to full (spec required)', async () => {
    openWithLaneAndPlanning(null);
    const result = await gate('src/feature.ts');
    expect(result.block).toBe(true);
    expect(result.summary).toContain('specification');
  });

  it('sensitivity floor: a high-sensitivity path forces full even when the lane is fast', async () => {
    writeSensitiveModuleMap();
    openWithLaneAndPlanning('fast');
    // Normal path on the fast lane is allowed…
    expect((await gate('src/feature.ts')).block).toBe(false);
    // …but a path under the high-sensitivity module is floored to full → spec required.
    const blocked = await gate('src/secure/keys.ts');
    expect(blocked.block).toBe(true);
    expect(blocked.summary).toContain('specification');
  });
});
