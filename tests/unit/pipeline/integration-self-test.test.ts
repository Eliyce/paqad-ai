import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DataRetrievalDecider } from '@/mcp/decision-matrix.js';
import { LaneRunner } from '@/pipeline/lane-runner.js';

import { fixtureClassification } from './shared.fixture.js';

describe('pipeline integration self-tests', () => {
  it('runs all lane entrypoints and writes a handoff for each', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-pipeline-'));
    const runner = new LaneRunner({ projectRoot: root });

    const full = await runner.runFullLane(fixtureClassification());
    const graduated = await runner.runGraduatedLane(
      fixtureClassification({
        complexity: 'medium',
        risk: 'medium',
        process_depth: 'graduated lane',
      }),
    );
    const fast = await runner.runFastLane(
      fixtureClassification({ complexity: 'trivial', risk: 'low', process_depth: 'fast lane' }),
    );

    expect(full.blocked_at).toBeNull();
    expect(graduated.blocked_at).toBeNull();
    expect(fast.blocked_at).toBeNull();
    expect(JSON.parse(readFileSync(full.handoff_path, 'utf8')).current_phase).toBeDefined();

    rmSync(root, { recursive: true, force: true });
  });

  it('stops early when a phase fails and prefers MCP over scripts', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-pipeline-fail-'));
    const runner = new LaneRunner({
      projectRoot: root,
      phaseOverrides: {
        'spec-review': {
          execute: async (context) => ({
            phase: 'spec-review',
            status: 'fail',
            summary: 'adversarial review blocked',
            context,
          }),
        },
      },
    });

    const result = await runner.runFullLane(fixtureClassification());
    const source = new DataRetrievalDecider(
      ['database-inspector'],
      ['refresh-registry-diff.sh'],
    ).decide('schema');

    expect(result.blocked_at).toBe('spec-review');
    expect(result.phases.some((phase) => phase.phase === 'implementation')).toBe(false);
    expect(source.type).toBe('mcp');

    rmSync(root, { recursive: true, force: true });
  });
});
