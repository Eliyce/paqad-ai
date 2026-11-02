import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import YAML from 'yaml';

import { runSetup } from '@/cli/commands/git-workflow.js';
import { PATHS } from '@/core/constants/paths.js';
import type { DeliveryShell } from '@/delivery/runner.js';
import { readLastApplied } from '@/git-workflow/last-applied.js';
import { resolveGitWorkflow } from '@/git-workflow/load.js';
import {
  applyAnswers,
  classifySubject,
  gatherSignals,
  patternFromExample,
  proposeFromSignals,
  type SetupSignals,
} from '@/git-workflow/setup.js';

function signals(over: Partial<SetupSignals> = {}): SetupSignals {
  return {
    remote: 'git@github.com:acme/shop.git',
    defaultBranch: 'main',
    branches: ['main'],
    mainline: [],
    prs: null,
    mergeMethods: null,
    rules: null,
    ciTargets: [],
    codeowners: null,
    prTemplate: null,
    unknown: [],
    ...over,
  };
}

function repeat<T>(n: number, make: (i: number) => T): T[] {
  return Array.from({ length: n }, (_, i) => make(i));
}

function fixture(): SetupSignals {
  return signals({
    branches: [
      'main',
      ...repeat(20, (i) => `feature/PROJ-${i + 1}-add-thing`),
      ...repeat(12, (i) => `bugfix/INC00123${String(i).padStart(2, '0')}-fix-thing`),
      'dependabot/npm/lodash',
      'release/1.2',
    ],
    mainline: repeat(30, (i) => ({
      subject: `PROJ-${i + 1}: show the saved items on the list page`,
      body: '',
    })),
  });
}

describe('git-workflow setup: proposing from history', () => {
  it('proposes feature and bugfix types, a servicenow source and a jira/linear choice, with evidence counts', () => {
    const { proposal } = proposeFromSignals(fixture());
    expect(proposal.mode).toBe('from-history');
    const branches = YAML.parse(proposal.files['branches.yaml']) as {
      types: Record<string, { prefix: string; commit_type: string }>;
      default_type: string;
    };
    expect(branches.types).toEqual({
      feature: { prefix: 'feature', commit_type: 'feat' },
      bugfix: { prefix: 'bugfix', commit_type: 'fix' },
    });
    expect(branches.default_type).toBe('feature');
    const tickets = YAML.parse(proposal.files['tickets.yaml']) as {
      sources: Record<string, { tracker: string; pattern: string }>;
    };
    expect(tickets.sources.servicenow.tracker).toBe('servicenow');
    expect(tickets.sources.proj.pattern).toBe('PROJ-\\d+');
    expect(proposal.choices.find((c) => c.id === 'tickets.sources.proj.tracker')).toMatchObject({
      options: [{ id: 'jira' }, { id: 'linear' }],
      recommended: 'jira',
    });
    expect(proposal.evidence).toContainEqual({
      file: 'branches.yaml',
      key: 'types.bugfix.prefix',
      value: 'bugfix',
      because: '12 of 32 branches start with bugfix/',
    });
    expect(proposal.evidence.find((e) => e.key === 'sources.servicenow')?.because).toBe(
      '12 branch names and commit subjects carry ServiceNow keys',
    );
    expect(resolveGitWorkflow(proposal.files).valid).toBe(true);
  });

  it('turns a 40/35/25 split into a commits.template choice with those three options', () => {
    const subjects = [
      ...repeat(40, (i) => `PROJ-${i}: show the saved items again`),
      ...repeat(35, () => 'feat(cart): show the saved items again'),
      ...repeat(25, () => 'Show the saved items again'),
    ];
    const s = signals({
      branches: ['main', ...repeat(10, (i) => `feature/PROJ-${i}-x`)],
      mainline: subjects.map((subject) => ({ subject, body: '' })),
    });
    const choice = proposeFromSignals(s).proposal.choices.find((c) => c.id === 'commits.template');
    expect(choice?.options.map((o) => [o.id, o.share])).toEqual([
      ['{ticket}: {summary}', 0.4],
      ['{type}({scope}): {summary}', 0.35],
      ['{summary}', 0.25],
    ]);
    expect(choice?.recommended).toBe('{ticket}: {summary}');
    expect(choice?.options[0].examples).toHaveLength(2);
  });

  it('decides without asking when one format holds 70% or more', () => {
    const { proposal } = proposeFromSignals(fixture());
    expect(proposal.choices.some((c) => c.id === 'commits.template')).toBe(false);
    expect(YAML.parse(proposal.files['commits.yaml']).template).toBe('{ticket}: {summary}');
  });

  it('gives new-project mode with the starter questions when there is no remote or little history', () => {
    for (const s of [signals({ remote: null }), signals({ branches: ['main', 'feature/x'] })]) {
      const { proposal } = proposeFromSignals(s);
      expect(proposal.mode).toBe('new-project');
      expect(proposal.evidence).toEqual([]);
      expect(proposal.choices.map((c) => c.id)).toEqual([
        'tickets.tracker',
        'tickets.example',
        'pull_requests.extra_target',
        'branches.releases',
        'branches.hotfix',
        'commits.template',
      ]);
    }
  });

  it('applies starter answers and lists unanswered choices as not confirmed', () => {
    const built = proposeFromSignals(signals({ remote: null }));
    const applied = applyAnswers(built, {
      'tickets.tracker': 'jira',
      'tickets.example': 'SHOP-42',
      'branches.hotfix': 'no',
      'branches.releases': 'yes',
    });
    const tickets = YAML.parse(applied.contents['tickets.yaml']!) as {
      sources: Record<string, { pattern: string }>;
    };
    expect(tickets.sources.jira.pattern).toBe('[A-Z]+-\\d+');
    const branches = YAML.parse(applied.contents['branches.yaml']!);
    expect(Object.keys(branches.types)).toEqual(['feature', 'bugfix']);
    expect(branches.base_branch).toBe('release/*');
    expect(applied.notConfirmed).toEqual([
      'not confirmed: Do changes also go to a shared test branch, like qa or staging, before they go live?',
      'not confirmed: How should a commit message start?',
    ]);
    expect(resolveGitWorkflow(applied.contents).valid).toBe(true);
  });

  it('classifies subjects and builds a pattern from an example key', () => {
    expect(classifySubject('feat(x): add it [PROJ-1]', ['PROJ-\\d+'])).toBe(
      '{type}({scope}): {summary} [{ticket}]',
    );
    expect(classifySubject('PROJ-1 - add it', ['PROJ-\\d+'])).toBe('{ticket} - {summary}');
    expect(patternFromExample('INC0012345')).toBe('[A-Z]+\\d+');
  });
});

type Route = (command: string, args: string[]) => { stdout?: string; exitCode?: number } | null;

function fakeShell(routes: Route[]): { shell: DeliveryShell; calls: string[][] } {
  const calls: string[][] = [];
  return {
    calls,
    shell: {
      async run(command, args) {
        calls.push([command, ...args]);
        for (const route of routes) {
          const hit = route(command, args);
          if (hit) return { stdout: hit.stdout ?? '', stderr: '', exitCode: hit.exitCode ?? 0 };
        }
        return { stdout: '', stderr: 'not found', exitCode: 1 };
      },
    },
  };
}

describe('git-workflow setup: reading signals', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-setup-'));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const gitOnly: Route = (command, args) => {
    if (command !== 'git') return null;
    if (args[0] === 'rev-parse') return { stdout: '.git' };
    if (args[0] === 'remote') return { stdout: 'git@github.com:acme/shop.git' };
    if (args[0] === 'symbolic-ref') return { stdout: 'origin/main' };
    if (args[0] === 'branch') return { stdout: 'origin/HEAD\norigin/main\norigin/feature/x\n' };
    if (args[0] === 'log') return { stdout: 'PROJ-1: show it\x1f\x1e\n' };
    return null;
  };

  it('reads commit style from the main line only and says gh signals are unknown without gh', async () => {
    const { shell, calls } = fakeShell([gitOnly]);
    const read = await gatherSignals(shell, root);
    expect(calls).toContainEqual([
      'git',
      'log',
      '--first-parent',
      '-n',
      '200',
      '--format=%s%x1f%b%x1e',
      'origin/HEAD',
    ]);
    expect(read.branches).toEqual(['main', 'feature/x']);
    expect(read.unknown).toEqual([
      "pull requests: gh isn't installed or signed in, so PR history wasn't read",
      "merge methods: gh couldn't read the repository settings",
      "branch protection: GitHub didn't show it to this account (needs admin)",
    ]);
    expect(read.unknown.join(' ')).not.toContain('no rules');
  });

  it('says branch protection is unknown on a 403 or 404 from the rules API', async () => {
    const { shell } = fakeShell([
      gitOnly,
      (command, args) =>
        command === 'gh' && args[0] === 'repo'
          ? { stdout: JSON.stringify({ squashMergeAllowed: true, nameWithOwner: 'acme/shop' }) }
          : null,
      (command, args) =>
        command === 'gh' && args[0] === 'api' ? { stdout: 'HTTP 404', exitCode: 1 } : null,
    ]);
    const read = await gatherSignals(shell, root);
    expect(read.mergeMethods).toEqual(['squash']);
    expect(read.unknown).toContain(
      "branch protection: GitHub didn't show it to this account (needs admin)",
    );
  });

  it('exits 2 when git cannot read the folder', async () => {
    const result = await runSetup({ projectRoot: root, shell: fakeShell([]).shell });
    expect(result.exitCode).toBe(2);
  });

  it('--apply writes valid files and stamps them, and refuses to overwrite without --overwrite', async () => {
    const { shell } = fakeShell([gitOnly]);
    writeFileSync(
      join(root, 'answers.json'),
      JSON.stringify({ choices: { 'tickets.tracker': 'none' } }),
    );
    const dry = await runSetup({
      projectRoot: root,
      shell,
      answersFile: 'answers.json',
      dryRun: true,
    });
    expect(JSON.parse(dry.stdout).written).toEqual([]);
    const first = await runSetup({ projectRoot: root, shell, answersFile: 'answers.json' });
    expect(first.exitCode).toBe(0);
    const out = JSON.parse(first.stdout);
    expect(out.valid).toBe(true);
    expect(out.written).toHaveLength(5);
    expect(out.not_confirmed).toContain('not confirmed: How should a commit message start?');
    expect(Object.keys(readLastApplied(root)?.files ?? {})).toHaveLength(5);
    const again = await runSetup({ projectRoot: root, shell, answersFile: 'answers.json' });
    expect(again.exitCode).toBe(1);
    expect(JSON.parse(again.stdout).error).toContain('--overwrite');
    mkdirSync(join(root, PATHS.GIT_WORKFLOW_DIR), { recursive: true });
    writeFileSync(join(root, PATHS.GIT_WORKFLOW_DIR, 'enforcement.yaml'), 'people: off\n');
    const forced = await runSetup({
      projectRoot: root,
      shell,
      answersFile: 'answers.json',
      overwrite: true,
    });
    expect(forced.exitCode).toBe(0);
    expect(readFileSync(join(root, PATHS.GIT_WORKFLOW_DIR, 'enforcement.yaml'), 'utf8')).toContain(
      'people: warn',
    );
  });
});
