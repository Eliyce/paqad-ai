import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import { resolveEvidenceExistenceMode } from '@/verification/repository/evidence-existence-mode.js';

describe('resolveEvidenceExistenceMode (issue #468 Phase C)', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-eem-'));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  function writeTeam(value: string): void {
    mkdirSync(join(root, '.paqad', 'configs'), { recursive: true });
    writeFileSync(
      join(root, '.paqad', 'configs', '.config.policy'),
      `evidence_existence_gate=${value}\n`,
      'utf8',
    );
  }

  function writeLocal(value: string): void {
    mkdirSync(join(root, '.paqad'), { recursive: true });
    writeFileSync(join(root, PATHS.PROJECT_CONFIG), `evidence_existence_gate=${value}\n`, 'utf8');
  }

  it('defaults to warn when nothing is set', () => {
    expect(resolveEvidenceExistenceMode(root, {})).toBe('warn');
  });

  it('honours a team-set off', () => {
    writeTeam('off');
    expect(resolveEvidenceExistenceMode(root, {})).toBe('off');
  });

  it('a local off cannot lower the warn floor (only raises)', () => {
    // Default floor is warn; a local `off` is weaker, so it is clamped away.
    writeLocal('off');
    expect(resolveEvidenceExistenceMode(root, {})).toBe('warn');
  });

  it('a local warn raises a team off', () => {
    writeTeam('off');
    writeLocal('warn');
    expect(resolveEvidenceExistenceMode(root, {})).toBe('warn');
  });

  it('the env escape hatch may raise but not lower', () => {
    writeTeam('warn');
    expect(resolveEvidenceExistenceMode(root, { PAQAD_EVIDENCE_EXISTENCE_GATE: 'off' })).toBe(
      'warn',
    );
    writeTeam('off');
    expect(resolveEvidenceExistenceMode(root, { PAQAD_EVIDENCE_EXISTENCE_GATE: 'warn' })).toBe(
      'warn',
    );
  });

  it('ignores an unrecognised value (treated as unset)', () => {
    writeTeam('strict');
    expect(resolveEvidenceExistenceMode(root, {})).toBe('warn');
  });
});
