import type { AgentRole } from '@/core/types/agent.js';
import type { PipelineQuestion } from '../types.js';

export const MAX_EXPERT_QUESTIONS = 5;

export type FindingKind = 'requirement' | 'invariant' | 'acceptance' | 'risk' | 'non-goal';

export type FindingSeverity = 'must' | 'should' | 'could';

export type ExpertOrigin = 'detector' | 'standing';

export interface ExpertNeed {
  role: AgentRole;
  reason: string;
  origin?: ExpertOrigin;
}

export interface ExpertNeedArtifact {
  experts: ExpertNeed[];
}

export interface ExpertFinding {
  id?: string;
  target: string;
  claim: string;
  kind?: FindingKind;
  severity?: FindingSeverity;
  evidence?: string;
  renamed_from?: string;
}

export interface ExpertNote {
  role: AgentRole;
  findings: ExpertFinding[];
  questions?: PipelineQuestion[];
}

export interface ExpertConflict {
  target: string;
  roles: AgentRole[];
  claims: string[];
  finding_ids: string[];
}

export interface MergedExpertNotes {
  findings: ExpertFinding[];
  conflicts: ExpertConflict[];
  voice_warnings?: VoiceWarning[];
}

export interface ExpertSlice {
  role: AgentRole;
  budget: number;
  granted: number;
  clamped: boolean;
}

export interface ExpertAccounting {
  role: AgentRole;
  reason: string;
  tokens: number;
  changed_spec: boolean;
  origin?: ExpertOrigin;
  empty?: boolean;
}

export interface VoiceWarning {
  id: string;
  target: string;
  hint: string;
}

export interface ExpertRunAccounting {
  experts: ExpertAccounting[];
  total_tokens: number;
  warnings: string[];
}
