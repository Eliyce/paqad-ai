import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import { collectDelivery } from '@/dashboard/collectors/delivery.js';
import { writeDetection } from '@/delivery/detection-store.js';
import { detectDelivery } from '@/delivery/detection.js';

function repo(): string {
  return mkdtempSync(join(tmpdir(), 'delivery-dash-'));
}

function writeProfile(root: string, servers: string): void {
  mkdirSync(join(root, PATHS.AGENCY_DIR), { recursive: true });
  writeFileSync(
    join(root, PATHS.PROJECT_PROFILE),
    [
      'project: { name: x, id: x, description: x }',
      'active_capabilities: [coding]',
      'commands: { install: i, dev: d, test: t, test_single: ts, lint: l, format: f, migrate: m, build: b }',
      'strictness: { full_lane_default: false, require_adversarial_review: false, block_on_stale_docs: false, require_db_review_for_migrations: false }',
      'compliance_packs: []',
      'features: { spec_only_mode: false, market_research: false, design_research: false, team_agents: false, supply_chain_governance: false, ai_governance: false }',
      `mcp: { servers: ${servers} }`,
      'model_routing: { default_model: m, reasoning_model: m, fast_model: m }',
      'research: { depth: standard }',
      'intelligence: { rag_enabled: false, rag_similarity_threshold: 0.5, rag_top_n: 5 }',
      'efficiency: {}',
      'escalation: { destructive_operations: warn, risky_migrations: warn, security_findings: warn, db_row_threshold: 100 }',
      'custom: { classification_dimensions: [], verification_plugins: [], escalation_rules: [] }',
    ].join('\n'),
    'utf8',
  );
}

describe('delivery dashboard collector', () => {
  it('reports dormant providers and nudges when nothing is connected', () => {
    const root = repo();
    try {
      writeProfile(root, '[]');
      const { section, attention } = collectDelivery(root);
      expect(section.id).toBe('delivery');
      expect(section.summary).toContain('Configured');
      expect(section.summary).toContain('dormant');
      expect(attention.length).toBe(2); // connect host + connect tracker
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('goes green when both host detected and tracker MCP connected', () => {
    const root = repo();
    try {
      writeProfile(root, '[{ name: atlassian, enabled: true, kind: jira }]');
      writeDetection(
        root,
        detectDelivery({
          remoteUrl: 'git@github.com:o/r.git',
          defaultBranch: 'origin/main',
          branchNames: ['feat/a'],
          recentCommitSubjects: ['feat: a'],
        }),
      );
      const { section, attention } = collectDelivery(root);
      expect(section.band).toBe('green');
      expect(section.summary).toContain('GitHub ✓');
      expect(section.summary).toContain('Jira ✓');
      expect(attention).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
