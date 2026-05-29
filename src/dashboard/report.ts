import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';

import { collectArchitecture } from './collectors/architecture.js';
import { collectDecisions } from './collectors/decisions.js';
import { collectFrameworkVersion } from './collectors/framework-version.js';
import { collectInstructionsAreas } from './collectors/instructions-areas.js';
import { collectModuleDecisions } from './collectors/module-decisions.js';
import { collectModuleDocs } from './collectors/module-docs.js';
import { collectModuleEvents } from './collectors/module-events.js';
import { collectModuleHealth } from './collectors/module-health.js';
import { collectModuleMapDrift } from './collectors/module-map-drift.js';
import { collectPentest } from './collectors/pentest.js';
import { collectProjectProfile } from './collectors/project-profile.js';
import { collectRagStatus } from './collectors/rag-status.js';
import { collectRuleCompliance } from './collectors/rule-compliance.js';
import { collectRules } from './collectors/rules.js';
import { collectSession } from './collectors/session.js';
import { collectStackDrift } from './collectors/stack-drift.js';
import { collectWorkflows } from './collectors/workflows.js';
import { bandForScore } from './scoring/index.js';
import type { AttentionItem, DashboardReport, ScoreBand, SectionData } from './types.js';

export interface BuildReportOptions {
  /** Reference timestamp; defaults to `Date.now()`. */
  now?: number;
}

/**
 * Severity ranking for attention items — lower = higher priority. Used
 * to pick the top-N for the summary band.
 */
const SEVERITY_RANK: Record<AttentionItem['severity'], number> = {
  critical: 0,
  warn: 1,
  info: 2,
};

const MAX_ATTENTION_ITEMS = 5;

/**
 * Computes the overall score as the average of every applicable
 * section's score, ignoring `unknown` (N/A) sections. Returns `null`
 * when no section is applicable (typically: project not onboarded).
 */
function computeOverall(sections: SectionData[]): { score: number | null; band: ScoreBand } {
  const applicable = sections.filter((s): s is SectionData & { score: number } => s.score !== null);
  if (applicable.length === 0) return { score: null, band: 'unknown' };
  const avg = Math.round(applicable.reduce((sum, s) => sum + s.score, 0) / applicable.length);
  return { score: avg, band: bandForScore(avg) };
}

/**
 * Build a complete dashboard report for `projectRoot`. Returns the
 * same payload regardless of consumer — the HTTP server, the
 * `paqad-ai status` printer, and any future consumer all key off this.
 */
export function buildReport(
  projectRoot: string,
  options: BuildReportOptions = {},
): DashboardReport {
  const now = options.now ?? Date.now();
  const root = resolve(projectRoot);
  const generatedAt = new Date(now).toISOString();

  // Project not onboarded → short-circuit. Single empty-state report
  // the UI renders as the "Run paqad-ai onboard first" card.
  const paqadDir = join(root, PATHS.AGENCY_DIR);
  const manifestPath = join(root, PATHS.ONBOARDING_MANIFEST);
  if (!existsSync(paqadDir) || !existsSync(manifestPath)) {
    return {
      schemaVersion: 1,
      generatedAt,
      projectRoot: root,
      projectName: null,
      frameworkVersion: null,
      notOnboarded: true,
      overallScore: null,
      overallBand: 'unknown',
      attention: [],
      sections: [],
    };
  }

  const { section: projectProfileSection, projectName } = collectProjectProfile(root);
  const { section: frameworkVersionSection, frameworkVersion } = collectFrameworkVersion(root, now);
  const ragSection = collectRagStatus(root, now);
  const { section: decisionsSection, attention: decisionsAttention } = collectDecisions(root, now);
  const { section: moduleHealthSection, attention: moduleHealthAttention } = collectModuleHealth(
    root,
    now,
  );
  const { section: stackDriftSection, attention: stackDriftAttention } = collectStackDrift(
    root,
    now,
  );
  const { section: moduleMapDriftSection, attention: moduleMapDriftAttention } =
    collectModuleMapDrift(root);
  const { section: moduleDecisionsSection, attention: moduleDecisionsAttention } =
    collectModuleDecisions(root, now);
  const { section: moduleEventsSection, attention: moduleEventsAttention } =
    collectModuleEvents(root);
  const rulesSection = collectRules(root, now);
  const workflowsSection = collectWorkflows(root, now);
  const moduleDocsSection = collectModuleDocs(root, now);
  const areaSections = collectInstructionsAreas(root, now);
  const architectureSection = collectArchitecture(root, now);
  const { section: pentestSection, attention: pentestAttention } = collectPentest(root, now);
  const { section: ruleComplianceSection, attention: ruleComplianceAttention } =
    collectRuleCompliance(root);
  const sessionSection = collectSession(root, now);

  // Display order — matches the section table in the design brief.
  const sections: SectionData[] = [
    projectProfileSection,
    rulesSection,
    workflowsSection,
    decisionsSection,
    moduleHealthSection,
    moduleDocsSection,
    moduleMapDriftSection,
    moduleDecisionsSection,
    moduleEventsSection,
    architectureSection,
    ...areaSections,
    stackDriftSection,
    frameworkVersionSection,
    ragSection,
    pentestSection,
    ruleComplianceSection,
    sessionSection,
  ];

  const allAttention: AttentionItem[] = [
    ...decisionsAttention,
    ...moduleHealthAttention,
    ...moduleMapDriftAttention,
    ...moduleDecisionsAttention,
    ...moduleEventsAttention,
    ...stackDriftAttention,
    ...pentestAttention,
    ...ruleComplianceAttention,
  ].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);

  const { score: overallScore, band: overallBand } = computeOverall(sections);

  return {
    schemaVersion: 1,
    generatedAt,
    projectRoot: root,
    projectName,
    frameworkVersion,
    notOnboarded: false,
    overallScore,
    overallBand,
    attention: allAttention.slice(0, MAX_ATTENTION_ITEMS),
    sections,
  };
}
