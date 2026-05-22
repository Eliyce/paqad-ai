import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { InstructionsDocsStructureGate } from '@/verification/gates/instructions-docs-structure.js';

import { createVerificationContext } from '../shared.fixture.js';

describe('InstructionsDocsStructureGate', () => {
  it('skips when no instruction documentation paths changed', async () => {
    const result = await new InstructionsDocsStructureGate().check(
      createVerificationContext({
        changed_files: ['src/service.ts'],
        documentation_files_changed: false,
      }),
    );

    expect(result).toEqual({
      gate: 'instructions-docs-structure',
      passed: true,
      detail: 'No instruction documentation changes detected',
    });
  });

  it('passes valid instruction documentation files', async () => {
    const context = createVerificationContext({
      changed_files: [
        'docs/instructions/rules/_shared/testing.md',
        'docs/instructions/rules/module-map.yml',
        'docs/instructions/architecture/design-tokens.json',
        'docs/instructions/design-system/theme.css',
        'docs/instructions/workflows/feature-development.yaml',
        'docs/instructions/tools/node-cli/README.md',
      ],
      documentation_files_changed: true,
    });

    writeInstructionFile(context.project_root, 'docs/instructions/rules/_shared/testing.md');
    writeInstructionFile(
      context.project_root,
      'docs/instructions/rules/module-map.yml',
      validModuleMapYaml(),
    );
    writeInstructionFile(
      context.project_root,
      'docs/instructions/architecture/design-tokens.json',
      '{}\n',
    );
    writeInstructionFile(
      context.project_root,
      'docs/instructions/design-system/theme.css',
      ':root {}\n',
    );
    writeInstructionFile(
      context.project_root,
      'docs/instructions/workflows/feature-development.yaml',
      validFeatureDevelopmentPolicyYaml(),
    );
    writeInstructionFile(context.project_root, 'docs/instructions/tools/node-cli/README.md');

    const result = await new InstructionsDocsStructureGate().check(context);

    expect(result).toEqual({
      gate: 'instructions-docs-structure',
      passed: true,
      detail: 'Instruction documentation structure is valid',
    });
  });

  it('skips outside provider completion checks', async () => {
    const context = createVerificationContext({
      verification_origin: 'paqad-cli',
      verification_stage: 'other',
      changed_files: ['docs/instructions/random/foo.md'],
      documentation_files_changed: true,
    });

    const result = await new InstructionsDocsStructureGate().check(context);

    expect(result).toEqual({
      gate: 'instructions-docs-structure',
      passed: true,
      detail: 'No instruction documentation changes detected',
    });
  });

  it('fails nearby non-canonical instruction roots', async () => {
    const result = await new InstructionsDocsStructureGate().check(
      createVerificationContext({
        changed_files: ['docs/instruction/rules/testing.md'],
        documentation_files_changed: true,
      }),
    );

    expect(result).toEqual({
      gate: 'instructions-docs-structure',
      passed: false,
      detail: 'Invalid instruction documentation path docs/instruction/rules/testing.md',
      remediation:
        'Move instruction documentation under an approved docs/instructions/{rules,stack,architecture,design-system,registries,workflows,tools,benchmarks,tech-debt}/ path.',
    });
  });

  it('fails unapproved top-level folders under docs/instructions', async () => {
    const result = await new InstructionsDocsStructureGate().check(
      createVerificationContext({
        changed_files: ['docs/instructions/random/foo.md'],
        documentation_files_changed: true,
      }),
    );

    expect(result).toEqual({
      gate: 'instructions-docs-structure',
      passed: false,
      detail: 'Invalid instruction documentation path docs/instructions/random/foo.md',
      remediation:
        'Move instruction documentation under an approved docs/instructions/{rules,stack,architecture,design-system,registries,workflows,tools,benchmarks,tech-debt}/ path.',
    });
  });

  it('fails hidden or system files touched under docs/instructions', async () => {
    const result = await new InstructionsDocsStructureGate().check(
      createVerificationContext({
        changed_files: ['docs/instructions/rules/.DS_Store'],
        documentation_files_changed: true,
      }),
    );

    expect(result.passed).toBe(false);
    expect(result.detail).toBe(
      'Invalid instruction documentation path docs/instructions/rules/.DS_Store',
    );
  });

  it('fails markdown files without headings', async () => {
    const context = createVerificationContext({
      changed_files: ['docs/instructions/stack/overview.md'],
      documentation_files_changed: true,
    });
    writeInstructionFile(
      context.project_root,
      'docs/instructions/stack/overview.md',
      'No heading\n',
    );

    const result = await new InstructionsDocsStructureGate().check(context);

    expect(result).toEqual({
      gate: 'instructions-docs-structure',
      passed: false,
      detail:
        'Instruction markdown file docs/instructions/stack/overview.md does not contain a heading',
      remediation: 'Add at least one markdown heading before completing the provider request.',
    });
  });

  it('fails invalid YAML and malformed module maps', async () => {
    const invalidYamlContext = createVerificationContext({
      changed_files: ['docs/instructions/workflows/quick-fix.yaml'],
      documentation_files_changed: true,
    });
    writeInstructionFile(
      invalidYamlContext.project_root,
      'docs/instructions/workflows/quick-fix.yaml',
      'name: [unterminated\n',
    );

    const invalidYamlResult = await new InstructionsDocsStructureGate().check(invalidYamlContext);
    expect(invalidYamlResult.detail).toBe(
      'Instruction YAML file docs/instructions/workflows/quick-fix.yaml does not parse',
    );

    const moduleMapContext = createVerificationContext({
      changed_files: ['docs/instructions/rules/module-map.yaml'],
      documentation_files_changed: true,
    });
    writeInstructionFile(
      moduleMapContext.project_root,
      'docs/instructions/rules/module-map.yaml',
      `modules:
  - name: Billing
`,
    );

    const moduleMapResult = await new InstructionsDocsStructureGate().check(moduleMapContext);
    expect(moduleMapResult.detail).toBe(
      'Instruction module map docs/instructions/rules/module-map.yaml is missing required field version',
    );
  });

  it('fails workflow YAML that does not match reserved policy or custom template structure', async () => {
    const policyContext = createVerificationContext({
      changed_files: ['docs/instructions/workflows/feature-development.yaml'],
      documentation_files_changed: true,
    });
    writeInstructionFile(
      policyContext.project_root,
      'docs/instructions/workflows/feature-development.yaml',
      'name: feature\n',
    );

    const policyResult = await new InstructionsDocsStructureGate().check(policyContext);
    expect(policyResult.detail).toBe(
      'Instruction workflow policy docs/instructions/workflows/feature-development.yaml is invalid',
    );

    const templateContext = createVerificationContext({
      changed_files: ['docs/instructions/workflows/quick-fix.yaml'],
      documentation_files_changed: true,
    });
    writeInstructionFile(
      templateContext.project_root,
      'docs/instructions/workflows/quick-fix.yaml',
      'name: quick-fix\n',
    );

    const templateResult = await new InstructionsDocsStructureGate().check(templateContext);
    expect(templateResult.detail).toBe(
      'Instruction workflow template docs/instructions/workflows/quick-fix.yaml is invalid',
    );
  });

  it('fails invalid JSON and unknown extensions', async () => {
    const invalidJsonContext = createVerificationContext({
      changed_files: ['docs/instructions/design-system/tokens.json'],
      documentation_files_changed: true,
    });
    writeInstructionFile(
      invalidJsonContext.project_root,
      'docs/instructions/design-system/tokens.json',
      '{\n',
    );

    const invalidJsonResult = await new InstructionsDocsStructureGate().check(invalidJsonContext);
    expect(invalidJsonResult.detail).toBe(
      'Instruction JSON file docs/instructions/design-system/tokens.json does not parse',
    );

    const unknownExtensionResult = await new InstructionsDocsStructureGate().check(
      createVerificationContext({
        changed_files: ['docs/instructions/workflows/quick-fix.md'],
        documentation_files_changed: true,
      }),
    );

    expect(unknownExtensionResult.detail).toBe(
      'Invalid instruction documentation path docs/instructions/workflows/quick-fix.md',
    );
  });

  it('fails nested registries, workflows, and unscoped tool files', async () => {
    const nestedRegistryResult = await new InstructionsDocsStructureGate().check(
      createVerificationContext({
        changed_files: ['docs/instructions/registries/components/component-registry.md'],
        documentation_files_changed: true,
      }),
    );
    expect(nestedRegistryResult.detail).toBe(
      'Invalid instruction documentation path docs/instructions/registries/components/component-registry.md',
    );

    const nestedWorkflowResult = await new InstructionsDocsStructureGate().check(
      createVerificationContext({
        changed_files: ['docs/instructions/workflows/feature/quick-fix.yaml'],
        documentation_files_changed: true,
      }),
    );
    expect(nestedWorkflowResult.detail).toBe(
      'Invalid instruction documentation path docs/instructions/workflows/feature/quick-fix.yaml',
    );

    const unscopedToolResult = await new InstructionsDocsStructureGate().check(
      createVerificationContext({
        changed_files: ['docs/instructions/tools/README.md'],
        documentation_files_changed: true,
      }),
    );
    expect(unscopedToolResult.detail).toBe(
      'Invalid instruction documentation path docs/instructions/tools/README.md',
    );
  });
});

function writeInstructionFile(
  projectRoot: string,
  relativePath: string,
  content = '# Heading\n',
): void {
  const absolutePath = join(projectRoot, ...relativePath.split('/'));
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, content);
}

function validModuleMapYaml(): string {
  return `version: 1
last_updated_at: "2026-05-09T00:00:00.000Z"
domain_glossary:
  preferred_terms: []
  synonyms: {}
  notes: ""
modules:
  - name: Billing
    slug: billing
    auto_update_module_name: true
    derivation: inferred
    confidence: medium
    source_paths:
      - src/billing
    evidence:
      routes: []
      tables: []
      symbols: []
    features:
      - name: Invoices
        slug: invoices
        auto_update_feature_name: true
        derivation: inferred
        confidence: medium
        source_paths:
          - src/billing/invoices
`;
}

function validFeatureDevelopmentPolicyYaml(): string {
  return `schema_version: "1"
merge_mode: append
stages:
  checks:
    checks:
      use_project_profile_commands: true
      commands:
        - test
      shell_commands: []
      block_on_failure: true
`;
}
