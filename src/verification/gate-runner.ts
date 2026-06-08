import type { EvaluateEscalationInput } from '@/core/types/token-efficiency.js';
import type { GateResult, VerificationContext } from '@/core/types/verification.js';
import type { DeltaReasoningPayload, VerificationDelta } from '@/core/types/token-efficiency.js';
import { buildVerificationGateDeltaPayload } from './delta.js';

import { AcTestMappingGate } from './gates/ac-test-mapping.js';
import { ArchitectureComplianceGate } from './gates/architecture-compliance.js';
import { BehavioralCorrectnessGate } from './gates/behavioral-correctness.js';
import { ChangeCompletenessGate } from './gates/change-completeness.js';
import { CodeTestsLintGate } from './gates/code-tests-lint.js';
import { DatabaseQualityGate } from './gates/database-quality.js';
import { DocumentationFreshnessGate } from './gates/documentation-freshness.js';
import type { Gate } from './gates/gate.interface.js';
import { ImplementationReviewGate } from './gates/implementation-review.js';
import { InstructionsDocsStructureGate } from './gates/instructions-docs-structure.js';
import { ModuleDocsStructureGate } from './gates/module-docs-structure.js';
import { MutationTestingGate } from './gates/mutation-testing.js';
import { QualityRatchetGate } from './gates/quality-ratchet.js';
import { RequirementCompletenessGate } from './gates/requirement-completeness.js';
import { SpecReviewGate } from './gates/spec-review.js';
import { StoryQualityGate } from './gates/story-quality.js';

export class VerificationGateRunner {
  constructor(private readonly gates: Gate[] = defaultGates()) {}

  async run(context: VerificationContext): Promise<GateResult[]> {
    const results: GateResult[] = [];
    let firstFailure: GateResult | null = null;

    for (const gate of this.gates) {
      if (firstFailure && !shouldRunAfterFailure(gate, context)) {
        continue;
      }

      const result = await gate.check(context);
      results.push(result);

      if (!result.passed && firstFailure === null) {
        firstFailure = result;
      }
    }

    return results;
  }

  async runWithDelta(
    context: VerificationContext,
    baselineResults: GateResult[],
    escalationInput: Omit<EvaluateEscalationInput, 'compact'> = {},
  ): Promise<{ results: GateResult[]; delta_payload: DeltaReasoningPayload<VerificationDelta> }> {
    const results = await this.run(context);
    return {
      results,
      delta_payload: buildVerificationGateDeltaPayload(baselineResults, results, escalationInput),
    };
  }
}

function shouldRunAfterFailure(gate: Gate, context: VerificationContext): boolean {
  if (gate.gate === 'module-docs-structure') {
    return context.changed_files.some((filePath) => {
      const normalized = normalizePath(filePath);
      return normalized.startsWith('docs/modules/') || normalized.startsWith('docs/module/');
    });
  }

  if (gate.gate === 'instructions-docs-structure') {
    return context.changed_files.some((filePath) => {
      const normalized = normalizePath(filePath);
      return (
        normalized.startsWith('docs/instructions/') ||
        normalized.startsWith('docs/instruction/') ||
        normalized.startsWith('docs/instruction-docs/') ||
        normalized.startsWith('docs/instructions-docs/')
      );
    });
  }

  return false;
}

function normalizePath(filePath: string): string {
  return filePath.replaceAll('\\', '/').replace(/^\.?\//, '');
}

function defaultGates(): Gate[] {
  return [
    new ChangeCompletenessGate(),
    new RequirementCompletenessGate(),
    new StoryQualityGate(),
    new AcTestMappingGate(),
    new SpecReviewGate(),
    new ArchitectureComplianceGate(),
    new CodeTestsLintGate(),
    new ImplementationReviewGate(),
    new BehavioralCorrectnessGate(),
    new MutationTestingGate(),
    new QualityRatchetGate(),
    new DatabaseQualityGate(),
    new ModuleDocsStructureGate(),
    new InstructionsDocsStructureGate(),
    new DocumentationFreshnessGate(),
  ];
}
