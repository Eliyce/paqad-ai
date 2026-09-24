// Visual-evidence readiness (issue #579, FR-8).
//
// The prerequisites a capture run needs on this machine: the site_map flag, a confirmed journey,
// a capture script, and a provisioned browser. doctor reports them as warn rows; plan compile uses
// the same list to open one decision pause when a frontend change cannot be captured here. One
// source, so the two can never disagree.

import { resolveFrameworkConfig } from '@/core/framework-config.js';
import { readProjectProfile } from '@/core/project-profile.js';
import { createPendingDecision, readContractDecisions } from '@/decisions/authoring.js';
import { readAllJourneys } from '@/site-map/store.js';

import { listCaptureScriptIds } from './capture-script.js';
import { browserStatus } from './provision.js';
import { frontendTriggerOrFault } from './trigger.js';

export type VisualEvidenceReadinessCode =
  'site-map-off' | 'no-confirmed-journey' | 'no-capture-script' | 'browser-not-provisioned';

export interface VisualEvidenceReadinessProblem {
  code: VisualEvidenceReadinessCode;
  detail: string;
  remediation: string;
}

/**
 * Every readiness problem, in doctor's order. Empty means a capture run can work here. Does not
 * check the visual_evidence flag itself: callers decide whether readiness matters.
 */
export function visualEvidenceReadiness(projectRoot: string): VisualEvidenceReadinessProblem[] {
  const problems: VisualEvidenceReadinessProblem[] = [];

  if (!resolveFrameworkConfig(projectRoot).features.site_map) {
    problems.push({
      code: 'site-map-off',
      detail:
        'visual_evidence is on but site_map is off — capture scripts derive from confirmed site-map journeys, so nothing can be captured.',
      remediation:
        'Turn on site_map (env PAQAD_SITE_MAP) and author a confirmed journey + capture script.',
    });
  }

  if (!readAllJourneys(projectRoot).some((journey) => journey.status === 'confirmed')) {
    problems.push({
      code: 'no-confirmed-journey',
      detail:
        'visual_evidence is on but no confirmed journey exists under docs/site-map/journeys/ — only confirmed journeys produce evidence.',
      remediation:
        'Confirm a journey (paqad-ai sitemap journey confirm) so it can back a capture script.',
    });
  }

  if (listCaptureScriptIds(projectRoot).length === 0) {
    problems.push({
      code: 'no-capture-script',
      detail:
        'visual_evidence is on but no *.capture.yaml exists under docs/site-map/journeys/ — there is nothing to capture.',
      remediation:
        'Author a docs/site-map/journeys/<id>.capture.yaml for a confirmed journey (see docs/modules/visual-evidence).',
    });
  }

  if (browserStatus() !== 'provisioned') {
    problems.push({
      code: 'browser-not-provisioned',
      detail:
        'visual_evidence is on but the capture browser is not provisioned — a capture run would record playwright-not-provisioned.',
      remediation:
        'Run `paqad-ai visual-evidence setup` to provision Playwright + Chromium under ~/.paqad-ai/ve-runtime.',
    });
  }

  return problems;
}

/** The pause title (FR-9), verbatim. */
export const READINESS_DECISION_TITLE =
  "Visual evidence is on, but I can't capture screenshots here yet";

/** The option key a resolved readiness packet carries when the developer waived capture. */
export const READINESS_WAIVE_OPTION = 'waive';

/**
 * The machine token a readiness packet's context carries for one change, so a re-run of plan
 * compile finds it (no second packet) and the gate can find a waiver for this change only.
 */
export function readinessToken(dirName: string): string {
  return `[paqad-ve-readiness ${dirName}]`;
}

/** visual_evidence flag AND the coding capability are both on for this project. */
export function visualEvidenceFlagOn(projectRoot: string): boolean {
  if (!resolveFrameworkConfig(projectRoot).features.visual_evidence) return false;
  return readProjectProfile(projectRoot)?.active_capabilities?.includes('coding') ?? false;
}

/**
 * Open ONE readiness decision pause for a frontend change that cannot be captured on this
 * machine (issue #579, FR-9). Returns the new packet id, or null when visual evidence is off,
 * the files are not frontend (or the pack registry is broken, which the gate reports), the
 * machine is ready, or a packet for this change already exists (pending or resolved).
 */
export function openVisualEvidenceReadinessPause(input: {
  projectRoot: string;
  dirName: string;
  files: readonly string[];
}): string | null {
  const { projectRoot, dirName } = input;
  if (!visualEvidenceFlagOn(projectRoot)) return null;
  if (!frontendTriggerOrFault(projectRoot, [...input.files]).triggered) return null;
  const problems = visualEvidenceReadiness(projectRoot);
  if (problems.length === 0) return null;
  const token = readinessToken(dirName);
  if (readContractDecisions(projectRoot).some(({ packet }) => packet.context.includes(token))) {
    return null;
  }
  const reasons = problems.map((problem) => `- ${problem.detail}`).join('\n');
  const { id } = createPendingDecision(projectRoot, {
    category: 'workflow-or-tool',
    title: READINESS_DECISION_TITLE,
    context:
      `This change touches frontend files and visual evidence is on, but a capture run cannot work here yet:\n${reasons}\n` +
      `Pick how this change gets its visual evidence. ${token}`,
    options: [
      { option_key: 'setup', label: 'Set it up now (site map journey, capture script, browser)' },
      {
        option_key: 'attach',
        label: 'Attach my own screenshots with paqad-ai visual-evidence attach',
      },
      { option_key: READINESS_WAIVE_OPTION, label: 'Record a waiver for this change' },
    ],
    recommendation: 'setup',
  });
  return id;
}

/**
 * The id of a resolved readiness packet for this change whose chosen option is `waive`, or null.
 * A waiver makes the strict gate read skipped ("waived by D-<id>"), never pass (INV-7).
 */
export function findVisualEvidenceWaiver(projectRoot: string, dirName: string): string | null {
  const token = readinessToken(dirName);
  for (const { packet, status } of readContractDecisions(projectRoot)) {
    if (status !== 'resolved' || !packet.context.includes(token)) continue;
    if ((packet as { chosen?: string }).chosen === READINESS_WAIVE_OPTION) return packet.id;
  }
  return null;
}
