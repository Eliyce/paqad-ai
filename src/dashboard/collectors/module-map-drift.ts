// Dashboard collector for module-map drift (issue #80 Phase 2 + Phase 4).
//
// Reads .paqad/module-map/drift.json (written by the reconciler) and surfaces
// a per-module drift badge plus an overall section score. Phase 2 ships the
// "drift count per module" badge. Phase 4 layers `--fail-on-drift` semantics
// across this section and three others.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import type { MMFindingCode, ModuleMapDriftReport } from '@/module-map/reconciler.js';

import { bandForScore } from '../scoring/index.js';
import type { AttentionItem, SectionData } from '../types.js';

const HELPER = {
  what: 'Module-map drift compares the source tree under source_roots to module-map.yml + docs/modules/. Findings are written to .paqad/module-map/drift.json by `paqad-ai module-map reconcile` or by `paqad-ai refresh`.',
  goodLooksLike:
    'No MM-* findings; `blocked: null`. Re-run `paqad-ai refresh --reconcile-module-map` after restructuring code.',
} as const;

export interface ModuleMapDriftResult {
  section: SectionData;
  attention: AttentionItem[];
}

function readReport(projectRoot: string): ModuleMapDriftReport | null {
  const path = join(projectRoot, PATHS.MODULE_MAP_DRIFT);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as ModuleMapDriftReport;
  } catch {
    return null;
  }
}

function aggregatePerModule(report: ModuleMapDriftReport): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of report.findings) {
    const key = f.module_slug ?? '<undeclared>';
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

export function collectModuleMapDrift(projectRoot: string): ModuleMapDriftResult {
  const report = readReport(projectRoot);

  if (report === null) {
    return {
      section: {
        id: 'module-map-drift',
        title: 'Module map drift',
        band: 'unknown',
        score: null,
        summary: 'No drift.json — run `paqad-ai module-map reconcile` or `paqad-ai refresh`.',
        metrics: [],
        helper: HELPER,
      },
      attention: [],
    };
  }

  if (report.blocked !== null) {
    return {
      section: {
        id: 'module-map-drift',
        title: 'Module map drift',
        band: 'unknown',
        score: null,
        summary: `Reconciler blocked: ${report.blocked}. Add module_health.source_roots to the active stack pack.`,
        metrics: [{ label: 'blocked', value: report.blocked }],
        helper: HELPER,
      },
      attention: [
        {
          sectionId: 'module-map-drift',
          message: 'Reconciler cannot run — missing module_health.source_roots.',
          severity: 'warn',
        },
      ],
    };
  }

  const total = report.findings.length;
  // Each finding deducts 8; floor at 0.
  const score = Math.max(0, 100 - total * 8);
  const perModule = aggregatePerModule(report);
  const topModules = Object.entries(perModule)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const summary =
    total === 0
      ? `No drift · ${report.source_roots.join(', ')}`
      : `${total} finding(s) across ${Object.keys(perModule).length} module(s)`;

  const attention: AttentionItem[] = [];
  // Always surface MM-DOC-MISSING separately — Phase 4's --fail-on-drift
  // treats it as a hard signal.
  const docMissing = report.findings.filter((f) => f.code === 'MM-DOC-MISSING');
  if (docMissing.length > 0) {
    attention.push({
      sectionId: 'module-map-drift',
      message: `${docMissing.length} module(s) missing docs/modules/ directory.`,
      severity: 'warn',
    });
  }
  const undeclared = report.findings.filter((f) => f.code === 'MM-ADD' || f.code === 'MM-MISMATCH');
  if (undeclared.length > 0) {
    attention.push({
      sectionId: 'module-map-drift',
      message: `${undeclared.length} undeclared / mismatched module path(s).`,
      severity: undeclared.length >= 3 ? 'critical' : 'warn',
    });
  }

  const codeBreakdown: { label: string; value: string }[] = [];
  for (const [code, count] of Object.entries(report.counts) as [MMFindingCode, number][]) {
    if (count > 0) codeBreakdown.push({ label: code, value: String(count) });
  }

  return {
    section: {
      id: 'module-map-drift',
      title: 'Module map drift',
      band: bandForScore(score),
      score,
      summary,
      metrics: [
        { label: 'findings', value: String(total) },
        { label: 'source_roots', value: report.source_roots.join(', ') || '—' },
        ...codeBreakdown,
      ],
      helper: HELPER,
      details: {
        generated_at: report.generated_at,
        per_module: perModule,
        top_modules: topModules,
        sample_findings: report.findings.slice(0, 10),
      },
    },
    attention,
  };
}
