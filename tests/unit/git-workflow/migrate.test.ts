import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import YAML from 'yaml';

import { PATHS } from '@/core/constants/paths.js';
import { renderDelivery } from '@/delivery/templates.js';
import { changedOutside } from '@/git-workflow/last-applied.js';
import { loadGitWorkflow } from '@/git-workflow/load.js';
import {
  COMMENT_DECISIONS_LINE,
  MOVED_MESSAGE,
  OLD_DELIVERY_POLICY,
  UNREADABLE_MESSAGE,
  migrateDeliveryPolicy,
} from '@/git-workflow/migrate.js';

const OLD = `schema_version: "1"
merge_mode: append
enabled: true
process:
  ticket:
    maintained: manual
    provider: jira
    server: atlassian
    require_ticket: true
    write_back_refined: never
    comment_decisions: false
  host:
    provider: github
  branch:
    template: "{type}/{ticket}-{title_slug}"
    type_map: { Story: feat, Bug: fix, Task: chore, default: feat }
    slug_max_length: 40
    base: develop
  commit:
    template: "{type}({scope}): {summary} [{ticket}]"
    sign_off: true
  pr:
    title_template: "{ticket}: {summary}"
    base: main
    draft: true
    reviewers: [alice]
    labels: [team-a]
    transition_on_open: "In Review"
  ci:
    gate: warn_only
    transition_on_green: ""
`;

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'git-workflow-migrate-'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function writeOld(text: string): void {
  mkdirSync(join(root, PATHS.WORKFLOWS_DIR), { recursive: true });
  writeFileSync(join(root, OLD_DELIVERY_POLICY), text);
}

function readNew(file: string): Record<string, unknown> {
  return YAML.parse(readFileSync(join(root, PATHS.GIT_WORKFLOW_DIR, file), 'utf8'));
}

describe('migrateDeliveryPolicy', () => {
  it('converts the old file with the mapping table, deletes it and prints the lines', () => {
    writeOld(OLD);
    const result = migrateDeliveryPolicy(root, { version: '2.0.0', baseBranch: 'main' });
    expect(result.ran).toBe(true);
    expect(result.deleted).toBe(true);
    expect(existsSync(join(root, OLD_DELIVERY_POLICY))).toBe(false);
    expect(result.lines).toEqual([
      'Moved delivery rules into .paqad/configs/git-workflow/tickets.yaml.',
      'Moved delivery rules into .paqad/configs/git-workflow/branches.yaml.',
      'Moved delivery rules into .paqad/configs/git-workflow/commits.yaml.',
      'Moved delivery rules into .paqad/configs/git-workflow/pull-requests.yaml.',
      'Moved delivery rules into .paqad/configs/git-workflow/enforcement.yaml.',
      COMMENT_DECISIONS_LINE,
      'branch.base and pr.base differed; kept pr.base (main).',
      MOVED_MESSAGE,
    ]);

    expect(readNew('tickets.yaml')).toMatchObject({
      require_ticket: true,
      write_back_refined: 'never',
      sources: {
        jira: {
          tracker: 'jira',
          pattern: '[A-Z][A-Z0-9]+-\\d+',
          server: 'atlassian',
          transitions: { on_pr_open: 'In Review' },
        },
      },
    });
    expect(readNew('branches.yaml')).toMatchObject({
      base_branch: 'main',
      template: '{prefix}/{ticket}-{title_slug}',
      slug_max_length: 40,
      types: {
        feat: { prefix: 'feat', commit_type: 'feat', ticket_types: ['Story'] },
        fix: { prefix: 'fix', commit_type: 'fix', ticket_types: ['Bug'] },
        chore: { prefix: 'chore', commit_type: 'chore', ticket_types: ['Task'] },
      },
      default_type: 'feat',
    });
    expect(readNew('commits.yaml')).toMatchObject({
      template: '{type}({scope}): {summary} [{ticket}]',
      sign_off: true,
      summary: { style: 'plain', max_length: 72 },
    });
    expect(readNew('pull-requests.yaml')).toMatchObject({
      draft: true,
      reviewers: ['alice'],
      labels: ['team-a'],
      also_open_against: [],
      ci: { gate: 'warn_only' },
    });
    expect(readNew('enforcement.yaml')).toMatchObject({
      enabled: true,
      agents: 'block',
      people: 'warn',
    });
    const loaded = loadGitWorkflow(root);
    expect(loaded.errors).toEqual([]);
    expect(loaded.warnings).toEqual([]);
    expect(changedOutside(root)).toEqual([]);
  });

  it('renders the same branch, commit and PR title before and after for old {type} templates', () => {
    writeOld(OLD);
    migrateDeliveryPolicy(root, { version: '2.0.0', baseBranch: 'main' });
    const rendered = renderDelivery(
      loadGitWorkflow(root).config,
      {
        ticket: 'PROJ-12',
        ticket_type: 'Bug',
        title: 'Fix crash',
        summary: 'stop the crash',
        scope: 'app',
      },
      '',
    );
    expect(rendered.branch).toBe('fix/PROJ-12-fix-crash');
    expect(rendered.commit).toBe('fix(app): stop the crash [PROJ-12]');
    expect(rendered.pr_title).toBe('PROJ-12: stop the crash');
  });

  it('a generic tracker gets a catch-all pattern and a line asking for a real one', () => {
    writeOld('process:\n  ticket:\n    provider: generic\n');
    const result = migrateDeliveryPolicy(root, { version: '2.0.0', baseBranch: 'main' });
    expect(readNew('tickets.yaml')).toMatchObject({ sources: { generic: { pattern: '.+' } } });
    expect(result.lines.some((line) => line.includes('Set a real pattern'))).toBe(true);
  });

  it('an unreadable old file leaves defaults written, keeps the old file and prints the message', () => {
    writeOld('process: [not, a, map]\n');
    const result = migrateDeliveryPolicy(root, { version: '2.0.0', baseBranch: 'main' });
    expect(result.lines).toEqual([UNREADABLE_MESSAGE]);
    expect(existsSync(join(root, OLD_DELIVERY_POLICY))).toBe(true);
    expect(readNew('enforcement.yaml')).toMatchObject({ agents: 'block' });
  });

  it('still migrates when the folder already holds a file that is not one of the five', () => {
    writeOld(OLD);
    mkdirSync(join(root, PATHS.GIT_WORKFLOW_DIR), { recursive: true });
    writeFileSync(join(root, PATHS.GIT_WORKFLOW_DIR, 'notes.yaml'), 'ai_attribution: strip\n');
    expect(migrateDeliveryPolicy(root, { version: '2.0.0', baseBranch: 'main' }).ran).toBe(true);
  });

  it('still migrates when commits.yaml holds only ai_attribution, and keeps it', () => {
    writeOld(OLD);
    mkdirSync(join(root, PATHS.GIT_WORKFLOW_DIR), { recursive: true });
    writeFileSync(join(root, PATHS.GIT_WORKFLOW_DIR, 'commits.yaml'), 'ai_attribution: keep\n');
    expect(migrateDeliveryPolicy(root, { version: '2.0.0', baseBranch: 'main' }).ran).toBe(true);
    expect(readNew('commits.yaml')).toMatchObject({ ai_attribution: 'keep', sign_off: true });
    expect(readFileSync(join(root, PATHS.GIT_WORKFLOW_DIR, 'commits.yaml'), 'utf8')).not.toContain(
      '# ai_attribution',
    );
    expect(existsSync(join(root, OLD_DELIVERY_POLICY))).toBe(false);
  });

  it('does nothing when any of the five files exists: the new files win', () => {
    writeOld(OLD);
    mkdirSync(join(root, PATHS.GIT_WORKFLOW_DIR), { recursive: true });
    writeFileSync(join(root, PATHS.GIT_WORKFLOW_DIR, 'enforcement.yaml'), 'enabled: true\n');
    expect(migrateDeliveryPolicy(root).ran).toBe(false);
    expect(existsSync(join(root, OLD_DELIVERY_POLICY))).toBe(true);
  });

  it('treats broken YAML, a non-boolean enabled and a section that is not a map as unreadable', () => {
    for (const text of ['process: [unclosed\n', 'enabled: "yes"\n', 'process:\n  ticket: [a]\n']) {
      rmSync(join(root, PATHS.GIT_WORKFLOW_DIR), { recursive: true, force: true });
      writeOld(text);
      const result = migrateDeliveryPolicy(root, { version: '2.0.0', baseBranch: 'main' });
      expect(result).toMatchObject({ ran: true, lines: [UNREADABLE_MESSAGE], deleted: false });
    }
  });

  it('converts an empty old file to the defaults and deletes it', () => {
    writeOld('');
    const result = migrateDeliveryPolicy(root, { version: '2.0.0', baseBranch: 'main' });
    expect(result.deleted).toBe(true);
    expect(readNew('branches.yaml')).toMatchObject({ default_type: 'feat' });
  });

  it('counts an unreadable new file as present, and a file holding a list as empty', () => {
    writeOld(OLD);
    mkdirSync(join(root, PATHS.GIT_WORKFLOW_DIR), { recursive: true });
    writeFileSync(join(root, PATHS.GIT_WORKFLOW_DIR, 'tickets.yaml'), 'sources: [unclosed\n');
    expect(migrateDeliveryPolicy(root).ran).toBe(false);
    writeFileSync(join(root, PATHS.GIT_WORKFLOW_DIR, 'tickets.yaml'), '- a\n');
    expect(migrateDeliveryPolicy(root, { version: '2.0.0', baseBranch: 'main' }).ran).toBe(true);
  });
});
