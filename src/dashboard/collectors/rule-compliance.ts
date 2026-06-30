// Dashboard collector for rules-as-scripts (issue #89).
//
// Reads the rule-script map, the cached findings report, and the drift report
// to derive a band + the exact prompt the user should type next. `unknown`
// until `analyze rules` has produced a map (onboarding plants the prompt).

import { loadRuleScriptMap } from '@/rule-scripts/map.js';
import { readLatestRuleDrift, readLatestRuleFindings } from '@/rule-scripts/rule-ledger.js';

import type { AttentionItem, SectionData } from '../types.js';

const HELPER = {
  what: 'Rules-as-scripts turns each rule under docs/instructions/rules/** into a deterministic verification script enforced during feature-development.checks.',
  goodLooksLike:
    'Every verifiable rule covered by a passing script, no drift, findings report fresh.',
} as const;

export function collectRuleCompliance(projectRoot: string): {
  section: SectionData;
  attention: AttentionItem[];
} {
  const map = loadRuleScriptMap(projectRoot);
  const attention: AttentionItem[] = [];

  // Never analyzed — unknown band, plant the entry prompt.
  if (!map || map.rules.length === 0) {
    attention.push({
      sectionId: 'rule-compliance',
      message: 'Rules not yet scripted — type `analyze rules` to classify them.',
      severity: 'info',
    });
    return {
      section: {
        id: 'rule-compliance',
        title: 'Rule Compliance',
        band: 'unknown',
        score: null,
        summary: 'No rule-script map — run `analyze rules`',
        metrics: [{ label: 'rules', value: '—' }],
        helper: HELPER,
      },
      attention,
    };
  }

  const total = map.rules.length;
  const unverifiable = map.rules.filter((r) => r.verifiability.kind === 'unverifiable').length;
  const enforcedElsewhere = map.rules.filter((r) => r.enforced_by.length > 0).length;
  const verifiable = map.rules.filter(
    (r) => r.verifiability.kind !== 'unverifiable' && r.enforced_by.length === 0,
  );
  const covered = verifiable.filter((r) => r.scripts.length > 0).length;
  const uncovered = verifiable.length - covered;

  // Buildout F6 (hard cutover, D1) — read compliance evidence from the
  // session-ledger, not the engine cache files. report.json / drift.json remain
  // the engine's own caches; the dashboard + SIEM read the folded rows.
  const drift = readLatestRuleDrift(projectRoot);
  const findings = readLatestRuleFindings(projectRoot);

  const driftBlocking = drift?.blocked ?? false;
  const deterministicFindings = findings?.counts.deterministic ?? 0;

  // Band: red on blocking drift or deterministic findings; amber on uncovered
  // verifiable rules; green when everything is covered and clean.
  let band: SectionData['band'];
  let score: number;
  if (driftBlocking || deterministicFindings > 0) {
    band = 'red';
    score = 40;
  } else if (uncovered > 0) {
    band = 'amber';
    score = 70;
  } else {
    band = 'green';
    score = 100;
  }

  // Attention items, priority-ordered, each naming the exact prompt.
  if (drift && driftBlocking) {
    const stale = drift.counts['RS-SCRIPT-STALE'] + drift.counts['RS-RULE-EDITED'];
    if (stale > 0) {
      attention.push({
        sectionId: 'rule-compliance',
        message: 'Rules edited but scripts not regenerated — type `generate rule scripts`.',
        severity: 'warn',
      });
    }
    if (drift.counts['RS-FIXTURE-FAIL'] > 0) {
      attention.push({
        sectionId: 'rule-compliance',
        message: `${drift.counts['RS-FIXTURE-FAIL']} script(s) failing fixtures — type \`regenerate scripts for rule RL-…\`.`,
        severity: 'critical',
      });
    }
    if (drift.counts['RS-RULE-ADDED'] > 0) {
      attention.push({
        sectionId: 'rule-compliance',
        message: 'Unscripted rules added — type `analyze rules` then `generate rule scripts`.',
        severity: 'warn',
      });
    }
  }
  if (uncovered > 0) {
    attention.push({
      sectionId: 'rule-compliance',
      message: `${uncovered} verifiable rule(s) without scripts — type \`generate rule scripts\`.`,
      severity: 'info',
    });
  }
  if (unverifiable > 0) {
    attention.push({
      sectionId: 'rule-compliance',
      message: `${unverifiable} rule(s) marked unverifiable — consider rewording (see rule-script-map.yml).`,
      severity: 'info',
    });
  }

  const driftNote = driftBlocking ? ' • drift' : '';
  const summary = `${covered}/${verifiable.length} verifiable covered • ${unverifiable} unverifiable${driftNote}`;

  return {
    section: {
      id: 'rule-compliance',
      title: 'Rule Compliance',
      band,
      score,
      summary: summary.slice(0, 60),
      metrics: [
        { label: 'covered', value: `${covered}/${verifiable.length}` },
        { label: 'enforced elsewhere', value: String(enforcedElsewhere) },
        { label: 'findings', value: String(deterministicFindings) },
      ],
      helper: HELPER,
      details: {
        total,
        covered,
        uncovered,
        unverifiable,
        enforced_elsewhere: enforcedElsewhere,
        drift_blocking: driftBlocking,
        deterministic_findings: deterministicFindings,
      },
    },
    attention,
  };
}
