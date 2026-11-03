import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { PATHS } from '@/core/constants/paths.js';
import { collectDelivery } from '@/dashboard/collectors/delivery.js';

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
      'features: { spec_only_mode: false, market_research: false, design_research: false, team_agents: false }',
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

function writeRules(root: string, file: string, text: string): void {
  mkdirSync(join(root, PATHS.GIT_WORKFLOW_DIR), { recursive: true });
  writeFileSync(join(root, PATHS.GIT_WORKFLOW_DIR, file), text, 'utf8');
}

describe('delivery dashboard collector', () => {
  let root: string;
  beforeEach(() => {
    root = repo();
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('describes the git-workflow folder and needs no tracker when the team has no sources', () => {
    writeProfile(root, '[]');
    const { section, attention } = collectDelivery(root);
    expect(section.helper?.what).toContain('.paqad/configs/git-workflow/');
    expect(section.summary).toContain('no ticket sources');
    expect(section.band).toBe('green');
    expect(attention).toEqual([]);
  });

  it('nudges for each ticket source whose tracker is not connected', () => {
    writeProfile(root, '[{ name: atlassian, enabled: true, kind: jira }]');
    writeRules(
      root,
      'tickets.yaml',
      'sources:\n  proj: { tracker: jira }\n  inc: { tracker: servicenow }\n',
    );
    const { section, attention } = collectDelivery(root);
    expect(section.summary).toContain('proj ✓');
    expect(section.summary).toContain('inc ✗ (dormant)');
    expect(attention).toHaveLength(1);
    expect(attention[0].message).toContain('ServiceNow');
  });

  it('reports the turned-off state from enforcement.yaml', () => {
    writeProfile(root, '[]');
    writeRules(root, 'enforcement.yaml', 'enabled: false\n');
    expect(collectDelivery(root).section.summary).toContain('enforcement.yaml');
  });

  it('flags an invalid config instead of using defaults', () => {
    writeProfile(root, '[]');
    writeRules(root, 'branches.yaml', 'default_type: nope\n');
    const { section, attention } = collectDelivery(root);
    expect(section.summary).toBe('The git workflow rules have errors');
    expect(attention[0].message).toContain('default_type');
  });
});
