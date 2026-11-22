import { readFileSync } from 'node:fs';
import { ulid } from '@/core/ids/ulid.js';
import { join } from 'node:path';

import {
  runSliceGate,
  SLICE_GATE_LIMIT_MS,
  sliceDigest,
  sliceFiles,
  type SliceGateStep,
} from '@/checks/slice-gate.js';
import { defaultSliceGateSteps } from '@/checks/slice-gate-steps.js';
import { getPackageRoot } from '@/core/runtime-paths.js';
import { createPendingDecision } from '@/decisions/authoring.js';
import { featureChangeKey } from '@/feature-evidence/paths.js';
import {
  appendFeatureStageRow,
  currentFeature,
  readFeatureStageUnit,
} from '@/feature-evidence/stage-ledger.js';
import { loadChangeEvidence } from '@/pipeline/change-evidence.js';
import { sliceOutOfAttempts } from '@/planning/slicing.js';
import {
  developmentEndRefusal,
  foldSlices,
  readCompiledSlicing,
  resumeFanOut,
  sliceDoneRefusal,
  sliceEndRefusedRow,
  sliceOwnedFiles,
  sliceProgressFile,
  sliceReport,
  sliceRisk,
  sliceStartRefusal,
  slicesView,
  type CompiledSlicing,
} from '@/stage-evidence/slices.js';
import { SLICE_DONE_KIND, SLICE_GATE_KIND, SLICE_START_KIND } from '@/stage-evidence/types.js';

export const LEAD_GUIDE_FILE = 'runtime/base/checklists/lead-developer.md';

export function leadGuideText(packageRoot: string = getPackageRoot()): string {
  return readFileSync(join(packageRoot, LEAD_GUIDE_FILE), 'utf8');
}

export function sliceBriefText(slicing: CompiledSlicing, id: string): string | null {
  const owned = sliceOwnedFiles(slicing, id);
  if (owned === null) return null;
  const ws = slicing.workstreams.find((w) => w.id === id);
  const provides = (ws?.provides_seams ?? []).map(
    (seam) => `${seam.name} (entry \`${seam.entry_file}\`, wired by ${seam.wired_ac})`,
  );
  const list = (items: readonly string[]) => (items.length > 0 ? items.join(', ') : 'none');
  return [
    `# Slice ${id}`,
    '',
    `You build slice \`${id}\` of this change. Export SE_WORKSTREAM=${id}.`,
    '',
    `- Criteria: ${list(ws?.acs ?? [])}`,
    `- Owned files: ${list(owned.map((glob) => `\`${glob}\``))}`,
    `- Seams you provide: ${list(provides)}`,
    `- Seams you use: ${list(ws?.uses_seams ?? [])}`,
    `- Progress file: \`${sliceProgressFile(id)}\`; keep it updated so the lead can dispatch you fresh.`,
    '',
    'Follow the slice section of your recipe. Return DONE only after slice done is accepted, and BLOCKED after opening a packet.',
    '',
  ].join('\n');
}

export interface SliceCommandContext {
  projectRoot: string;
  sessionId: string;
  agentId: string | null;
  nowMs?: () => number;
  changedFiles?: readonly string[];
  steps?: Partial<Record<'format' | 'lint' | 'typecheck' | 'rules' | 'tests', SliceGateStep>>;
  out?: (line: string) => void;
  err?: (line: string) => void;
}

export interface SliceCommandResult {
  ok: boolean;
  message: string;
  packet?: string;
}

function subjectOf(slicing: CompiledSlicing, id: string) {
  const ws = slicing.workstreams.find((w) => w.id === id);
  return {
    id,
    owned_files: sliceOwnedFiles(slicing, id) ?? [],
    acs: ws?.acs ?? [],
    seams: slicing.workstreams
      .flatMap((w) => w.provides_seams)
      .filter((seam) => (ws?.acs ?? []).includes(seam.wired_ac)),
  };
}

export async function runSlicePhase(
  action: string,
  id: string | undefined,
  ctx: SliceCommandContext,
): Promise<SliceCommandResult> {
  const nowMs = ctx.nowMs ?? Date.now;
  const dirName = currentFeature(ctx.projectRoot, ctx.sessionId);
  if (dirName === null) return { ok: false, message: 'no active change for this session' };
  const slicing = readCompiledSlicing(ctx.projectRoot, dirName);
  const rows = () => readFeatureStageUnit(ctx.projectRoot, dirName);
  const append = (row: Record<string, unknown>) =>
    appendFeatureStageRow(ctx.projectRoot, ctx.sessionId, dirName, {
      agent: 'paqad-development',
      ...(ctx.agentId ? { agent_id: ctx.agentId } : {}),
      ...row,
    });

  if (action === 'resume') {
    const resume = resumeFanOut(rows());
    return { ok: true, message: JSON.stringify(resume) };
  }
  if (!id) return { ok: false, message: `name the workstream to ${action}` };
  if (action === 'start') {
    const refusal = sliceStartRefusal(slicing, id, rows(), nowMs());
    if (refusal) return { ok: false, message: refusal };
    append({ kind: SLICE_START_KIND, workstream: id, stage: 'development', refusal_id: ulid() });
    return { ok: true, message: `slice ${id} started` };
  }
  if (slicing === null || sliceOwnedFiles(slicing, id) === null) {
    return { ok: false, message: sliceStartRefusal(slicing, id, [], nowMs()) ?? 'unknown slice' };
  }
  const changed = ctx.changedFiles ?? (await loadChangeEvidence(ctx.projectRoot)).files;
  const subject = subjectOf(slicing, id);
  if (action === 'gate') {
    if (!foldSlices(rows()).has(id))
      return { ok: false, message: `slice "${id}" has no slice_start row` };
    const result = await runSliceGate({
      projectRoot: ctx.projectRoot,
      subject,
      changedFiles: changed,
      nowMs,
      steps: {
        ...defaultSliceGateSteps({
          projectRoot: ctx.projectRoot,
          deadlineMs: nowMs() + SLICE_GATE_LIMIT_MS,
          nowMs,
        }),
        ...ctx.steps,
      },
    });
    append({
      kind: SLICE_GATE_KIND,
      refusal_id: ulid(),
      workstream: id,
      stage: 'development',
      event_status: result.passed ? 'completed' : 'failed',
      failures: result.failures.length > 0 ? result.failures : [],
      digest: result.digest,
      ...(result.slowest_step ? { slowest_step: result.slowest_step } : {}),
    });
    if (result.passed) return { ok: true, message: `slice ${id} gate passed` };
    const failures = foldSlices(rows()).get(id)?.gate_failures ?? 0;
    let packet: string | undefined;
    if (sliceOutOfAttempts(sliceRisk(slicing, id), failures)) {
      packet = raiseSlicePacket(ctx, dirName, id, result.failures);
    }
    return {
      ok: false,
      message: `slice ${id} gate failed: ${result.failures.join('; ')}`,
      ...(packet ? { packet } : {}),
    };
  }
  if (action === 'done') {
    const digest = sliceDigest(ctx.projectRoot, id, sliceFiles(subject, changed));
    const refusal = sliceDoneRefusal(rows(), id, digest);
    if (refusal) return { ok: false, message: refusal };
    append({ kind: SLICE_DONE_KIND, workstream: id, stage: 'development', digest });
    return { ok: true, message: `slice ${id} done` };
  }
  return {
    ok: false,
    message: `unknown slice action "${action}" — use start, gate, done or resume`,
  };
}

function raiseSlicePacket(
  ctx: SliceCommandContext,
  dirName: string,
  id: string,
  failures: readonly string[],
): string | undefined {
  try {
    const created = createPendingDecision(ctx.projectRoot, {
      category: 'implementation',
      title: `Slice ${id} failed its gate after its last attempt`,
      context: `The slice gate for workstream ${id} failed: ${failures.join('; ')}`,
      options: [
        {
          option_key: 'redispatch',
          label: 'Dispatch the slice again',
          trade_off: 'more build time',
        },
        {
          option_key: 'drop',
          label: 'Drop the slice from this change',
          trade_off: 'its criteria stay open',
        },
      ],
      change: featureChangeKey(dirName),
      workstream: id,
      askAnyway: true,
    });
    return created.id;
  } catch (error) {
    ctx.err?.(`could not raise the slice packet: ${(error as Error).message}`);
    return undefined;
  }
}

export function developmentEndCheck(
  projectRoot: string,
  sessionId: string,
  agentId: string | null,
): string | null {
  const dirName = currentFeature(projectRoot, sessionId);
  if (dirName === null) return null;
  const rows = readFeatureStageUnit(projectRoot, dirName);
  const slicing = readCompiledSlicing(projectRoot, dirName);
  const refusal = developmentEndRefusal(slicing, rows, agentId);
  if (refusal === null) return null;
  if (refusal.kind === 'slice-agent' && agentId) {
    appendFeatureStageRow(projectRoot, sessionId, dirName, sliceEndRefusedRow(refusal, agentId));
  }
  return refusal.message;
}

export function slicesSettings(projectRoot: string, sessionId: string) {
  const dirName = currentFeature(projectRoot, sessionId);
  if (dirName === null) return null;
  const slicing = readCompiledSlicing(projectRoot, dirName);
  if (slicing === null) return null;
  return slicesView(slicing, readFeatureStageUnit(projectRoot, dirName));
}

export function slicesReport(projectRoot: string, sessionId: string) {
  const dirName = currentFeature(projectRoot, sessionId);
  if (dirName === null) return null;
  const slicing = readCompiledSlicing(projectRoot, dirName);
  if (slicing === null) return null;
  return sliceReport(slicing, readFeatureStageUnit(projectRoot, dirName));
}
