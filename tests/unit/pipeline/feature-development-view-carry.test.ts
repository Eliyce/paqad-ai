import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import YAML from 'yaml';

import { PATHS } from '@/core/constants/paths.js';
import { defaultFeatureDevelopmentPolicy } from '@/pipeline/feature-development-policy.js';
import {
  FEATURE_DEVELOPMENT_VIEW_HEADER,
  carryWorkflowFields,
  featureDevelopmentViewPath,
  readStoredViewHash,
  rebuildFeatureDevelopmentView,
  refreshFeatureDevelopmentView,
  viewEditedByHand,
} from '@/pipeline/feature-development-view.js';

let root: string;

function write(rel: string, text: string): void {
  const path = join(root, rel);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, text, 'utf8');
}

function teamYaml(file: string): Record<string, unknown> {
  return YAML.parse(readFileSync(join(root, '.paqad/configs', file), 'utf8')) as Record<
    string,
    unknown
  >;
}

const moved = (file: string, path: string) =>
  `Moved your edit to docs/instructions/workflows/feature-development.yaml into .paqad/configs/${file}: ${path}.`;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'feature-view-carry-'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('carrying hand edits out of the feature-development view', () => {
  it('moves nothing from something that is not a policy', () => {
    const policy = defaultFeatureDevelopmentPolicy();
    expect(carryWorkflowFields(root, null, policy)).toEqual([]);
    expect(carryWorkflowFields(root, { stages: [] }, policy)).toEqual([]);
    expect(carryWorkflowFields(root, { stages: { checks: { checks: 'x' } } }, policy)).toEqual([]);
  });

  it('appends extra read entries to the team list already there', () => {
    write(
      '.paqad/configs/feature-development/workflow.yaml',
      'stages:\n  review:\n    read: [docs/a.md]\n',
    );
    const lines = carryWorkflowFields(
      root,
      { stages: { review: { read: ['docs/b.md', '', 7] } } },
      defaultFeatureDevelopmentPolicy(),
    );
    expect(lines).toEqual([moved('feature-development/workflow.yaml', 'stages.review.read')]);
    expect(teamYaml('feature-development/workflow.yaml')).toMatchObject({
      stages: { review: { read: ['docs/a.md', 'docs/b.md'] } },
    });
  });

  it('moves a changed module attribution, and ignores an unknown value or the current one', () => {
    const policy = defaultFeatureDevelopmentPolicy();
    expect(
      carryWorkflowFields(
        root,
        { stages: { planning: { escalation: { attribution_pending: 'defer' } } } },
        policy,
      ),
    ).toEqual([]);
    expect(
      carryWorkflowFields(
        root,
        { stages: { planning: { escalation: { attribution_pending: 'later' } } } },
        policy,
      ),
    ).toEqual([]);
    expect(
      carryWorkflowFields(
        root,
        { stages: { planning: { escalation: { attribution_pending: 'stop' } } } },
        policy,
      ),
    ).toEqual([moved('feature-development/workflow.yaml', 'stages.planning.module_attribution')]);
    expect(teamYaml('feature-development/workflow.yaml')).toMatchObject({
      stages: { planning: { module_attribution: 'stop' } },
    });
  });

  it('moves turning off the profile commands, a warn-only failure and numbers new extra commands after existing ones', () => {
    write(
      '.paqad/configs/feature-development/checks.yaml',
      'commands:\n  extra:\n    lint: pnpm lint\n',
    );
    const lines = carryWorkflowFields(
      root,
      {
        stages: {
          checks: {
            checks: {
              use_project_profile_commands: false,
              commands: ['format'],
              shell_commands: ['pnpm e2e'],
              block_on_failure: false,
            },
          },
        },
      },
      defaultFeatureDevelopmentPolicy(),
    );
    expect(lines).toEqual([
      moved('feature-development/checks.yaml', 'commands.from_project_profile'),
      moved('feature-development/checks.yaml', 'commands.extra'),
      moved('feature-development/checks.yaml', 'on_failure'),
    ]);
    expect(teamYaml('feature-development/checks.yaml')).toMatchObject({
      commands: { from_project_profile: [], extra: { lint: 'pnpm lint', 'command-2': 'pnpm e2e' } },
      on_failure: 'warn',
    });
  });

  it('moves a narrower command list and a block setting turned back on', () => {
    const policy = defaultFeatureDevelopmentPolicy();
    policy.stages.checks.checks!.use_project_profile_commands = false;
    policy.stages.checks.checks!.block_on_failure = false;
    const lines = carryWorkflowFields(
      root,
      { stages: { checks: { checks: { commands: ['test'], block_on_failure: true } } } },
      policy,
    );
    expect(lines).toEqual([
      moved('feature-development/checks.yaml', 'commands.from_project_profile'),
      moved('feature-development/checks.yaml', 'on_failure'),
    ]);
    expect(teamYaml('feature-development/checks.yaml')).toMatchObject({
      commands: { from_project_profile: ['test'] },
      on_failure: 'block',
    });
  });

  it('leaves the commands alone when the stage has no checks block in the policy', () => {
    const policy = defaultFeatureDevelopmentPolicy();
    policy.stages.checks.checks = null;
    expect(
      carryWorkflowFields(root, { stages: { checks: { checks: { commands: ['test'] } } } }, policy),
    ).toEqual([]);
  });

  it('moves a valid rule-compliance mode to the team config and ignores an unknown one', () => {
    const policy = defaultFeatureDevelopmentPolicy();
    expect(
      carryWorkflowFields(
        root,
        { stages: { checks: { rule_compliance: { mode: 'loud' } } } },
        policy,
      ),
    ).toEqual([]);
    const lines = carryWorkflowFields(
      root,
      { stages: { checks: { rule_compliance: { mode: 'warn' } } } },
      policy,
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^Moved your edit to .* into \.paqad\/configs\/.+: .+\.$/);
  });
});

describe('refreshing the feature-development view: edge cases', () => {
  it('skips a folder without a project profile, a content project and an unreadable profile', () => {
    expect(refreshFeatureDevelopmentView(root).status).toBe('skipped');
    write(PATHS.PROJECT_PROFILE, ':\n  - [broken');
    expect(refreshFeatureDevelopmentView(root).status).toBe('skipped');
  });

  it('warns and still rebuilds when the hand-edited view is not valid YAML', () => {
    write(PATHS.PROJECT_PROFILE, 'active_capabilities:\n  - coding\n');
    refreshFeatureDevelopmentView(root);
    writeFileSync(
      featureDevelopmentViewPath(root),
      `${FEATURE_DEVELOPMENT_VIEW_HEADER}stages: [\n`,
    );
    const result = refreshFeatureDevelopmentView(root);
    expect(result.status).toBe('written');
    expect(result.handEdited).toBe(true);
    expect(result.warnings[0]).toContain(
      "was edited by hand and couldn't be read, so the edit wasn't moved:",
    );
  });

  it('is not hand-edited without a stored hash, without the view, or with an empty hash file', () => {
    expect(viewEditedByHand(root)).toBe(false);
    write(PATHS.FEATURE_DEVELOPMENT_VIEW_HASH, '   \n');
    expect(readStoredViewHash(root)).toBeNull();
    write(PATHS.FEATURE_DEVELOPMENT_VIEW_HASH, 'abc\n');
    expect(viewEditedByHand(root)).toBe(false);
  });

  it('returns the moved lines alone when the view was not edited, and reports a rebuild that fails', () => {
    write(PATHS.PROJECT_PROFILE, 'active_capabilities:\n  - coding\n');
    expect(rebuildFeatureDevelopmentView(root)).toEqual([]);
    rmSync(featureDevelopmentViewPath(root));
    mkdirSync(featureDevelopmentViewPath(root));
    const lines = rebuildFeatureDevelopmentView(root);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("couldn't be rebuilt:");
  });
});
