import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import { listConfigsFiles } from '@/core/framework-config.js';
import { resolveAiAttributionMode } from '@/delivery/attribution-config.js';
import {
  EXAMPLE_GITHUB_REF,
  defaultGitWorkflow,
  renderDefaultGitWorkflowFile,
} from '@/git-workflow/defaults.js';
import { loadGitWorkflow } from '@/git-workflow/load.js';
import { generateGitWorkflowFiles } from '@/git-workflow/onboard.js';
import { runCheckCommit } from '@/cli/commands/git-workflow.js';
import { GIT_WORKFLOW_FILES } from '@/git-workflow/types.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'git-workflow-load-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function write(file: string, text: string): void {
  mkdirSync(join(root, PATHS.GIT_WORKFLOW_DIR), { recursive: true });
  writeFileSync(join(root, PATHS.GIT_WORKFLOW_DIR, file), text, 'utf8');
}

function writeAllDefaults(): void {
  for (const file of GIT_WORKFLOW_FILES) {
    write(file, renderDefaultGitWorkflowFile(file, { version: '9.9.9' }));
  }
}

describe('loadGitWorkflow', () => {
  it('falls back to every default when the folder is missing', () => {
    const result = loadGitWorkflow(root);
    expect(result.source).toBe('defaults');
    expect(result.valid).toBe(true);
    expect(result.config).toEqual(defaultGitWorkflow());
  });

  it('reads the five default files back as the default config with no warnings', () => {
    writeAllDefaults();
    const result = loadGitWorkflow(root);
    expect(result.source).toBe('git-workflow');
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.config).toEqual(defaultGitWorkflow());
  });

  it('fills type and source defaults from the top level and the tracker', () => {
    write(
      'branches.yaml',
      'base_branch: develop\ntemplate: "{ticket}-{title_slug}"\ntypes:\n  chore: {}\ndefault_type: chore\n',
    );
    write('tickets.yaml', 'sources:\n  inc:\n    tracker: servicenow\n');
    const { config, valid } = loadGitWorkflow(root);
    expect(valid).toBe(true);
    expect(config.branches.types.chore).toEqual({
      prefix: 'chore',
      commit_type: 'chore',
      tickets: [],
      ticket_types: [],
      base_branch: 'develop',
      labels: [],
      template: '{ticket}-{title_slug}',
    });
    expect(config.tickets.sources.inc.pattern).toBe('(INC|RITM|CHG|PRB|TASK)\\d{7}');
    expect(config.tickets.sources.inc.transitions).toEqual({ on_pr_open: '', on_ci_green: '' });
  });

  it('reports an unparseable file as an error and never swaps in defaults silently', () => {
    write('commits.yaml', 'template: [unclosed\n');
    const result = loadGitWorkflow(root);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatchObject({ file: 'commits.yaml', path: '' });
  });

  it('reports a schema error with the file and the key path', () => {
    write('enforcement.yaml', 'agents: sometimes\n');
    const result = loadGitWorkflow(root);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatchObject({ file: 'enforcement.yaml', path: 'agents' });
  });

  it('treats an unknown key as a warning, not an error', () => {
    write('pull-requests.yaml', 'draft: true\nmerge_queue: on\nci:\n  retries: 2\n');
    write('branches.yaml', 'types:\n  feature:\n    colour: blue\n');
    const result = loadGitWorkflow(root);
    expect(result.valid).toBe(true);
    expect(result.config.pull_requests.draft).toBe(true);
    expect(result.warnings.map((w) => `${w.file}:${w.path}`)).toEqual([
      'branches.yaml:types.feature.colour',
      'pull-requests.yaml:merge_queue',
      'pull-requests.yaml:ci.retries',
    ]);
    expect(result.warnings[1].message).toBe(
      "pull-requests.yaml has a setting paqad doesn't know: merge_queue. It may be from a newer paqad or a typo.",
    );
  });

  it('never lets personal .paqad/.config lines or PAQAD_* env vars change a setting', () => {
    writeAllDefaults();
    mkdirSync(join(root, '.paqad'), { recursive: true });
    writeFileSync(
      join(root, PATHS.PROJECT_CONFIG),
      'base_branch=develop\npeople=block\nagents=warn\nrequire_ticket=true\n',
    );
    const saved = { ...process.env };
    process.env.PAQAD_BASE_BRANCH = 'develop';
    process.env.PAQAD_PEOPLE = 'block';
    process.env.PAQAD_ENABLED = 'false';
    try {
      expect(loadGitWorkflow(root).config).toEqual(defaultGitWorkflow());
    } finally {
      process.env = saved;
    }
  });

  it('keeps ai_attribution resolving from the personal line and PAQAD_AI_ATTRIBUTION', () => {
    mkdirSync(join(root, PATHS.PROJECT_CONFIGS_DIR), { recursive: true });
    writeFileSync(join(root, PATHS.PROJECT_CONFIGS_DIR, '.config.app'), 'ai_attribution=keep\n');
    expect(resolveAiAttributionMode(root, {})).toBe('keep');
    expect(resolveAiAttributionMode(root, { PAQAD_AI_ATTRIBUTION: 'strip' })).toBe('strip');
    writeFileSync(join(root, PATHS.PROJECT_CONFIG), 'ai_attribution=strip\n');
    expect(resolveAiAttributionMode(root, {})).toBe('strip');
  });
});

describe('ai_attribution in commits.yaml', () => {
  it('AC-7: a known value gives no warning and an unknown value is a validation error', () => {
    write('commits.yaml', 'ai_attribution: strip\n');
    const strip = loadGitWorkflow(root);
    expect(strip.warnings).toEqual([]);
    expect(strip.errors).toEqual([]);
    write('commits.yaml', 'ai_attribution: keep\n');
    expect(loadGitWorkflow(root).errors).toEqual([]);
    write('commits.yaml', 'ai_attribution: maybe\n');
    const maybe = loadGitWorkflow(root);
    expect(maybe.valid).toBe(false);
    expect(maybe.warnings).toEqual([]);
    expect(maybe.errors.map((error) => error.path)).toEqual(['ai_attribution']);
  });

  it.each([
    ['maybe', 'ai_attribution: maybe'],
    ['empty', 'ai_attribution:'],
    ['upper case', 'ai_attribution: STRIP'],
    ['a boolean', 'ai_attribution: true'],
  ])('AC-8: %s falls back to defaults, and the commit check stays silent', (_name, line) => {
    write(
      'commits.yaml',
      `template: "custom {summary}"\nsummary:\n  style: free\n  max_length: 500\n${line}\n`,
    );
    const loaded = loadGitWorkflow(root);
    expect(loaded.valid).toBe(false);
    expect(loaded.config.commits.template).toBe(defaultGitWorkflow().commits.template);
    expect(resolveAiAttributionMode(root, {})).toBe('strip');
    const message = join(root, 'message.txt');
    writeFileSync(message, 'custom text\n');
    expect(
      runCheckCommit({ projectRoot: root, messageFile: message, env: {}, merging: false }),
    ).toEqual({ exitCode: 0, stderr: '', findings: [] });
  });

  it('AC-8: a bad value carried from .config.policy resolves to the default mode', () => {
    mkdirSync(join(root, PATHS.PROJECT_CONFIGS_DIR), { recursive: true });
    writeFileSync(
      join(root, PATHS.PROJECT_CONFIGS_DIR, '.config.policy'),
      'ai_attribution=maybe\n',
    );
    expect(resolveAiAttributionMode(root, {})).toBe('strip');
  });
});

describe('the git-workflow folder and the .config.* reader', () => {
  it('listConfigsFiles lists none of the git-workflow files', () => {
    writeAllDefaults();
    writeFileSync(join(root, PATHS.PROJECT_CONFIGS_DIR, '.config.app'), 'stages_mode=strict\n');
    const listed = listConfigsFiles(root).map((path) => path.split(/[\\/]/).pop());
    expect(listed).toEqual(['.config.app']);
  });
});

describe('default files', () => {
  it('writes enforcement.yaml exactly as the default content', () => {
    expect(renderDefaultGitWorkflowFile('enforcement.yaml')).toBe(
      [
        '# How strictly paqad holds everyone to these rules.',
        '#',
        "# enabled: false turns off paqad's delivery help and checks completely.",
        '#',
        '# agents: work done through a coding agent',
        "#   block  a turn, commit or PR that doesn't match is refused until the agent fixes it",
        '#   warn   paqad points it out and the agent should fix it',
        '#',
        '# people: commits and pushes made by people, checked by git hooks',
        '#   block  the commit or push is refused (git commit --no-verify still skips it)',
        "#   warn   the hook prints what doesn't match and lets it through",
        '#   off    no git hooks for people',
        'schema_version: 1',
        '',
        'enabled: true',
        'agents: block',
        'people: warn',
        '',
      ].join('\n'),
    );
  });

  it('writes the remote default branch into branches.yaml and quotes a glob', () => {
    expect(renderDefaultGitWorkflowFile('branches.yaml', { baseBranch: 'develop' })).toContain(
      '\nbase_branch: develop\n',
    );
    expect(renderDefaultGitWorkflowFile('branches.yaml', { baseBranch: 'release/*' })).toContain(
      '\nbase_branch: "release/*"\n',
    );
  });

  it('documents the ticket link example in pull-requests.yaml', () => {
    expect(renderDefaultGitWorkflowFile('pull-requests.yaml')).toContain(
      `# Add the ticket to the PR body: "Closes ${EXAMPLE_GITHUB_REF}" for GitHub issues,`,
    );
  });

  it('onboarding writes the five files and the PR body template, and no delivery-policy.yaml', () => {
    const files = generateGitWorkflowFiles('coding', root);
    expect(files.map((f) => f.path)).toEqual([
      '.paqad/configs/git-workflow/tickets.yaml',
      '.paqad/configs/git-workflow/branches.yaml',
      '.paqad/configs/git-workflow/commits.yaml',
      '.paqad/configs/git-workflow/pull-requests.yaml',
      '.paqad/configs/git-workflow/enforcement.yaml',
      '.paqad/templates/pr-body.md',
    ]);
    expect(files.some((f) => f.path.endsWith('delivery-policy.yaml'))).toBe(false);
    expect(files[1].content).toContain('\nbase_branch: main\n');
    expect(generateGitWorkflowFiles('content', root)).toEqual([]);
  });
});
