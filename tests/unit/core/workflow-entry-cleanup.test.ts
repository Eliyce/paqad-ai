import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import YAML from 'yaml';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import { syncTeamConfigFiles } from '@/core/team-config.js';
import { migrateTeamConfig } from '@/core/team-config-migrate.js';
import {
  defaultFeatureDevelopmentPolicy,
  loadFeatureDevelopmentPolicy,
} from '@/pipeline/feature-development-policy.js';
import { featureDevelopmentViewPath } from '@/pipeline/feature-development-view.js';

const FILE = 'feature-development/workflow.yaml';
const VERSION = '9.9.9';
const TEAM = 'Verify test coverage is 100%';
const FIXTURES = join(__dirname, '../../fixtures/team-config');
const STOCK = readFileSync(join(FIXTURES, 'workflow-1.116-stock.yaml'), 'utf8');
const EMBEDDED_ERA = readFileSync(join(FIXTURES, 'workflow-embedded-stages-era.yaml'), 'utf8');
const LISTED = 'Keep planning scoped to the requested feature and the current repository state.';
const LISTED_OLD = YAML.parse(STOCK).stages.review.instructions[0] as string;

let root: string;

function writeWorkflow(text: string): string {
  const path = join(root, PATHS.PROJECT_CONFIGS_DIR, FILE);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, text, 'utf8');
  return path;
}

function readWorkflow(): string {
  return readFileSync(join(root, PATHS.PROJECT_CONFIGS_DIR, FILE), 'utf8');
}

function sync(): string[] {
  const notes: string[] = [];
  syncTeamConfigFiles(root, notes, VERSION);
  return notes;
}

function planningFile(lines: string[]): string {
  return ['paqad_version: "1.118.0"', 'stages:', '  planning:', ...lines, ''].join('\n');
}

function oldView(text: string): void {
  const path = featureDevelopmentViewPath(root);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, text, 'utf8');
}

function withTeamLine(text: string): string {
  const parsed = YAML.parse(text);
  parsed.stages.planning.instructions.push(TEAM);
  return YAML.stringify(parsed, { lineWidth: 0 });
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'workflow-entry-cleanup-'));
  mkdirSync(join(root, '.paqad'), { recursive: true });
  writeFileSync(join(root, PATHS.PROJECT_PROFILE), 'active_capabilities:\n  - coding\n');
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('carrying an old workflow view', () => {
  it.each([
    ['the 1.116 stock view', STOCK],
    ['a view from the embedded stages era', EMBEDDED_ERA],
  ])('AC-1: from %s only the team line carries, with its line', (_name, text) => {
    oldView(withTeamLine(text));
    const result = migrateTeamConfig(root, { version: VERSION });
    expect(result.error).toBeUndefined();
    const live = YAML.parse(readWorkflow());
    expect(live.stages.planning.instructions).toEqual([TEAM]);
    const carriedLines = result.lines.filter((line) => line.startsWith('Carried this '));
    expect(carriedLines).toEqual([
      `Carried this planning instruction from the old workflow file; delete it from ${FILE} if it is a stale copy of paqad's own: ${TEAM}`,
    ]);
    for (const stage of ['specification', 'development', 'review', 'checks', 'delivery']) {
      expect(live.stages[stage]?.instructions).toBeUndefined();
    }
    expect(live.stages.planning.read).toBeUndefined();
  });

  it('AC-2: the planning brief holds the reuse instruction once after an unedited 1.116 upgrade', () => {
    oldView(STOCK);
    expect(migrateTeamConfig(root, { version: VERSION }).error).toBeUndefined();
    const { policy } = loadFeatureDevelopmentPolicy(root);
    const matches = policy.stages.planning.instructions.filter((line) =>
      line.includes('Reuse before you build'),
    );
    expect(matches).toHaveLength(1);
    expect(defaultFeatureDevelopmentPolicy().stages.planning.instructions).toContain(matches[0]);
  });
});

describe('removing listed entries from the live workflow file', () => {
  it('AC-5: removes only the listed lines with one message each, and a second run changes nothing', () => {
    writeWorkflow(
      planningFile([
        '    read:',
        '      - docs/modules/**',
        '    instructions:',
        `      - ${LISTED}`,
        `      - ${TEAM}`,
      ]),
    );
    expect(sync()).toEqual([
      `Removed an old copy of paqad's planning read path from ${FILE}: docs/modules/**`,
      `Removed an old copy of paqad's planning instruction from ${FILE}: ${LISTED.slice(0, 60)}`,
    ]);
    const first = readWorkflow();
    expect(YAML.parse(first).stages.planning.instructions).toEqual([TEAM]);
    expect(sync()).toEqual([]);
    expect(readWorkflow()).toBe(first);
  });

  it('AC-6: removes the two shipped folder lines, keeps a never-shipped one and touches no folder', () => {
    const folders = ['docs/modules/x', 'docs/instructions/y', 'docs/our-own/z'];
    for (const folder of folders) {
      mkdirSync(join(root, folder), { recursive: true });
      writeFileSync(join(root, folder, 'file.md'), 'kept', 'utf8');
    }
    writeWorkflow(
      planningFile([
        '    read:',
        '      - docs/modules/**',
        '      - docs/instructions/**',
        '      - docs/our-own/**',
      ]),
    );
    const notes = sync();
    expect(notes).toHaveLength(2);
    expect(YAML.parse(readWorkflow()).stages.planning.read).toEqual(['docs/our-own/**']);
    for (const folder of folders) {
      expect(readFileSync(join(root, folder, 'file.md'), 'utf8')).toBe('kept');
    }
  });

  it('AC-7: prints the first 60 characters on one line for 60, over 60 and multi-line text', () => {
    const exactly = LISTED.slice(0, 60);
    const multiline = LISTED.replace('the requested', 'the\n        requested');
    writeWorkflow(
      planningFile(['    instructions:', `      - ${LISTED}`, `      - |-\n        ${multiline}`]),
    );
    const notes = sync();
    expect(exactly).toHaveLength(60);
    expect(notes).toEqual([
      `Removed an old copy of paqad's planning instruction from ${FILE}: ${exactly}`,
      `Removed an old copy of paqad's planning instruction from ${FILE}: ${exactly}`,
    ]);
  });

  it('AC-7: prints text of exactly 60 characters whole', () => {
    const notes: string[] = [];
    const short = 'Sync canonical docs affected by the feature diff after verification passes.';
    writeWorkflow(
      [
        'paqad_version: "1.118.0"',
        'stages:',
        '  documentation_sync:',
        '    instructions:',
        `      - ${short}`,
        '',
      ].join('\n'),
    );
    syncTeamConfigFiles(root, notes, VERSION);
    expect(notes[0]!.split(': ').at(-1)).toBe(short.slice(0, 60));
  });

  it('AC-7: a stage left empty renders the commented default', () => {
    writeWorkflow(planningFile(['    instructions:', `      - ${LISTED}`]));
    sync();
    const text = readWorkflow();
    expect(text).toMatch(/^# +instructions: \[\]$/mu);
    expect(YAML.parse(text).stages).toBeUndefined();
  });

  it('AC-7: a non-string item stays', () => {
    writeWorkflow(planningFile(['    instructions:', `      - ${LISTED}`, '      - 42']));
    expect(sync()).toHaveLength(1);
    expect(YAML.parse(readWorkflow()).stages.planning.instructions).toEqual([42]);
  });

  it('AC-7, INV-3: a file stamped newer than the package changes nothing and prints nothing', () => {
    const text = [
      'paqad_version: "99.0.0"',
      'stages:',
      '  planning:',
      '    instructions:',
      `      - ${LISTED}`,
      '',
    ].join('\n');
    writeWorkflow(text);
    expect(sync()).toEqual([]);
    expect(readWorkflow()).toBe(text);
  });

  it('AC-7: team comments on and around removed entries stay', () => {
    writeWorkflow(
      planningFile([
        '    # A note above the list.',
        '    instructions:',
        '      # A note above the first item.',
        `      - ${LISTED} # A note beside the item.`,
        '      # A note above the second item.',
        `      - ${LISTED_OLD}`,
      ]),
    );
    sync();
    const first = readWorkflow();
    for (const note of [
      'A note above the list.',
      'A note above the first item.',
      'A note beside the item.',
      'A note above the second item.',
    ]) {
      expect(first).toContain(note);
    }
    expect(sync()).toEqual([]);
    expect(readWorkflow()).toBe(first);
  });

  it('INV-3: cleans only the workflow file', () => {
    const models = join(root, PATHS.PROJECT_CONFIGS_DIR, 'models.yaml');
    mkdirSync(join(models, '..'), { recursive: true });
    writeFileSync(models, `paqad_version: "1.118.0"\ninstructions:\n  - ${LISTED}\n`, 'utf8');
    expect(sync()).toEqual([]);
    expect(existsSync(models)).toBe(true);
    expect(readFileSync(models, 'utf8')).toContain(LISTED);
  });
});
