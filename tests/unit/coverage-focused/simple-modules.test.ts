import { mkdtempSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

import { AiderAdapter } from '@/adapters/aider/aider-adapter.js';
import { ContinueAdapter } from '@/adapters/continue/continue-adapter.js';
import { GithubCopilotAdapter } from '@/adapters/github-copilot/github-copilot-adapter.js';
import { JunieAdapter } from '@/adapters/junie/junie-adapter.js';
import { DocumentPipeline } from '@/document/pipeline.js';
import { DocumentationWorkflow } from '@/document/workflow.js';
import { PriorityClassifier } from '@/context/priority-classifier.js';
import {
  resolveFrameworkInstallPath,
  writeDetectionReport,
  writeFrameworkMetadata,
  writeOnboardingManifest,
} from '@/onboarding/manifest-writer.js';
import {
  loadProjectPackRegistry,
  getPacksForFrameworks,
  getPackManifestMap,
} from '@/packs/project-packs.js';
import { ReportMerger } from '@/pentest/report-merger.js';
import { TIER_TOKEN_LIMITS, StreamTruncator } from '@/pipeline/stream-truncator.js';
import { ConditionalSectionProcessor } from '@/skills/conditional-processor.js';
import { StepExecutor } from '@/workflows/step-executor.js';

import { fixtureArtifact, fixtureSkillBundleArtifacts } from '../adapters/shared.fixture.js';

type AdapterWithProtectedPaths = {
  hooksOutputPath(): string;
  mcpOutputPath(): string;
  cacheOutputPath(): string;
  memoryOutputPath(): string;
};

vi.mock('@/core/runtime-paths.js', async () => {
  const actual =
    await vi.importActual<typeof import('@/core/runtime-paths.js')>('@/core/runtime-paths.js');
  return {
    ...actual,
    getRuntimeRoot: vi.fn(() => '/runtime-root'),
  };
});

vi.mock('@/packs/loader.js', () => {
  class StackPackLoader {
    load(input: { runtimeRoot: string; projectRoot?: string }) {
      const packs = new Map([
        [
          'laravel',
          {
            manifest: { name: 'laravel', version: '1.0.0' },
            root: `${input.runtimeRoot}/laravel`,
          },
        ],
        [
          'react',
          {
            manifest: { name: 'react', version: '1.0.0' },
            root: `${input.runtimeRoot}/react`,
          },
        ],
      ]);

      return { packs, input };
    }
  }

  return { StackPackLoader };
});

describe('coverage simple modules', () => {
  describe('adapter path helpers', () => {
    it('covers bundle-relative skill fallback branches across reduced adapters', async () => {
      const adapters = [
        new AiderAdapter(),
        new ContinueAdapter(),
        new GithubCopilotAdapter(),
        new JunieAdapter(),
      ];
      const skillRoot = mkdtempSync(join(tmpdir(), 'paqad-skill-path-'));
      const nestedSkillPath = join(
        skillRoot,
        'skills',
        'sample-skill',
        'references',
        'checklist.md',
      );
      mkdirSync(join(skillRoot, 'skills', 'sample-skill', 'references'), { recursive: true });
      writeFileSync(nestedSkillPath, 'checklist');

      const rootedSkills = fixtureSkillBundleArtifacts();
      const sourceOnlySkill = {
        ...fixtureArtifact('sample-skill/references/checklist.md'),
        source: 'skills/sample-skill/references/checklist.md',
      };
      const pathOnlySkill = {
        ...fixtureArtifact('sample-skill/references/checklist.md'),
        path: nestedSkillPath,
        source: 'checklist.md',
      };
      const basenameFallbackSkillPath = join(skillRoot, 'standalone.md');
      writeFileSync(basenameFallbackSkillPath, 'standalone');
      const basenameFallbackSkill = {
        ...fixtureArtifact('sample-skill/references/checklist.md'),
        path: basenameFallbackSkillPath,
        source: 'standalone.md',
      };

      try {
        for (const adapter of adapters) {
          const protectedPaths = adapter as AdapterWithProtectedPaths;
          const rooted = await adapter.generateSkills(rootedSkills);
          const sourceFallback = await adapter.generateSkills([sourceOnlySkill]);
          const pathFallback = await adapter.generateSkills([pathOnlySkill]);
          const basenameFallback = await adapter.generateSkills([basenameFallbackSkill]);
          const agents = await adapter.generateAgents([fixtureArtifact('sample-agent.md')]);

          expect(rooted[0]?.path).toContain(adapter.type === 'aider' ? '.aider/skills' : '');
          expect(rooted.map((file) => file.path)).toEqual(
            expect.arrayContaining([
              expect.stringContaining('sample-skill/SKILL.md'),
              expect.stringContaining('sample-skill/agents/openai.yaml'),
              expect.stringContaining('sample-skill/references/checklist.md'),
            ]),
          );
          expect(sourceFallback[0]?.path).toMatch(/references\/checklist\.md$/);
          expect(pathFallback[0]?.path).toMatch(/sample-skill\/references\/checklist\.md$/);
          expect(basenameFallback[0]?.path).toMatch(/standalone\.md$/);
          expect(agents[0]?.path).toMatch(/sample-agent\.md$/);
          expect(protectedPaths.hooksOutputPath()).toContain('hooks');
          expect(protectedPaths.mcpOutputPath()).toContain('mcp');
          expect(protectedPaths.cacheOutputPath()).toContain('cache');
          expect(protectedPaths.memoryOutputPath()).toContain('memory');
        }
      } finally {
        rmSync(skillRoot, { recursive: true, force: true });
      }
    });
  });

  describe('document pipeline', () => {
    it('delegates to the documentation workflow', async () => {
      const runSpy = vi
        .spyOn(DocumentationWorkflow.prototype, 'run')
        .mockResolvedValue({ generated: [], skipped: [], stale: [] } as never);

      const pipeline = new DocumentPipeline();
      const options = {
        projectRoot: '/tmp/project',
        request: { domain: 'coding', stack: 'node-cli', request_text: 'docs' },
      };

      await expect(pipeline.run(options)).resolves.toEqual({
        generated: [],
        skipped: [],
        stale: [],
      });
      expect(runSpy).toHaveBeenCalledWith(options);
    });
  });

  describe('manifest writer', () => {
    let root: string;
    const originalEnv = process.env.PAQAD_FRAMEWORK_HOME;

    beforeEach(() => {
      root = mkdtempSync(join(tmpdir(), 'paqad-coverage-'));
    });

    afterEach(() => {
      if (originalEnv === undefined) {
        delete process.env.PAQAD_FRAMEWORK_HOME;
      } else {
        process.env.PAQAD_FRAMEWORK_HOME = originalEnv;
      }
      rmSync(root, { recursive: true, force: true });
      vi.useRealTimers();
    });

    it('writes onboarding metadata, manifests, and detection reports', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-03-28T09:00:00.000Z'));
      process.env.PAQAD_FRAMEWORK_HOME = '/custom/framework';

      const detectionPath = writeDetectionReport(root, {
        generated_at: '2026-03-28T09:00:00.000Z',
        overall_status: 'pass',
        checks: [],
      });
      const manifestPath = writeOnboardingManifest(root, {
        generated_at: '2026-03-28T09:00:00.000Z',
        framework_version: '1.2.3',
        files_written: [],
        docs_detected: [],
        adapter: 'codex-cli',
      });

      writeFrameworkMetadata(root, '1.2.3');

      expect(JSON.parse(readFileSync(detectionPath, 'utf8'))).toMatchObject({
        overall_status: 'pass',
      });
      expect(JSON.parse(readFileSync(manifestPath, 'utf8'))).toMatchObject({
        framework_version: '1.2.3',
      });
      expect(readFileSync(join(root, '.paqad/framework-version.txt'), 'utf8')).toBe(
        'version=1.2.3\nupdated_at=2026-03-28T09:00:00.000Z\n',
      );
      expect(readFileSync(join(root, '.paqad/framework-path.txt'), 'utf8')).toBe(
        '$PAQAD_FRAMEWORK_HOME\n',
      );
      expect(resolveFrameworkInstallPath()).toBe('/custom/framework');
    });

    it('falls back to the user home installation path', () => {
      delete process.env.PAQAD_FRAMEWORK_HOME;
      writeFrameworkMetadata(root, '9.9.9');
      expect(readFileSync(join(root, '.paqad/framework-path.txt'), 'utf8')).toBe(
        '~/.paqad-ai/current\n',
      );
      expect(resolveFrameworkInstallPath()).toContain('/.paqad-ai/current');
    });

    it('sanitizes persisted paths to repo-relative values and preserves external paths', () => {
      const externalRoot = join(tmpdir(), 'paqad-external-root');
      const externalIgnored = join(tmpdir(), 'paqad-external-ignore');

      const detectionPath = writeDetectionReport(root, {
        detected_domain: null,
        detected_stack: null,
        detected_capabilities: [],
        confidence: 'low',
        signals: [],
        timestamp: '2026-03-28T09:00:00.000Z',
        repository: {
          selected_root: root,
          scan_max_depth: 2,
          ignored_paths: [join(root, 'node_modules'), externalIgnored],
          projects: [
            {
              root: root,
              role: 'standalone',
              parent_root: null,
              markers: [],
              ecosystems: [],
            },
            {
              root: join(root, 'packages', 'web'),
              role: 'component',
              parent_root: root,
              markers: [],
              ecosystems: [],
            },
            {
              root: externalRoot,
              role: 'standalone',
              parent_root: null,
              markers: [],
              ecosystems: [],
            },
          ],
          applications: [
            {
              root: root,
              component_roots: [join(root, 'packages', 'web'), externalRoot],
            },
          ],
          primary_project_root: join(root, 'packages', 'web'),
        },
      });

      const manifestPath = writeOnboardingManifest(root, {
        framework_version: '1.2.3',
        adapter: 'codex-cli',
        project_root: root,
        profile: {} as never,
        detected: null,
        generated_at: '2026-03-28T09:00:00.000Z',
        generated_artifacts: [],
        repository: {
          selected_root: root,
          scan_max_depth: 1,
          ignored_paths: [externalIgnored],
          projects: [],
          applications: [],
          primary_project_root: null,
        },
      });

      expect(JSON.parse(readFileSync(detectionPath, 'utf8'))).toMatchObject({
        repository: {
          selected_root: '.',
          ignored_paths: ['node_modules', externalIgnored],
          projects: expect.arrayContaining([
            expect.objectContaining({ root: '.', parent_root: null }),
            expect.objectContaining({ root: 'packages/web', parent_root: '.' }),
            expect.objectContaining({ root: externalRoot, parent_root: null }),
          ]),
          applications: [
            {
              root: '.',
              component_roots: ['packages/web', externalRoot],
            },
          ],
          primary_project_root: 'packages/web',
        },
      });

      expect(JSON.parse(readFileSync(manifestPath, 'utf8'))).toMatchObject({
        project_root: '.',
        repository: {
          selected_root: '.',
          ignored_paths: [externalIgnored],
          primary_project_root: null,
        },
      });
    });
  });

  describe('project packs', () => {
    it('loads the registry and filters manifests by framework', () => {
      const registry = loadProjectPackRegistry('/repo');
      const packs = getPacksForFrameworks(['laravel', 'missing', 'react'], '/repo');
      const manifestMap = getPackManifestMap(['react', 'missing'], '/repo');

      expect(registry.packs.has('laravel')).toBe(true);
      expect(packs.map((pack) => pack.manifest.name)).toEqual(['laravel', 'react']);
      expect([...manifestMap.keys()]).toEqual(['react']);
      expect(manifestMap.get('react')).toMatchObject({ name: 'react' });
    });
  });

  describe('report merger', () => {
    it('merges normalized pentest findings and marks scanned impacts as potentially fixed', () => {
      const merger = new ReportMerger();
      const existing = [
        {
          id: 'PT-AAAA1111',
          title: 'Stored XSS in billing notes',
          category: 'xss',
          impact: 'high',
          impact_area: ['docs/modules/billing/technical.md', 'module:billing'],
          affected_modules: ['billing'],
          affected_packages: [],
        },
        {
          id: 'PT-BBBB2222',
          title: 'SQL injection in reporting export',
          category: 'sql-injection',
          impact: 'high',
          impact_area: ['docs/modules/reporting/queries.md', 'module:reporting'],
          affected_modules: ['reporting'],
          affected_packages: [],
        },
      ];
      const incremental = [
        {
          title: 'Stored XSS in billing notes',
          category: 'xss',
          impact: 'critical',
          impact_area: ['docs/modules/billing/technical.md', 'module:billing'],
          affected_modules: ['billing'],
          affected_packages: [],
        },
        {
          title: 'CSRF in profile update form',
          category: 'csrf',
          impact: 'medium',
          impact_area: ['docs/modules/profile/technical.md', 'module:profile'],
          affected_modules: ['profile'],
          affected_packages: [],
        },
      ];

      const merged = merger.merge(existing, incremental, [
        'docs/modules/billing/technical.md',
        'docs/modules/reporting/queries.md',
      ]);

      expect(merged.result).toEqual({
        new_findings: 1,
        updated_findings: 1,
        potentially_fixed: 1,
      });
      expect(merged.mergedFindings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            title: 'Stored XSS in billing notes',
            category: 'xss',
            impact: 'critical',
            source: 'incremental',
          }),
          expect.objectContaining({
            title: 'SQL injection in reporting export',
            category: 'sql-injection',
            status: 'potentially-fixed',
          }),
          expect.objectContaining({
            title: 'CSRF in profile update form',
            category: 'csrf',
            source: 'incremental',
          }),
        ]),
      );
    });

    it('matches findings by id, modules, packages, and title when impact areas do not overlap', () => {
      const merger = new ReportMerger();
      const merged = merger.merge(
        [
          {
            id: 'PT-AAAA1111',
            title: 'Duplicate by id',
            category: 'csrf',
            affected_modules: [],
            affected_packages: [],
            impact_area: [],
          },
          {
            title: 'Module overlap',
            category: 'auth-mechanism',
            affected_modules: ['auth'],
            affected_packages: [],
            impact_area: [],
          },
          {
            title: 'Package overlap',
            category: 'dependency-advisory',
            affected_modules: [],
            affected_packages: ['axios'],
            impact_area: [],
          },
          {
            title: 'Title fallback',
            category: 'logging-monitoring',
            affected_modules: [],
            affected_packages: [],
            impact_area: [],
          },
        ],
        [
          {
            id: 'PT-AAAA1111',
            title: 'Changed duplicate by id',
            category: 'csrf',
            affected_modules: [],
            affected_packages: [],
            impact_area: [],
            impact: 'high',
          },
          {
            title: 'Renamed module overlap',
            category: 'auth-mechanism',
            affected_modules: ['auth'],
            affected_packages: [],
            impact_area: [],
            impact: 'medium',
          },
          {
            title: 'Renamed package overlap',
            category: 'dependency-advisory',
            affected_modules: [],
            affected_packages: ['axios'],
            impact_area: [],
            impact: 'high',
          },
          {
            title: 'Title fallback',
            category: 'logging-monitoring',
            affected_modules: [],
            affected_packages: [],
            impact_area: [],
            impact: 'low',
          },
        ],
        ['unrelated/file.ts'],
      );

      expect(merged.result).toEqual({
        new_findings: 0,
        updated_findings: 4,
        potentially_fixed: 0,
      });
      expect(merged.mergedFindings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'PT-AAAA1111', source: 'incremental', impact: 'high' }),
          expect.objectContaining({ category: 'auth-mechanism', source: 'incremental' }),
          expect.objectContaining({ category: 'dependency-advisory', source: 'incremental' }),
          expect.objectContaining({ title: 'Title fallback', source: 'incremental' }),
        ]),
      );
    });

    it('tolerates malformed non-array matcher fields without crashing or mis-merging', () => {
      const merger = new ReportMerger();
      const merged = merger.merge(
        [
          {
            title: 'Malformed existing finding',
            category: 'csrf',
            impact_area: 'docs/modules/profile/technical.md',
            affected_modules: null,
            affected_packages: undefined,
          },
        ],
        [
          {
            title: 'Malformed incoming finding',
            category: 'csrf',
            impact_area: 'docs/modules/profile/technical.md',
            affected_modules: null,
            affected_packages: undefined,
          },
        ],
        ['docs/modules/profile/technical.md'],
      );

      expect(merged.result).toEqual({
        new_findings: 1,
        updated_findings: 0,
        potentially_fixed: 0,
      });
      expect(merged.mergedFindings).toHaveLength(2);
    });
  });

  describe('stream truncator', () => {
    let root: string;

    beforeEach(() => {
      root = mkdtempSync(join(tmpdir(), 'paqad-truncator-'));
    });

    afterEach(() => {
      rmSync(root, { recursive: true, force: true });
      vi.useRealTimers();
    });

    it('returns unmodified output when under the limit', async () => {
      const truncator = new StreamTruncator(root);
      const result = truncator.truncate('short output', 'fast');

      expect(result).toEqual({
        output: 'short output',
        truncated: false,
        original_token_estimate: truncator.estimateTokens('short output'),
        final_token_estimate: truncator.estimateTokens('short output'),
      });

      await truncator.logTruncation('skill', result);
      expect(() => readFileSync(join(root, '.paqad/audit.log'), 'utf8')).toThrow();
    });

    it('truncates at sentence boundaries, falls back to newlines and raw slices, and logs truncation', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-03-28T09:00:00.000Z'));

      const truncator = new StreamTruncator(root);
      const sentenceOutput = `Alpha. Beta. ${'x'.repeat(TIER_TOKEN_LIMITS.fast * 4)}`;
      const sentenceResult = truncator.truncate(sentenceOutput, 'fast', 4);
      expect(sentenceResult.truncated).toBe(true);
      expect(sentenceResult.output).toContain('[truncated]');
      expect(sentenceResult.output.startsWith('Alpha.')).toBe(true);

      const newlineText = `${'a'.repeat(9)}\n${'b'.repeat(20)}`;
      const newlineResult = truncator.truncate(newlineText, 'fast', 3);
      expect(newlineResult.output).toBe(`${'a'.repeat(9)}\n\n[truncated]`);

      const rawText = 'x'.repeat(40);
      const rawResult = truncator.truncate(rawText, 'fast', 3);
      expect(rawResult.output).toBe(`${rawText.slice(0, 12)}\n\n[truncated]`);

      await truncator.logTruncation('summarizer', rawResult);
      expect(readFileSync(join(root, '.paqad/audit.log'), 'utf8')).toContain(
        'WARN truncation skill=summarizer original=10t final=3t',
      );
    });
  });

  describe('conditional section processor', () => {
    it('keeps matching blocks and strips non-matching blocks case-insensitively', () => {
      const processor = new ConditionalSectionProcessor();
      const body = [
        'before',
        '<!-- if:Laravel -->keep me<!-- endif -->',
        '<!-- if:react -->drop me<!-- endif -->',
        'after',
      ].join('\n');

      expect(processor.process(body, ['laravel'])).toContain('keep me');
      expect(processor.process(body, ['laravel'])).not.toContain('drop me');
      expect(processor.process(body, ['vue'])).not.toContain('keep me');
    });
  });

  describe('priority classifier', () => {
    it('classifies artifact sources and workflow phases across all tiers', () => {
      const classifier = new PriorityClassifier();

      expect(classifier.classify('docs/instructions/rules/core.md', 'rule')).toBe('critical');
      expect(classifier.classify('recent-decision-1', 'conversation-turn')).toBe('high');
      expect(classifier.classify('docs/stack-docs/react.md', 'stack-doc')).toBe('medium');
      expect(classifier.classify('scratchpad', 'note')).toBe('low');

      expect(classifier.classifyByContent('x', 'router')).toBe('critical');
      expect(classifier.classifyByContent('x', 'constitution')).toBe('critical');
      expect(classifier.classifyByContent('x', 'implementation')).toBe('high');
      expect(classifier.classifyByContent('x', 'spec')).toBe('high');
      expect(classifier.classifyByContent('x', 'docs')).toBe('medium');
      expect(classifier.classifyByContent('x', 'stack')).toBe('medium');
      expect(classifier.classifyByContent('x', 'other')).toBe('low');
    });
  });

  describe('step executor', () => {
    it('skips steps when conditions do not match and completes when they do', async () => {
      const executor = new StepExecutor({
        classification: { complexity: 'high', workflow: 'feature-development', risk: 'medium' },
      });

      expect(
        executor.shouldExecute({
          name: 'plan',
          phase: 'planning',
          condition: { complexity: ['high'], workflow: ['feature-development'] },
          skills: [],
        }),
      ).toBe(true);

      expect(
        executor.shouldExecute({
          name: 'skip',
          phase: 'planning',
          condition: { missing: ['value'] },
          skills: [],
        }),
      ).toBe(false);

      expect(
        executor.shouldExecute({
          name: 'ignore-invalid',
          phase: 'planning',
          condition: { complexity: 'high' as never },
          skills: [],
        }),
      ).toBe(true);

      await expect(
        executor.execute({ name: 'run', phase: 'implementation', skills: [] }),
      ).resolves.toEqual({
        status: 'failed',
        error:
          'No workflow skill runner is configured for "undefined". Custom workflow steps cannot be marked complete without execution.',
      });

      await expect(
        executor.execute({
          name: 'skip',
          phase: 'implementation',
          condition: { risk: ['critical'] },
          skills: [],
        }),
      ).resolves.toEqual({ status: 'skipped' });
    });

    it('returns failed when step execution throws', async () => {
      class FailingStepExecutor extends StepExecutor {
        protected override async runStep(): Promise<void> {
          throw new Error('runner failed');
        }
      }

      const executor = new FailingStepExecutor({
        classification: { workflow: 'feature-development' },
      });

      await expect(
        executor.execute({ name: 'boom', phase: 'implementation', skills: [] }),
      ).resolves.toEqual({ status: 'failed', error: 'runner failed' });
    });
  });
});
