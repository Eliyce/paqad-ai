import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import YAML from 'yaml';

import { createConfigCommand } from '@/cli/commands/config.js';
import { PATHS } from '@/core/constants/paths.js';
import {
  ensureTeamConfigFiles,
  setTeamConfigValue,
  writeTeamYamlValue,
} from '@/core/team-config.js';
import {
  FEATURE_DEVELOPMENT_VIEW_HEADER,
  featureDevelopmentViewPath,
  refreshFeatureDevelopmentView,
} from '@/pipeline/feature-development-view.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'paqad-cli-config-show-'));
});
afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
  rmSync(root, { recursive: true, force: true });
});

async function run(args: string[]): Promise<string[]> {
  const out: string[] = [];
  vi.spyOn(console, 'log').mockImplementation((line: string) => void out.push(String(line)));
  await createConfigCommand().parseAsync([...args, '--project-root', root], { from: 'user' });
  vi.restoreAllMocks();
  return out;
}

describe('paqad-ai config show', () => {
  it('prints JSON for every setting, and only the changed ones with --changed', async () => {
    const all = JSON.parse((await run(['show', '--json'])).join('\n'));
    expect(all.settings.length).toBeGreaterThan(10);
    expect(all.invalid).toEqual([]);
    setTeamConfigValue(root, 'rag_top_n', '9');
    const changed = JSON.parse((await run(['show', '--json', '--changed'])).join('\n'));
    expect(
      changed.settings.every((row: { same_as_default: boolean }) => !row.same_as_default),
    ).toBe(true);
    expect(changed.settings.length).toBeGreaterThan(0);
    expect(changed.settings.length).toBeLessThan(all.settings.length);
  });

  it('prints the changed settings as a table without --json', async () => {
    setTeamConfigValue(root, 'rag_top_n', '9');
    const out = await run(['show', '--changed']);
    expect(out.join('\n')).toContain(
      'retrieval.yaml: match.max_results  9  (team: retrieval.yaml)',
    );
  });
});

describe('paqad-ai config migrate: a failed move', () => {
  it('sets exit code 1 when a team YAML file is broken', async () => {
    mkdirSync(join(root, PATHS.PROJECT_CONFIGS_DIR), { recursive: true });
    writeFileSync(join(root, PATHS.PROJECT_CONFIGS_DIR, '.config.policy'), 'stages_mode=warn\n');
    mkdirSync(join(root, PATHS.PROJECT_CONFIGS_DIR, 'feature-development'), { recursive: true });
    writeFileSync(
      join(root, PATHS.PROJECT_CONFIGS_DIR, 'feature-development/workflow.yaml'),
      'stage_tracking: [unclosed\n',
    );
    const out = await run(['migrate']);
    expect(process.exitCode).toBe(1);
    expect(out.join('\n')).toContain("isn't valid YAML");
  });
});

describe('paqad-ai config view', () => {
  it('prints nothing when the view is current, and the moved lines after a hand edit', async () => {
    writeFileSync(join(root, '.gitignore'), '');
    mkdirSync(join(root, '.paqad'), { recursive: true });
    writeFileSync(join(root, PATHS.PROJECT_PROFILE), 'active_capabilities:\n  - coding\n');
    refreshFeatureDevelopmentView(root);
    expect(await run(['view'])).toEqual([]);
    const parsed = YAML.parse(readFileSync(featureDevelopmentViewPath(root), 'utf8'));
    parsed.stages.review.instructions.push('Hand rule.');
    writeFileSync(
      featureDevelopmentViewPath(root),
      `${FEATURE_DEVELOPMENT_VIEW_HEADER}${YAML.stringify(parsed)}`,
    );
    const lines = await run(['view']);
    expect(lines[0]).toContain('was edited by hand; paqad moved the edit and rebuilt it.');
  });
});

describe('team YAML writes', () => {
  it('refuses to write into a broken file and names an unknown setting', () => {
    expect(() => setTeamConfigValue(root, 'no_such_key', '1')).toThrow(
      "no_such_key isn't a paqad setting.",
    );
    mkdirSync(join(root, PATHS.PROJECT_CONFIGS_DIR), { recursive: true });
    writeFileSync(join(root, PATHS.PROJECT_CONFIGS_DIR, 'paqad.yaml'), 'a: [unclosed\n');
    expect(() => writeTeamYamlValue(root, 'paqad.yaml', ['a'], 1)).toThrow();
  });

  it('creates the missing team files once and keeps existing ones', () => {
    const first = ensureTeamConfigFiles(root);
    expect(first.length).toBeGreaterThan(5);
    expect(ensureTeamConfigFiles(root)).toEqual([]);
  });
});
