import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CompliancePackLoader, loadCompliancePacks } from '@/packs/compliance-packs.js';
import { SchemaValidator } from '@/validators';

function writeCompliancePack(dir: string, body: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'compliance-pack.yaml'), body, 'utf8');
}

const VALID = `kind: compliance-pack
name: NAME
framework: { id: NAME, title: Some Framework }
disclaimer: Evidence toward, not compliance.
mappings:
  - clause: { id: Art.15, title: Robustness }
    satisfied_by:
      - { type: gate, ref: behavioral-correctness, relation: subset-of }
    evidence_strength: partial
`;

describe('compliance-pack schema', () => {
  const validator = new SchemaValidator();

  it('accepts a minimal valid pack', () => {
    const result = validator.validate('compliance-pack', {
      kind: 'compliance-pack',
      name: 'eu-ai-act',
      framework: { id: 'eu-ai-act', title: 'EU AI Act' },
      disclaimer: 'Evidence toward.',
      mappings: [
        {
          clause: { id: 'Art.15', title: 'Robustness' },
          satisfied_by: [{ type: 'gate', ref: 'mutation-testing', relation: 'subset-of' }],
          evidence_strength: 'partial',
        },
      ],
    });
    expect(result.valid).toBe(true);
  });

  it('rejects evidence_strength "full"', () => {
    const result = validator.validate('compliance-pack', {
      kind: 'compliance-pack',
      name: 'x',
      framework: { id: 'x', title: 'X' },
      disclaimer: 'd',
      mappings: [
        {
          clause: { id: 'A', title: 'A' },
          satisfied_by: [{ type: 'gate', ref: 'mutation-testing', relation: 'subset-of' }],
          evidence_strength: 'full',
        },
      ],
    });
    expect(result.valid).toBe(false);
  });

  it('rejects an unknown OSCAL relation', () => {
    const result = validator.validate('compliance-pack', {
      kind: 'compliance-pack',
      name: 'x',
      framework: { id: 'x', title: 'X' },
      disclaimer: 'd',
      mappings: [
        {
          clause: { id: 'A', title: 'A' },
          satisfied_by: [{ type: 'gate', ref: 'mutation-testing', relation: 'satisfies' }],
          evidence_strength: 'partial',
        },
      ],
    });
    expect(result.valid).toBe(false);
  });
});

describe('CompliancePackLoader', () => {
  let root: string;
  let runtimeRoot: string;
  let globalRoot: string;
  let projectRoot: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-compliance-'));
    runtimeRoot = join(root, 'runtime');
    globalRoot = join(root, 'global');
    projectRoot = join(root, 'project');
    mkdirSync(join(runtimeRoot, 'capabilities', 'compliance'), { recursive: true });
    mkdirSync(globalRoot, { recursive: true });
    mkdirSync(join(projectRoot, '.paqad', 'compliance-packs'), { recursive: true });
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('loads a valid built-in pack', () => {
    writeCompliancePack(
      join(runtimeRoot, 'capabilities', 'compliance', 'eu-ai-act'),
      VALID.replace(/NAME/g, 'eu-ai-act'),
    );
    const packs = loadCompliancePacks(projectRoot, { runtimeRoot, globalPacksRoot: globalRoot });
    expect(packs).toHaveLength(1);
    expect(packs[0]?.manifest.name).toBe('eu-ai-act');
    expect(packs[0]?.source).toBe('built-in');
  });

  it('lets a project pack override a built-in pack by name', () => {
    writeCompliancePack(
      join(runtimeRoot, 'capabilities', 'compliance', 'eu-ai-act'),
      VALID.replace(/NAME/g, 'eu-ai-act'),
    );
    writeCompliancePack(
      join(projectRoot, '.paqad', 'compliance-packs', 'eu-ai-act'),
      VALID.replace(/NAME/g, 'eu-ai-act').replace(
        'disclaimer: Evidence toward, not compliance.',
        'disclaimer: Project override.',
      ),
    );
    const packs = loadCompliancePacks(projectRoot, { runtimeRoot, globalPacksRoot: globalRoot });
    expect(packs).toHaveLength(1);
    expect(packs[0]?.source).toBe('project');
    expect(packs[0]?.manifest.disclaimer).toBe('Project override.');
  });

  it('quarantines a pack referencing an unknown gate (warns, never throws)', () => {
    writeCompliancePack(
      join(projectRoot, '.paqad', 'compliance-packs', 'bad'),
      `kind: compliance-pack
name: bad
framework: { id: bad, title: Bad }
disclaimer: d
mappings:
  - clause: { id: A, title: A }
    satisfied_by:
      - { type: gate, ref: not-a-real-gate, relation: subset-of }
    evidence_strength: partial
`,
    );
    const registry = new CompliancePackLoader().load({
      runtimeRoot,
      globalPacksRoot: globalRoot,
      projectRoot,
    });
    expect(registry.packs.size).toBe(0);
    expect(registry.warnings.some((w) => w.message.includes('unknown gate'))).toBe(true);
  });

  it('ships a discoverable, valid built-in eu-ai-act pack', () => {
    // Default roots → the real runtime/ pack. Proves the shipped pack parses,
    // validates, and references only real gates.
    const packs = loadCompliancePacks(projectRoot, { globalPacksRoot: globalRoot });
    const euAiAct = packs.find((p) => p.manifest.name === 'eu-ai-act');
    expect(euAiAct).toBeDefined();
    expect(euAiAct?.validation.valid).toBe(true);
    expect(euAiAct?.manifest.mappings.length).toBeGreaterThan(0);
  });
});
