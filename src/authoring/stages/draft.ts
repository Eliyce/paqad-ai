import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

import { recordGateFailure } from '../evidence.js';
import { SKILL_FILE } from '../paths.js';
import {
  AuthoringRefusal,
  renderGateMarkdown,
  requireEarlierGates,
  type SkillWorkspace,
} from '../workspace.js';
import { readWorkspaceSources } from './sources.js';
import { stageResult, type StageResult } from './result.js';

export const DRAFT_DIR = 'draft';
export const DRAFT_SOURCE_FILE = 'draft-source.json';

export function readDraftSource(workspace: SkillWorkspace): string | null {
  return workspace.readJson<{ dir?: string }>(DRAFT_SOURCE_FILE)?.dir ?? null;
}
export const UNSOURCED_HEADING = '## Unsourced';

export function draftFolder(workspace: SkillWorkspace): string {
  return `${DRAFT_DIR}/${workspace.name}`;
}

export interface InstructionBlock {
  heading: string;
  start: number;
  end: number;
}

export function instructionBlocks(skillText: string): InstructionBlock[] {
  const lines = skillText.split(/\r?\n/);
  let bodyStart = 0;
  if (lines[0] === '---') {
    const close = lines.indexOf('---', 1);
    bodyStart = close === -1 ? 0 : close + 1;
  }
  while (lines.length > bodyStart && lines.at(-1)!.trim() === '') lines.pop();
  const blocks: InstructionBlock[] = [];
  let current: InstructionBlock | null = null;
  for (let index = bodyStart; index < lines.length; index += 1) {
    const heading = /^#{1,6}\s+(.+?)\s*$/u.exec(lines[index]!);
    if (heading) {
      if (current) blocks.push(current);
      current = { heading: heading[1]!, start: index + 1, end: index + 1 };
      continue;
    }
    if (current) current.end = index + 1;
  }
  if (current) blocks.push(current);
  return blocks;
}

export interface TraceMapping {
  heading: string;
  sources: string[];
}

export interface UnsourcedEntry {
  heading: string;
  justified: boolean;
}

function splitCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/u, '')
    .replace(/\|$/u, '')
    .split('|')
    .map((cell) => cell.trim());
}

export function parseTrace(text: string): {
  mappings: TraceMapping[];
  unsourced: UnsourcedEntry[];
} {
  const mappings: TraceMapping[] = [];
  const unsourced: UnsourcedEntry[] = [];
  let inUnsourced = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^##\s+/u.test(line)) {
      inUnsourced = line.trim() === UNSOURCED_HEADING;
      continue;
    }
    if (inUnsourced) {
      const item = /^\s*[-*]\s+(.+)$/u.exec(line);
      if (!item) continue;
      const body = item[1]!;
      const heading = body.split(/\s+\(lines\s|:\s/u)[0]!.trim();
      const justified = /\b(?:model-knowledge|accepted):\s*\S/u.test(body);
      unsourced.push({ heading, justified });
      continue;
    }
    if (!line.trim().startsWith('|')) continue;
    const [heading, , ids] = splitCells(line);
    if (!heading || heading === 'Block' || /^-+$/u.test(heading)) continue;
    const sources = (ids ?? '')
      .split(/[,\s]+/u)
      .map((id) => id.trim())
      .filter((id) => id.length > 0);
    mappings.push({ heading, sources });
  }
  return { mappings, unsourced };
}

function copyTree(source: string, target: string, workspace: SkillWorkspace, prefix = ''): void {
  const root = realpathSync(source);
  for (const name of readdirSync(join(source, prefix)).sort()) {
    const rel = prefix === '' ? name : `${prefix}/${name}`;
    const abs = join(source, rel);
    const stat = lstatSync(abs);
    if (stat.isSymbolicLink()) {
      throw new AuthoringRefusal(
        `S3 draft refused: ${rel} is a symlink. Copy the real file into the skill folder.`,
      );
    }
    const resolved = realpathSync(abs);
    if (resolved !== root && !resolved.startsWith(`${root}${sep}`)) {
      throw new AuthoringRefusal(`S3 draft refused: ${rel} resolves outside the skill folder.`);
    }
    if (stat.isDirectory()) {
      copyTree(source, target, workspace, rel);
      continue;
    }
    const buffer = readFileSync(abs);
    if (buffer.subarray(0, 8000).includes(0)) {
      const out = workspace.path(`${target}/${rel}`);
      mkdirSync(dirname(out), { recursive: true });
      copyFileSync(abs, out);
      continue;
    }
    workspace.write(`${target}/${rel}`, buffer.toString('utf8'));
  }
}

export interface DraftInput {
  dir: string;
  traceText: string;
  refuse?: string;
}

function refuseDraft(workspace: SkillWorkspace, reason: string): StageResult {
  const artifact = workspace.write(
    'trace.md',
    renderGateMarkdown(
      { gate: 'failed', stage: 'S3', reason: `refused: ${reason}` },
      `# Trace: ${workspace.name}\n\nThe draft was refused: ${reason}\n`,
    ),
  );
  workspace.remove(DRAFT_DIR);
  const receipt = recordGateFailure(workspace.projectRoot, {
    skill: workspace.name,
    gate: 'S3',
    evidencePath: artifact,
  });
  return stageResult(false, [receipt], [artifact]);
}

export function runDraft(workspace: SkillWorkspace, input: DraftInput): StageResult {
  requireEarlierGates(workspace, 'S3');
  if (input.refuse !== undefined) return refuseDraft(workspace, input.refuse);
  if (!existsSync(join(input.dir, SKILL_FILE))) {
    throw new AuthoringRefusal(`S3 draft refused: ${input.dir} holds no ${SKILL_FILE}.`, 2);
  }
  const target = draftFolder(workspace);
  workspace.remove(DRAFT_DIR);
  copyTree(input.dir, target, workspace);
  workspace.writeJson(DRAFT_SOURCE_FILE, {
    dir: relative(workspace.projectRoot, resolve(input.dir)).replaceAll('\\', '/'),
  });

  const skillText = workspace.read(`${target}/${SKILL_FILE}`) ?? '';
  const blocks = instructionBlocks(skillText);
  const known = new Set(readWorkspaceSources(workspace).map((row) => row.id));
  const trace = parseTrace(input.traceText);
  const unknownIds = new Set<string>();
  const added: InstructionBlock[] = [];
  const unjustified: string[] = [];

  for (const block of blocks) {
    const mapping = trace.mappings.find((entry) => entry.heading === block.heading);
    const mapped = mapping?.sources.filter((id) => known.has(id)) ?? [];
    for (const id of mapping?.sources ?? []) if (!known.has(id)) unknownIds.add(id);
    if (mapped.length > 0) continue;
    const listed = trace.unsourced.find((entry) => entry.heading === block.heading);
    if (listed?.justified) continue;
    unjustified.push(block.heading);
    if (!listed) added.push(block);
  }

  let traceText = input.traceText.replace(/\s*$/u, '\n');
  if (added.length > 0) {
    if (
      !traceText.includes(`\n${UNSOURCED_HEADING}\n`) &&
      !traceText.startsWith(`${UNSOURCED_HEADING}\n`)
    ) {
      traceText += `\n${UNSOURCED_HEADING}\n\n`;
    }
    traceText += added
      .map((block) => `- ${block.heading} (lines ${block.start}-${block.end}): needs a reason`)
      .join('\n');
    traceText += '\n';
  }
  const failed = unjustified.length > 0 || unknownIds.size > 0;
  const reasons: string[] = [];
  if (unjustified.length > 0)
    reasons.push(`unsourced blocks without a reason: ${unjustified.join(', ')}`);
  if (unknownIds.size > 0)
    reasons.push(`S-IDs not in sources.md: ${[...unknownIds].sort().join(', ')}`);
  const artifact = workspace.write(
    'trace.md',
    renderGateMarkdown(
      {
        gate: failed ? 'failed' : 'passed',
        stage: 'S3',
        ...(failed ? { reason: reasons.join('; ') } : {}),
        blocks: blocks.length,
      },
      traceText,
    ),
  );
  if (failed) {
    return stageResult(
      false,
      [
        `S3 draft failed: ${reasons.join('; ')}.`,
        `Give each one an S-ID from sources.md, or under ${UNSOURCED_HEADING} an "accepted: <reason>" or "model-knowledge: <why>", then rerun.`,
      ],
      [artifact, workspace.relPath(target)],
    );
  }
  return stageResult(
    true,
    [
      `S3 draft passed: all ${blocks.length} instruction blocks are traced.`,
      `Next: paqad-ai skill lint ${workspace.relPath(target)}`,
    ],
    [artifact, workspace.relPath(target)],
  );
}
