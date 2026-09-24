import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { writeProjectProfile } from '@/core/project-profile.js';
import { featureFilePath } from '@/feature-evidence/paths.js';
import { openFeatureChange } from '@/feature-evidence/stage-ledger.js';
import { runCapabilityGate } from '@/kernel/gate.js';
import {
  REMINDER_MARKER_DIR,
  VISUAL_EVIDENCE_REMINDER,
  visualEvidenceReminder,
} from '@/visual-evidence/reminder.js';

import { fixtureProfile } from '../adapters/shared.fixture.js';

const SES = 'ses_ve_reminder';
let root: string;

function project(visualEvidence: boolean): void {
  writeProjectProfile(root, {
    ...fixtureProfile('laravel'),
    active_capabilities: ['coding'],
    stack_profile: {
      frameworks: ['react'],
      traits: [],
      toolchains: [],
      version_bands: [],
      sources: [],
    },
  } as never);
  writeFileSync(join(root, '.paqad', '.config'), `visual_evidence=${visualEvidence}\n`);
}

function remind(targetPaths: string[]): string | null {
  return visualEvidenceReminder({ projectRoot: root, targetPaths, sessionId: SES });
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'paqad-ve-remind-'));
  mkdirSync(join(root, '.paqad'), { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('visualEvidenceReminder (issue #579, FR-15)', () => {
  it('fires once per change on the first frontend edit, with an absolute or relative target', () => {
    project(true);
    const dir = openFeatureChange(root, SES, { adapter: 'claude-code', ulidSeed: 1 });

    expect(remind([join(root, 'src', 'pages', 'Goals.tsx')])).toBe(VISUAL_EVIDENCE_REMINDER);
    expect(remind(['src/pages/Other.tsx'])).toBeNull();
    // INV-10: the marker lives under .paqad/session, never in the bundle.
    expect(REMINDER_MARKER_DIR.split(/[\\/]/).slice(0, 2)).toEqual(['.paqad', 'session']);
    expect(dir).not.toContain('session');
  });

  it('stays quiet when visual evidence is off, the edit is not frontend, or no bundle is open', () => {
    project(false);
    openFeatureChange(root, SES, { adapter: 'claude-code', ulidSeed: 2 });
    expect(remind(['src/a.tsx'])).toBeNull();

    project(true);
    expect(remind(['src/server/api.ts'])).toBeNull();

    const other = mkdtempSync(join(tmpdir(), 'paqad-ve-remind-none-'));
    try {
      mkdirSync(join(other, '.paqad'), { recursive: true });
      writeProjectProfile(other, {
        ...fixtureProfile('laravel'),
        active_capabilities: ['coding'],
        stack_profile: {
          frameworks: ['react'],
          traits: [],
          toolchains: [],
          version_bands: [],
          sources: [],
        },
      } as never);
      writeFileSync(join(other, '.paqad', '.config'), 'visual_evidence=true\n');
      expect(
        visualEvidenceReminder({ projectRoot: other, targetPaths: ['src/a.tsx'], sessionId: SES }),
      ).toBeNull();
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });

  it('stays quiet once the bundle already holds visual evidence', () => {
    project(true);
    const dir = openFeatureChange(root, SES, { adapter: 'claude-code', ulidSeed: 3 });
    writeFileSync(join(root, featureFilePath(dir, 'visualEvidence')), '{}');
    expect(remind(['src/a.tsx'])).toBeNull();
  });

  it('skips the reminder when the marker cannot be written', () => {
    project(true);
    openFeatureChange(root, SES, { adapter: 'claude-code', ulidSeed: 4 });
    // A file where the marker directory should be makes the mkdir fail on every platform.
    mkdirSync(join(root, '.paqad', 'session'), { recursive: true });
    writeFileSync(join(root, REMINDER_MARKER_DIR), 'not a dir');
    expect(remind(['src/a.tsx'])).toBeNull();
  });
});

describe('runCapabilityGate context (issue #579)', () => {
  it('carries the reminder on the pre-mutation seam only', async () => {
    project(true);
    openFeatureChange(root, SES, { adapter: 'claude-code', ulidSeed: 5 });
    const completion = await runCapabilityGate({
      projectRoot: root,
      seam: 'completion',
      env: {},
      payload: { toolName: 'Edit', targetPath: 'src/a.tsx', sessionId: SES },
    });
    expect(completion.context).toBe('');

    const first = await runCapabilityGate({
      projectRoot: root,
      seam: 'pre-mutation',
      env: {},
      payload: { toolName: 'Edit', targetPath: 'src/a.tsx', sessionId: SES },
    });
    expect(first.context).toBe(VISUAL_EVIDENCE_REMINDER);

    const payloadless = await runCapabilityGate({
      projectRoot: root,
      seam: 'pre-mutation',
      env: { CLAUDE_SESSION_ID: SES },
    });
    expect(payloadless.context).toBe('');
  });
});
