import { resolveFrameworkConfig } from '@/core/framework-config.js';
import { readProjectProfile } from '@/core/project-profile.js';
import { createPendingDecision, readContractDecisions } from '@/decisions/authoring.js';
import { featureChangeKey } from '@/feature-evidence/paths.js';
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

export const READINESS_DECISION_TITLE =
  "Visual evidence is on, but I can't capture screenshots here yet";

export const READINESS_WAIVE_OPTION = 'waive';

export function readinessToken(dirName: string): string {
  return `[paqad-ve-readiness ${dirName}]`;
}

export function visualEvidenceFlagOn(projectRoot: string): boolean {
  if (!resolveFrameworkConfig(projectRoot).features.visual_evidence) return false;
  return readProjectProfile(projectRoot)?.active_capabilities?.includes('coding') ?? false;
}

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
    change: featureChangeKey(dirName),
  });
  return id;
}

export function visualAcRequiredFiles(projectRoot: string, files: readonly string[]): string[] {
  if (!visualEvidenceFlagOn(projectRoot)) return [];
  return frontendTriggerOrFault(projectRoot, [...new Set(files)]).files;
}

export function findVisualEvidenceWaiver(projectRoot: string, dirName: string): string | null {
  const token = readinessToken(dirName);
  for (const { packet, status } of readContractDecisions(projectRoot)) {
    if (status !== 'resolved' || !packet.context.includes(token)) continue;
    if ((packet as { chosen?: string }).chosen === READINESS_WAIVE_OPTION) return packet.id;
  }
  return null;
}

export function visualEvidenceWaiverHint(projectRoot: string, dirName: string): string {
  const token = readinessToken(dirName);
  const pending = readContractDecisions(projectRoot).find(
    ({ packet, status }) => status === 'pending' && packet.context.includes(token),
  );
  if (pending) {
    return `resolve the pending readiness decision with \`paqad-ai decision resolve ${pending.packet.id} ${READINESS_WAIVE_OPTION}\``;
  }
  return (
    `create one with \`paqad-ai decision create --category workflow-or-tool --title "Visual evidence waiver" ` +
    `--context "<why no screenshots> ${token}" --option ${READINESS_WAIVE_OPTION}="Waive visual evidence" ` +
    `--option attach="Attach screenshots"\` and resolve it with \`paqad-ai decision resolve <D-id> ${READINESS_WAIVE_OPTION}\``
  );
}
