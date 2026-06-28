import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import YAML from 'yaml';
import { describe, expect, it } from 'vitest';

import { MANDATORY_STAGES, STAGE_EVIDENCE_STAGES } from '@/stage-evidence/index.js';

const MODULE_DIR = resolve(__dirname, '../../../src/stage-evidence');
const REGISTRY = resolve(
  __dirname,
  '../../../docs/instructions/workflows/feature-development-stages.yml',
);

/**
 * Issue #247 C1 — the stage-evidence writer is ALWAYS-ON, independent of the
 * enterprise / AI-BOM machinery (which can be flag-disabled). Depending on it would
 * break stage-tracking whenever enterprise is off. This guard fails if any
 * stage-evidence source file imports an enterprise / AI-BOM / receipt module, so
 * the boundary can never erode. Enrichment is one-way only: enterprise code MAY
 * read these records; the records never depend on enterprise code.
 */
describe('stage-evidence is independent of enterprise / AI-BOM (#247 C1)', () => {
  const FORBIDDEN = [/enterprise-policy/, /ai-bom/i, /receipt/i, /\/evidence\/receipt/];

  it('no stage-evidence source file imports enterprise / AI-BOM code', () => {
    for (const file of readdirSync(MODULE_DIR).filter((name) => name.endsWith('.ts'))) {
      const source = readFileSync(join(MODULE_DIR, file), 'utf8');
      const imports = source
        .split('\n')
        .filter((line) => /^\s*import\b/.test(line) || /from ['"]/.test(line));
      for (const line of imports) {
        for (const forbidden of FORBIDDEN) {
          expect(
            forbidden.test(line),
            `${file} must not import enterprise code: ${line.trim()}`,
          ).toBe(false);
        }
      }
    }
  });
});

/**
 * Issue #247 — the tracked registry must mirror the canonical STAGE_ORDER the
 * ledger derives from, so a human reading the registry sees the same order the
 * gate enforces. This fails if the two drift.
 */
describe('stage registry mirrors the canonical stage order', () => {
  const registry = YAML.parse(readFileSync(REGISTRY, 'utf8')) as {
    stages: { id: string; mandatory: boolean }[];
  };

  it('lists the stages in the same order as STAGE_EVIDENCE_STAGES', () => {
    expect(registry.stages.map((stage) => stage.id)).toEqual([...STAGE_EVIDENCE_STAGES]);
  });

  it('marks the same stages mandatory as the engine', () => {
    const registryMandatory = registry.stages.filter((s) => s.mandatory).map((s) => s.id);
    expect(registryMandatory).toEqual([...MANDATORY_STAGES]);
  });
});
