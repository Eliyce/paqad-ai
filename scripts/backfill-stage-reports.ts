import { homedir } from 'node:os';

import { resolveSessionId } from '@/rag-ledger/session.js';
import { backfillStageReports, claudeTranscriptFinder } from '@/stage-isolation/report-backfill.js';

const since = process.argv.find((arg) => arg.startsWith('--since='))?.slice('--since='.length);
if (!since) {
  process.stderr.write('usage: backfill-stage-reports.ts --since=YYYY-MM-DD [--apply]\n');
  process.exit(2);
}
const root = process.cwd();
const changes = backfillStageReports({
  projectRoot: root,
  sessionId: resolveSessionId(root, process.env.SE_SESSION ?? null),
  since,
  findTranscript: claudeTranscriptFinder(homedir()),
  apply: process.argv.includes('--apply'),
});
process.stdout.write(`${JSON.stringify(changes, null, 2)}\n`);
