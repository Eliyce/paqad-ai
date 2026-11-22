import { readFeatureChecks } from '@/checks/report-store.js';
import { readFeatureStageUnit } from '@/feature-evidence/stage-ledger.js';
import { runRepositoryVerification } from '@/verification/repository/run-repository-verification.js';

import { readHudVerdict, writeHudReceipt, type HudVerdictReading } from './receipt-file.js';

export type VerdictJudge = (projectRoot: string, sessionId: string) => Promise<void>;

export function newestChangeEvidenceAt(projectRoot: string, dirName: string): number | null {
  let newest: number | null = null;
  const consider = (value: unknown): void => {
    const at = typeof value === 'string' ? Date.parse(value) : Number.NaN;
    if (!Number.isNaN(at) && (newest === null || at > newest)) newest = at;
  };
  try {
    for (const row of readFeatureStageUnit(projectRoot, dirName)) consider(row.recorded_at);
  } catch {
    newest = null;
  }
  const report = readFeatureChecks(projectRoot, dirName);
  consider(report?.generated_at ?? report?.recorded_at);
  return newest;
}

export function hudVerdictIsStale(projectRoot: string, reading: HudVerdictReading): boolean {
  if (reading.status !== 'found' || !reading.record.change) return false;
  const writtenAt = Date.parse(reading.record.written_at);
  if (Number.isNaN(writtenAt)) return true;
  const newest = newestChangeEvidenceAt(projectRoot, reading.record.change);
  return newest !== null && newest > writtenAt;
}

const judgeAgain: VerdictJudge = async (projectRoot, sessionId) => {
  const verdict = await runRepositoryVerification({
    projectRoot,
    origin: 'hook-completion',
    hostSessionId: sessionId,
  });
  writeHudReceipt(projectRoot, sessionId, verdict);
};

export async function readFreshHudVerdict(
  projectRoot: string,
  sessionId: string,
  judge: VerdictJudge = judgeAgain,
): Promise<HudVerdictReading> {
  const reading = readHudVerdict(projectRoot, sessionId);
  if (!hudVerdictIsStale(projectRoot, reading)) return reading;
  await judge(projectRoot, sessionId);
  return readHudVerdict(projectRoot, sessionId);
}
