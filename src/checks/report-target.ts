import {
  type ChecksReport,
  readChecksReport,
  readFeatureChecks,
  writeChecksReport,
  writeFeatureChecks,
} from '@/checks/report-store.js';
import { currentFeature } from '@/feature-evidence/stage-ledger.js';
import { resolveSessionId } from '@/rag-ledger/session.js';

export function activeFeatureDirOrNull(projectRoot: string): string | null {
  try {
    return currentFeature(projectRoot, checksSessionId(projectRoot));
  } catch {
    return null;
  }
}

export function checksSessionId(projectRoot: string): string {
  return resolveSessionId(projectRoot, explicitSessionHint());
}

function explicitSessionHint(): string | null {
  for (const candidate of [process.env.SE_SESSION, process.env.CLAUDE_SESSION_ID]) {
    const cleaned = candidate?.trim();
    if (cleaned) return cleaned;
  }
  return null;
}

export function readChecksReportForFeature(
  projectRoot: string,
  dirName: string | null,
): ChecksReport | null {
  if (dirName) {
    const fromBundle = readFeatureChecks(projectRoot, dirName);
    if (fromBundle) return fromBundle;
  }
  return readChecksReport(projectRoot);
}

export function writeChecksReportForFeature(
  projectRoot: string,
  dirName: string | null,
  report: ChecksReport,
): string {
  return dirName
    ? writeFeatureChecks(projectRoot, dirName, report, checksSessionId(projectRoot))
    : writeChecksReport(projectRoot, report);
}
