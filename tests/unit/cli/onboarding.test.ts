import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ONBOARDING_VERBS,
  createOnboardingCommand,
  runVerb,
} from '../../../src/cli/commands/onboarding.js';
import { Detector } from '../../../src/detection/detector.js';
import { fileSha256 } from '../../../src/onboarding/journey/preflight.js';
import { readChoices } from '../../../src/onboarding/journey/choices.js';
import { readEvents } from '../../../src/onboarding/journey/events.js';
import { readRun, updateRun } from '../../../src/onboarding/journey/run-store.js';

import { git, gitRepo } from '../onboarding/journey/fixtures/git.js';
import { moduleMap, tempRoot, writeFile } from '../onboarding/journey/fixtures/journey.js';

describe('paqad-ai onboarding verbs', () => {
  let root: string;

  beforeEach(() => {
    root = tempRoot('paqad-onboarding-cli-');
    vi.stubEnv('SE_SESSION', 'session-a');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    process.exitCode = undefined;
    rmSync(root, { recursive: true, force: true });
  });

  async function run(
    ...args: string[]
  ): Promise<{ lines: string[]; errors: string[]; code: number }> {
    const lines: string[] = [];
    const errors: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((line: string) => void lines.push(String(line)));
    vi.spyOn(console, 'error').mockImplementation((line: string) => void errors.push(String(line)));
    process.exitCode = undefined;
    await createOnboardingCommand().parseAsync([...args, '--project-root', root], { from: 'user' });
    const code = Number(process.exitCode ?? 0);
    process.exitCode = undefined;
    vi.restoreAllMocks();
    return { lines, errors, code };
  }

  function view(): Record<string, unknown> & {
    stages: Array<{ state: string }>;
    refusal: string | null;
  } {
    return JSON.parse(readFileSync(join(root, '.paqad/onboarding/view.json'), 'utf8'));
  }

  function markDone(...ids: Array<'detect' | 'setup' | 'project_docs'>): void {
    updateRun(root, (draft) => {
      for (const id of ids) draft.stages[id] = { status: 'done' };
    });
  }

  it('FR-7: refuses to start off a TTY until the agent attests it asked', async () => {
    const refused = await run('start', '--providers', 'claude-code');
    expect(refused.code).toBe(1);
    expect(readRun(root)).toBeNull();
    const started = await run(
      'start',
      '--providers',
      'claude-code,codex-cli',
      '--asked',
      '--allow-list',
      'no',
    );
    expect(started.code).toBe(0);
    expect(readRun(root)?.providers).toEqual(['claude-code', 'codex-cli']);
    const asked = readChoices(root).find((row) => row.kind === 'providers');
    expect(asked?.by).toBe('agent-attested');
  });

  it('FR-7: the tray answer itself is recorded on the plugin path', async () => {
    await run('start', '--from-tray', '--session', 'tray-session', '--allow-list', 'no');
    expect(readRun(root)?.owner_session).toBe('tray-session');
    expect(readChoices(root)[0]?.by).toBe('tray');
  });

  it('FR-6: --allow-list yes writes the scoped allow list and records the exact entries', async () => {
    await run('start', '--asked');
    const settings = JSON.parse(readFileSync(join(root, '.claude/settings.local.json'), 'utf8'));
    expect(settings.permissions.allow).toContain('Write(docs/**)');
    const row = readChoices(root).find((choice) => choice.kind === 'allow_list');
    expect((row?.details as { added: { allow: string[] } }).added.allow).toEqual(
      settings.permissions.allow,
    );
  });

  it('NFR-9: a second start attaches to the open journey instead of starting another', async () => {
    await run('start', '--asked', '--allow-list', 'no');
    const first = readRun(root)?.run_id;
    const again = await run('start', '--asked', '--allow-list', 'no');
    expect(again.code).toBe(0);
    expect(again.lines.join('\n')).toContain('already open');
    expect(readRun(root)?.run_id).toBe(first);
  });

  it('AC-5 INV-22: starting step 4 before step 3 is done exits non-zero, names step 3 and keeps progress', async () => {
    await run('start', '--asked', '--allow-list', 'no');
    markDone('detect', 'setup');
    await run('status');
    const before = view().stages;
    const refused = await run('stage', 'start', 'module_docs');
    expect(refused.code).toBe(1);
    expect(refused.errors.join('\n')).toContain('step 3 (Write the project docs)');
    expect(view().stages).toEqual(before);
    expect(view().refusal).toContain('step 3');
    expect(readRun(root)?.stages.module_docs.status).toBe('not_started');
  });

  it('AC-5: no verb accepts a skip state', async () => {
    await run('start', '--asked', '--allow-list', 'no');
    const stage = createOnboardingCommand().commands.find((command) => command.name() === 'stage');
    expect(stage?.commands.map((command) => command.name())).toEqual(['start', 'end', 'fail']);
    const degradedSkip = await run('stage', 'end', 'detect', '--degraded', 'skipped');
    expect(degradedSkip.code).toBe(1);
  });

  it('AC-2 AC-7: a failed step resumes at its first unfinished unit', async () => {
    writeFile(
      root,
      'docs/instructions/rules/module-map.yml',
      moduleMap(['auth', 'billing', 'search']),
    );
    await run('start', '--asked', '--allow-list', 'no');
    markDone('detect', 'setup', 'project_docs');
    await run('stage', 'start', 'module_docs');
    await run('unit', 'module_docs', 'auth');
    await run('stage', 'fail', 'module_docs', '--reason', 'agent hit its turn limit');
    expect(view().button).toBe('Resume');
    const resumed = await run('resume', '--json');
    const outcome = JSON.parse(resumed.lines.join('\n'));
    expect(outcome.units_todo).toEqual(['billing', 'search', 'registries']);
    expect(readRun(root)?.stages.module_docs.status).toBe('running');
  });

  it('AC-24: resume drops removed modules, adds new ones and keeps finished unchanged ones', async () => {
    writeFile(
      root,
      'docs/instructions/rules/module-map.yml',
      moduleMap(['auth', 'billing', 'search']),
    );
    await run('start', '--asked', '--allow-list', 'no');
    markDone('detect', 'setup', 'project_docs');
    await run('stage', 'start', 'module_docs');
    await run('unit', 'module_docs', 'auth');
    await run('unit', 'module_docs', 'billing');
    await run('stage', 'fail', 'module_docs', '--reason', 'stopped');
    writeFile(
      root,
      'docs/instructions/rules/module-map.yml',
      moduleMap([
        'auth',
        { slug: 'billing', sources: ['src/billing', 'src/invoices'] },
        'payments',
      ]),
    );
    const outcome = JSON.parse((await run('resume', '--json')).lines.join('\n'));
    expect(outcome.units_todo).toEqual(['billing', 'payments', 'registries']);
    expect(readRun(root)?.stages.module_docs.plan).not.toContain('search');
  });

  it('AC-25 FR-27: abandon keeps everything written and another tool resumes with a hand-over row', async () => {
    await run('start', '--asked', '--allow-list', 'no');
    markDone('detect', 'setup');
    await run('stage', 'start', 'project_docs');
    writeFile(root, 'docs/stack/overview.md', '# Stack');
    await run('unit', 'project_docs', 'stack', '--outputs', 'docs/stack/overview.md');
    const abandoned = await run('abandon');
    expect(abandoned.lines.join('\n')).toContain('docs/stack/overview.md');
    expect(readRun(root)?.status).toBe('abandoned');
    vi.stubEnv('SE_SESSION', 'codex-session');
    await run('start', '--asked', '--allow-list', 'no');
    expect(readRun(root)?.owner_session).toBe('codex-session');
    expect(readEvents(root).some((event) => event.kind === 'handover')).toBe(true);
    expect(readFileSync(join(root, 'docs/stack/overview.md'), 'utf8')).toBe('# Stack');
  });

  it('FR-12: choices lists automatic choices and --review marks them reviewed', async () => {
    await run('start', '--asked', '--allow-list', 'no');
    await run('choose-stack', 'react', '--reason', 'vite and react in package.json');
    const listed = await run('choices');
    expect(listed.lines.join('\n')).toContain('stack: react');
    await run('choices', '--review', 'all');
    expect(readChoices(root).every((row) => row.reviewed)).toBe(true);
  });

  it('refuses --kept for a module whose source changed', async () => {
    writeFile(root, 'docs/instructions/rules/module-map.yml', moduleMap(['auth']));
    await run('start', '--asked', '--allow-list', 'no');
    markDone('detect', 'setup', 'project_docs');
    await run('stage', 'start', 'module_docs');
    const refused = await run('unit', 'module_docs', 'auth', '--kept', '--source-hash', 'old');
    expect(refused.code).toBe(1);
    expect(refused.errors.join('\n')).toContain('changed since');
  });

  it('next prints the next step from the table words', async () => {
    await run('start', '--asked', '--allow-list', 'no');
    const next = await run('next');
    expect(next.lines.join('\n')).toContain('onboarding stage start detect');
  });

  it('AC-1: exposes exactly the fifteen onboarding verbs', () => {
    expect(ONBOARDING_VERBS).toHaveLength(15);
    expect(
      createOnboardingCommand()
        .commands.map((command) => command.name())
        .sort(),
    ).toEqual([...ONBOARDING_VERBS].sort());
  });

  it.each([
    ['detect', ['detect']],
    ['choose-stack', ['choose-stack', 'cobol', '--reason', 'x']],
    ['setup', ['setup']],
    ['next', ['next']],
    ['stage', ['stage', 'start', 'module_docs']],
    ['unit', ['unit', 'module_docs', 'auth']],
    ['progress', ['progress', 'rules_analyze', '1', '2']],
    ['decide', ['decide', 'D-01J000000000000000000000Z9']],
    ['status', ['status']],
    ['choices', ['choices']],
    ['resume', ['resume']],
    ['finish', ['finish']],
    ['commit', ['commit', '--later']],
    ['abandon', ['abandon']],
  ])('AC-1 INV-22: %s rewrites view.json, keeping step state on a refusal', async (_verb, args) => {
    await run('start', '--asked', '--allow-list', 'no');
    writeFile(root, '.paqad/onboarding/view.json', '{"marker":true}');
    const before = readRun(root)?.stages;
    const result = await run(...args);
    const written = view();
    expect(written).not.toHaveProperty('marker');
    expect(written.stages).toHaveLength(8);
    if (result.code !== 0) {
      expect(written.refusal).toBeTruthy();
      expect(readRun(root)?.stages).toEqual(before);
    }
  });

  it('AC-20: commit --no is read as the answer no', async () => {
    await run('start', '--asked', '--allow-list', 'no');
    updateRun(root, (draft) => {
      for (const id of Object.keys(draft.stages) as Array<keyof typeof draft.stages>) {
        draft.stages[id] = { status: 'done' };
      }
    });
    const answered = await run('commit', '--no');
    expect(answered.code).toBe(0);
    expect(readRun(root)?.commit?.answer).toBe('no');
    expect(view().uncommitted_note).toContain('paqad-ai onboarding commit --branch');
    const refused = await run('commit');
    expect(refused.code).toBe(1);
  });
  it('INV-22: a plain thrown value still reaches the person and the view', async () => {
    await run('start', '--asked', '--allow-list', 'no');
    const errors: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((line: string) => void errors.push(line));
    await runVerb(root, () => {
      throw 'the disk is full';
    });
    expect(process.exitCode).toBe(1);
    expect(errors).toEqual(['**▸ paqad** · the disk is full']);
    expect(view().refusal).toBe('the disk is full');
  });

  it('AC-5: refuses a step name that is not one of the eight', async () => {
    await run('start', '--asked', '--allow-list', 'no');
    const refused = await run('stage', 'start', 'skip_docs');
    expect(refused.code).toBe(1);
    expect(refused.errors.join('\n')).toContain('Unknown step "skip_docs".');
  });

  it('FR-27: the owner session falls back to the Claude session id, then to unknown', async () => {
    vi.stubEnv('SE_SESSION', undefined);
    vi.stubEnv('CLAUDE_SESSION_ID', 'claude-1');
    await run('start', '--asked', '--allow-list', 'no');
    expect(readRun(root)?.owner_session).toBe('claude-1');
    rmSync(join(root, '.paqad'), { recursive: true, force: true });
    vi.stubEnv('CLAUDE_SESSION_ID', undefined);
    await run('start', '--asked', '--allow-list', 'no');
    expect(readRun(root)?.owner_session).toBe('unknown');
  });

  it('NFR-9: attaching to a journey with every step done says it resumed at the end', async () => {
    await run('start', '--asked', '--allow-list', 'no');
    updateRun(root, (draft) => {
      for (const id of Object.keys(draft.stages) as Array<keyof typeof draft.stages>) {
        draft.stages[id] = { status: 'done' };
      }
    });
    const again = await run('start', '--asked', '--allow-list', 'no');
    expect(again.lines.join('\n')).toContain('resumed it at the end');
  });

  it('FR-3: detect records a confident stack', async () => {
    await run('start', '--asked', '--allow-list', 'no');
    vi.spyOn(Detector.prototype, 'detect').mockResolvedValue({
      detected_stack: 'react',
      confidence: 'high',
      detected_capabilities: [],
      signals: [],
    } as never);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((line: string) => void lines.push(line));
    await createOnboardingCommand().parseAsync(['detect', '--project-root', root], {
      from: 'user',
    });
    expect(lines).toEqual(['**▸ paqad** · Detected react.']);
    expect(readRun(root)?.detection?.stack).toBe('react');
  });

  it('records the planned count, an agent claim and a unit, and resumes from the env session', async () => {
    await run('start', '--asked', '--allow-list', 'no');
    markDone('detect', 'setup');
    await run('stage', 'start', 'project_docs', '--planned', '3');
    expect(readRun(root)?.stages.project_docs.planned).toBe(3);
    const claimed = await run('unit', 'project_docs', 'stack', '--claim', 'paqad-onboarding-docs');
    expect(claimed.lines).toEqual(['**▸ paqad** · paqad-onboarding-docs starts stack.']);
    expect(readEvents(root).at(-1)).toMatchObject({ kind: 'agent_start', unit: 'stack' });
    const refused = await run('unit', 'project_docs', 'stack', '--install-check', 'x.mjs');
    expect(refused.errors.join('\n')).toContain('--install-check is only for step 7');
    vi.stubEnv('SE_SESSION', undefined);
    const resumed = await run('resume');
    expect(resumed.lines.join('\n')).toContain('Resumed at project_docs, starting with stack.');
    markDone('project_docs');
    expect((await run('resume')).lines).toEqual(['**▸ paqad** · Resumed at module_docs.']);
  });

  it('FR-12: reviews choices by id and says when none are recorded', async () => {
    const empty = await run('choices');
    expect(empty.lines).toEqual(['No choices recorded.']);
    await run('start', '--asked', '--allow-list', 'no');
    await run('choose-stack', 'react', '--reason', 'vite');
    const marked = await run('choices', '--review', 'C-2');
    expect(marked.lines).toEqual(['**▸ paqad** · Marked 1 choice(s) reviewed.']);
    const listed = await run('choices');
    expect(listed.lines.join('\n')).toMatch(/C-1 ○ start/u);
    expect(listed.lines.join('\n')).toMatch(/C-2 ✓ detect · stack: react/u);
  });

  it('AC-8: commit --branch with a ticket and message commits and lists what it left out', async () => {
    gitRepo(root);
    writeFile(root, 'README.md', '# app\n');
    git(root, 'add', '.');
    git(root, 'commit', '-q', '-m', 'init');
    await run('start', '--asked', '--allow-list', 'no');
    writeFile(root, 'docs/stack/overview.md', '# Stack\n');
    updateRun(root, (draft) => {
      for (const id of Object.keys(draft.stages) as Array<keyof typeof draft.stages>) {
        draft.stages[id] = { status: 'done' };
      }
      draft.written = {
        'docs/stack/overview.md': fileSha256(join(root, 'docs/stack/overview.md'))!,
      };
    });
    const answered = await run(
      'commit',
      '--branch',
      '--ticket',
      '1',
      '--message',
      'docs(#1): add the paqad onboarding docs',
    );
    expect(answered.code).toBe(0);
    const text = answered.lines.join('\n');
    expect(text).toMatch(/Committed 2 files on .+\. Nothing was pushed\./u);
    expect(text).toContain('left out: .paqad/onboarding/journey.json (not written by onboarding)');
    expect(git(root, 'log', '-1', '--format=%s').trim()).toBe(
      'docs(#1): add the paqad onboarding docs',
    );
    expect((await run('resume')).errors.join('\n')).toContain('nothing to resume');
  });

  it('AC-8: a typed branch name that breaks the team pattern is refused', async () => {
    await run('start', '--asked', '--allow-list', 'no');
    updateRun(root, (draft) => {
      for (const id of Object.keys(draft.stages) as Array<keyof typeof draft.stages>) {
        draft.stages[id] = { status: 'done' };
      }
    });
    const refused = await run('commit', '--branch', 'whatever');
    expect(refused.code).toBe(1);
    expect(refused.errors.join('\n')).toContain('The branch name "whatever" does not follow');
    expect((await run('resume')).lines).toEqual(['**▸ paqad** · Resumed at the end.']);
  });
});
