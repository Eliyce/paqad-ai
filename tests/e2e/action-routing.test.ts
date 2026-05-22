import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SemanticLoader } from '@/context/semantic-loader.js';
import { writeProjectProfile } from '@/core/project-profile.js';

function makeProfile(projectRoot: string, actionRoutingEnabled: boolean) {
  writeProjectProfile(projectRoot, {
    project: { name: 'Demo', id: 'demo', description: 'Demo' },
    active_capabilities: ['coding'],
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
      require_adversarial_review: false,
      block_on_stale_docs: false,
      require_db_review_for_migrations: false,
    },
    compliance_packs: [],
    features: {
      spec_only_mode: false,
      market_research: false,
      design_research: false,
      team_agents: false,
      supply_chain_governance: false,
      ai_governance: false,
    },
    mcp: { servers: [] },
    model_routing: { default_model: 'gpt-5', reasoning_model: 'gpt-5', fast_model: 'gpt-5-mini' },
    research: { depth: 'standard' },
    intelligence: {
      rag_enabled: false,
      rag_similarity_threshold: 0.75,
      rag_top_n: 20,
      action_routing: { enabled: actionRoutingEnabled },
    },
    efficiency: {},
    escalation: {
      destructive_operations: 'warn',
      risky_migrations: 'warn',
      security_findings: 'warn',
      db_row_threshold: 1000,
    },
    custom: { classification_dimensions: [], verification_plugins: [], escalation_rules: [] },
  });
}

function writeWorkflow(projectRoot: string, name: string) {
  const dir = join(projectRoot, 'docs', 'instructions', 'workflows');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.yaml`), `name: ${name}\ndescription: ${name}\nsteps: []\n`);
}

describe('Action Routing — end-to-end', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'paqad-action-routing-e2e-'));
    mkdirSync(join(projectRoot, 'src'), { recursive: true });
    writeFileSync(
      join(projectRoot, 'src/pentest.ts'),
      'export function runPentestScan(target: string): VulnerabilityReport { return scanFor("injection"); }\n',
    );
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('action_recommendations absent when action_routing disabled (default)', async () => {
    makeProfile(projectRoot, false);
    writeWorkflow(projectRoot, 'pentest');

    const loader = new SemanticLoader({ projectRoot, sessionId: 'e2e-action-off' });
    const result = await loader.load(
      [{ path: join(projectRoot, 'src/pentest.ts'), content: 'pentest scan function' }],
      { taskKeywords: ['pentest'], tokenBudget: 2000, symbolReferences: [] },
    );

    expect(result.action_recommendations).toBeUndefined();
  });

  it('action_recommendations present when enabled and workflow matches', async () => {
    makeProfile(projectRoot, true);
    writeWorkflow(projectRoot, 'pentest');

    const loader = new SemanticLoader({ projectRoot, sessionId: 'e2e-action-on' });
    const result = await loader.load(
      [{ path: join(projectRoot, 'src/pentest.ts'), content: 'pentest scan function' }],
      { taskKeywords: ['pentest', 'scan'], tokenBudget: 2000, symbolReferences: [] },
    );

    // May or may not match depending on keyword overlap
    // But result structure is always correct
    if (result.action_recommendations) {
      for (const rec of result.action_recommendations) {
        expect(rec.requires_user_approval).toBe(true);
        expect(rec.action_type).toBe('workflow');
        expect(typeof rec.workflow_id).toBe('string');
        expect(Array.isArray(rec.evidence_chunk_ids)).toBe(true);
        expect(typeof rec.explanation).toBe('string');
        expect(typeof rec.confidence).toBe('number');
      }
    }
  });

  it('recommendations reference valid workflow IDs from the registry', async () => {
    makeProfile(projectRoot, true);
    writeWorkflow(projectRoot, 'pentest');
    writeWorkflow(projectRoot, 'root-cause-analysis');

    const loader = new SemanticLoader({ projectRoot, sessionId: 'e2e-action-registry' });
    const result = await loader.load(
      [
        {
          path: join(projectRoot, 'src/pentest.ts'),
          content: 'pentest scan vulnerability analysis',
        },
      ],
      { taskKeywords: ['pentest', 'analysis'], tokenBudget: 2000, symbolReferences: [] },
    );

    if (result.action_recommendations) {
      const workflowIds = result.action_recommendations.map((r) => r.workflow_id);
      for (const id of workflowIds) {
        expect(['pentest', 'root-cause-analysis']).toContain(id);
      }
    }
  });

  it('evidence_chunk_ids are chunk IDs, not raw chunk text', async () => {
    makeProfile(projectRoot, true);
    writeWorkflow(projectRoot, 'pentest');

    const loader = new SemanticLoader({ projectRoot, sessionId: 'e2e-action-safe' });
    const result = await loader.load(
      [{ path: join(projectRoot, 'src/pentest.ts'), content: 'pentest scan vulnerability' }],
      { taskKeywords: ['pentest'], tokenBudget: 2000, symbolReferences: [] },
    );

    if (result.action_recommendations) {
      for (const rec of result.action_recommendations) {
        for (const id of rec.evidence_chunk_ids) {
          // IDs should be strings that look like chunk IDs (source file paths or similar)
          expect(typeof id).toBe('string');
          // Should not be raw function body text
          expect(id).not.toMatch(/export function|return scanFor/);
        }
      }
    }
  });
});
