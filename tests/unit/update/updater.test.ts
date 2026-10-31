import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import YAML from 'yaml';

import { VERSION } from '@/index.js';
import { PAQAD_SCHEMA_VERSION } from '@/core/constants/schema.js';
import { generateConfigExample } from '@/core/framework-config.js';
import { schemaMarkerPath, schemaMigrationLogPath } from '@/core/schema-version.js';
import { FrameworkUpdater } from '@/update/index.js';

describe('FrameworkUpdater', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'paqad-ai-update-'));
    mkdirSync(join(projectRoot, '.paqad'), { recursive: true });
    writeFileSync(
      join(projectRoot, '.paqad/framework-version.txt'),
      'version=0.0.0\nupdated_at=2020-01-01T00:00:00.000Z\n',
    );
    writeFileSync(
      join(projectRoot, '.paqad/project-profile.yaml'),
      YAML.stringify({
        project: { name: 'Demo', id: 'demo', description: 'Demo' },
        routing: { domain: 'coding', stack: 'laravel', capabilities: [] },
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
        strictness: {
          full_lane_default: false,
          require_adversarial_review: true,
          block_on_stale_docs: true,
          require_db_review_for_migrations: true,
        },
        compliance_packs: [],
        features: {
          spec_only_mode: false,
          market_research: false,
          design_research: false,
          team_agents: true,
        },
        mcp: { servers: [] },
        model_routing: {
          default_model: 'gpt-5',
          reasoning_model: 'gpt-5',
          fast_model: 'gpt-5-mini',
        },
        research: { depth: 'standard' },
        efficiency: {
          context_hit_rate_target: 0.7,
          skill_caching: true,
          differential_refresh: true,
          mcp_first: true,
        },
        escalation: {
          destructive_operations: 'block',
          risky_migrations: 'warn',
          security_findings: 'block',
          db_row_threshold: 10,
        },
        custom: {
          classification_dimensions: [],
          verification_plugins: [],
          escalation_rules: [],
        },
      }),
    );
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('updates framework-managed artifacts and reports version changes', async () => {
    writeFileSync(
      join(projectRoot, '.paqad/onboarding-manifest.json'),
      JSON.stringify(
        {
          framework_version: '0.0.0',
          adapter: 'claude-code',
          project_root: projectRoot,
          profile: {},
          detected: null,
          generated_at: new Date().toISOString(),
          generated_artifacts: [{ path: 'CLAUDE.md', auto_update: true }],
        },
        null,
        2,
      ),
    );
    writeFileSync(join(projectRoot, 'CLAUDE.md'), 'old');

    const updater = new FrameworkUpdater({
      generateCandidates: async () => [
        {
          path: 'CLAUDE.md',
          content: 'new',
          autoUpdate: true,
        },
      ],
    });

    const report = await updater.run(projectRoot);

    expect(report.previous_version).toBe('0.0.0');
    expect(report.target_version).toBe(VERSION);
    expect(report.regenerated).toEqual(['CLAUDE.md']);
    expect(readFileSync(join(projectRoot, 'CLAUDE.md'), 'utf8')).toBe('new');
    const versionFileContent = readFileSync(
      join(projectRoot, '.paqad/framework-version.txt'),
      'utf8',
    );
    expect(versionFileContent).toMatch(/^version=/m);
    expect(versionFileContent).toContain(`version=${VERSION}`);
    expect(versionFileContent).toMatch(/^updated_at=/m);
  });

  it('leaves the tracked config of a newer checkout byte-identical on update', async () => {
    const newerExample = generateConfigExample('999.0.0');
    const app = '# team header\nenterprise=true\nfuture_knob=on\n';
    mkdirSync(join(projectRoot, '.paqad/configs'), { recursive: true });
    writeFileSync(join(projectRoot, '.paqad/.config.example'), newerExample);
    writeFileSync(join(projectRoot, '.paqad/configs/.config.app'), app);

    const report = await new FrameworkUpdater({ generateCandidates: async () => [] }).run(
      projectRoot,
    );

    expect(readFileSync(join(projectRoot, '.paqad/.config.example'), 'utf8')).toBe(newerExample);
    expect(readFileSync(join(projectRoot, '.paqad/configs/.config.app'), 'utf8')).toBe(app);
    expect(report.config_keys_pruned).toEqual([]);
  });

  it('refreshes the tracked config as before when the stamp matches this version', async () => {
    mkdirSync(join(projectRoot, '.paqad/configs'), { recursive: true });
    writeFileSync(join(projectRoot, '.paqad/.config.example'), generateConfigExample());
    writeFileSync(join(projectRoot, '.paqad/configs/.config.app'), 'future_knob=on\n');

    await new FrameworkUpdater({ generateCandidates: async () => [] }).run(projectRoot);

    expect(readFileSync(join(projectRoot, '.paqad/.config.example'), 'utf8')).toBe(
      generateConfigExample(),
    );
    const app = readFileSync(join(projectRoot, '.paqad/configs/.config.app'), 'utf8');
    expect(app).not.toContain('future_knob');
    expect(app).toMatch(/^# auto_update=true$/m);
  });

  it('AC-6: adds a missing managed ignore line and keeps every line outside the managed block', async () => {
    const begin = '# >>> paqad-ai managed (do not edit between markers) >>>';
    const end = '# <<< paqad-ai managed <<<';
    const before = '# team lines\nmy-cache/\n\n';
    const after = '\n# after the block\nnotes.txt\n';
    writeFileSync(
      join(projectRoot, '.paqad/.gitignore'),
      `${before}${begin}\n.agent-entry-loaded\nvectors/\n${end}${after}`,
    );

    await new FrameworkUpdater({ generateCandidates: async () => [] }).run(projectRoot);

    const text = readFileSync(join(projectRoot, '.paqad/.gitignore'), 'utf8');
    const block = text.slice(text.indexOf(begin), text.indexOf(end));
    expect(block.split('\n')).toContain('.agent-entry-loaded.d/');
    expect(block.split('\n')).toContain('locks/');
    expect(block.split('\n')).toContain('vectors/');
    expect(text.startsWith(before)).toBe(true);
    expect(text.endsWith(after)).toBe(true);
  });

  it('adds the local config line to .worktreeinclude and keeps the existing lines', async () => {
    writeFileSync(join(projectRoot, '.worktreeinclude'), 'secrets/dev.env\n.env.local\n');

    await new FrameworkUpdater({ generateCandidates: async () => [] }).run(projectRoot);

    expect(readFileSync(join(projectRoot, '.worktreeinclude'), 'utf8')).toBe(
      'secrets/dev.env\n.env.local\n.paqad/.config\n',
    );
  });

  it('leaves the git index, deprecated artifacts and the root ignore file untouched', async () => {
    const git = (...args: string[]) =>
      execFileSync('git', args, { cwd: projectRoot, stdio: ['ignore', 'pipe', 'ignore'] })
        .toString('utf8')
        .trim();
    git('init', '-q');
    mkdirSync(join(projectRoot, '.paqad/session'), { recursive: true });
    writeFileSync(join(projectRoot, '.paqad/session/state.json'), '{}\n');
    writeFileSync(join(projectRoot, '.paqad/version'), '1.0.0\n');
    const rootIgnore =
      'node_modules/\n\n# >>> paqad-ai managed (do not edit between markers) >>>\nvectors/\n# <<< paqad-ai managed <<<\n';
    writeFileSync(join(projectRoot, '.gitignore'), rootIgnore);
    git('add', '-f', '.paqad/session/state.json', '.paqad/version', '.gitignore');
    const indexBefore = git('ls-files', '-s');

    await new FrameworkUpdater({ generateCandidates: async () => [] }).run(projectRoot);

    expect(git('ls-files', '-s')).toBe(indexBefore);
    expect(existsSync(join(projectRoot, '.paqad/version'))).toBe(true);
    expect(readFileSync(join(projectRoot, '.gitignore'), 'utf8')).toBe(rootIgnore);
    expect(readFileSync(join(projectRoot, '.paqad/.gitignore'), 'utf8')).toContain('session/');
  });

  it('leaves the managed ignore file alone when the checkout is newer', async () => {
    writeFileSync(join(projectRoot, '.paqad/.config.example'), generateConfigExample('999.0.0'));
    const ignore =
      '# >>> paqad-ai managed (do not edit between markers) >>>\nfuture/\n# <<< paqad-ai managed <<<\n';
    writeFileSync(join(projectRoot, '.paqad/.gitignore'), ignore);

    await new FrameworkUpdater({ generateCandidates: async () => [] }).run(projectRoot);

    expect(readFileSync(join(projectRoot, '.paqad/.gitignore'), 'utf8')).toBe(ignore);
  });

  it('migrates an already-onboarded project schema forward on update (buildout F1, C4)', async () => {
    writeFileSync(
      schemaMarkerPath(projectRoot),
      JSON.stringify({
        paqad_schema_version: '0.9.0',
        written_at: '2025-01-01T00:00:00.000Z',
        written_by_engine_version: '0.9.0',
      }),
    );

    const updater = new FrameworkUpdater({ generateCandidates: async () => [] });
    await updater.run(projectRoot);

    const marker = JSON.parse(readFileSync(schemaMarkerPath(projectRoot), 'utf8'));
    expect(marker.paqad_schema_version).toBe(PAQAD_SCHEMA_VERSION);
    const log = readFileSync(schemaMigrationLogPath(projectRoot), 'utf8').trim().split('\n');
    expect(log).toHaveLength(1);
    expect(JSON.parse(log[0])).toMatchObject({
      from_version: '0.9.0',
      to_version: PAQAD_SCHEMA_VERSION,
    });
  });

  it('finishes a pending evidence migration on a later update', async () => {
    writeFileSync(
      schemaMarkerPath(projectRoot),
      JSON.stringify({
        paqad_schema_version: PAQAD_SCHEMA_VERSION,
        written_at: '2025-01-01T00:00:00.000Z',
        written_by_engine_version: VERSION,
      }),
    );
    const run = '300-gamma-01JABCDEFGHJKMNPQRSTVWXYZ3';
    mkdirSync(join(projectRoot, '.paqad/_specs', run, 'pipeline'), { recursive: true });
    writeFileSync(join(projectRoot, '.paqad/_specs', run, 'pipeline/request.md'), '# Gamma\n');

    await new FrameworkUpdater({ generateCandidates: async () => [] }).run(projectRoot);

    expect(existsSync(join(projectRoot, '.paqad/_specs'))).toBe(false);
    expect(
      readFileSync(join(projectRoot, '.paqad/ledger/feature-evidence', run, 'request.md'), 'utf8'),
    ).toContain('# Gamma');
  });

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'goes on with the update when the evidence migration cannot delete a file',
    async () => {
      const run = '300-gamma-01JABCDEFGHJKMNPQRSTVWXYZ3';
      mkdirSync(join(projectRoot, '.paqad/_specs', run, 'pipeline'), { recursive: true });
      writeFileSync(join(projectRoot, '.paqad/_specs', run, 'pipeline/request.md'), '# Gamma\n');
      chmodSync(join(projectRoot, '.paqad/_specs'), 0o500);
      try {
        const report = await new FrameworkUpdater({ generateCandidates: async () => [] }).run(
          projectRoot,
        );
        expect(report.target_version).toBe(VERSION);
        expect(existsSync(join(projectRoot, '.paqad/_specs', run))).toBe(true);
      } finally {
        chmodSync(join(projectRoot, '.paqad/_specs'), 0o700);
      }
    },
  );

  it('refuses to update a project whose schema is newer than this engine (D2 refuse)', async () => {
    writeFileSync(
      schemaMarkerPath(projectRoot),
      JSON.stringify({
        paqad_schema_version: '2.0.0',
        written_at: '2027-01-01T00:00:00.000Z',
        written_by_engine_version: '2.0.0',
      }),
    );

    const updater = new FrameworkUpdater({ generateCandidates: async () => [] });
    await expect(updater.run(projectRoot)).rejects.toThrow(/newer than this engine/);
  });

  it('skips user-managed artifacts and produces a diff report', async () => {
    writeFileSync(
      join(projectRoot, '.paqad/onboarding-manifest.json'),
      JSON.stringify(
        {
          framework_version: '0.0.0',
          adapter: 'claude-code',
          project_root: projectRoot,
          profile: {},
          detected: null,
          generated_at: new Date().toISOString(),
          generated_artifacts: [{ path: 'docs/rules/team.md', auto_update: false }],
        },
        null,
        2,
      ),
    );
    mkdirSync(join(projectRoot, 'docs/rules'), { recursive: true });
    writeFileSync(join(projectRoot, 'docs/rules/team.md'), 'current rule');

    const updater = new FrameworkUpdater({
      generateCandidates: async () => [
        {
          path: 'docs/rules/team.md',
          content: 'framework rule',
          autoUpdate: true,
        },
        {
          path: 'scripts/new-script.sh',
          content: '#!/usr/bin/env bash\necho ok\n',
          autoUpdate: true,
          executable: true,
        },
      ],
    });

    const report = await updater.run(projectRoot);

    expect(report.regenerated).toEqual(['scripts/new-script.sh']);
    expect(report.new_scripts).toEqual(['scripts/new-script.sh']);
    expect(report.skipped).toEqual([
      {
        path: 'docs/rules/team.md',
        before: 'current rule',
        after: 'framework rule',
      },
    ]);
    expect(readFileSync(join(projectRoot, 'docs/rules/team.md'), 'utf8')).toBe('current rule');
    expect(existsSync(join(projectRoot, 'scripts/new-script.sh'))).toBe(true);
  });
  describe('legacy MCP files on update', () => {
    let userHome: string;
    const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
    const userOwned = (name: string): string =>
      `${JSON.stringify({ mcpServers: { [name]: { command: 'npx', args: [name] } } }, null, 2)}\n`;

    beforeEach(() => {
      userHome = mkdtempSync(join(tmpdir(), 'paqad-update-mcp-home-'));
      process.env.HOME = userHome;
      process.env.USERPROFILE = userHome;
    });

    afterEach(() => {
      rmSync(userHome, { recursive: true, force: true });
      for (const key of ['HOME', 'USERPROFILE'] as const) {
        if (saved[key] === undefined) delete process.env[key];
        else process.env[key] = saved[key];
      }
    });

    it('keeps user-owned MCP files byte-identical and deletes paqad-written ones (AC-5, AC-6)', async () => {
      const fixtures = new Map([
        ['.cursor/mcp.json', userOwned('cursor-server')],
        ['.vscode/mcp.json', userOwned('vscode-server')],
        ['.junie/mcp/mcp.json', userOwned('junie-server')],
      ]);
      for (const [path, content] of fixtures) {
        mkdirSync(join(projectRoot, path, '..'), { recursive: true });
        writeFileSync(join(projectRoot, path), content);
      }
      mkdirSync(join(projectRoot, '.claude'), { recursive: true });
      writeFileSync(
        join(projectRoot, '.claude/settings.mcp.json'),
        JSON.stringify({ mcpServers: { figma: { enabled: true } }, resolved_artifacts: [] }),
      );

      const report = await new FrameworkUpdater().run(projectRoot);

      for (const [path, content] of fixtures) {
        expect(readFileSync(join(projectRoot, path), 'utf8')).toBe(content);
      }
      expect(existsSync(join(projectRoot, '.claude/settings.mcp.json'))).toBe(false);
      expect(report.regenerated.some((path) => path.endsWith('mcp.json'))).toBe(false);
      expect(report.regenerated).toContain('.paqad/mcp-recommendations.json');
    });
  });

  describe('stage-agent generation on update', () => {
    let userHome: string;
    let savedHome: string | undefined;
    let savedUserProfile: string | undefined;

    beforeEach(() => {
      userHome = mkdtempSync(join(tmpdir(), 'paqad-update-userhome-'));
      savedHome = process.env.HOME;
      savedUserProfile = process.env.USERPROFILE;
      process.env.HOME = userHome;
      process.env.USERPROFILE = userHome;
    });

    afterEach(() => {
      rmSync(userHome, { recursive: true, force: true });
      const restore = (key: 'HOME' | 'USERPROFILE', value?: string) => {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      };
      restore('HOME', savedHome);
      restore('USERPROFILE', savedUserProfile);
    });

    it('writes six Claude and six Codex stage agents, plus the two High Table agents, under the user home', async () => {
      await new FrameworkUpdater().run(projectRoot);

      const claudeAgents = join(userHome, '.claude/agents');
      const codexAgents = join(userHome, '.codex/agents');
      expect(existsSync(claudeAgents)).toBe(true);
      expect(
        readdirSync(claudeAgents)
          .filter((f) => f.endsWith('.md'))
          .sort(),
      ).toEqual([
        'paqad-checks.md',
        'paqad-chief-architect.md',
        'paqad-development.md',
        'paqad-documentation-sync.md',
        'paqad-expert.md',
        'paqad-planning.md',
        'paqad-review.md',
        'paqad-specification.md',
      ]);
      expect(readdirSync(codexAgents).filter((f) => f.endsWith('.toml'))).toHaveLength(8);
    });

    it('never writes the agents into the project', async () => {
      await new FrameworkUpdater().run(projectRoot);

      expect(existsSync(join(projectRoot, '.claude/agents'))).toBe(false);
      expect(existsSync(join(projectRoot, '.codex/agents'))).toBe(false);
    });

    it('writes home stage agents on update by default', async () => {
      await new FrameworkUpdater({ generateCandidates: async () => [] }).run(projectRoot);
      expect(existsSync(join(userHome, '.claude/agents'))).toBe(true);
    });

    it('skips stage-agent generation when the plugin is installed', async () => {
      const pluginsDir = join(userHome, '.claude/plugins');
      mkdirSync(pluginsDir, { recursive: true });
      writeFileSync(
        join(pluginsDir, 'installed_plugins.json'),
        JSON.stringify({ plugins: { 'paqad@eliyce': { enabled: true } } }),
      );

      await new FrameworkUpdater({ generateCandidates: async () => [] }).run(projectRoot);

      expect(existsSync(join(userHome, '.claude/agents'))).toBe(false);
      expect(existsSync(join(userHome, '.codex/agents'))).toBe(false);
    });

    describe('project Claude settings when the plugin is installed', () => {
      const settingsPath = () => join(projectRoot, '.claude/settings.json');
      const completionScript = () =>
        join(userHome, '.paqad-ai/current/hooks/stage-agent-completion.mjs');
      const startCommand = 'node "~/.paqad-ai/current/hooks/stage-agent-start.mjs"';
      const regenerated = {
        hooks: {
          SubagentStop: [
            { matcher: '^(paqad:)?paqad-', hooks: [{ type: 'command', command: '' }] },
          ],
          SubagentStart: [{ hooks: [{ type: 'command', command: startCommand }] }],
        },
      };

      function installPlugin(): void {
        const pluginsDir = join(userHome, '.claude/plugins');
        mkdirSync(pluginsDir, { recursive: true });
        writeFileSync(
          join(pluginsDir, 'installed_plugins.json'),
          JSON.stringify({ plugins: { 'paqad@eliyce': { enabled: true } } }),
        );
      }

      function candidate() {
        return {
          path: '.claude/settings.json',
          content: `${JSON.stringify(regenerated, null, 2)}\n`,
          autoUpdate: true,
        };
      }

      it('refreshes the settings while they still hold live npm hook lines', async () => {
        installPlugin();
        mkdirSync(join(userHome, '.paqad-ai/current/hooks'), { recursive: true });
        writeFileSync(completionScript(), '');
        mkdirSync(join(projectRoot, '.claude'), { recursive: true });
        writeFileSync(
          settingsPath(),
          JSON.stringify({
            hooks: {
              SubagentStop: [
                { hooks: [{ type: 'command', command: `node "${completionScript()}"` }] },
              ],
            },
          }),
        );

        const report = await new FrameworkUpdater({
          generateCandidates: async () => [candidate()],
        }).run(projectRoot);

        expect(report.regenerated).toContain('.claude/settings.json');
        const written = JSON.parse(readFileSync(settingsPath(), 'utf8'));
        expect(written.hooks.SubagentStart[0].hooks[0].command).toBe(startCommand);
      });

      it('leaves the settings to the plugin when they hold no live npm hook lines', async () => {
        installPlugin();
        mkdirSync(join(projectRoot, '.claude'), { recursive: true });
        const before = JSON.stringify({
          hooks: {
            SubagentStop: [
              { hooks: [{ type: 'command', command: `node "${completionScript()}"` }] },
            ],
          },
        });
        writeFileSync(settingsPath(), before);

        const report = await new FrameworkUpdater({
          generateCandidates: async () => [candidate()],
        }).run(projectRoot);

        expect(report.regenerated).not.toContain('.claude/settings.json');
        expect(readFileSync(settingsPath(), 'utf8')).toBe(before);
      });
    });
  });

  describe('team setup on update', () => {
    const claudeCandidates = async () => [{ path: 'CLAUDE.md', content: 'x', autoUpdate: true }];

    it('writes .paqad/hook.mjs for a Claude project, names it to commit, and gives no diff on a rerun', async () => {
      const report = await new FrameworkUpdater({ generateCandidates: claudeCandidates }).run(
        projectRoot,
      );
      const launcher = join(projectRoot, '.paqad/hook.mjs');
      const bytes = readFileSync(launcher, 'utf8');
      expect(bytes).toContain(`PAQAD_LAUNCHER_VERSION = '${VERSION}'`);
      expect(report.team_setup_notes.join('\n')).toContain('.paqad/hook.mjs');
      await new FrameworkUpdater({ generateCandidates: claudeCandidates }).run(projectRoot);
      expect(readFileSync(launcher, 'utf8')).toBe(bytes);
    });

    it('writes no team setup for a project without Claude', async () => {
      const report = await new FrameworkUpdater({
        generateCandidates: async () => [{ path: 'AGENTS.md', content: 'x', autoUpdate: true }],
      }).run(projectRoot);
      expect(existsSync(join(projectRoot, '.paqad/hook.mjs'))).toBe(false);
      expect(report.team_setup_notes).toEqual([]);
    });

    it('removes an unchanged launcher once the team opts out', async () => {
      await new FrameworkUpdater({ generateCandidates: claudeCandidates }).run(projectRoot);
      mkdirSync(join(projectRoot, '.paqad/configs'), { recursive: true });
      writeFileSync(
        join(projectRoot, '.paqad/configs/.config.app'),
        'team_bootstrap_enabled=false\n',
      );
      await new FrameworkUpdater({ generateCandidates: claudeCandidates }).run(projectRoot);
      expect(existsSync(join(projectRoot, '.paqad/hook.mjs'))).toBe(false);
    });
  });
});
