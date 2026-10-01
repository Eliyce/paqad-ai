import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createSetupCommand } from '@/cli/commands/setup.js';
import { createProgram } from '@/cli/program.js';
import type { SetupPlan } from '@/onboarding/setup-plan.js';

const { validateSetupPlan, readSetupPlan, verifyReadinessToDevelop, onboardInstalledStack } =
  vi.hoisted(() => ({
    validateSetupPlan: vi.fn(),
    readSetupPlan: vi.fn(),
    verifyReadinessToDevelop: vi.fn(),
    onboardInstalledStack: vi.fn(),
  }));

vi.mock('@/onboarding/setup-plan.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/onboarding/setup-plan.js')>();
  return { ...actual, validateSetupPlan, readSetupPlan };
});

vi.mock('@/onboarding/readiness.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/onboarding/readiness.js')>();
  return { ...actual, verifyReadinessToDevelop };
});

vi.mock('@/onboarding/onboard-installed-stack.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/onboarding/onboard-installed-stack.js')>();
  return { ...actual, onboardInstalledStack };
});

const PLAN: SetupPlan = {
  schema_version: '1',
  project_root: '/tmp/demo',
  slice: '#596 slice 3',
  created_at: '2026-10-01T00:00:00.000Z',
  steps: [
    {
      id: 'runtime',
      description: 'Install the language runtime',
      command: 'mise install node@22',
      verify: 'node --version',
      recovery: 'Install mise, then re-run.',
      version: '22',
      state: 'pending',
    },
    {
      id: 'deps',
      description: 'Install project dependencies',
      command: 'pnpm install',
      verify: 'pnpm list',
      recovery: 'corepack enable, then re-run.',
      prerequisite: 'runtime',
      state: 'completed',
    },
  ],
};

describe('createSetupCommand', () => {
  let root: string;
  let lines: string[];
  let errors: string[];

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-cli-setup-'));
    lines = [];
    errors = [];
    validateSetupPlan.mockReset();
    readSetupPlan.mockReset();
    verifyReadinessToDevelop.mockReset();
    onboardInstalledStack.mockReset();
    process.exitCode = undefined;
    vi.spyOn(console, 'log').mockImplementation((line: string) => void lines.push(String(line)));
    vi.spyOn(console, 'error').mockImplementation((line: string) => void errors.push(String(line)));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
    rmSync(root, { recursive: true, force: true });
  });

  function run(...args: string[]): Promise<unknown> {
    return createSetupCommand().parseAsync(args, { from: 'user' });
  }

  it('registers `setup` with plan/onboard/verify subcommands on the program', () => {
    const setup = createProgram().commands.find((command) => command.name() === 'setup');
    expect(setup).toBeDefined();
    const subNames = setup!.commands.map((command) => command.name());
    expect(subNames).toContain('plan');
    expect(subNames).toContain('onboard');
    expect(subNames).toContain('verify');
    const planSub = setup!.commands.find((command) => command.name() === 'plan');
    expect(planSub!.commands.map((command) => command.name())).toEqual(['validate', 'show']);
  });

  it('onboard reports the detected stack, re-derivation and a ready verdict', async () => {
    onboardInstalledStack.mockResolvedValue({
      projectRoot: root,
      onboarded: true,
      detectedFrameworks: ['react'],
      providers: ['claude-code'],
      commandsRederived: true,
      readiness: {
        ready: true,
        checks: { commandsConfigured: true, moduleDocsPresent: true },
        blockers: [],
      },
    });

    await run('onboard', '--project-root', root);

    expect(onboardInstalledStack).toHaveBeenCalledWith({ projectRoot: root, providers: undefined });
    const out = lines.join('\n');
    expect(out).toContain('onboarded the installed stack: react');
    expect(out).toContain('re-derived real commands');
    expect(out).toContain('ready to develop');
    expect(process.exitCode).toBeUndefined();
  });

  it('onboard lists readiness blockers when the stack onboarded but is not yet ready', async () => {
    onboardInstalledStack.mockResolvedValue({
      projectRoot: root,
      onboarded: true,
      detectedFrameworks: ['react'],
      providers: ['claude-code'],
      commandsRederived: false,
      readiness: {
        ready: false,
        checks: { commandsConfigured: true, moduleDocsPresent: false },
        blockers: ['module documentation missing (docs/modules/ is absent or empty)'],
      },
    });

    await run('onboard', '--providers', 'claude-code', '--project-root', root);

    expect(onboardInstalledStack).toHaveBeenCalledWith({
      projectRoot: root,
      providers: ['claude-code'],
    });
    const out = lines.join('\n');
    expect(out).toContain('kept the existing commands');
    expect(out).toContain('not yet ready to develop');
    expect(out).toContain('module documentation missing');
    expect(process.exitCode).toBeUndefined();
  });

  it('onboard exits non-zero with the recovery when no stack is detected', async () => {
    onboardInstalledStack.mockResolvedValue({
      projectRoot: root,
      onboarded: false,
      detectedFrameworks: [],
      providers: ['claude-code'],
      commandsRederived: false,
      readiness: {
        ready: false,
        checks: { commandsConfigured: false, moduleDocsPresent: false },
        blockers: [],
      },
      recovery: 'No application framework detected yet. Install your stack, then re-run.',
    });

    await run('onboard', '--project-root', root);

    const err = errors.join('\n');
    expect(err).toContain('no application stack detected');
    expect(err).toContain('Install your stack');
    expect(process.exitCode).toBe(1);
  });

  it('onboard surfaces a thrown error and exits non-zero', async () => {
    onboardInstalledStack.mockRejectedValue(new Error('No paqad workspace at /tmp/x.'));

    await run('onboard', '--project-root', root);

    expect(errors.join('\n')).toContain('No paqad workspace');
    expect(process.exitCode).toBe(1);
  });

  it('plan validate accepts a well-formed file', async () => {
    const file = join(root, 'plan.json');
    writeFileSync(file, JSON.stringify(PLAN), 'utf8');
    validateSetupPlan.mockReturnValue({ ok: true, errors: [] });

    await run('plan', 'validate', file);

    expect(validateSetupPlan).toHaveBeenCalledOnce();
    expect(lines.join('\n')).toContain('setup plan is valid');
    expect(process.exitCode).toBeUndefined();
  });

  it('plan validate reports each error and exits non-zero on an invalid file', async () => {
    const file = join(root, 'plan.json');
    writeFileSync(file, JSON.stringify(PLAN), 'utf8');
    validateSetupPlan.mockReturnValue({ ok: false, errors: ['step 1: bad', 'step 2: worse'] });

    await run('plan', 'validate', file);

    expect(errors.join('\n')).toContain('step 1: bad');
    expect(errors.join('\n')).toContain('step 2: worse');
    expect(process.exitCode).toBe(1);
  });

  it('plan validate exits non-zero when the file cannot be read as JSON', async () => {
    await run('plan', 'validate', join(root, 'does-not-exist.json'));

    expect(validateSetupPlan).not.toHaveBeenCalled();
    expect(errors.join('\n')).toContain('could not read JSON');
    expect(process.exitCode).toBe(1);
  });

  it('plan show prints each step and its state', async () => {
    readSetupPlan.mockReturnValue(PLAN);

    await run('plan', 'show', '--project-root', root);

    const out = lines.join('\n');
    expect(out).toContain('#596 slice 3');
    expect(out).toContain('[pending] runtime');
    expect(out).toContain('[completed] deps');
    expect(out).toContain('after runtime');
  });

  it('plan show reports clearly when no plan is recorded', async () => {
    readSetupPlan.mockReturnValue(null);

    await run('plan', 'show', '--project-root', root);

    expect(lines.join('\n')).toContain('No setup plan recorded');
  });

  it('verify reports ready and exits zero', async () => {
    verifyReadinessToDevelop.mockReturnValue({
      ready: true,
      checks: { commandsConfigured: true, moduleDocsPresent: true },
      blockers: [],
    });

    await run('verify', '--project-root', root);

    expect(verifyReadinessToDevelop).toHaveBeenCalledWith(root);
    expect(lines.join('\n')).toContain('ready to develop');
    expect(process.exitCode).toBeUndefined();
  });

  it('verify lists blockers and exits non-zero when not ready', async () => {
    verifyReadinessToDevelop.mockReturnValue({
      ready: false,
      checks: { commandsConfigured: false, moduleDocsPresent: false },
      blockers: ['application stack still undecided'],
    });

    await run('verify', '--project-root', root);

    expect(errors.join('\n')).toContain('application stack still undecided');
    expect(process.exitCode).toBe(1);
  });
});
