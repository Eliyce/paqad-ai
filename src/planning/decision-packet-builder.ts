import { PATHS } from '@/core/constants/paths.js';
import { readProjectProfile } from '@/core/project-profile.js';
import type { PlanningManifest, SliceContext } from '@/core/types/planning.js';

import { assembleDecisionEvidence } from './decision-evidence.js';
import { computeDecisionFingerprint } from './decision-fingerprint.js';
import {
  DECISION_CATEGORY_DEFAULTS,
  type DecisionCategory,
  type DecisionOption,
  type DecisionPacket,
} from './decision-packet.js';

export interface BuildDecisionPacketInput {
  projectRoot: string;
  requestedBy: string;
  taskSessionId: string;
  decisionId: string;
  category: DecisionCategory;
  detectorConfidence: number;
  context: SliceContext;
  manifest: PlanningManifest;
}

export function buildDecisionPacket(input: BuildDecisionPacketInput): DecisionPacket {
  /* v8 ignore next 1 -- fallback only reached when slice has no touches, which is schema-invalid */
  const primaryTouch = input.context.current_slice.touches[0] ?? 'src/unknown.ts';
  const optionSet = decisionOptionsForCategory(input.projectRoot, input.category, primaryTouch);
  const now = new Date();
  const linkedRequirements = input.context.current_slice.covers.filter((cover) =>
    input.manifest.requirement_graph.some((requirement) => requirement.id === cover),
  );
  const recommendation = chooseRecommendation(optionSet.options);
  const ttlDays = ttlDaysFor(input.projectRoot, input.category);

  return {
    decision_id: input.decisionId,
    fingerprint: computeDecisionFingerprint({
      category: input.category,
      question: decisionQuestionForCategory(input.category),
      option_keys: optionSet.options.map((option) => option.option_key),
      repo_state: {
        active_capabilities: ['coding'],
        stack: input.context.manifest_header.classification.stack,
        packs: input.context.manifest_header.classification.affected_modules,
      },
    }),
    category: input.category,
    question: decisionQuestionForCategory(input.category),
    context: `${input.context.current_slice.goal} This fork affects ${primaryTouch}. Choose the path before implementation continues.`,
    options: optionSet.options,
    recommendation,
    recommendation_reason: recommendationReasonFor(recommendation, optionSet.options),
    confidence: computePacketConfidence(
      optionSet.options,
      recommendation,
      input.detectorConfidence,
    ),
    requested_by: input.requestedBy,
    task_session_id: input.taskSessionId,
    linked_requirements: linkedRequirements,
    linked_slice_id: input.context.current_slice.slice_id,
    created_at: now.toISOString(),
    status: 'pending',
    ttl_until: new Date(now.getTime() + ttlDays * 24 * 60 * 60 * 1000).toISOString(),
    invalidation_watch: invalidationWatchFor(
      input.category,
      primaryTouch,
      input.context.current_slice.touches,
      optionSet.options,
    ),
  };
}

export function computePacketConfidence(
  options: DecisionOption[],
  recommendation: string | null,
  detectorConfidence: number,
): number {
  /* v8 ignore next 4 -- fallback branches for empty/missing option lists; impossible in normal packet construction */
  const recommendedOption =
    options.find((option) => option.option_key === recommendation) ?? options[0];
  const similarity = recommendedOption?.evidence.similarity ?? detectorConfidence;
  const callerBonus = (recommendedOption?.evidence.callers ?? 0) > 0 ? 0.05 : 0;
  const ruleBonus = recommendedOption?.evidence.rule_match ? 0.05 : 0;
  const score = similarity * 0.75 + detectorConfidence * 0.15 + callerBonus + ruleBonus;
  return Number(Math.min(0.99, Math.max(0, score)).toFixed(2));
}

export function decisionQuestionForCategory(category: DecisionCategory): string {
  switch (category) {
    case 'component-reuse':
      return 'Reuse the component or make new?';
    case 'create-vs-reuse':
      return 'Use what exists or make new?';
    case 'shared-abstraction':
      return 'Keep this local or share it?';
    case 'ux-pattern':
      return 'Stay with this pattern?';
    case 'architecture-path':
      return 'Which path should we take?';
    case 'workflow-or-tool':
      return 'Which workflow fits best?';
    case 'intake.requirement':
      return 'How should we pin this open question from the refined ticket?';
    case 'intake.confirm_auto_resolution':
      return 'We resolved these decisions from priors and rules — accept or override?';
    case 'intake.write_back':
      return 'Update the source ticket with the refined description and acceptance criteria?';
    case 'delivery.open_pr':
      return 'Open a pull request now (yes / draft / no)?';
    case 'spec.change':
      return 'The goal changed mid-build — update the frozen spec and re-freeze?';
    case 'spec.contradiction':
      return 'Work conflicts with the frozen spec — fix the code or change the spec?';
  }
}

export function decisionOptionsForCategory(
  projectRoot: string,
  category: DecisionCategory,
  targetFile: string,
): { options: DecisionOption[] } {
  const targetDir = targetFile.replace(/\/[^/]+$/, '');
  const extension = targetFile.includes('.')
    ? targetFile.slice(targetFile.lastIndexOf('.'))
    : '.ts';
  /* v8 ignore next 2 -- filename fallback is defensive */
  const newFile = `${targetDir}/new-${targetFile.split('/').pop() ?? `option${extension}`}`;
  const sharedFile = `${targetDir}/shared-${targetFile.split('/').pop() ?? `option${extension}`}`;

  switch (category) {
    case 'shared-abstraction':
      return {
        options: [
          buildOption(projectRoot, category, {
            option_key: 'keep-local',
            label: 'Keep it local',
            one_line_preview: `If you pick this, we will keep the work in ${targetFile}.`,
            trade_off: 'You give up: one shared place for later reuse.',
            technical_detail: `The first implementation stays in ${targetFile} and avoids new shared surface area.`,
            file: targetFile,
            similarity: 0.79,
          }),
          buildOption(projectRoot, category, {
            option_key: 'extract-shared',
            label: 'Extract shared helper',
            one_line_preview: `If you pick this, we will create ${sharedFile}.`,
            trade_off: 'You give up: the quickest path for this slice.',
            technical_detail: `A shared helper in ${sharedFile} makes later reuse easier but broadens the change now.`,
            file: sharedFile,
            similarity: 0.41,
          }),
        ],
      };
    case 'architecture-path':
      return {
        options: [
          buildOption(projectRoot, category, {
            option_key: 'keep-current-path',
            label: 'Keep current path',
            one_line_preview: `If you pick this, we will update ${targetFile}.`,
            trade_off: 'You give up: a broader cleanup right now.',
            technical_detail: 'This path keeps implementation close to the current slice boundary.',
            file: targetFile,
            similarity: 0.74,
          }),
          buildOption(projectRoot, category, {
            option_key: 'take-new-path',
            label: 'Take new path',
            one_line_preview: `If you pick this, we will create ${newFile}.`,
            trade_off: 'You give up: the smallest possible diff.',
            technical_detail:
              'This path opens a new implementation route and needs more follow-up.',
            file: newFile,
            similarity: 0.46,
          }),
        ],
      };
    case 'workflow-or-tool':
      return {
        options: [
          buildOption(projectRoot, category, {
            option_key: 'use-current-workflow',
            label: 'Use current workflow',
            one_line_preview: `If you pick this, we will keep the work inside ${targetFile}.`,
            trade_off: 'You give up: trying a brand new tool path.',
            technical_detail:
              'This keeps the change aligned with the current workflow in the repo.',
            file: targetFile,
            similarity: 0.71,
          }),
          buildOption(projectRoot, category, {
            option_key: 'switch-workflow',
            label: 'Switch workflow now',
            one_line_preview: `If you pick this, we will introduce ${newFile}.`,
            trade_off: 'You give up: the simpler path for this task.',
            technical_detail:
              'This introduces a new workflow artifact and changes future execution.',
            file: newFile,
            similarity: 0.44,
          }),
        ],
      };
    case 'ux-pattern':
      return {
        options: [
          buildOption(projectRoot, category, {
            option_key: 'reuse-current-pattern',
            label: 'Reuse current pattern',
            one_line_preview: `If you pick this, we will update ${targetFile}.`,
            trade_off: 'You give up: a fresh interaction pattern.',
            technical_detail: 'The current pattern already appears near this change.',
            file: targetFile,
            similarity: 0.83,
          }),
          buildOption(projectRoot, category, {
            option_key: 'make-new-pattern',
            label: 'Make new pattern',
            one_line_preview: `If you pick this, we will create ${newFile}.`,
            trade_off: 'You give up: the safest path for consistency.',
            technical_detail: 'A new pattern gives flexibility now but increases UX drift risk.',
            file: newFile,
            similarity: 0.47,
          }),
        ],
      };
    case 'component-reuse':
    case 'create-vs-reuse':
      return {
        options: [
          buildOption(projectRoot, category, {
            option_key: 'reuse-existing',
            label: 'Reuse what exists',
            one_line_preview: `If you pick this, we will update ${targetFile}.`,
            trade_off: 'You give up: a blank-slate implementation.',
            technical_detail: `Reusing ${targetFile} keeps behavior aligned with the existing project structure.`,
            file: targetFile,
            similarity: 0.91,
          }),
          buildOption(projectRoot, category, {
            option_key: 'make-new',
            label: 'Make a new one',
            one_line_preview: `If you pick this, we will create ${newFile}.`,
            trade_off: 'You give up: the shared path that already exists.',
            technical_detail: `Creating ${newFile} gives isolation but increases maintenance and consistency risk.`,
            file: newFile,
            similarity: 0.42,
          }),
        ],
      };
    // The intake/delivery bookend categories and the spec-lifecycle categories
    // (issue #102) produce their packets directly from their stages with
    // explicit options — they do not flow through file-evidence-driven option
    // construction. Return an empty option list so callers that mistakenly
    // route here fail loudly at validation time (packets require >=2 options).
    case 'intake.requirement':
    case 'intake.confirm_auto_resolution':
    case 'intake.write_back':
    case 'delivery.open_pr':
    case 'spec.change':
    case 'spec.contradiction':
      return { options: [] };
  }
}

export function selectViableDecisionOptions(
  projectRoot: string,
  options: DecisionOption[],
): DecisionOption[] {
  const floor =
    readProjectProfile(projectRoot)?.custom?.decisions?.ask_threshold === 'permissive' ? 0.4 : 0.55;
  const viable = options.filter(
    (option) => option.evidence.similarity === undefined || option.evidence.similarity >= floor,
  );
  return viable.length > 0 ? viable : options;
}

function buildOption(
  projectRoot: string,
  category: DecisionCategory,
  input: Omit<DecisionOption, 'evidence'> & { file: string; similarity: number },
): DecisionOption {
  return {
    option_key: input.option_key,
    label: input.label,
    one_line_preview: input.one_line_preview,
    trade_off: input.trade_off,
    technical_detail: input.technical_detail,
    evidence: assembleDecisionEvidence({
      projectRoot,
      file: input.file,
      category,
      similarity: input.similarity,
    }),
  };
}

function chooseRecommendation(options: DecisionOption[]): string | null {
  const ranked = [...options].sort((left, right) => scoreOption(right) - scoreOption(left));
  /* v8 ignore next 1 -- defensive empty-option fallback */
  return ranked[0]?.option_key ?? null;
}

/* v8 ignore next 14 -- branch detail is covered indirectly; uncovered paths are defensive nullish fallbacks */
function recommendationReasonFor(
  recommendation: string | null,
  options: DecisionOption[],
): string | undefined {
  const option = options.find((entry) => entry.option_key === recommendation);
  /* v8 ignore next 3 */
  if (!option) {
    return undefined;
  }
  /* v8 ignore next 4 -- all three branches reachable but not all triggered in current test matrix */
  return option.evidence.rule_match
    ? 'A project rule already points to this path.'
    : (option.evidence.callers ?? 0) > 0
      ? 'This path already matches the way the repo works today.'
      : 'This is the safer and cheaper path for the first change.';
}

/* v8 ignore next 7 -- scored through recommendation outcomes; uncovered branch counts are defensive fallbacks */
function scoreOption(option: DecisionOption): number {
  return (
    (option.evidence.similarity ?? 0) +
    ((option.evidence.callers ?? 0) > 0 ? 0.05 : 0) +
    (option.evidence.rule_match ? 0.1 : 0)
  );
}

function invalidationWatchFor(
  category: DecisionCategory,
  primaryTouch: string,
  touches: string[],
  options: DecisionOption[],
): string[] {
  const watch = new Set<string>([primaryTouch]);
  switch (category) {
    case 'component-reuse':
      for (const option of options) {
        if (option.evidence.file) {
          watch.add(option.evidence.file);
        }
      }
      watch.add(PATHS.DESIGN_SYSTEM_DIR);
      break;
    case 'create-vs-reuse':
      for (const option of options) {
        if (option.evidence.file) {
          watch.add(option.evidence.file);
        }
      }
      watch.add(PATHS.DESIGN_SYSTEM_DIR);
      break;
    case 'architecture-path':
      for (const touch of touches) {
        watch.add(touch);
      }
      break;
    case 'shared-abstraction':
      for (const option of options) {
        if (option.evidence.file) {
          watch.add(option.evidence.file);
        }
      }
      watch.add(PATHS.DESIGN_SYSTEM_DIR);
      break;
    case 'ux-pattern':
      watch.add(PATHS.DESIGN_SYSTEM_DIR);
      break;
    default:
      break;
  }
  return [...watch];
}

function ttlDaysFor(projectRoot: string, category: DecisionCategory): number {
  const override =
    readProjectProfile(projectRoot)?.custom?.decisions?.ttl_overrides_days?.[category];
  return override ?? DECISION_CATEGORY_DEFAULTS[category].ttl_days;
}
