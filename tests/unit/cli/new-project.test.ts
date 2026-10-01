import { FrameworkError } from '@/core/errors/index.js';
import { createNewProjectCommand } from '@/cli/commands/new-project.js';
import { createProgram } from '@/cli/program.js';

const { createProjectWorkspace } = vi.hoisted(() => ({
  createProjectWorkspace: vi.fn(),
}));

vi.mock('@/onboarding/create-project.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/onboarding/create-project.js')>();
  return { ...actual, createProjectWorkspace };
});

function run(args: string[]): Promise<unknown> {
  return createNewProjectCommand().parseAsync(args, { from: 'user' });
}

describe('createNewProjectCommand', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    createProjectWorkspace.mockReset();
    process.exitCode = undefined;
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    warnSpy.mockRestore();
    process.exitCode = undefined;
    vi.restoreAllMocks();
  });

  it('registers `new project` under the program', () => {
    const newCommand = createProgram().commands.find((command) => command.name() === 'new');
    expect(newCommand).toBeDefined();
    expect(newCommand!.commands.map((command) => command.name())).toContain('project');
  });

  it('wires the name/parent/providers through to createProjectWorkspace', async () => {
    createProjectWorkspace.mockResolvedValue({
      projectRoot: '/tmp/demo/my-app',
      created: true,
      gitInitialized: true,
      stack: 'undecided',
      generatedFiles: ['CLAUDE.md'],
      preserved: [],
    });

    await run(['project', 'my-app', '--parent-dir', '/tmp/demo', '--provider', 'claude-code']);

    expect(createProjectWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'my-app',
        parentDir: '/tmp/demo',
        providers: ['claude-code'],
        force: undefined,
      }),
    );
  });

  it('prints that the application stack is undecided and names the next step', async () => {
    createProjectWorkspace.mockResolvedValue({
      projectRoot: '/tmp/demo/my-app',
      created: true,
      gitInitialized: true,
      stack: 'undecided',
      generatedFiles: ['CLAUDE.md'],
      preserved: [],
    });

    await run(['project', 'my-app']);

    const output = logSpy.mock.calls.map((call) => String(call[0])).join('\n');
    expect(output).toContain('UNDECIDED');
    expect(output).toMatch(/NEXT STEP/i);
    expect(output).toContain('git initialized');
  });

  it('forwards an explicit --rag opt-in as a RagSelection', async () => {
    createProjectWorkspace.mockResolvedValue({
      projectRoot: '/tmp/demo/r',
      created: true,
      gitInitialized: false,
      stack: 'undecided',
      generatedFiles: [],
      preserved: [],
    });

    await run(['project', 'r', '--rag']);

    expect(createProjectWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ rag: { enabled: true } }),
    );
  });

  it('leaves rag unset when neither --rag nor --no-rag is given', async () => {
    createProjectWorkspace.mockResolvedValue({
      projectRoot: '/tmp/demo/r',
      created: true,
      gitInitialized: false,
      stack: 'undecided',
      generatedFiles: [],
      preserved: [],
    });

    await run(['project', 'r']);

    expect(createProjectWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ rag: undefined }),
    );
  });

  it('prints the Codex trust hint when codex-cli is a provider', async () => {
    createProjectWorkspace.mockResolvedValue({
      projectRoot: '/tmp/demo/c',
      created: true,
      gitInitialized: true,
      stack: 'undecided',
      generatedFiles: [],
      preserved: [],
    });

    await run(['project', 'c', '--provider', 'codex-cli']);

    const output = logSpy.mock.calls.map((call) => String(call[0])).join('\n');
    expect(output).toMatch(/\/hooks/);
  });

  it('surfaces a recovery note when one is returned', async () => {
    createProjectWorkspace.mockResolvedValue({
      projectRoot: '/tmp/demo/r',
      created: true,
      gitInitialized: false,
      stack: 'undecided',
      generatedFiles: [],
      preserved: [],
      recovery: 'git init failed (no git); initialize version control yourself.',
    });

    await run(['project', 'r']);

    const warnings = warnSpy.mock.calls.map((call) => String(call[0])).join('\n');
    expect(warnings).toContain('git init failed');
  });

  it('prints an actionable message and sets a non-zero exit code on a non-empty directory', async () => {
    createProjectWorkspace.mockRejectedValue(
      new FrameworkError('Refusing to create a workspace in a non-empty directory: /tmp/x.', {
        code: 'PROJECT_DIR_NOT_EMPTY',
      }),
    );

    await run(['project', 'x']);

    const errors = errorSpy.mock.calls.map((call) => String(call[0])).join('\n');
    expect(errors).toContain('non-empty directory');
    expect(process.exitCode).toBe(1);
  });

  it('rethrows unexpected errors unchanged', async () => {
    createProjectWorkspace.mockRejectedValue(new Error('boom'));
    await expect(run(['project', 'x'])).rejects.toThrow('boom');
  });
});
