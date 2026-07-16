import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import YAML from 'yaml';

import { joinProject } from '@/cli/commands/join.js';

function write(path: string, body: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body, 'utf8');
}

function seedTrackedOnboarding(root: string): void {
  write(
    join(root, '.paqad/project-profile.yaml'),
    YAML.stringify({
      project: { name: 'Cloned project', id: 'clone', description: 'Join fixture' },
      active_capabilities: ['content', 'coding', 'security'],
      stack_profile: {
        frameworks: ['node-cli'],
        traits: ['typescript'],
        toolchains: [],
        version_bands: [],
        sources: [],
      },
      commands: {
        install: 'pnpm install',
        dev: 'pnpm dev',
        test: 'pnpm test',
        test_single: 'pnpm test -- one',
        lint: 'pnpm lint',
        format: 'pnpm format',
        migrate: 'pnpm migrate',
        build: 'pnpm build',
      },
      compliance_packs: [],
      mcp: { servers: [] },
      custom: { classification_dimensions: [], verification_plugins: [], escalation_rules: [] },
    }),
  );
  write(
    join(root, '.paqad/onboarding-manifest.json'),
    `${JSON.stringify(
      {
        adapter: 'codex-cli',
        project_root: '.',
        profile: {},
        detected: null,
        generated_at: '2026-01-01T00:00:00.000Z',
        generated_artifacts: [{ path: 'AGENTS.md', auto_update: true }],
      },
      null,
      2,
    )}\n`,
  );
  write(join(root, '.paqad/configs/.config.rag'), '# rag_enabled=false\n');
  write(join(root, '.paqad/framework-path.txt'), '~/.paqad-ai/current\n');
  write(
    join(root, '.paqad/.gitignore'),
    '.agent-entry-loaded\nframework-version.txt\ncompiled-rules.json\ncontext/\nvectors/\n',
  );
  write(join(root, 'docs/instructions/rules/constitution.md'), '# Constitution\n\n- Safe.\n');
  write(join(root, '.gitignore'), '.codex/cache.json\n.codex/memory.json\n');
  write(join(root, 'AGENTS.md'), 'tracked agent entry\n');
}

describe('paqad-ai join — cloned project', () => {
  let temp: string;

  beforeEach(() => {
    temp = mkdtempSync(join(tmpdir(), 'paqad-join-e2e-'));
  });

  afterEach(() => {
    rmSync(temp, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('recreates ignored machine files in a fresh clone without a tracked diff', async () => {
    const source = join(temp, 'source');
    const clone = join(temp, 'clone');
    mkdirSync(source, { recursive: true });
    seedTrackedOnboarding(source);
    execFileSync('git', ['init', '--quiet'], { cwd: source });
    execFileSync('git', ['config', 'user.email', 'join@example.test'], { cwd: source });
    execFileSync('git', ['config', 'user.name', 'Join Fixture'], { cwd: source });
    execFileSync('git', ['add', '.'], { cwd: source });
    execFileSync('git', ['commit', '--quiet', '-m', 'onboard project'], { cwd: source });
    execFileSync('git', ['clone', '--quiet', source, clone], { cwd: temp });
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await joinProject({ projectRoot: clone, rag: false });

    expect(existsSync(join(clone, '.codex/cache.json'))).toBe(true);
    expect(existsSync(join(clone, '.codex/memory.json'))).toBe(true);
    expect(existsSync(join(clone, '.paqad/compiled-rules.json'))).toBe(true);
    expect(existsSync(join(clone, '.paqad/context/session-context.md'))).toBe(true);
    expect(existsSync(join(clone, '.paqad/framework-version.txt'))).toBe(true);
    expect(execFileSync('git', ['status', '--porcelain'], { cwd: clone, encoding: 'utf8' })).toBe(
      '',
    );
  });
});
