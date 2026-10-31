import {
  AuthoringRefusal,
  readMode,
  renderGateMarkdown,
  type SkillWorkspace,
} from '../workspace.js';
import { stageResult, type StageResult } from './result.js';

export const EXCLUSIONS = ['one-off', 'documented', 'convention', 'enforceable'] as const;
export type Exclusion = (typeof EXCLUSIONS)[number];

export const BASELINE_RUNS = 3;
export const NO_SKILL_NEEDED_LINE =
  'No skill needed: the agent did this right 3 times out of 3 without one. I stopped here.';

export function exclusionLine(kind: Exclusion, detail?: string): string {
  switch (kind) {
    case 'one-off':
      return "This is a one-off fix, so it doesn't need a skill. Fix it in this change.";
    case 'documented':
      return `This is already documented in ${detail ?? '<path>'}. Point the agent there instead of adding a skill.`;
    case 'convention':
      return 'This is a project convention. It belongs in the always-loaded instructions file, not a skill.';
    case 'enforceable':
      return "A script or hook can enforce this. I'll propose a rules-as-scripts check instead of a skill.";
  }
}

export interface JustifyInput {
  exclusion?: string;
  documentedIn?: string;
  enforceWith?: string;
}

interface Verdict {
  run: number;
  passed: boolean;
  note: string;
}

function producerHint(name: string): string {
  return (
    `Run the task ${BASELINE_RUNS} times without a skill in fresh contexts, save each transcript to ` +
    `baseline/run-<n>.md, write baseline/verdicts.json as [{run, passed, note}], then rerun ` +
    `paqad-ai skill justify ${name}.`
  );
}

function readVerdicts(workspace: SkillWorkspace): Verdict[] {
  const rel = 'baseline/verdicts.json';
  const text = workspace.read(rel);
  if (text === null) {
    throw new AuthoringRefusal(
      `${workspace.relPath(rel)} is missing. ${producerHint(workspace.name)}`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new AuthoringRefusal(
      `${workspace.relPath(rel)} is not valid JSON. ${producerHint(workspace.name)}`,
    );
  }
  if (!Array.isArray(parsed) || parsed.length !== BASELINE_RUNS) {
    throw new AuthoringRefusal(
      `${workspace.relPath(rel)} needs exactly ${BASELINE_RUNS} entries. ${producerHint(workspace.name)}`,
    );
  }
  const verdicts: Verdict[] = [];
  for (const [index, entry] of parsed.entries()) {
    const row = entry as Partial<Verdict> | null;
    const missing = (['run', 'passed', 'note'] as const).filter((field) => {
      if (row === null || typeof row !== 'object') return true;
      if (field === 'run') return typeof row.run !== 'number';
      if (field === 'passed') return typeof row.passed !== 'boolean';
      return typeof row.note !== 'string';
    });
    if (missing.length > 0) {
      throw new AuthoringRefusal(
        `${workspace.relPath(rel)} entry ${index + 1} is missing ${missing.join(', ')}. ${producerHint(workspace.name)}`,
      );
    }
    verdicts.push(row as Verdict);
  }
  for (let run = 1; run <= BASELINE_RUNS; run += 1) {
    if (!workspace.exists(`baseline/run-${run}.md`)) {
      throw new AuthoringRefusal(
        `${workspace.relPath(`baseline/run-${run}.md`)} is missing. ${producerHint(workspace.name)}`,
      );
    }
  }
  return verdicts;
}

function asExclusion(value: string): Exclusion {
  if ((EXCLUSIONS as readonly string[]).includes(value)) return value as Exclusion;
  throw new AuthoringRefusal(
    `--exclusion must be one of ${EXCLUSIONS.join(', ')} (got "${value}").`,
    2,
  );
}

function stopWithExclusion(
  workspace: SkillWorkspace,
  input: JustifyInput,
  kind: Exclusion,
): StageResult {
  if (kind === 'documented' && !input.documentedIn) {
    throw new AuthoringRefusal('--exclusion documented needs --documented-in <path>.', 2);
  }
  if (kind === 'enforceable' && !input.enforceWith) {
    throw new AuthoringRefusal(
      '--exclusion enforceable needs --enforce-with <hook or script> naming what will enforce it.',
      2,
    );
  }
  const line = exclusionLine(kind, input.documentedIn);
  const proposal =
    kind === 'enforceable'
      ? `Proposal: enforce this with ${input.enforceWith} instead of a skill. No skill folder was created.`
      : 'No skill folder was created.';
  const artifact = workspace.write(
    'justification.md',
    renderGateMarkdown(
      {
        gate: 'stopped',
        stage: 'S0',
        reason: `exclusion: ${kind}`,
        ...(kind === 'enforceable' ? { enforce_with: input.enforceWith } : {}),
      },
      `# Justification: ${workspace.name}\n\n${line}\n\n${proposal}\n`,
    ),
  );
  return { ...stageResult(false, [line, proposal], [artifact]), stopped: true };
}

export function runJustify(workspace: SkillWorkspace, input: JustifyInput = {}): StageResult {
  if (readMode(workspace).entry === 'improve') {
    return stageResult(true, [
      `${workspace.name} is in improve mode: the snapshot is the baseline, so S0 is skipped.`,
    ]);
  }
  if (input.exclusion !== undefined) {
    return stopWithExclusion(workspace, input, asExclusion(input.exclusion));
  }
  const verdicts = readVerdicts(workspace);
  const passed = verdicts.filter((verdict) => verdict.passed).length;
  const rows = verdicts
    .map(
      (verdict) => `| ${verdict.run} | ${verdict.passed ? 'passed' : 'failed'} | ${verdict.note} |`,
    )
    .join('\n');
  const table = `| Run | Result | Note |\n| --- | --- | --- |\n${rows}\n`;
  if (passed === BASELINE_RUNS) {
    const artifact = workspace.write(
      'justification.md',
      renderGateMarkdown(
        { gate: 'stopped', stage: 'S0', reason: 'baseline passed 3 of 3', baseline_passed: passed },
        `# Justification: ${workspace.name}\n\n${NO_SKILL_NEEDED_LINE}\n\n${table}`,
      ),
    );
    return { ...stageResult(false, [NO_SKILL_NEEDED_LINE], [artifact]), stopped: true };
  }
  const line = `A skill is justified: the agent got it wrong ${BASELINE_RUNS - passed} time${BASELINE_RUNS - passed === 1 ? '' : 's'} out of ${BASELINE_RUNS} without one.`;
  const artifact = workspace.write(
    'justification.md',
    renderGateMarkdown(
      { gate: 'passed', stage: 'S0', baseline_passed: passed },
      `# Justification: ${workspace.name}\n\n${line}\n\n${table}`,
    ),
  );
  return stageResult(
    true,
    [line, `Next: paqad-ai skill intake ${workspace.name} <intake.yaml>`],
    [artifact],
  );
}
