import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import YAML from 'yaml';

import {
  JOIN_NOT_ONBOARDED_MESSAGE,
  JOIN_RAG_BUILDING_MESSAGE,
  JOIN_RAG_OFF_MESSAGE,
  JOIN_RAG_PRESENT_MESSAGE,
  JOIN_READY_MESSAGE,
  createJoinCommand,
  deriveRecordedProviders,
  joinProject,
} from '@/cli/commands/join.js';
import { createProgram } from '@/cli/program.js';
import { RagService } from '@/rag/service.js';

const { promptConfirm } = vi.hoisted(() => ({ promptConfirm: vi.fn() }));

vi.mock('@inquirer/prompts', () => ({
  confirm: promptConfirm,
  input: vi.fn(),
  select: vi.fn(),
}));

function write(path: string, body: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body, 'utf8');
}

function seedOnboardedProject(root: string): void {
  write(
    join(root, '.paqad/project-profile.yaml'),
    YAML.stringify({
      project: { name: 'Demo', id: 'demo', description: 'Demo' },
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
        generated_artifacts: [
          { path: 'AGENTS.md', auto_update: true },
          { path: 'CLAUDE.md', auto_update: true },
        ],
      },
      null,
      2,
    )}\n`,
  );
  write(join(root, '.paqad/configs/.config.rag'), '# rag_enabled=false\n');
  write(
    join(root, '.paqad/.gitignore'),
    '.agent-entry-loaded\nframework-version.txt\ncompiled-rules.json\ncontext/\nvectors/\n',
  );
  write(
    join(root, 'docs/instructions/rules/constitution.md'),
    '# Constitution\n\n- Keep it safe.\n',
  );
  write(join(root, '.gitignore'), '.codex/cache.json\n.codex/memory.json\n');
  write(join(root, 'AGENTS.md'), 'tracked agent entry\n');
  write(join(root, 'CLAUDE.md'), 'tracked second provider\n');
  execFileSync('git', ['init', '--quiet'], { cwd: root });
}

describe('paqad-ai join', () => {
  let root: string;
  let output: string[];

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-join-'));
    output = [];
    promptConfirm.mockReset().mockResolvedValue(true);
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      output.push(String(chunk));
      return true;
    });
    vi.spyOn(RagService.prototype, 'getStatus').mockResolvedValue({
      enabled: true,
      configured_provider: 'local',
      configured_model: 'Xenova/all-MiniLM-L6-v2',
      index_present: false,
      valid: false,
      chunk_count: 0,
      size_bytes: 0,
    });
    vi.spyOn(RagService.prototype, 'configureAndBuild').mockResolvedValue({
      enabled: true,
      configured_provider: 'local',
      configured_model: 'Xenova/all-MiniLM-L6-v2',
      index_present: true,
      valid: true,
      chunk_count: 1,
      size_bytes: 100,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(root, { recursive: true, force: true });
  });

  it('is registered with the non-interactive teammate setup flags', () => {
    expect(createProgram().commands.map((command) => command.name())).toContain('join');
    const command = createJoinCommand();
    expect(command.description()).toBe(
      'Set up an already-onboarded project on your machine (no re-onboarding)',
    );
    expect(command.options.map((option) => option.long)).toEqual([
      '--project-root',
      '--interactive',
      '--no-rag',
      '--yes',
    ]);
  });

  it('rejects a project without committed onboarding truth', async () => {
    await expect(joinProject({ projectRoot: root })).rejects.toThrow(JOIN_NOT_ONBOARDED_MESSAGE);
    expect(existsSync(join(root, '.paqad'))).toBe(false);
  });

  it('derives every recorded provider while keeping the primary adapter first', () => {
    expect(
      deriveRecordedProviders({
        adapter: 'codex-cli',
        project_root: '.',
        profile: {} as never,
        detected: null,
        generated_at: '',
        generated_artifacts: [
          { path: 'CLAUDE.md', auto_update: true },
          { path: 'AGENTS.md', auto_update: true },
        ],
      }),
    ).toEqual(['codex-cli', 'claude-code']);
  });

  it('recreates ignored local artifacts, preserves tracked entries, and skips RAG when off', async () => {
    seedOnboardedProject(root);

    await joinProject({ projectRoot: root });

    expect(readFileSync(join(root, 'AGENTS.md'), 'utf8')).toBe('tracked agent entry\n');
    expect(existsSync(join(root, '.codex/cache.json'))).toBe(true);
    expect(existsSync(join(root, '.codex/memory.json'))).toBe(true);
    expect(existsSync(join(root, '.paqad/compiled-rules.json'))).toBe(true);
    expect(existsSync(join(root, '.paqad/context/session-context.md'))).toBe(true);
    expect(existsSync(join(root, '.paqad/framework-version.txt'))).toBe(true);
    expect(existsSync(join(root, '.paqad/.agent-entry-loaded'))).toBe(true);
    expect(output.join('')).toContain(JOIN_RAG_OFF_MESSAGE);
    expect(output.join('')).toContain(JOIN_READY_MESSAGE);
    expect(promptConfirm).not.toHaveBeenCalled();
    expect(RagService.prototype.configureAndBuild).not.toHaveBeenCalled();
  });

  it('does not overwrite local-artifact paths when the repository tracks them', async () => {
    seedOnboardedProject(root);
    write(join(root, '.paqad/.gitignore'), 'vectors/\n');
    const trackedArtifacts = new Map([
      ['.paqad/compiled-rules.json', 'tracked compiled rules\n'],
      ['.paqad/context/session-context.md', 'tracked context\n'],
      ['.paqad/framework-version.txt', 'tracked version\n'],
      ['.paqad/.agent-entry-loaded', 'tracked sentinel\n'],
    ]);
    for (const [path, content] of trackedArtifacts) {
      write(join(root, path), content);
    }

    await joinProject({ projectRoot: root, rag: false });

    for (const [path, content] of trackedArtifacts) {
      expect(readFileSync(join(root, path), 'utf8')).toBe(content);
    }
  });

  it('skips an already-valid RAG index', async () => {
    seedOnboardedProject(root);
    write(join(root, '.paqad/configs/.config.rag'), 'rag_enabled=true\n');
    vi.mocked(RagService.prototype.getStatus).mockResolvedValue({
      enabled: true,
      configured_provider: 'local',
      configured_model: 'Xenova/all-MiniLM-L6-v2',
      index_present: true,
      valid: true,
      chunk_count: 3,
      size_bytes: 300,
    });

    await joinProject({ projectRoot: root });

    expect(output.join('')).toContain(JOIN_RAG_PRESENT_MESSAGE);
    expect(RagService.prototype.configureAndBuild).not.toHaveBeenCalled();
  });

  it('builds a missing team-enabled index without provider or stack prompts', async () => {
    seedOnboardedProject(root);
    write(
      join(root, '.paqad/configs/.config.rag'),
      'rag_enabled=true\nrag_embedding_provider=local\nrag_embedding_model=Xenova/all-MiniLM-L6-v2\n',
    );

    await joinProject({ projectRoot: root, interactive: true, yes: true });

    expect(output.join('')).toContain(JOIN_RAG_BUILDING_MESSAGE);
    expect(RagService.prototype.configureAndBuild).toHaveBeenCalledWith(
      expect.objectContaining({
        rag_enabled: true,
        embedding_provider: 'local',
        embedding_model: 'Xenova/all-MiniLM-L6-v2',
      }),
      expect.any(Function),
    );
    expect(promptConfirm).not.toHaveBeenCalled();
  });

  it('honors a local RAG-off override above team enablement', async () => {
    seedOnboardedProject(root);
    write(join(root, '.paqad/configs/.config.rag'), 'rag_enabled=true\n');
    write(join(root, '.paqad/.config'), 'rag_enabled=false\n');

    await joinProject({ projectRoot: root });

    expect(output.join('')).toContain(JOIN_RAG_OFF_MESSAGE);
    expect(RagService.prototype.getStatus).not.toHaveBeenCalled();
    expect(RagService.prototype.configureAndBuild).not.toHaveBeenCalled();
  });

  it('asks before an interactive build unless --yes is supplied', async () => {
    seedOnboardedProject(root);
    write(join(root, '.paqad/configs/.config.rag'), 'rag_enabled=true\n');
    promptConfirm.mockResolvedValue(false);

    await joinProject({ projectRoot: root, interactive: true });

    expect(promptConfirm).toHaveBeenCalledOnce();
    expect(RagService.prototype.configureAndBuild).not.toHaveBeenCalled();
    expect(output.join('')).not.toContain(JOIN_READY_MESSAGE);
  });
});
