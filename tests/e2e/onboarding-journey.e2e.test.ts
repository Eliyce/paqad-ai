import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { setupRun } = vi.hoisted(() => ({ setupRun: vi.fn() }));

vi.mock('@/onboarding/orchestrator.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/onboarding/orchestrator.js')>()),
  OnboardingOrchestrator: class {
    run = setupRun;
  },
}));

import { createOnboardingCommand } from '@/cli/commands/onboarding.js';
import { readEvents } from '@/onboarding/journey/events.js';
import { readRun } from '@/onboarding/journey/run-store.js';
import { applyRuleScriptMap } from '@/rule-scripts/apply.js';
import { assembleMap, scanAndEmbedIds } from '@/rule-scripts/analyzer.js';
import { compileRuleScripts } from '@/rule-scripts/compile.js';

import { T0, moduleMap, tempRoot, writeFile } from '../unit/onboarding/journey/fixtures/journey.js';

const DISCOVERY = 'rd-20990101-000000';

describe('the onboarding journey end to end with a stub agent', () => {
  let root: string;
  let ticks: number;
  const clock = (): Date => new Date(Date.parse(T0) + ticks++ * 1000);

  beforeEach(() => {
    root = tempRoot('paqad-journey-e2e-');
    ticks = 0;
    vi.stubEnv('SE_SESSION', 'claude-session');
    setupRun.mockImplementation(async () => {
      writeFile(root, '.paqad/framework-path.txt', '/opt/paqad-ai\n');
      writeFile(
        root,
        '.paqad/onboarding-manifest.json',
        '{"providers":["claude-code","codex-cli"]}',
      );
      writeFile(root, 'CLAUDE.md', '# entry\n');
      writeFile(
        root,
        '.paqad/project-profile.yaml',
        'project:\n  id: demo\ncommands:\n  dev: npm run dev\n  build: npm run build\n  test: npm test\n',
      );
      return {
        adapter: 'claude-code',
        decision_pause_supported_adapters: ['claude-code', 'codex-cli'],
        generated_files: [join(root, 'CLAUDE.md')],
        detected_modules: [],
        runtime_root: '/opt/paqad-ai/runtime',
        manifest_path: '.paqad/onboarding-manifest.json',
        warnings: [],
        kept_files: [],
        drift_review_targets: [],
        reverted_framework_values: [],
        step_failures: [],
      };
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    process.exitCode = undefined;
    rmSync(root, { recursive: true, force: true });
  });

  async function verb(...args: string[]): Promise<string> {
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((line: string) => void lines.push(String(line)));
    vi.spyOn(console, 'error').mockImplementation(
      (line: string) => void lines.push(`ERR ${String(line)}`),
    );
    process.exitCode = undefined;
    await createOnboardingCommand({ now: clock }).parseAsync([...args, '--project-root', root], {
      from: 'user',
    });
    const code = Number(process.exitCode ?? 0);
    process.exitCode = undefined;
    vi.restoreAllMocks();
    if (code !== 0) throw new Error(`${args.join(' ')} failed:\n${lines.join('\n')}`);
    return lines.join('\n');
  }

  function view(): {
    status: string;
    status_line: string | null;
    stages: Array<{ state: string }>;
  } {
    return JSON.parse(readFileSync(join(root, '.paqad/onboarding/view.json'), 'utf8'));
  }

  it('AC-2 AC-7 AC-25 AC-26 AC-27: runs all eight steps with a stop, a resume and a hand-over', async () => {
    await verb('start', '--asked', '--providers', 'claude-code,codex-cli', '--allow-list', 'no');

    await verb('stage', 'start', 'detect');
    await verb('choose-stack', 'react', '--reason', 'vite and react in package.json');
    await verb('stage', 'end', 'detect');

    await verb('stage', 'start', 'setup');
    await verb('setup');
    await verb('stage', 'end', 'setup');

    writeFile(root, 'docs/instructions/rules/module-map.yml', moduleMap(['auth', 'billing']));
    await verb('stage', 'start', 'project_docs');
    for (const area of [
      'stack',
      'architecture',
      'design-system',
      'registries',
      'benchmarks',
      'tech-debt',
      'module-map',
    ]) {
      writeFile(root, `docs/${area}/overview.md`, `# ${area}\n`);
      await verb('unit', 'project_docs', area, '--outputs', `docs/${area}/overview.md`);
    }
    await verb('stage', 'end', 'project_docs');

    await verb('stage', 'start', 'module_docs');
    writeFile(root, 'docs/modules/auth/summary.md', '# Auth\n');
    await verb('unit', 'module_docs', 'auth', '--outputs', 'docs/modules/auth/summary.md');
    await verb('stage', 'fail', 'module_docs', '--reason', 'the agent reached its turn limit');
    expect(view().status).toBe('stopped');

    vi.stubEnv('SE_SESSION', 'codex-session');
    const resumed = JSON.parse(await verb('resume', '--json'));
    expect(resumed.units_todo).toEqual(['billing', 'registries']);
    expect(readRun(root)?.owner_session).toBe('codex-session');
    expect(readEvents(root).some((event) => event.kind === 'handover')).toBe(true);

    writeFile(root, 'docs/modules/billing/summary.md', '# Billing\n');
    await verb('unit', 'module_docs', 'billing', '--outputs', 'docs/modules/billing/summary.md');
    await verb('unit', 'module_docs', 'registries');
    await verb('stage', 'end', 'module_docs');

    await verb('stage', 'start', 'rules_discovery', '--planned', '3');
    expect(view().status_line).toBe(
      '**▸ paqad** · Step 5 of 8 · Researching rules for your stack · 0 of 3',
    );
    const dir = `.paqad/ledger/rules-discovery/${DISCOVERY}`;
    const at = clock().toISOString();
    writeFile(
      root,
      `${dir}/run.json`,
      JSON.stringify({
        schema_version: 1,
        doc_type: 'paqad.rules-discovery.run',
        run_id: DISCOVERY,
        revision: 2,
        step: 'docs',
        status: 'done',
        opened_at: at,
        updated_at: at,
        signoff_decision: null,
        proposal_hash: null,
        steps: [],
      }),
    );
    writeFile(
      root,
      `${dir}/research.json`,
      JSON.stringify({
        schema_version: 1,
        state: 'skipped-offline',
        order: [],
        done: [],
        skipped_private: [],
        unreached: [],
        updated_at: at,
      }),
    );
    writeFile(
      root,
      `${dir}/proposal.json`,
      JSON.stringify({
        schema_version: 1,
        run_id: DISCOVERY,
        generated_at: at,
        rows: [],
        folded: [],
        not_rules: [],
        manifests: {},
      }),
    );
    await verb('stage', 'end', 'rules_discovery', '--degraded', 'research_offline');

    await verb('stage', 'start', 'rules_analyze');
    writeFile(root, 'docs/instructions/rules/coding/q.md', '- Keep handlers small.\n');
    const scan = scanAndEmbedIds(root);
    const ids = scan.inventory.map((item) => item.id);
    const map = assembleMap(
      scan.inventory,
      new Map(
        ids.map((id) => [
          id,
          {
            id,
            verifiability: { kind: 'unverifiable' as const, reason: 'needs a person' },
            enforced_by: [],
          },
        ]),
      ),
      scan.rule_files_hash,
      null,
    );
    applyRuleScriptMap({
      projectRoot: root,
      map,
      via: 'rule-analyzer',
      event: { action: 'analyze', rule_ids: ids },
    });
    await verb('progress', 'rules_analyze', String(ids.length), String(ids.length));
    await verb('stage', 'end', 'rules_analyze');

    await verb('stage', 'start', 'rule_scripts');
    compileRuleScripts(root);
    await verb('unit', 'rule_scripts', 'batch-1');
    await verb('stage', 'end', 'rule_scripts');

    await verb('stage', 'start', 'finish');
    await verb('finish');
    expect(view().status).toBe('asking_commit');
    expect(
      view().stages.every((stage) => stage.state === 'done' || stage.state === 'degraded'),
    ).toBe(true);

    await verb('commit', '--later');
    expect(readRun(root)?.status).toBe('done');
    expect(view().status).toBe('done_with_gaps');
    expect(readFileSync(join(root, '.paqad/onboarding/report.md'), 'utf8')).toContain(
      'Research rules for your stack: degraded',
    );
  });
});
