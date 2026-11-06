import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import YAML from 'yaml';

import { runShow } from '@/cli/commands/git-workflow.js';
import { PATHS } from '@/core/constants/paths.js';
import { getGitWorkflowConfig } from '@/dashboard/config-git-workflow.js';
import { defaultDesignSignOff, renderDefaultGitWorkflowFile } from '@/git-workflow/defaults.js';
import { loadGitWorkflow } from '@/git-workflow/load.js';
import { convertDeliveryPolicy, migrateDeliveryPolicy } from '@/git-workflow/migrate.js';
import { syncGitWorkflow } from '@/git-workflow/sync.js';
import { GIT_WORKFLOW_FILES } from '@/git-workflow/types.js';
import { FrameworkUpdater } from '@/update/index.js';

const DIR = PATHS.GIT_WORKFLOW_DIR;
const SIGN_OFF = `${DIR}/design-sign-off.yaml`;
const FIVE = GIT_WORKFLOW_FILES.filter((file) => file !== 'design-sign-off.yaml');

let root: string;
const put = (rel: string, text: string) => {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text);
};
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'paqad-design-sign-off-config-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function writeFive(): void {
  for (const file of FIVE) put(`${DIR}/${file}`, renderDefaultGitWorkflowFile(file));
}

describe('design-sign-off.yaml config', () => {
  it('AC-2: only the five older files load without error and sign-off resolves to off', () => {
    writeFive();
    const loaded = loadGitWorkflow(root);
    expect(loaded.errors).toEqual([]);
    expect(loaded.config.design_sign_off).toEqual(defaultDesignSignOff());
    expect(loaded.config.design_sign_off).toMatchObject({
      enabled: false,
      lanes: ['graduated', 'full'],
      approval_channel: { server: '', channel: '' },
      format: { summary_max_words: 200, detail_max_words: 800 },
      wait_for_approval: true,
      approve_by: 'either',
      approve_words: ['approved', 'lgtm', 'sign off'],
      approvers: [],
      move_to_on_post: '',
      approved_status: '',
      allow_skip_with_reason: true,
    });
    const shown = runShow(root);
    expect(shown.exitCode).toBe(0);
    expect(YAML.parse(shown.stdout).config.design_sign_off.enabled).toBe(false);
    const dashboard = getGitWorkflowConfig(root);
    expect(dashboard.errors).toEqual([]);
    expect(dashboard.resolved.design_sign_off.enabled).toBe(false);
    expect(dashboard.files.find((file) => file.name === 'design-sign-off.yaml')?.exists).toBe(
      false,
    );
  });

  it('AC-2: the default file reads back as the defaults with no warnings', () => {
    put(SIGN_OFF, renderDefaultGitWorkflowFile('design-sign-off.yaml'));
    const loaded = loadGitWorkflow(root);
    expect(loaded.errors).toEqual([]);
    expect(loaded.warnings).toEqual([]);
    expect(loaded.config.design_sign_off).toEqual(defaultDesignSignOff());
  });

  it('reads a team setting over the defaults', () => {
    put(
      SIGN_OFF,
      'schema_version: 1\nenabled: true\nlanes: [full]\napproval_channel:\n  server: slack\n  channel: design\napprove_by: status\napproved_status: Ready\n',
    );
    const resolved = loadGitWorkflow(root).config.design_sign_off;
    expect(resolved).toMatchObject({
      enabled: true,
      lanes: ['full'],
      approval_channel: { server: 'slack', channel: 'design' },
      approve_by: 'status',
      approved_status: 'Ready',
      wait_for_approval: true,
    });
  });

  it.each([
    ['an unknown key', 'schema_version: 1\nenabled: true\ncolour: blue\n'],
    [
      'approve_by outside reply, status and either',
      'schema_version: 1\nenabled: true\napprove_by: vote\n',
    ],
  ])('AC-5: %s is a schema error for that file and sign-off falls back to defaults', (_n, text) => {
    put(SIGN_OFF, text);
    const loaded = loadGitWorkflow(root);
    expect(loaded.valid).toBe(false);
    expect(loaded.errors.length).toBeGreaterThan(0);
    expect(loaded.errors.every((issue) => issue.file === 'design-sign-off.yaml')).toBe(true);
    expect(loaded.config.design_sign_off).toEqual(defaultDesignSignOff());
  });

  it('AC-3: update sync writes a missing file once with its defaults and leaves team edits alone', () => {
    writeFive();
    const first = syncGitWorkflow(root, { version: '2.0.0', baseBranch: 'main' });
    expect(first.map((path) => path.split(/[\\/]/).pop())).toEqual(['design-sign-off.yaml']);
    expect(read(SIGN_OFF)).toBe(renderDefaultGitWorkflowFile('design-sign-off.yaml'));
    const edited = read(SIGN_OFF).replace('enabled: false', 'enabled: true');
    put(SIGN_OFF, edited);
    expect(syncGitWorkflow(root, { version: '2.0.0', baseBranch: 'main' })).toEqual([]);
    expect(read(SIGN_OFF)).toBe(edited);
  });

  it('the delivery move writes all six files and keeps a design-sign-off.yaml the team already has', () => {
    const converted = convertDeliveryPolicy({}, { baseBranch: 'main' });
    expect(Object.keys(converted.files)).toEqual([...GIT_WORKFLOW_FILES]);
    expect(converted.files['design-sign-off.yaml']).toBe(
      renderDefaultGitWorkflowFile('design-sign-off.yaml'),
    );
    put('docs/instructions/workflows/delivery-policy.yaml', 'process:\n  pr:\n    draft: true\n');
    put(SIGN_OFF, 'schema_version: 1\nenabled: true\n');
    const moved = migrateDeliveryPolicy(root, { version: '2.0.0', baseBranch: 'main' });
    expect(moved.ran).toBe(true);
    expect(read(SIGN_OFF)).toBe('schema_version: 1\nenabled: true\n');
    for (const file of FIVE) expect(existsSync(join(root, DIR, file))).toBe(true);
    expect(moved.lines.some((line) => line.includes('design-sign-off.yaml'))).toBe(false);
  });
});

describe('design-sign-off.yaml while the git-workflow files are on hold', () => {
  const COMMITS = `${DIR}/commits.yaml`;
  const POLICY = 'docs/instructions/workflows/delivery-policy.yaml';

  beforeEach(() => {
    put(
      '.paqad/project-profile.yaml',
      'project: { name: D, id: d, description: D }\nrouting: { domain: coding, stack: laravel, capabilities: [] }\ncommands: {}\ncompliance_packs: []\nactive_capabilities: [coding]\nmcp: { servers: [] }\ncustom: { classification_dimensions: [], verification_plugins: [], escalation_rules: [] }\n',
    );
    put(POLICY, 'process:\n  pr:\n    draft: true\n');
    put(COMMITS, 'schema_version: 2\nai_attribution: keep\n');
  });

  it('AC-4: update still adds design-sign-off.yaml, leaves the held files alone and says so', async () => {
    const result = await new FrameworkUpdater({ generateCandidates: async () => [] }).run(root);
    expect(read(SIGN_OFF)).toBe(renderDefaultGitWorkflowFile('design-sign-off.yaml'));
    expect(read(COMMITS)).toBe('schema_version: 2\nai_attribution: keep\n');
    for (const file of FIVE.filter((file) => file !== 'commits.yaml')) {
      expect(existsSync(join(root, DIR, file))).toBe(false);
    }
    expect(result.git_workflow_notes).toContain(`Added ${SIGN_OFF} with its defaults.`);
  });
});
