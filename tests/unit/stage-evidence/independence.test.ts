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

describe('stage-evidence is independent of enterprise / AI-BOM', () => {
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
