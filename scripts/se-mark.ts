import {
  endStage,
  foldChange,
  openStageEvidence,
  startStage,
  verifyChange,
} from '@/stage-evidence/index.js';
import { STAGE_EVIDENCE_DOC_TYPE } from '@/stage-evidence/types.js';
import { currentOrdinal } from '@/session-ledger/ledger.js';
import { resolveSessionId } from '@/rag-ledger/session.js';

const [verb, stage] = process.argv.slice(2);
const artifactArg = process.argv.find((a) => a.startsWith('--artifact='));
const artifactPaths = artifactArg ? artifactArg.slice('--artifact='.length).split(',') : [];
const root = process.cwd();
const sessionId = resolveSessionId(root, process.env.SE_SESSION ?? null);
const ctx = { sessionId, adapter: 'claude-code' as const };

function out(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

switch (verb) {
  case 'open':
    out(openStageEvidence(root, ctx));
    break;
  case 'start':
    out(startStage(root, stage, ctx));
    break;
  case 'end':
    out(endStage(root, stage, { artifactPaths }, ctx));
    break;
  case 'verify':
    out(verifyChange(root, ctx));
    break;
  case 'status':
    out(foldChange(root, sessionId, currentOrdinal(root, STAGE_EVIDENCE_DOC_TYPE, sessionId) || 1));
    break;
  default:
    process.stderr.write(`unknown verb: ${verb}\n`);
    process.exit(2);
}
