import { stageDefinition } from './stages.js';
import { DEGRADED_CODES, type DegradedCode, type StageId } from './types.js';

export interface DegradedInfo {
  stage: StageId;
  relaxes: readonly string[];
  footnote: string;
  next_action: string;
}

export const DEGRADED: Record<DegradedCode, DegradedInfo> = {
  stack_mismatch_noted: {
    stage: 'detect',
    relaxes: [],
    footnote:
      'The stack in your profile and the one in your manifests disagree; the journey used the detected one.',
    next_action:
      'Check the stack in .paqad/project-profile.yaml and run `paqad-ai refresh` if it is wrong.',
  },
  git_workflow_kept: {
    stage: 'setup',
    relaxes: [],
    footnote:
      'Your git workflow files were changed by hand, so the recommended workflow was not applied.',
    next_action: 'Run `paqad-ai git-workflow setup` when you want the recommended workflow.',
  },
  research_offline: {
    stage: 'rules_discovery',
    relaxes: ['research_online'],
    footnote:
      'Rules research ran offline, so rules come only from your project and past decisions.',
    next_action:
      'Run `paqad-ai rules discovery start` when you are online to research your packages.',
  },
  research_stopped: {
    stage: 'rules_discovery',
    relaxes: ['all_packages'],
    footnote: 'Rules research stopped before every package was read.',
    next_action: 'Run `paqad-ai rules discovery start` to research the packages left.',
  },
  rag_off: {
    stage: 'finish',
    relaxes: ['rag_ready'],
    footnote: 'The search index is off, so agents search your docs without it.',
    next_action: 'Run `paqad-ai rag rebuild` to build the search index.',
  },
};

export type DegradedParse = { ok: true; codes: DegradedCode[] } | { ok: false; message: string };

export function parseDegradedCodes(stage: StageId, raw: readonly string[]): DegradedParse {
  const allowed = stageDefinition(stage).allowed_degraded;
  const codes: DegradedCode[] = [];
  for (const value of raw) {
    if (!(DEGRADED_CODES as readonly string[]).includes(value)) {
      return {
        ok: false,
        message: `"${value}" is not a gap code. Use one of: ${allowed.join(', ') || 'none for this step'}.`,
      };
    }
    const code = value as DegradedCode;
    if (!allowed.includes(code)) {
      return {
        ok: false,
        message: `"${code}" is not an allowed gap for step ${stageDefinition(stage).index} (${stageDefinition(stage).name}).`,
      };
    }
    if (!codes.includes(code)) codes.push(code);
  }
  return { ok: true, codes };
}

export function relaxedItems(codes: readonly DegradedCode[]): Set<string> {
  return new Set(codes.flatMap((code) => DEGRADED[code].relaxes));
}
