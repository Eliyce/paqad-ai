import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import YAML from 'yaml';

import { PATHS } from '@/core/constants/paths.js';
import { FRAMEWORK_CONFIG_SPECS } from '@/core/framework-config.js';
import { readTeamConfig } from '@/core/team-config.js';
import {
  AI_ATTRIBUTION_COMMENT_LINES,
  renderDefaultGitWorkflowFile,
} from '@/git-workflow/defaults.js';
import { readLastApplied } from '@/git-workflow/last-applied.js';
import { loadGitWorkflow } from '@/git-workflow/load.js';
import { syncGitWorkflow, syncGitWorkflowFile } from '@/git-workflow/sync.js';
import { GIT_WORKFLOW_FILES } from '@/git-workflow/types.js';

const OPTS = { version: '2.0.0', baseBranch: 'main' };

describe('syncGitWorkflowFile', () => {
  it('leaves a complete file byte-identical', () => {
    for (const file of GIT_WORKFLOW_FILES) {
      const text = renderDefaultGitWorkflowFile(file, { version: '1.0.0' });
      expect(syncGitWorkflowFile(text, file, OPTS)).toBe(text);
    }
  });

  it('adds a missing fixed-place key with its default, the Added line and a bumped version', () => {
    const text = [
      '# How pull requests are opened.',
      'paqad_version: "1.0.0"',
      '',
      'title_template: "{ticket}: {summary}"  # team value',
      'body_template: .github/pull_request_template.md',
      'draft: true',
      'reviewers: [alice]',
      'labels: []',
      'link_ticket: false',
      'also_open_against: [qa]',
      'host: github',
      'host_server: ""',
      '',
      'ci:',
      '  gate: warn_only   # keep this comment',
      '  on_red: stop',
      '',
    ].join('\n');
    const next = syncGitWorkflowFile(text, 'pull-requests.yaml', OPTS);
    expect(next).toBe(
      [
        '# How pull requests are opened.',
        'paqad_version: "2.0.0"',
        '',
        'title_template: "{ticket}: {summary}"  # team value',
        'body_template: .github/pull_request_template.md',
        'draft: true',
        'reviewers: [alice]',
        'labels: []',
        'link_ticket: false',
        'also_open_against: [qa]',
        'host: github',
        'host_server: ""',
        '',
        'ci:',
        '  gate: warn_only   # keep this comment',
        '  on_red: stop',
        '  # Added in paqad-ai 2.0.0',
        '  timeout_minutes: 30',
        '',
      ].join('\n'),
    );
  });

  it('appends a missing top-level key at the end of the file', () => {
    const text = 'paqad_version: "1.0.0"\n\nenabled: true\nagents: warn\n';
    expect(syncGitWorkflowFile(text, 'enforcement.yaml', OPTS)).toBe(
      'paqad_version: "2.0.0"\n\nenabled: true\nagents: warn\n\n# Added in paqad-ai 2.0.0\npeople: warn\n',
    );
  });

  it('never inserts a key into a team-named branch type or ticket source', () => {
    const text = [
      'paqad_version: "1.0.0"',
      'base_branch: main',
      'template: "{prefix}/{ticket}-{title_slug}"',
      'slug_max_length: 50',
      'types:',
      '  bugfix:',
      '    prefix: bug',
      'default_type: bugfix',
      '',
    ].join('\n');
    expect(syncGitWorkflowFile(text, 'branches.yaml', OPTS)).toBe(text);
    const tickets = renderDefaultGitWorkflowFile('tickets.yaml', { version: '1.0.0' }).replace(
      'sources: {}',
      'sources:\n  proj:\n    tracker: jira',
    );
    expect(syncGitWorkflowFile(tickets, 'tickets.yaml', OPTS)).toBe(tickets);
  });

  it('never touches a file whose paqad_version is newer than the running package', () => {
    const text = 'paqad_version: "3.0.0"\nenabled: true\n';
    expect(syncGitWorkflowFile(text, 'enforcement.yaml', OPTS)).toBe(text);
  });
});

describe('the commented ai_attribution lines in commits.yaml', () => {
  const COMMENT = AI_ATTRIBUTION_COMMENT_LINES.join('\n');
  const OLD =
    'paqad_version: "1.0.0"\ntemplate: "{ticket}: {summary}"\nsign_off: false\nask_when_unspecified: true\nsummary:\n  style: plain\n  max_length: 72\n';

  it('AC-26: an upgraded file gets them, and a second run changes nothing', () => {
    const once = syncGitWorkflowFile(OLD, 'commits.yaml', OPTS);
    expect(once).toContain(COMMENT);
    expect(YAML.parse(once).paqad_version).toBe('2.0.0');
    expect(YAML.parse(once).ai_attribution).toBeUndefined();
    expect(syncGitWorkflowFile(once, 'commits.yaml', OPTS)).toBe(once);
  });

  it('AC-26: a new file shows them and they match the default in code', () => {
    const fresh = renderDefaultGitWorkflowFile('commits.yaml', OPTS);
    expect(fresh).toContain(COMMENT);
    const spec = FRAMEWORK_CONFIG_SPECS.find((row) => row.key === 'ai_attribution');
    expect(AI_ATTRIBUTION_COMMENT_LINES[1]).toBe(`# ai_attribution: ${String(spec?.default)}`);
    expect(syncGitWorkflowFile(fresh, 'commits.yaml', OPTS)).toBe(fresh);
  });

  it('AC-26: a live value stays byte-identical', () => {
    const live = `${OLD}ai_attribution: keep\n`.replace('"1.0.0"', '"2.0.0"');
    expect(syncGitWorkflowFile(live, 'commits.yaml', OPTS)).toBe(live);
  });

  it('AC-27: keeps CRLF line ends', () => {
    const crlf = OLD.replaceAll('\n', '\r\n');
    const once = syncGitWorkflowFile(crlf, 'commits.yaml', OPTS);
    expect(once).toContain(AI_ATTRIBUTION_COMMENT_LINES.join('\r\n'));
    expect(once.replaceAll('\r\n', '')).not.toContain('\n');
    expect(YAML.parse(once).summary.max_length).toBe(72);
  });

  it('AC-27: handles a file with no final newline and stays valid', () => {
    const once = syncGitWorkflowFile(OLD.trimEnd(), 'commits.yaml', OPTS);
    expect(once).toContain(`max_length: 72\n\n${COMMENT}\n`);
    expect(YAML.parse(once).summary.max_length).toBe(72);
  });

  it('AC-27: a comment with no space counts as present', () => {
    const text = `${OLD}#ai_attribution: keep\n`;
    expect(syncGitWorkflowFile(text, 'commits.yaml', OPTS)).toBe(text);
  });

  it('AC-27: a file stamped newer than the package is left alone', () => {
    const text = OLD.replace('"1.0.0"', '"9.0.0"');
    expect(syncGitWorkflowFile(text, 'commits.yaml', OPTS)).toBe(text);
  });

  it('AC-27: changes the version stamp only on the run that adds the lines', () => {
    const once = syncGitWorkflowFile(OLD, 'commits.yaml', OPTS);
    const later = syncGitWorkflowFile(once, 'commits.yaml', { ...OPTS, version: '3.0.0' });
    expect(later).toBe(once);
  });

  it('adds them to no other file', () => {
    const text = renderDefaultGitWorkflowFile('tickets.yaml', OPTS);
    expect(syncGitWorkflowFile(text, 'tickets.yaml', OPTS)).not.toContain('ai_attribution');
  });
});

describe('syncGitWorkflow', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'git-workflow-sync-'));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('AC-26: the commented lines leave the value config show reports unchanged', () => {
    const commits = join(root, PATHS.GIT_WORKFLOW_DIR, 'commits.yaml');
    syncGitWorkflow(root, { version: '2.0.0', baseBranch: 'main' });
    expect(readFileSync(commits, 'utf8')).toContain('# ai_attribution: strip');
    expect(readTeamConfig(root).merged.has('ai_attribution')).toBe(false);
    writeFileSync(commits, `${readFileSync(commits, 'utf8')}ai_attribution: keep\n`);
    const live = readFileSync(commits, 'utf8');
    expect(readTeamConfig(root).merged.get('ai_attribution')).toBe('keep');
    syncGitWorkflow(root, { version: '2.0.0', baseBranch: 'main' });
    expect(readFileSync(commits, 'utf8')).toBe(live);
  });

  it('writes a missing file whole, then stamps .last-applied.json for the files it changed', () => {
    mkdirSync(join(root, PATHS.GIT_WORKFLOW_DIR), { recursive: true });
    const enforcement = join(root, PATHS.GIT_WORKFLOW_DIR, 'enforcement.yaml');
    writeFileSync(enforcement, 'paqad_version: "1.0.0"\nenabled: true\nagents: warn\n');
    const written = syncGitWorkflow(root, { version: '2.0.0', baseBranch: 'develop' });
    expect(written).toHaveLength(5);
    expect(readFileSync(join(root, PATHS.GIT_WORKFLOW_DIR, 'branches.yaml'), 'utf8')).toContain(
      '\nbase_branch: develop\n',
    );
    expect(readFileSync(enforcement, 'utf8')).toContain('# Added in paqad-ai 2.0.0\npeople: warn');
    expect(Object.keys(readLastApplied(root)?.files ?? {})).toHaveLength(5);
    expect(loadGitWorkflow(root).config.enforcement.agents).toBe('warn');
    expect(syncGitWorkflow(root, { version: '2.0.0' })).toEqual([]);
  });
});
