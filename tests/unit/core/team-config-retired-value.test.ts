import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import YAML from 'yaml';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import { readTeamConfig, syncTeamConfigFiles } from '@/core/team-config.js';
import { migrateTeamConfig } from '@/core/team-config-migrate.js';
import { resolveEvidenceExistenceMode } from '@/verification/repository/evidence-existence-mode.js';

const EVIDENCE = 'feature-development/evidence.yaml';
const VERSION = '9.9.9';

let root: string;

function writeConfig(rel: string, text: string): void {
  const path = join(root, PATHS.PROJECT_CONFIGS_DIR, rel);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, text, 'utf8');
}

function readEvidence(): string {
  return readFileSync(join(root, PATHS.PROJECT_CONFIGS_DIR, EVIDENCE), 'utf8');
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'team-config-retired-'));
  mkdirSync(join(root, '.paqad'), { recursive: true });
  writeFileSync(join(root, PATHS.PROJECT_PROFILE), 'active_capabilities:\n  - coding\n');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('the retired strict value of the old evidence check', () => {
  it('migrates evidence_existence_gate=strict to warn with nothing reported invalid', () => {
    writeConfig('.config.policy', 'evidence_existence_gate=strict\n');

    const result = migrateTeamConfig(root, { version: VERSION });

    expect(YAML.parse(readEvidence()).legacy_existence_check).toBe('warn');
    expect(result.lines).toContain(
      `evidence_existence_gate → ${EVIDENCE}: legacy_existence_check = warn`,
    );
    expect(readTeamConfig(root).issues.filter((issue) => issue.key !== undefined)).toEqual([]);
  });

  it('reads an already migrated strict as warn with nothing reported invalid', () => {
    writeConfig(EVIDENCE, 'legacy_existence_check: strict\n');

    const team = readTeamConfig(root);

    expect(team.merged.get('evidence_existence_gate')).toBe('warn');
    expect(team.issues).toEqual([]);
    expect(resolveEvidenceExistenceMode(root, {})).toBe('warn');
  });

  it('replaces an already migrated strict on sync, keeps other values and says so once', () => {
    writeConfig(
      EVIDENCE,
      `paqad_version: "1.117.0"\nenterprise:\n  enabled: true\nlegacy_existence_check: strict\n`,
    );

    const first: string[] = [];
    syncTeamConfigFiles(root, first, VERSION);

    const parsed = YAML.parse(readEvidence());
    expect(parsed.legacy_existence_check).toBe('warn');
    expect(parsed.enterprise.enabled).toBe(true);
    expect(first.filter((note) => note.includes('legacy_existence_check'))).toEqual([
      `.paqad/configs/${EVIDENCE}: legacy_existence_check was strict, which this check doesn't have any more, so it is now warn.`,
    ]);

    const second: string[] = [];
    syncTeamConfigFiles(root, second, VERSION);
    expect(second).toEqual([]);
    expect(YAML.parse(readEvidence()).legacy_existence_check).toBe('warn');
  });

  it.each(['warn', 'off'])('keeps a team value of %s as written', (value) => {
    writeConfig(EVIDENCE, `legacy_existence_check: ${value}\n`);

    const notes: string[] = [];
    syncTeamConfigFiles(root, notes, VERSION);

    expect(readTeamConfig(root).merged.get('evidence_existence_gate')).toBe(value);
    expect(YAML.parse(readEvidence()).legacy_existence_check).toBe(value);
    expect(notes).toEqual([]);
  });

  it('still reports a value that was never allowed', () => {
    writeConfig(EVIDENCE, 'legacy_existence_check: sometimes\n');

    const team = readTeamConfig(root);

    expect(team.merged.has('evidence_existence_gate')).toBe(false);
    expect(team.issues.map((issue) => issue.key)).toEqual(['evidence_existence_gate']);
  });

  it('leaves a team file that is not valid YAML untouched', () => {
    const broken = 'legacy_existence_check: [strict\n';
    writeConfig(EVIDENCE, broken);

    const notes: string[] = [];
    syncTeamConfigFiles(root, notes, VERSION);

    expect(readEvidence()).toBe(broken);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain("isn't valid YAML");
  });
});
