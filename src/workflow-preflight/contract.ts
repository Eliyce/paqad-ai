export type ProbeOutcome = 'ok' | 'unavailable' | 'needs-decision';

export type RequirementKind = 'command' | 'file' | 'workflow';

export interface PreflightOption {
  id: string;
  label: string;
  recommended?: boolean;
}

export interface PreflightRequirement {
  id: string;
  label: string;
  kind: RequirementKind;
  why: string;
  probe: (projectRoot: string) => Promise<ProbeOutcome>;
  applies?: (projectRoot: string) => boolean;
  options: PreflightOption[];
}

export interface PreflightRequirementResult {
  id: string;
  label: string;
  kind: RequirementKind;
  why: string;
  outcome: ProbeOutcome;
  options: PreflightOption[];
}

export interface PreflightQuestion {
  id: string;
  label: string;
  why: string;
  outcome: Exclude<ProbeOutcome, 'ok'>;
  options: PreflightOption[];
}

export interface PreflightResult {
  ok: boolean;
  requirements: PreflightRequirementResult[];
  questions: PreflightQuestion[];
}
