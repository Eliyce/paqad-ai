// Agent attribution on stage-evidence rows (issue #573).
//
// Stage isolation (#567) says each mandatory stage runs in its own subagent while the main
// chat stays a lean orchestrator. Nothing recorded WHICH of those wrote a row, so an
// isolated run and a fully inline run were indistinguishable in the ledger after the fact.
// The owner chose `agent` REQUIRED on every new row rather than optional-and-nullable; that
// is safe because reads never run the validator, which INV-1 / the last test here pins.

import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  ORCHESTRATOR_AGENT,
  isStageAgent,
  resolveAgentIdentity,
} from '@/stage-evidence/agent-identity.js';
import { validateStageEvidenceRow } from '@/stage-evidence/schema.js';
import {
  appendFeatureStageRow,
  featureStagePath,
  readFeatureStageUnit,
} from '@/feature-evidence/stage-ledger.js';

describe('resolveAgentIdentity', () => {
  it('prefers the agent name, which is the stable meaningful identity', () => {
    expect(resolveAgentIdentity({ agentType: 'paqad-development', agentId: 'a1b2c3' })).toBe(
      'paqad-development',
    );
  });

  it('falls back to the opaque id rather than mislabelling a subagent row', () => {
    // Recording `orchestrator` for a row a subagent actually wrote would be worse than
    // recording an opaque id, because it is an affirmatively WRONG attribution.
    expect(resolveAgentIdentity({ agentId: 'a1b2c3' })).toBe('a1b2c3');
  });

  it('reads the main chat when the payload carries neither field', () => {
    expect(resolveAgentIdentity({})).toBe(ORCHESTRATOR_AGENT);
    expect(resolveAgentIdentity()).toBe(ORCHESTRATOR_AGENT);
  });

  it('treats blank and non-string values as absent', () => {
    expect(resolveAgentIdentity({ agentType: '   ', agentId: '' })).toBe(ORCHESTRATOR_AGENT);
    expect(resolveAgentIdentity({ agentType: 42, agentId: null })).toBe(ORCHESTRATOR_AGENT);
  });

  it('trims a padded identity', () => {
    expect(resolveAgentIdentity({ agentType: '  paqad-review  ' })).toBe('paqad-review');
  });
});

describe('isStageAgent', () => {
  it('recognises a dispatched stage agent', () => {
    expect(isStageAgent('paqad-checks')).toBe(true);
  });

  it('does not treat the orchestrator or an unknown value as one', () => {
    expect(isStageAgent(ORCHESTRATOR_AGENT)).toBe(false);
    expect(isStageAgent('some-other-agent')).toBe(false);
    expect(isStageAgent(null)).toBe(false);
    expect(isStageAgent(undefined)).toBe(false);
  });
});

describe('the row schema requires an agent (issue #573)', () => {
  const base = {
    schema_version: 1,
    doc_type: 'paqad.stage-evidence',
    kind: 'stage_start',
    session_id: 's1',
    conversation_ordinal: 1,
    ts: '2026-01-01T00:00:00.000Z',
    adapter: 'claude-code',
    content_hash: 'hash',
  };

  it('accepts a row that names its agent', () => {
    expect(validateStageEvidenceRow({ ...base, agent: 'paqad-planning' })).toEqual([]);
  });

  it('rejects a row written without one', () => {
    expect(validateStageEvidenceRow(base).join(' ')).toContain('agent');
  });

  it('rejects an empty agent, which would attribute the row to nothing', () => {
    expect(validateStageEvidenceRow({ ...base, agent: '' })).not.toEqual([]);
  });
});

describe('the write chokepoint always supplies an agent', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-agent-attr-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function rowsOf(dir: string) {
    return readFeatureStageUnit(root, dir);
  }

  it('defaults to the orchestrator when the caller names no agent', () => {
    appendFeatureStageRow(root, 's1', 'change-1', {
      kind: 'stage_start',
      stage: 'planning',
    });

    expect(rowsOf('change-1')[0].agent).toBe(ORCHESTRATOR_AGENT);
  });

  it('keeps the identity a dispatched stage agent supplies', () => {
    appendFeatureStageRow(root, 's1', 'change-2', {
      kind: 'stage_start',
      stage: 'development',
      agent: 'paqad-development',
    });

    expect(rowsOf('change-2')[0].agent).toBe('paqad-development');
  });

  it('defaults rather than failing when a caller passes agent: undefined', () => {
    // A caller threading an optional field through writes `agent: input.agent`, which is
    // an OWN property set to undefined. A naive `{ agent: default, ...row }` spread would
    // overwrite the default with undefined and fail validation.
    appendFeatureStageRow(root, 's1', 'change-3', {
      kind: 'stage_start',
      stage: 'planning',
      agent: undefined,
    });

    expect(rowsOf('change-3')[0].agent).toBe(ORCHESTRATOR_AGENT);
  });

  it('makes an inline run distinguishable from an isolated one', () => {
    appendFeatureStageRow(root, 's1', 'inline', {
      kind: 'stage_start',
      stage: 'development',
    });
    appendFeatureStageRow(root, 's1', 'isolated', {
      kind: 'stage_start',
      stage: 'development',
      agent: 'paqad-development',
    });

    expect(isStageAgent(rowsOf('inline')[0].agent as string)).toBe(false);
    expect(isStageAgent(rowsOf('isolated')[0].agent as string)).toBe(true);
  });

  it('still reads a row written before the field existed (INV-1)', () => {
    // Required on WRITE only. `readFeatureStageUnit` -> `readJsonl` runs no validator, so
    // every bundle produced by an earlier engine stays readable. This is the whole reason
    // required is safe here.
    const legacy = {
      schema_version: 1,
      doc_type: 'paqad.stage-evidence',
      session_id: 's1',
      conversation_ordinal: 1,
      kind: 'stage_start',
      stage: 'planning',
      adapter: 'claude-code',
      ts: '2020-01-01T00:00:00.000Z',
      content_hash: 'legacy',
    };
    const path = join(root, featureStagePath('legacy-change'));
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, `${JSON.stringify(legacy)}\n`);

    const rows = rowsOf('legacy-change');

    expect(rows).toHaveLength(1);
    expect(rows[0].stage).toBe('planning');
    expect(rows[0].agent).toBeUndefined();
    // And it would indeed fail the writer's validator — proving reads and writes differ.
    expect(validateStageEvidenceRow(JSON.parse(readFileSync(path, 'utf8')))).not.toEqual([]);
  });
});
