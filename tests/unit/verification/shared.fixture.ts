import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { EnterpriseConfig } from '@/core/types/project-profile.js';
import type { VerificationContext } from '@/core/types/verification.js';

export function createVerificationContext(
  overrides: Partial<VerificationContext> = {},
): VerificationContext {
  const projectRoot = mkdtempSync(join(tmpdir(), 'paqad-verification-'));
  mkdirSync(join(projectRoot, 'docs/modules/core/ui'), { recursive: true });
  mkdirSync(join(projectRoot, 'docs/modules/core/api'), { recursive: true });
  mkdirSync(join(projectRoot, 'docs/modules/core/integration'), { recursive: true });
  writeFileSync(join(projectRoot, 'docs/modules/core/ui/screens.md'), '# screens');
  writeFileSync(
    join(projectRoot, 'docs/modules/core/api/endpoints.md'),
    `# API Endpoints

## Endpoints

### GET /users

- **Method**: GET
- **Route**: /users
- **Auth**: session
- **Description**: Returns users.
- **Request Schema**: none
- **Response Schema**: UserList
`,
  );
  writeFileSync(join(projectRoot, 'docs/modules/core/api/schemas.md'), '# schemas');
  writeFileSync(join(projectRoot, 'docs/modules/core/api/error-codes.md'), '# error codes');
  writeFileSync(join(projectRoot, 'docs/modules/core/integration/events.md'), '# events');
  writeFileSync(join(projectRoot, 'docs/modules/core/integration/contracts.md'), '# contracts');
  writeFileSync(
    join(projectRoot, 'docs/modules/core/error-catalog.md'),
    `# Error Catalog

## Error Code Format

Use stable codes with a prefix and numeric suffix.

## Errors

### API-001: Request rejected

- **Code**: API-001
- **User-Facing Message**: Request rejected.
- **Trigger**: Input validation failed.
- **Recovery Path**: Fix the request and retry.
`,
  );

  return {
    project_root: projectRoot,
    verification_origin: 'provider-workflow',
    verification_stage: 'provider-completion',
    modules: ['core'],
    changed_files: [],
    changed_files_source: 'none',
    code_changed: false,
    test_files_changed: false,
    documentation_files_changed: false,
    stale_doc_targets: [],
    requirements_complete: true,
    story_quality_passed: true,
    ac_test_mapping_passed: true,
    spec_review_passed: true,
    architecture_compliant: true,
    code_tests_lint_passed: true,
    implementation_review_passed: true,
    behavioral_correctness_passed: true,
    database_quality_passed: true,
    expected_ui_modules: ['core'],
    expected_api_modules: ['core'],
    expected_integration_modules: ['core'],
    expected_error_catalog_modules: ['core'],
    registry_refreshed_at: new Date().toISOString(),
    glossary_updated: true,
    ...overrides,
  };
}

/**
 * Issue #187 — write a minimal project profile into a fixture's `project_root`
 * that opts the enterprise ledger on. `readProjectProfile` tolerates/migrates a
 * partial profile, preserving the `enterprise` block. Defaults turn on the full
 * ledger write set; pass overrides to exercise individual sub-flags.
 */
export function writeEnterpriseProfile(
  projectRoot: string,
  enterprise: Partial<EnterpriseConfig> = {},
): void {
  const block: EnterpriseConfig = {
    enabled: true,
    evidence_ledger: true,
    ai_bom: true,
    compliance_citations: false,
    ...enterprise,
  };
  mkdirSync(join(projectRoot, '.paqad'), { recursive: true });
  const lines = [
    'enterprise:',
    `  enabled: ${block.enabled}`,
    `  evidence_ledger: ${block.evidence_ledger}`,
    `  ai_bom: ${block.ai_bom}`,
    `  compliance_citations: ${block.compliance_citations}`,
    '',
  ];
  writeFileSync(join(projectRoot, '.paqad', 'project-profile.yaml'), lines.join('\n'));
}
