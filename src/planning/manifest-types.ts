export type {
  CompiledRule,
  CompiledRulesStore,
  CoverageOverlayEntry,
  DecisionRecord,
  DocTarget,
  ExecutionSlice,
  HealthTier,
  IntelligenceContext,
  ManifestClassification,
  ManifestDelta,
  ModuleHealthMetrics,
  ModuleHealthProfile,
  PlanVsActualDiff,
  PlanVsActualSnapshot,
  PlanningCostEntry,
  PlanningCostLog,
  PlanningLane,
  PlanningManifest,
  RegressionEntry,
  RequirementNode,
  VerificationCriterion,
} from '@/core/types/planning.js';

export interface ValidationIssue {
  code: string;
  message: string;
  path?: string;
}

export interface ManifestValidationError extends ValidationIssue {
  severity: 'error';
}

export interface ValidationReport {
  valid: boolean;
  errors: ManifestValidationError[];
  warnings: ValidationIssue[];
}
