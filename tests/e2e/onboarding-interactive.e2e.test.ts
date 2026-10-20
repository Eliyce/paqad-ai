import { execa, execaSync } from 'execa';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const cliPath = join(process.cwd(), 'dist/cli/index.js');
const buildLockRoot = join(process.cwd(), '.tmp');
const buildLockDir = join(process.cwd(), '.tmp', 'built-cli-pty.lock');

async function ensureBuiltCli(): Promise<void> {
  if (existsSync(cliPath) && !existsSync(buildLockDir)) {
    return;
  }

  mkdirSync(buildLockRoot, { recursive: true });

  while (true) {
    try {
      mkdirSync(buildLockDir, { recursive: false });
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error;
      }
      if (existsSync(cliPath) && !existsSync(buildLockDir)) {
        return;
      }
      await sleep(100);
    }
  }

  try {
    if (!existsSync(cliPath)) {
      await execa('pnpm', ['run', 'build'], { cwd: process.cwd() });
    }
  } finally {
    rmSync(buildLockDir, { recursive: true, force: true });
  }
}

function hasExpect(): boolean {
  try {
    execaSync('expect', ['-v']);
    return true;
  } catch {
    return false;
  }
}

const CORE_PHASE1_ARTIFACTS = [
  '.paqad/project-profile.yaml',
  '.paqad/detection-report.json',
  '.paqad/framework-version.txt',
  '.paqad/framework-path.txt',
  '.paqad/onboarding-manifest.json',
  '.paqad/compiled-rules.json',
  'CLAUDE.md',
];

function buildExpectScript(opts: { projectRoot: string; cliPath: string }): string {
  return `
set timeout 120
log_user 0
cd "${opts.projectRoot}"
spawn node "${opts.cliPath}" onboard --project-root "${opts.projectRoot}"

set spawned_pid [exp_pid]
set rag_handled 0

expect {
    -re "Want to enable this" {
        if {!$rag_handled} {
            set rag_handled 1
            send "\\033\\[B"
            send "\\r"
            # Phase 2 with "No, skip" performs at most one idempotent
            # writeProjectProfile of intelligence=default-off. Give it a generous
            # window to finish, then SIGKILL and exit immediately. The spawned
            # process may park its event loop on a stuck inquirer/readline handle
            # (the very hang the phase split protects against), so we cannot rely on a
            # clean SIGTERM exit. Every phase 1 artifact is already on disk by
            # the time the RAG prompt opens — killing here cannot drop data the
            # test is asserting on.
            after 2000
            catch {exec kill -KILL $spawned_pid}
        } else {
            exp_continue
        }
    }
    -re "Which AI provider" { send "\\r"; exp_continue }
    -re "Which stack is this project using" { send "\\r"; exp_continue }
    -re "Are you using Inertia.js" { send "\\r"; exp_continue }
    -re "Which frontend framework" { send "\\r"; exp_continue }
    -re "Are you using Tailwind" { send "\\r"; exp_continue }
    -re "Are you using Laravel Boost" { send "\\r"; exp_continue }
    -re "Which testing framework" { send "\\r"; exp_continue }
    -re "Are you using Laravel Sail" { send "\\r"; exp_continue }
    -re "Are you using Docker Compose" { send "\\r"; exp_continue }
    -re "Are you using Docker" { send "\\r"; exp_continue }
    -re "Continue with this detected stack profile" { send "\\r"; exp_continue }
    -re "ONBOARDING COMPLETE" { exp_continue }
    eof {}
    timeout {}
}

catch {close}
exit 0
`;
}

describe.runIf(hasExpect())('onboarding interactive PTY E2E', () => {
  let projectRoot: string;
  let originalFrameworkHome: string | undefined;

  beforeAll(async () => {
    await ensureBuiltCli();
  });

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'paqad-pty-onboard-'));
    originalFrameworkHome = process.env.PAQAD_FRAMEWORK_HOME;
    process.env.PAQAD_FRAMEWORK_HOME = join(projectRoot, '.framework-home');

    writeFileSync(join(projectRoot, 'artisan'), '');
    writeFileSync(
      join(projectRoot, 'composer.json'),
      JSON.stringify({ require: { 'laravel/framework': '^12.0' } }),
    );
    mkdirSync(join(projectRoot, 'app'), { recursive: true });
    writeFileSync(join(projectRoot, 'app', '.gitkeep'), '');
    mkdirSync(join(projectRoot, 'routes'), { recursive: true });
    writeFileSync(join(projectRoot, 'routes', '.gitkeep'), '');
  });

  afterEach(() => {
    if (originalFrameworkHome === undefined) {
      delete process.env.PAQAD_FRAMEWORK_HOME;
    } else {
      process.env.PAQAD_FRAMEWORK_HOME = originalFrameworkHome;
    }
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it(
    'writes the full .paqad/** artifact set when the user picks "No, skip" on RAG',
    { timeout: 240_000 },
    async () => {
      const script = buildExpectScript({ projectRoot, cliPath });
      const result = await execa('expect', ['-c', script], { reject: false });

      const missing = CORE_PHASE1_ARTIFACTS.filter(
        (artifact) => !existsSync(join(projectRoot, artifact)),
      );

      const ctx = `expect_exit=${result.exitCode}\nexpect_stdout=${result.stdout}\nexpect_stderr=${result.stderr}`;
      expect(missing, `missing artifacts after No,skip:\n${missing.join('\n')}\n${ctx}`).toEqual(
        [],
      );
    },
  );
});
