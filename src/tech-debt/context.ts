import { readFeatureRecord } from '@/feature-evidence/feature-record.js';
import { featureChangeKey } from '@/feature-evidence/paths.js';
import {
  readFeatureTechDebtIndex,
  type TechDebtIndexEntry,
} from '@/feature-evidence/tech-debt-index.js';
import { currentFeature, foldFeature } from '@/feature-evidence/stage-ledger.js';
import { resolveSessionId } from '@/rag-ledger/session.js';

import type { DebtFoundIn } from './items.js';

export interface DebtContext {
  session: string;
  dirName: string | null;
  foundIn: DebtFoundIn;
}

export function resolveDebtContext(projectRoot: string, sessionHint: string | null): DebtContext {
  const session = resolveSessionId(projectRoot, sessionHint);
  const dirName = currentFeature(projectRoot, session);
  if (dirName === null) {
    return { session, dirName, foundIn: { change: null, issue: null, stage: null } };
  }
  const running = foldFeature(projectRoot, session, dirName).stages.filter(
    (stage) => stage.state === 'running',
  );
  return {
    session,
    dirName,
    foundIn: {
      change: featureChangeKey(dirName),
      issue: readFeatureRecord(projectRoot, dirName)?.issue ?? null,
      stage: running.at(-1)?.stage ?? null,
    },
  };
}

export function raisedTechDebt(
  projectRoot: string,
  sessionHint: string | null,
): TechDebtIndexEntry[] {
  const dirName = currentFeature(projectRoot, resolveSessionId(projectRoot, sessionHint));
  return dirName === null ? [] : (readFeatureTechDebtIndex(projectRoot, dirName) ?? []);
}
