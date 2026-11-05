import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  DEVELOPER_ACTOR,
  repairActor,
  repairChainBreak,
  stageAgentRepairRefusal,
} from '@/feature-evidence/chain-repair.js';
import { featureDir, featureFilePath } from '@/feature-evidence/paths.js';
import { appendFeatureStageRow, readFeatureStageUnit } from '@/feature-evidence/stage-ledger.js';
import { ORCHESTRATOR_AGENT } from '@/stage-evidence/agent-identity.js';

const SESSION = 'ses_repair';
const DIR = 'repair-01JABCDEFGHJKMNPQRSTVWXY70';

describe('who may repair the ledger', () => {
  it('calls a terminal the developer and anything else the orchestrator', () => {
    expect(repairActor(true)).toBe(DEVELOPER_ACTOR);
    expect(repairActor(false)).toBe(ORCHESTRATOR_AGENT);
    expect(repairActor(undefined)).toBe(process.stdin.isTTY ? DEVELOPER_ACTOR : ORCHESTRATOR_AGENT);
  });

  it('refuses any named stage agent and nobody else', () => {
    expect(stageAgentRepairRefusal('a1')).toContain('a stage agent cannot repair');
    expect(stageAgentRepairRefusal('   ')).toBeNull();
    expect(stageAgentRepairRefusal(undefined)).toBeNull();
  });
});

describe('repairing a chain break', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-chain-repair-'));
    mkdirSync(join(root, featureDir(DIR)), { recursive: true });
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const seedBreak = (): number => {
    appendFeatureStageRow(root, SESSION, DIR, { kind: 'stage_start', stage: 'planning' });
    appendFeatureStageRow(root, SESSION, DIR, { kind: 'stage_end', stage: 'planning' });
    const path = join(root, featureFilePath(DIR, 'stageEvidence'));
    const lines = readFileSync(path, 'utf8').trim().split('\n');
    const last = JSON.parse(lines[1]!) as Record<string, unknown>;
    last.prev_hash = '0'.repeat(64);
    lines[1] = JSON.stringify(last);
    writeFileSync(path, `${lines.join('\n')}\n`);
    return 2;
  };

  it('records the broken row and its hash, under the actor it was given', () => {
    const broken = seedBreak();
    const result = repairChainBreak(root, SESSION, DIR, broken, 'torn write', DEVELOPER_ACTOR);
    expect(result).toEqual({ ok: true, message: 'recorded a repair for row 2: torn write' });
    const repair = readFeatureStageUnit(root, DIR).find((row) => row.kind === 'record-repair');
    expect(repair).toMatchObject({ agent: DEVELOPER_ACTOR, repairs_row: 2, reason: 'torn write' });
    expect(typeof repair!.repairs_hash).toBe('string');
    expect(repair).not.toHaveProperty('stage_agents_running');
  });

  it('defaults to the orchestrator and names the stage agents still running', () => {
    const broken = seedBreak();
    appendFeatureStageRow(root, SESSION, DIR, {
      kind: 'stage-agent',
      stage: 'review',
      agent: 'paqad-review',
      agent_id: 'a-live',
      event_status: 'started',
      host_pid: process.pid,
      tokens_used: 0,
      tokens_not_recarried: 0,
      estimate: true,
    });
    expect(repairChainBreak(root, SESSION, DIR, broken, 'why').ok).toBe(true);
    const repair = readFeatureStageUnit(root, DIR).find((row) => row.kind === 'record-repair');
    expect(repair).toMatchObject({
      agent: ORCHESTRATOR_AGENT,
      stage_agents_running: ['paqad-review'],
    });
  });

  it('declines a row that is not broken and writes nothing', () => {
    seedBreak();
    const before = readFeatureStageUnit(root, DIR).length;
    expect(repairChainBreak(root, SESSION, DIR, 1, 'why')).toEqual({
      ok: false,
      message: 'row 1 is not a chain break; the breaks are at rows 2',
    });
    expect(readFeatureStageUnit(root, DIR)).toHaveLength(before);
  });
});
