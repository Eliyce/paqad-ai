import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { queryPatterns } from '@/compliance/defect-patterns/store.js';
import type { ResolutionMap } from '@/core/types/classification.js';
import type { PostClassificationAdjustments } from '@/core/types/post-classification.js';
import type { PreClassificationResult } from '@/core/types/pre-classification.js';
import type { ClassificationResult } from '@/core/types/classification.js';
import { PATHS } from '@/core/constants/paths.js';
import { COMPLEXITY_LEVELS, selectLane } from '@/core/types/routing.js';
import { readAllModuleHealth } from '@/planning/module-health.js';
import { syncModuleHealth } from '@/planning/module-health-updater.js';

export class PostClassifier {
  constructor(private readonly projectRoot?: string) {}

  async adjust(
    classification: ClassificationResult,
    _preResult: PreClassificationResult,
    resolutionMap: ResolutionMap,
  ): Promise<PostClassificationAdjustments> {
    const laneBeforeOverride = selectWorkflowAwareLane(classification);
    if (this.projectRoot) {
      await syncModuleHealth({
        projectRoot: this.projectRoot,
        source: 'preflight',
        preflight: true,
        silent: true,
      });
    }
    const healthProfiles = this.projectRoot ? await readAllModuleHealth(this.projectRoot) : [];
    const affected = new Set(classification.affected_modules);
    const relevantHealth = healthProfiles.filter((profile) => affected.has(profile.module));

    let laneOverrideReason: string | null = null;
    let complexity = classification.complexity;
    let risk = classification.risk;

    if (relevantHealth.some((profile) => profile.tier === 'fragile')) {
      laneOverrideReason = 'Affected modules include fragile health tiers.';
      risk = 'high';
      resolutionMap.risk = 'health-override';
    } else if (
      relevantHealth.length > 0 &&
      relevantHealth.every((profile) => profile.tier === 'stable') &&
      classification.complexity === 'trivial'
    ) {
      laneOverrideReason = 'Stable modules allow the fast lane for trivial work.';
    }

    const defectFloor = await this.computeRiskFloor(classification);
    if (riskRank(defectFloor.risk_floor) > riskRank(risk)) {
      risk = defectFloor.risk_floor!;
      resolutionMap.risk = 'defect-floor';
    }

    const complexityAdjustment = await this.computeComplexityAdjustment(
      classification.affected_modules,
    );
    if (complexityAdjustment.adjustment !== 0) {
      complexity = applyComplexityAdjustment(complexity, complexityAdjustment.adjustment);
      resolutionMap.complexity = 'history-corrected';
    }

    const highOverrideRate =
      Object.values(resolutionMap).filter((source) => source === 'llm-overridden').length /
        Math.max(Object.keys(resolutionMap).length, 1) >
      0.3;

    await this.writeHistory(highOverrideRate);

    return {
      complexity,
      risk,
      lane_before_override: laneBeforeOverride,
      lane_override_reason: laneOverrideReason,
      risk_floor: defectFloor.risk_floor,
      risk_floor_reason: defectFloor.risk_floor_reason,
      complexity_adjustment: complexityAdjustment.adjustment,
      complexity_adjustment_reason: complexityAdjustment.reason,
      resolution_updates: {},
      high_override_rate: highOverrideRate,
    };
  }

  private async computeRiskFloor(classification: ClassificationResult): Promise<{
    risk_floor: ClassificationResult['risk'] | null;
    risk_floor_reason: string | null;
  }> {
    const { frequency, matchCount } = await this.readDefectStats(classification.affected_modules);
    if (frequency > 10) {
      return {
        risk_floor: 'high',
        risk_floor_reason: 'Defect history exceeds 10 relevant recurrences.',
      };
    }
    if (frequency > 5) {
      return {
        risk_floor: 'medium',
        risk_floor_reason: 'Defect history exceeds 5 relevant recurrences.',
      };
    }
    if (matchCount > 3) {
      return {
        risk_floor: 'medium',
        risk_floor_reason: 'More than 3 open defect patterns tracked for affected modules.',
      };
    }
    return { risk_floor: null, risk_floor_reason: null };
  }

  private async readDefectStats(
    affectedModules: string[],
  ): Promise<{ frequency: number; matchCount: number }> {
    try {
      const patterns = await queryPatterns({ min_frequency: 1, limit: 10 });
      const matching = patterns.filter((entry) =>
        entry.example_files.some((file) =>
          affectedModules.some((modulePath) => file.replace(/\\/g, '/').includes(modulePath)),
        ),
      );
      const frequency = matching.reduce((max, entry) => Math.max(max, entry.frequency), 0);
      return { frequency, matchCount: matching.length };
    } catch {
      return { frequency: 0, matchCount: 0 };
    }
  }

  private async computeComplexityAdjustment(affectedModules: string[]): Promise<{
    adjustment: number;
    reason: string | null;
  }> {
    if (!this.projectRoot) {
      return { adjustment: 0, reason: null };
    }

    const specsDir = join(this.projectRoot, PATHS.PLANNING_SPECS_DIR);
    try {
      const files = (await readdir(specsDir)).filter((file) =>
        file.endsWith('.plan-vs-actual.json'),
      );
      const records: Array<{ scope_accuracy_pct?: number }> = [];

      for (const file of files) {
        try {
          const parsed = JSON.parse(await readFile(join(specsDir, file), 'utf8')) as {
            scope_accuracy_pct?: number;
            unplanned_files?: string[];
          };
          const touchesAffected =
            affectedModules.length === 0 ||
            (parsed.unplanned_files ?? []).some((entry) =>
              affectedModules.some((modulePath) => entry.includes(modulePath)),
            );
          if (touchesAffected) {
            records.push(parsed);
          }
        } catch {
          // Ignore corrupt history.
        }
      }

      if (records.length < 3) {
        return { adjustment: 0, reason: null };
      }

      const lowAccuracy = records.filter((entry) => (entry.scope_accuracy_pct ?? 100) < 67).length;
      const veryHighAccuracy = records.filter(
        (entry) => (entry.scope_accuracy_pct ?? 0) > 200,
      ).length;

      if (lowAccuracy >= 3) {
        return { adjustment: 1, reason: 'Plan-vs-actual history shows repeated under-scoping.' };
      }
      if (veryHighAccuracy >= 3) {
        return { adjustment: -1, reason: 'Plan-vs-actual history shows repeated over-estimation.' };
      }
    } catch {
      // Ignore missing history.
    }

    return { adjustment: 0, reason: null };
  }

  private async writeHistory(highOverrideRate: boolean): Promise<void> {
    if (!this.projectRoot) {
      return;
    }

    const filePath = join(this.projectRoot, PATHS.AGENCY_CACHE_DIR, 'classification-history.json');
    let entries: Array<{ timestamp: string; high_override_rate: boolean }> = [];
    try {
      entries = JSON.parse(await readFile(filePath, 'utf8')) as Array<{
        timestamp: string;
        high_override_rate: boolean;
      }>;
    } catch {
      entries = [];
    }

    entries.push({ timestamp: new Date().toISOString(), high_override_rate: highOverrideRate });
    entries = entries.slice(-50);
    await mkdir(join(this.projectRoot, PATHS.AGENCY_CACHE_DIR), { recursive: true });
    await writeFile(filePath, JSON.stringify(entries, null, 2) + '\n', 'utf8');
  }
}

function applyComplexityAdjustment(
  complexity: ClassificationResult['complexity'],
  adjustment: number,
): ClassificationResult['complexity'] {
  const index = COMPLEXITY_LEVELS.indexOf(complexity);
  const next = Math.max(0, Math.min(COMPLEXITY_LEVELS.length - 1, index + adjustment));
  return COMPLEXITY_LEVELS[next]!;
}

function riskRank(risk: ClassificationResult['risk'] | null | undefined): number {
  if (risk === 'high') {
    return 3;
  }
  if (risk === 'medium') {
    return 2;
  }
  if (risk === 'low') {
    return 1;
  }
  return 0;
}

function selectWorkflowAwareLane(classification: ClassificationResult): string {
  if (classification.workflow === 'project-question') {
    return 'fast';
  }
  if (
    classification.workflow === 'writing' ||
    classification.workflow === 'editing' ||
    classification.workflow === 'planning' ||
    classification.workflow === 'research'
  ) {
    return 'fast';
  }
  if (classification.workflow === 'investigation') {
    return 'fast';
  }
  if (classification.workflow === 'pentest' || classification.workflow === 'pentest-retest') {
    return 'graduated';
  }
  if (classification.workflow === 'migration') {
    return 'full';
  }
  if (classification.workflow === 'bug-fix') {
    return classification.complexity === 'low' && classification.risk === 'low'
      ? 'fast'
      : 'graduated';
  }
  if (classification.workflow === 'feature-development') {
    return classification.risk === 'high' ? 'full' : 'graduated';
  }
  return selectLane(classification.complexity, classification.risk);
}
