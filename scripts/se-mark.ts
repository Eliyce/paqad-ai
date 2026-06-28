// Dogfood + dev helper: drive the stage-evidence recorder from the shell so a
// human/agent can mark stages live while following the feature-development
// workflow. `npx tsx scripts/se-mark.ts <verb> [stage] [--artifact f1,f2]`.
//   open | start <stage> | end <stage> [--artifact a,b] | verify | status
// Session id comes from SE_SESSION (defaults to a stable dev id).

import {
  endStage,
  foldChange,
  openStageEvidence,
  startStage,
  verifyChange,
} from '@/stage-evidence/index.js';

const [verb, stage] = process.argv.slice(2);
const artifactArg = process.argv.find((a) => a.startsWith('--artifact='));
const artifactPaths = artifactArg ? artifactArg.slice('--artifact='.length).split(',') : [];
const sessionId = process.env.SE_SESSION ?? 'dev-session';
const ctx = { sessionId, adapter: 'claude-code' as const };
const root = process.cwd();

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
    out(foldChange(root, sessionId, 1));
    break;
  default:
    process.stderr.write(`unknown verb: ${verb}\n`);
    process.exit(2);
}
